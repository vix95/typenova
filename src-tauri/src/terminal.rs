//! The integrated terminal: shells that run in a pseudo terminal (ConPTY on Windows, a pty elsewhere) and stream their output to the window.
//!
//! A terminal is a child process the user started on purpose, as in any terminal emulator. Nothing here runs by itself: a shell starts only when
//! the window asks for one, in a folder that exists, and everything it prints goes back through the channel the window gave.

use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, AppHandle, Manager, State};

/// Most a single write to a terminal may carry (a paste), so that one call cannot flood the shell.
const MAX_WRITE_BYTES: usize = 1 << 20;

/// What a terminal sends to the window.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalEvent {
  /// Output of the shell, as base64 (it is a byte stream: a character may be split between two chunks).
  Data { data: String },
  Exit { code: Option<u32> },
}

/// A shell that can be started.
#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
  pub id: String,
  pub label: String,
  pub path: String,
  pub args: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellList {
  pub shells: Vec<ShellProfile>,
  pub default_id: Option<String>,
}

struct Session {
  master: Box<dyn MasterPty + Send>,
  writer: Box<dyn Write + Send>,
  killer: Box<dyn ChildKiller + Send + Sync>,
}

/// Tells a session from an earlier one that had the same id: the end of the old one must not remove the new one.
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Default, Clone)]
pub struct Terminals(Arc<Mutex<HashMap<String, (u64, Session)>>>);

fn is_executable_file(path: &Path) -> bool {
  path.is_file()
}

/// The first file called `name` (with the executable extensions on Windows) in the folders of PATH.
fn find_in_path(name: &str) -> Option<PathBuf> {
  let paths = std::env::var_os("PATH")?;
  let extensions: Vec<String> = if cfg!(windows) {
    std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".into()).split(';').filter(|item| !item.is_empty()).map(|item| item.to_ascii_lowercase()).collect()
  } else {
    vec![String::new()]
  };
  for folder in std::env::split_paths(&paths) {
    for extension in &extensions {
      let candidate = folder.join(format!("{name}{extension}"));
      if is_executable_file(&candidate) { return Some(candidate); }
    }
  }
  None
}

fn profile(id: &str, label: &str, path: &Path, args: &[&str]) -> ShellProfile {
  ShellProfile { id: id.into(), label: label.into(), path: path.to_string_lossy().into_owned(), args: args.iter().map(|item| item.to_string()).collect() }
}

/// Keeps the first profile of each id and each path.
fn dedupe(profiles: Vec<ShellProfile>) -> Vec<ShellProfile> {
  let mut seen_ids = std::collections::HashSet::new();
  let mut seen_paths = std::collections::HashSet::new();
  profiles.into_iter().filter(|item| seen_ids.insert(item.id.clone()) && seen_paths.insert(item.path.to_ascii_lowercase())).collect()
}

#[cfg(windows)]
fn detect_shells() -> Vec<ShellProfile> {
  let env_path = |name: &str| std::env::var_os(name).map(PathBuf::from);
  let system_root = env_path("SystemRoot").unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
  let mut found = Vec::new();
  let mut push = |id: &str, label: &str, candidates: Vec<PathBuf>, args: &[&str]| {
    if let Some(path) = candidates.into_iter().find(|candidate| is_executable_file(candidate)) { found.push(profile(id, label, &path, args)); }
  };
  let program_files = [env_path("ProgramFiles"), env_path("ProgramW6432"), env_path("ProgramFiles(x86)")].into_iter().flatten().collect::<Vec<_>>();
  let mut pwsh: Vec<PathBuf> = find_in_path("pwsh").into_iter().collect();
  pwsh.extend(program_files.iter().map(|base| base.join(r"PowerShell\7\pwsh.exe")));
  push("pwsh", "PowerShell", pwsh, &["-NoLogo"]);
  push("powershell", "Windows PowerShell", vec![system_root.join(r"System32\WindowsPowerShell\v1.0\powershell.exe")], &["-NoLogo"]);
  push("cmd", "Command Prompt", vec![env_path("ComSpec").unwrap_or_else(|| system_root.join(r"System32\cmd.exe"))], &[]);
  let mut git_bash: Vec<PathBuf> = program_files.iter().map(|base| base.join(r"Git\bin\bash.exe")).collect();
  if let Some(local) = env_path("LOCALAPPDATA") { git_bash.push(local.join(r"Programs\Git\bin\bash.exe")); }
  // Git for Windows also puts git.exe in PATH (…\Git\cmd\git.exe); its bash is two folders up.
  if let Some(git) = find_in_path("git") { if let Some(root) = git.parent().and_then(|cmd| cmd.parent()) { git_bash.push(root.join(r"bin\bash.exe")); } }
  push("gitbash", "Git Bash", git_bash, &["--login", "-i"]);
  push("wsl", "WSL", vec![system_root.join(r"System32\wsl.exe")], &[]);
  let system32 = system_root.join("System32");
  // The tools that come with Git Bash (its bash, sh, zsh…) are that shell, not other ones.
  let git_root = found.iter().find(|shell| shell.id == "gitbash").and_then(|shell| Path::new(&shell.path).parent()?.parent().map(Path::to_path_buf));
  for (name, label) in [("nu", "Nushell"), ("fish", "fish"), ("zsh", "zsh"), ("bash", "bash"), ("sh", "sh")] {
    // The bash.exe of System32 only starts WSL, which is listed above.
    if let Some(path) = find_in_path(name).filter(|path| !path.starts_with(&system32) && !git_root.as_ref().is_some_and(|root| path.starts_with(root))) { found.push(profile(name, label, &path, &[])); }
  }
  dedupe(found)
}

#[cfg(not(windows))]
fn detect_shells() -> Vec<ShellProfile> {
  let mut found = Vec::new();
  let login: &[&str] = &["-l"];
  if let Ok(listed) = std::fs::read_to_string("/etc/shells") {
    for line in listed.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with('#')) {
      let path = Path::new(line);
      let name = path.file_name().and_then(|item| item.to_str()).unwrap_or("shell");
      if is_executable_file(path) && name != "nologin" && name != "false" { found.push(profile(name, name, path, login)); }
    }
  }
  if let Some(shell) = std::env::var_os("SHELL").map(PathBuf::from).filter(|path| is_executable_file(path)) {
    let name = shell.file_name().and_then(|item| item.to_str()).unwrap_or("shell").to_string();
    found.insert(0, profile(&name, &name, &shell, login));
  }
  for name in ["pwsh", "nu", "fish", "zsh", "bash"] {
    if let Some(path) = find_in_path(name) { found.push(profile(name, name, &path, if name == "pwsh" || name == "nu" { &[] } else { login })); }
  }
  dedupe(found)
}

/// The shell used when none is named: PowerShell on Windows, the user's login shell elsewhere.
fn default_shell_id(shells: &[ShellProfile]) -> Option<String> {
  if cfg!(windows) {
    return ["pwsh", "powershell", "cmd"].iter().find(|id| shells.iter().any(|shell| shell.id == **id)).map(|id| id.to_string());
  }
  let login = std::env::var_os("SHELL").map(PathBuf::from).and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()));
  login.filter(|name| shells.iter().any(|shell| &shell.id == name)).or_else(|| shells.first().map(|shell| shell.id.clone()))
}

#[tauri::command]
pub fn terminal_shells() -> ShellList {
  let shells = detect_shells();
  let default_id = default_shell_id(&shells);
  ShellList { shells, default_id }
}

/// An id the window chose for a terminal: short and made of plain characters, so that it can never be anything but a key.
fn valid_id(id: &str) -> bool {
  !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn start_dir(cwd: Option<&str>) -> PathBuf {
  cwd.map(PathBuf::from).filter(|path| path.is_dir()).or_else(|| std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)).unwrap_or_else(std::env::temp_dir)
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
  PtySize { rows: rows.clamp(1, 500), cols: cols.clamp(1, 1000), pixel_width: 0, pixel_height: 0 }
}

/// Starts `path` in a pseudo terminal. Output goes to `emit`, from a thread of its own. When the shell has ended and its last output was passed on,
/// `emit` gets the exit and then `on_exit` is called: the pseudo terminal must be closed by the caller then (on Windows its output only ends when it is closed).
fn start_session(path: &str, args: &[String], cwd: Option<&str>, cols: u16, rows: u16, emit: impl Fn(TerminalEvent) + Send + Sync + 'static, on_exit: impl FnOnce() + Send + 'static) -> Result<(Session, u32), String> {
  let shell = Path::new(path);
  if !is_executable_file(shell) { return Err(format!("the shell was not found: {path}")); }
  let pair = native_pty_system().openpty(pty_size(cols, rows)).map_err(|error| format!("cannot open a terminal: {error}"))?;
  let mut command = CommandBuilder::new(shell);
  command.args(args);
  command.cwd(start_dir(cwd));
  command.env("TERM", "xterm-256color");
  command.env("COLORTERM", "truecolor");
  command.env("TERM_PROGRAM", "TypeNova");
  let mut child = pair.slave.spawn_command(command).map_err(|error| format!("cannot start the shell: {error}"))?;
  drop(pair.slave);
  let pid = child.process_id().unwrap_or(0);
  let killer = child.clone_killer();
  let mut reader = pair.master.try_clone_reader().map_err(|error| format!("cannot read the terminal: {error}"))?;
  let writer = pair.master.take_writer().map_err(|error| format!("cannot write to the terminal: {error}"))?;
  let emit = Arc::new(emit);
  let output = emit.clone();
  std::thread::spawn(move || {
    let mut buffer = [0u8; 16 * 1024];
    loop {
      match reader.read(&mut buffer) {
        Ok(0) | Err(_) => break,
        Ok(count) => output(TerminalEvent::Data { data: STANDARD.encode(&buffer[..count]) }),
      }
    }
  });
  std::thread::spawn(move || {
    let code = child.wait().ok().map(|status| status.exit_code());
    // What the shell printed last is still on its way through the reader thread.
    std::thread::sleep(std::time::Duration::from_millis(250));
    emit(TerminalEvent::Exit { code });
    on_exit();
  });
  Ok((Session { master: pair.master, writer, killer }, pid))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn terminal_spawn(terminals: State<Terminals>, id: String, shell: String, args: Vec<String>, cwd: Option<String>, cols: u16, rows: u16, on_event: Channel<TerminalEvent>) -> Result<u32, String> {
  if !valid_id(&id) { return Err("invalid terminal id".into()); }
  let mut sessions = terminals.0.lock().map_err(|_| "terminals are unavailable")?;
  if sessions.contains_key(&id) { return Err("this terminal is already running".into()); }
  let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
  let all = terminals.inner().0.clone();
  let own_id = id.clone();
  let (session, pid) = start_session(&shell, &args, cwd.as_deref(), cols, rows, move |event| { let _ = on_event.send(event); }, move || {
    // The shell is over: forgetting the session closes its pseudo terminal (unless a newer session already took the id).
    if let Ok(mut sessions) = all.lock() { if sessions.get(&own_id).map(|(current, _)| *current) == Some(generation) { sessions.remove(&own_id); } }
  })?;
  sessions.insert(id, (generation, session));
  Ok(pid)
}

#[tauri::command]
pub fn terminal_write(terminals: State<Terminals>, id: String, data: String) -> Result<(), String> {
  if data.len() > MAX_WRITE_BYTES { return Err("too much text at once".into()); }
  let mut sessions = terminals.0.lock().map_err(|_| "terminals are unavailable")?;
  let (_, session) = sessions.get_mut(&id).ok_or("no such terminal")?;
  session.writer.write_all(data.as_bytes()).and_then(|_| session.writer.flush()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_resize(terminals: State<Terminals>, id: String, cols: u16, rows: u16) -> Result<(), String> {
  let sessions = terminals.0.lock().map_err(|_| "terminals are unavailable")?;
  let (_, session) = sessions.get(&id).ok_or("no such terminal")?;
  session.master.resize(pty_size(cols, rows)).map_err(|error| error.to_string())
}

/// Ends a terminal's shell and forgets it. Asking for one that is gone is not an error.
#[tauri::command]
pub fn terminal_kill(terminals: State<Terminals>, id: String) -> Result<(), String> {
  let mut sessions = terminals.0.lock().map_err(|_| "terminals are unavailable")?;
  if let Some((_, mut session)) = sessions.remove(&id) { let _ = session.killer.kill(); }
  Ok(())
}

/// Ends every shell (the program is closing).
pub fn kill_all(app: &AppHandle) {
  if let Some(terminals) = app.try_state::<Terminals>() {
    if let Ok(mut sessions) = terminals.0.lock() {
      for (_, (_, mut session)) in sessions.drain() { let _ = session.killer.kill(); }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::mpsc;
  use std::time::{Duration, Instant};

  #[test]
  fn ids_are_plain_keys() {
    assert!(valid_id("t-1_a"));
    assert!(!valid_id(""));
    assert!(!valid_id("a b"));
    assert!(!valid_id("../x"));
    assert!(!valid_id(&"x".repeat(65)));
  }

  #[test]
  fn profiles_are_listed_once() {
    let a = profile("bash", "bash", Path::new("/bin/bash"), &[]);
    let same_path = profile("sh", "sh", Path::new("/BIN/bash"), &[]);
    let same_id = profile("bash", "bash 2", Path::new("/usr/bin/bash"), &[]);
    let other = profile("zsh", "zsh", Path::new("/bin/zsh"), &[]);
    let listed = dedupe(vec![a.clone(), same_path, same_id, other.clone()]);
    assert_eq!(listed, vec![a, other]);
  }

  #[test]
  fn the_default_shell_is_one_that_exists() {
    let shells = detect_shells();
    if shells.is_empty() { return; }
    let default = default_shell_id(&shells).expect("a default shell");
    assert!(shells.iter().any(|shell| shell.id == default));
  }

  #[test]
  fn shells_of_this_computer_are_listed() {
    let shells = detect_shells();
    for shell in &shells { println!("shell {} | {} | {} {:?}", shell.id, shell.label, shell.path, shell.args); }
    println!("default: {:?}", default_shell_id(&shells));
    assert!(shells.iter().all(|shell| Path::new(&shell.path).is_file()));
  }

  #[test]
  fn a_missing_start_folder_falls_back_to_the_home_folder() {
    let home = start_dir(Some("/definitely/not/a/folder"));
    assert!(home.is_dir());
    assert_eq!(start_dir(Some(std::env::temp_dir().to_str().unwrap())), std::env::temp_dir());
  }

  #[test]
  fn a_missing_shell_is_refused_and_a_path_is_found_in_path() {
    assert!(start_session("/no/such/shell", &[], None, 80, 24, |_| {}, || {}).is_err());
    let dir = std::env::temp_dir().join(format!("typenova-path-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let name = if cfg!(windows) { "typenova-tool.exe" } else { "typenova-tool" };
    std::fs::write(dir.join(name), b"x").unwrap();
    let before = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![dir.clone()];
    paths.extend(std::env::split_paths(&before));
    std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
    let found = find_in_path("typenova-tool");
    std::env::set_var("PATH", before);
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(found.map(|path| path.file_name().unwrap().to_owned()), Some(std::ffi::OsString::from(name)));
  }

  /// What a terminal emulator does for the shell: Windows' ConPTY asks where the cursor is (ESC [ 6 n) and waits for the answer before it goes on.
  fn answer_cursor_request(session: &mut Session, text: &[u8], answered: &mut bool) {
    if !*answered && text.windows(4).any(|part| part == b"[6n") {
      session.writer.write_all(b"[1;1R").unwrap();
      session.writer.flush().unwrap();
      *answered = true;
    }
  }

  /// Reads what a command printed through a real pseudo terminal, and its exit.
  fn run_to_end(shell: &str, args: &[&str]) -> (String, Option<u32>) {
    let (sender, receiver) = mpsc::channel();
    let args: Vec<String> = args.iter().map(|item| item.to_string()).collect();
    let (mut session, _pid) = start_session(shell, &args, None, 100, 30, move |event| { let _ = sender.send(event); }, || {}).expect("the shell starts");
    let mut text = Vec::new();
    let mut answered = false;
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
      match receiver.recv_timeout(Duration::from_millis(200)) {
        Ok(TerminalEvent::Data { data }) => { text.extend(STANDARD.decode(data).unwrap()); answer_cursor_request(&mut session, &text, &mut answered); }
        Ok(TerminalEvent::Exit { code }) => return (String::from_utf8_lossy(&text).into_owned(), code),
        Err(_) => {}
      }
    }
    panic!("the shell did not finish: {}", String::from_utf8_lossy(&text));
  }

  #[test]
  fn a_real_shell_runs_in_the_pseudo_terminal_and_reports_its_exit() {
    let (shell, args): (String, Vec<&str>) = if cfg!(windows) {
      (std::env::var("ComSpec").unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into()), vec!["/c", "echo typenova-terminal-ok & exit 3"])
    } else {
      ("/bin/sh".into(), vec!["-c", "echo typenova-terminal-ok; exit 3"])
    };
    let (text, code) = run_to_end(&shell, &args);
    assert!(text.contains("typenova-terminal-ok"), "output was: {text:?}");
    assert_eq!(code, Some(3));
  }

  #[test]
  fn input_written_to_a_session_reaches_the_shell() {
    let (shell, args): (String, Vec<String>) = if cfg!(windows) {
      (std::env::var("ComSpec").unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into()), vec![])
    } else {
      ("/bin/sh".into(), vec![])
    };
    let (sender, receiver) = mpsc::channel();
    let (mut session, _pid) = start_session(&shell, &args, None, 100, 30, move |event| { let _ = sender.send(event); }, || {}).expect("the shell starts");
    session.writer.write_all(b"echo typenova-typed-input\r\n").unwrap();
    session.writer.flush().unwrap();
    session.master.resize(pty_size(120, 40)).expect("the terminal resizes");
    let mut text = Vec::new();
    let mut answered = false;
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut seen = false;
    while Instant::now() < deadline && !seen {
      if let Ok(TerminalEvent::Data { data }) = receiver.recv_timeout(Duration::from_millis(200)) {
        text.extend(STANDARD.decode(data).unwrap());
        answer_cursor_request(&mut session, &text, &mut answered);
        seen = String::from_utf8_lossy(&text).matches("typenova-typed-input").count() >= 2;
      }
    }
    let _ = session.killer.kill();
    assert!(seen, "the shell echoed the command and printed its output: {:?}", String::from_utf8_lossy(&text));
  }
}
