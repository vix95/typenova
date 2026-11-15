//! Working with Git from the interface: what changed (index and working tree), staging and unstaging, committing what is staged, pushing, switching and creating branches,
//! and the committed text of a file for the change markers in the margin.
//!
//! Like `git_sync.rs` this goes through the `git` executable with an argument list (never a shell). Paths from the interface are checked (relative, no `..`) and given to git
//! as literal pathspecs, so a file named `*` or `:(top)x` is just a file. Nothing here forces, discards changes or skips hooks.

use crate::git::{run_git, safe_relative_path, valid_rev};
use crate::git_sync::{blocked_reason, current_branch, push_branch, push_remote, upstream_of_head};
use serde::Serialize;

/// More changes than this are counted but not listed.
const MAX_LISTED: usize = 2000;
const MAX_MESSAGE: usize = 2000;
/// A committed file bigger than this gets no change markers.
const MAX_BASE_BYTES: usize = 2_000_000;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileState {
  pub path: String,
  pub old_path: Option<String>,
  /// Status in the index (`A`, `M`, `D`, `R`, `C`, `T`), empty when the file is not staged.
  pub index: String,
  /// Status in the working tree (`M`, `D`, `T`, or `?` for a new file that git does not know yet), empty when unchanged.
  pub worktree: String,
  pub conflicted: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkState {
  pub branch: Option<String>,
  pub upstream: Option<String>,
  pub ahead: u32,
  pub behind: u32,
  pub has_commits: bool,
  /// The remote a first push would go to.
  pub remote: Option<String>,
  pub files: Vec<FileState>,
  pub total: u32,
  /// Why nothing can be committed (detached HEAD, a merge or rebase in progress, conflicts).
  pub blocked: Option<String>,
}

fn parse_files(text: &str) -> (Vec<FileState>, bool) {
  let mut files = Vec::new();
  let mut conflicts = false;
  let mut parts = text.split('\0');
  while let Some(entry) = parts.next() {
    if entry.len() < 4 || !entry.is_char_boundary(3) {
      continue;
    }
    let (x, y) = (entry.as_bytes()[0] as char, entry.as_bytes()[1] as char);
    let path = entry[3..].to_string();
    let conflicted = matches!((x, y), ('D', 'D') | ('A', 'U') | ('U', 'D') | ('U', 'A') | ('D', 'U') | ('A', 'A') | ('U', 'U'));
    conflicts |= conflicted;
    let old_path = if x == 'R' || x == 'C' || y == 'R' || y == 'C' { parts.next().map(str::to_string) } else { None };
    let letter = |value: char| if value == ' ' { String::new() } else { value.to_string() };
    let (index, worktree) = if (x, y) == ('?', '?') { (String::new(), "?".to_string()) } else { (letter(x), letter(y)) };
    files.push(FileState { path, old_path, index, worktree, conflicted });
  }
  (files, conflicts)
}

fn count_pair(text: &str) -> (u32, u32) {
  let mut numbers = text.split_whitespace().map(|value| value.parse::<u32>().unwrap_or(0));
  (numbers.next().unwrap_or(0), numbers.next().unwrap_or(0))
}

fn state(repo: &str) -> Result<WorkState, String> {
  let status = run_git(repo, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
  let (mut files, conflicts) = parse_files(&status);
  let total = files.len() as u32;
  files.truncate(MAX_LISTED);
  let branch = current_branch(repo);
  let upstream = if branch.is_some() { upstream_of_head(repo) } else { None };
  let remote = if upstream.is_none() { push_remote(repo) } else { None };
  let (ahead, behind) = if upstream.is_some() { run_git(repo, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).map(|text| count_pair(&text)).unwrap_or((0, 0)) } else { (0, 0) };
  let has_commits = run_git(repo, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok();
  let blocked = blocked_reason(repo, conflicts, &branch);
  Ok(WorkState { branch, upstream, ahead, behind, has_commits, remote, files, total, blocked })
}

/// Paths as literal pathspecs, after checking that each one is a plain relative path.
fn literal_paths(paths: &[String]) -> Result<Vec<String>, String> {
  if paths.is_empty() {
    return Err("no files".into());
  }
  paths.iter().map(|path| if safe_relative_path(path) { Ok(format!(":(literal){path}")) } else { Err(format!("invalid path: {path}")) }).collect()
}

fn stage(repo: &str, paths: &[String]) -> Result<(), String> {
  let specs = literal_paths(paths)?;
  let mut args: Vec<&str> = vec!["add", "-A", "--"];
  args.extend(specs.iter().map(String::as_str));
  run_git(repo, &args).map(|_| ())
}

fn unstage(repo: &str, paths: &[String]) -> Result<(), String> {
  let specs = literal_paths(paths)?;
  let has_commits = run_git(repo, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok();
  // Before the first commit there is no HEAD to restore from: the files are taken out of the index.
  let mut args: Vec<&str> = if has_commits { vec!["restore", "--staged", "--"] } else { vec!["rm", "--cached", "-r", "-q", "--"] };
  args.extend(specs.iter().map(String::as_str));
  run_git(repo, &args).map(|_| ())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
  pub commit: String,
}

/// Commits what is staged (and only that) with `message`.
fn commit_staged(repo: &str, message: &str) -> Result<CommitResult, String> {
  let message = message.trim();
  if message.is_empty() || message.len() > MAX_MESSAGE || message.contains('\0') {
    return Err("the commit message is empty or too long".into());
  }
  let current = state(repo)?;
  if let Some(reason) = current.blocked {
    return Err(format!("nothing was committed: {reason}"));
  }
  if run_git(repo, &["diff", "--cached", "--quiet"]).is_ok() && current.has_commits {
    return Err("nothing is staged".into());
  }
  run_git(repo, &["commit", "-m", message])?;
  Ok(CommitResult { commit: run_git(repo, &["rev-parse", "--short", "HEAD"]).map(|text| text.trim().to_string()).unwrap_or_default() })
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
  pub pushed: bool,
  pub target: Option<String>,
  pub error: Option<String>,
}

fn push(repo: &str) -> Result<PushResult, String> {
  let branch = current_branch(repo).ok_or("detached HEAD: there is no branch to push")?;
  let upstream = upstream_of_head(repo);
  let remote = if upstream.is_none() { push_remote(repo) } else { None };
  let (pushed, target, error) = push_branch(repo, &upstream, &remote, &branch);
  Ok(PushResult { pushed, target, error })
}

/// Switches to a branch (`local`), creates one from the current commit (`new`), or creates a local branch that tracks a remote one (`track`, `origin/feature`).
fn switch(repo: &str, target: &str, mode: &str) -> Result<String, String> {
  if !valid_rev(target) || run_git(repo, &["check-ref-format", "--branch", target]).is_err() {
    return Err(format!("invalid branch name: {target}"));
  }
  let args: Vec<&str> = match mode {
    "local" => vec!["switch", target],
    "new" => vec!["switch", "-c", target],
    "track" => vec!["switch", "--track", target],
    _ => return Err("unknown mode".into()),
  };
  run_git(repo, &args)?;
  Ok(current_branch(repo).unwrap_or_default())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeadText {
  /// `tracked` (text is the committed text), `new` (not committed yet: every line counts as added), or `none` (ignored, binary or too big: no markers).
  pub kind: String,
  pub text: String,
}

fn head_text(repo: &str, path: &str) -> Result<HeadText, String> {
  if !safe_relative_path(path) {
    return Err("invalid path".into());
  }
  let none = || HeadText { kind: "none".into(), text: String::new() };
  let spec = format!("HEAD:{path}");
  if run_git(repo, &["cat-file", "-e", &spec]).is_ok() {
    let size = run_git(repo, &["cat-file", "-s", &spec]).ok().and_then(|text| text.trim().parse::<usize>().ok()).unwrap_or(usize::MAX);
    if size > MAX_BASE_BYTES {
      return Ok(none());
    }
    let text = run_git(repo, &["show", &spec])?;
    return Ok(if text.contains('\0') { none() } else { HeadText { kind: "tracked".into(), text } });
  }
  // `check-ignore` takes plain paths (not pathspecs).
  Ok(if run_git(repo, &["check-ignore", "-q", "--", path]).is_ok() { none() } else { HeadText { kind: "new".into(), text: String::new() } })
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(job).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_work_state(repo: String) -> Result<WorkState, String> { blocking(move || state(&repo)).await }
#[tauri::command]
pub async fn git_stage(repo: String, paths: Vec<String>) -> Result<(), String> { blocking(move || stage(&repo, &paths)).await }
#[tauri::command]
pub async fn git_unstage(repo: String, paths: Vec<String>) -> Result<(), String> { blocking(move || unstage(&repo, &paths)).await }
#[tauri::command]
pub async fn git_commit_staged(repo: String, message: String) -> Result<CommitResult, String> { blocking(move || commit_staged(&repo, &message)).await }
#[tauri::command]
pub async fn git_push(repo: String) -> Result<PushResult, String> { blocking(move || push(&repo)).await }
#[tauri::command]
pub async fn git_switch(repo: String, target: String, mode: String) -> Result<String, String> { blocking(move || switch(&repo, &target, &mode)).await }
#[tauri::command]
pub async fn git_head_text(repo: String, path: String) -> Result<HeadText, String> { blocking(move || head_text(&repo, &path)).await }

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::path::Path;
  use std::process::Command;

  fn git_available() -> bool {
    Command::new("git").arg("--version").output().map(|output| output.status.success()).unwrap_or(false)
  }

  fn git_in(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(output.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&output.stderr));
    String::from_utf8_lossy(&output.stdout).into_owned()
  }

  #[test]
  fn the_status_is_parsed_into_index_and_working_tree() {
    let (files, conflicts) = parse_files("M  staged.md\0 M edited.md\0MM both.md\0?? new.md\0R  new-name.md\0old-name.md\0 D gone.md\0");
    let got: Vec<(&str, &str, &str)> = files.iter().map(|file| (file.path.as_str(), file.index.as_str(), file.worktree.as_str())).collect();
    assert_eq!(got, vec![("staged.md", "M", ""), ("edited.md", "", "M"), ("both.md", "M", "M"), ("new.md", "", "?"), ("new-name.md", "R", ""), ("gone.md", "", "D")]);
    assert_eq!(files[4].old_path.as_deref(), Some("old-name.md"));
    assert!(!conflicts && parse_files("UU a.md\0").1);
    assert_eq!(count_pair("2\t1\n"), (2, 1));
  }

  #[test]
  fn files_are_staged_committed_pushed_and_branches_switched() {
    if !git_available() {
      return;
    }
    let base = std::env::temp_dir().join(format!("typenova-work-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let (remote, work) = (base.join("remote.git"), base.join("work"));
    fs::create_dir_all(&remote).unwrap();
    fs::create_dir_all(&work).unwrap();
    git_in(&remote, &["init", "-q", "--bare", "-b", "main"]);
    git_in(&work, &["init", "-q", "-b", "main"]);
    for (key, value) in [("user.email", "t@example.com"), ("user.name", "Tester"), ("commit.gpgsign", "false")] {
      git_in(&work, &["config", key, value]);
    }
    let repo = work.to_string_lossy().into_owned();

    // Before the first commit: stage, unstage, commit.
    fs::write(work.join("a.md"), "one\ntwo\n").unwrap();
    fs::write(work.join("b[1].md"), "literal name\n").unwrap();
    assert_eq!(state(&repo).unwrap().has_commits, false);
    stage(&repo, &["a.md".into()]).unwrap();
    assert_eq!(git_in(&work, &["diff", "--cached", "--name-only"]).trim(), "a.md");
    unstage(&repo, &["a.md".into()]).unwrap();
    assert_eq!(git_in(&work, &["diff", "--cached", "--name-only"]).trim(), "");
    assert!(commit_staged(&repo, "Nothing staged").is_err());
    stage(&repo, &["a.md".into(), "b[1].md".into()]).unwrap();
    assert_eq!(git_in(&work, &["diff", "--cached", "--name-only"]).lines().count(), 2, "a name with brackets is taken literally");
    assert!(commit_staged(&repo, "  ").is_err());
    assert!(stage(&repo, &["../outside".into()]).is_err() && stage(&repo, &[]).is_err());
    assert!(commit_staged(&repo, "First").unwrap().commit.len() >= 7);
    git_in(&work, &["remote", "add", "origin", &remote.to_string_lossy()]);

    // Only what is staged is committed; the rest stays changed.
    fs::write(work.join("a.md"), "one\ntwo\nthree\n").unwrap();
    fs::write(work.join("c.md"), "new\n").unwrap();
    stage(&repo, &["c.md".into()]).unwrap();
    let mid = state(&repo).unwrap();
    assert_eq!(mid.branch.as_deref(), Some("main"));
    assert!(mid.files.iter().any(|f| f.path == "c.md" && f.index == "A") && mid.files.iter().any(|f| f.path == "a.md" && f.worktree == "M" && f.index.is_empty()));
    commit_staged(&repo, "Add c").unwrap();
    assert_eq!(git_in(&work, &["show", "--name-only", "--format=", "HEAD"]).trim(), "c.md");
    assert!(state(&repo).unwrap().files.iter().any(|f| f.path == "a.md"), "a.md is still a change");

    // The committed text for the margin: tracked, new, and ignored.
    assert_eq!(head_text(&repo, "a.md").unwrap(), HeadText { kind: "tracked".into(), text: "one\ntwo\n".into() });
    fs::write(work.join("fresh.md"), "x\n").unwrap();
    assert_eq!(head_text(&repo, "fresh.md").unwrap().kind, "new");
    fs::write(work.join(".gitignore"), "ignored.md\n").unwrap();
    fs::write(work.join("ignored.md"), "x\n").unwrap();
    assert_eq!(head_text(&repo, "ignored.md").unwrap().kind, "none");
    assert!(head_text(&repo, "../x").is_err());

    // Push: the first one sets the upstream, later ones are plain pushes; ahead/behind follow.
    let first = push(&repo).unwrap();
    assert!(first.pushed && first.target.as_deref() == Some("origin/main"), "{first:?}");
    let synced = state(&repo).unwrap();
    assert_eq!((synced.upstream.as_deref(), synced.ahead, synced.behind), (Some("origin/main"), 0, 0));
    stage(&repo, &["a.md".into()]).unwrap();
    commit_staged(&repo, "Update a").unwrap();
    assert_eq!(state(&repo).unwrap().ahead, 1);
    assert!(push(&repo).unwrap().pushed);

    // Branches: create, switch back, switch with a change that does not conflict, a remote branch tracked, bad names refused.
    assert_eq!(switch(&repo, "feature/x", "new").unwrap(), "feature/x");
    assert_eq!(switch(&repo, "main", "local").unwrap(), "main");
    assert!(switch(&repo, "nope", "local").is_err());
    assert!(switch(&repo, "bad name", "new").is_err() && switch(&repo, "-x", "local").is_err() && switch(&repo, "a..b", "new").is_err());
    git_in(&work, &["push", "-q", "origin", "main:release"]);
    git_in(&work, &["fetch", "-q", "origin"]);
    assert_eq!(switch(&repo, "origin/release", "track").unwrap(), "release");
    assert_eq!(upstream_of_head(&repo).as_deref(), Some("origin/release"));
    // A change that would be overwritten stops the switch and says so.
    git_in(&work, &["switch", "-q", "main"]);
    fs::write(work.join("a.md"), "main edit\n").unwrap();
    git_in(&work, &["commit", "-q", "-am", "main edit"]);
    git_in(&work, &["switch", "-q", "release"]);
    fs::write(work.join("a.md"), "local unsaved edit\n").unwrap();
    assert!(switch(&repo, "main", "local").is_err());
    assert_eq!(current_branch(&repo).as_deref(), Some("release"));
    let _ = fs::remove_dir_all(&base);
  }
}
