//! The operations of a Git client beyond commit and push: fetching, creating, renaming and deleting branches, merging, rebasing, cherry-picking, reverting, resetting,
//! tags, checking out a commit, stashes, and continuing or aborting an operation that stopped on a conflict.
//!
//! Like the other Git modules this goes through the `git` executable with an argument list (never a shell). Names, revisions and hashes from the interface are checked first.
//! An operation that stops on a conflict is not an error: it comes back as an `OpResult` with `ok: false` and git's own words, and the repository is left in that state for the
//! person to resolve (the Changes panel shows the conflicts) or to abort. Nothing here forces a push or skips hooks; what destroys work (a hard reset, a forced branch delete) is
//! asked for explicitly by the interface and is only run on request.

use crate::git::{run_git, valid_hash, valid_rev};
use crate::git_sync::{current_branch, operation_in_progress};
use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
  /// False when git stopped (most often on a conflict); `message` says why.
  pub ok: bool,
  pub message: String,
  /// A merge, rebase, cherry-pick or revert is waiting to be continued or aborted.
  pub in_progress: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
  pub index: u32,
  pub message: String,
  pub date: String,
}

/// Runs git and gives its output whatever the exit status was: a merge that stops on a conflict exits non-zero and prints on stdout.
fn run_capture(repo: &str, args: &[&str]) -> Result<(bool, String), String> {
  let mut command = Command::new("git");
  command
    .arg("-C")
    .arg(repo)
    .args(["-c", "core.quotepath=false", "-c", "log.showSignature=false", "-c", "core.editor=true", "--no-pager"])
    .args(args)
    .env("GIT_TERMINAL_PROMPT", "0")
    .env("GIT_EDITOR", "true")
    .env("GIT_SEQUENCE_EDITOR", "true");
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000); // no console window
  }
  let output = command.output().map_err(|error| if error.kind() == std::io::ErrorKind::NotFound { "Git is not installed or not on the PATH".to_string() } else { error.to_string() })?;
  let mut text = String::from_utf8_lossy(&output.stdout).trim().to_string();
  let errors = String::from_utf8_lossy(&output.stderr).trim().to_string();
  if !errors.is_empty() {
    if !text.is_empty() { text.push('\n'); }
    text.push_str(&errors);
  }
  Ok((output.status.success(), text))
}

fn result(repo: &str, args: &[&str]) -> Result<OpResult, String> {
  let (ok, message) = run_capture(repo, args)?;
  Ok(OpResult { ok, message, in_progress: operation_in_progress(repo).map(str::to_string) })
}

fn valid_branch(repo: &str, name: &str) -> bool {
  valid_rev(name) && run_git(repo, &["check-ref-format", "--branch", name]).is_ok()
}

/// A name of a remote: letters, digits and `._-`, as `git remote add` accepts.
fn valid_remote(name: &str) -> bool {
  !name.is_empty() && name.len() <= 100 && !name.starts_with('-') && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

fn reject(what: &str, value: &str) -> String { format!("invalid {what}: {value}") }

pub fn fetch(repo: &str) -> Result<OpResult, String> { result(repo, &["fetch", "--all", "--prune", "--tags"]) }

pub fn branch_create(repo: &str, name: &str, start: &str, checkout: bool) -> Result<OpResult, String> {
  if !valid_branch(repo, name) { return Err(reject("branch name", name)); }
  if !start.is_empty() && !valid_rev(start) { return Err(reject("starting point", start)); }
  let mut args: Vec<&str> = if checkout { vec!["switch", "-c", name] } else { vec!["branch", name] };
  if !start.is_empty() { args.push(start); }
  result(repo, &args)
}

pub fn branch_delete(repo: &str, name: &str, force: bool) -> Result<OpResult, String> {
  if !valid_branch(repo, name) { return Err(reject("branch name", name)); }
  if current_branch(repo).as_deref() == Some(name) { return Err("the branch in use cannot be deleted: switch to another one first".into()); }
  result(repo, &["branch", if force { "-D" } else { "-d" }, name])
}

pub fn branch_rename(repo: &str, old: &str, new: &str) -> Result<OpResult, String> {
  if !valid_branch(repo, old) { return Err(reject("branch name", old)); }
  if !valid_branch(repo, new) { return Err(reject("branch name", new)); }
  result(repo, &["branch", "-m", old, new])
}

/// Deletes a branch on a remote (`git push <remote> --delete <branch>`).
pub fn remote_branch_delete(repo: &str, remote: &str, name: &str) -> Result<OpResult, String> {
  if !valid_remote(remote) { return Err(reject("remote", remote)); }
  if !valid_branch(repo, name) { return Err(reject("branch name", name)); }
  result(repo, &["push", remote, "--delete", name])
}

pub fn merge(repo: &str, rev: &str) -> Result<OpResult, String> {
  if !valid_rev(rev) { return Err(reject("revision", rev)); }
  result(repo, &["merge", "--no-edit", rev])
}

pub fn rebase(repo: &str, onto: &str) -> Result<OpResult, String> {
  if !valid_rev(onto) { return Err(reject("revision", onto)); }
  result(repo, &["rebase", onto])
}

pub fn cherry_pick(repo: &str, hash: &str) -> Result<OpResult, String> {
  if !valid_hash(hash) { return Err(reject("commit", hash)); }
  result(repo, &["cherry-pick", hash])
}

pub fn revert(repo: &str, hash: &str) -> Result<OpResult, String> {
  if !valid_hash(hash) { return Err(reject("commit", hash)); }
  result(repo, &["revert", "--no-edit", hash])
}

/// `mode` is `soft`, `mixed` or `hard`; a hard reset throws the changes of the working tree away, and the interface asks first.
pub fn reset(repo: &str, hash: &str, mode: &str) -> Result<OpResult, String> {
  if !valid_hash(hash) { return Err(reject("commit", hash)); }
  let flag = match mode { "soft" => "--soft", "mixed" => "--mixed", "hard" => "--hard", _ => return Err(reject("reset mode", mode)) };
  result(repo, &["reset", flag, hash])
}

pub fn checkout_commit(repo: &str, hash: &str) -> Result<OpResult, String> {
  if !valid_hash(hash) { return Err(reject("commit", hash)); }
  result(repo, &["switch", "--detach", hash])
}

/// A tag on `rev` (a commit, branch or tag): annotated when `message` is not empty.
pub fn tag_create(repo: &str, name: &str, rev: &str, message: &str) -> Result<OpResult, String> {
  if !valid_rev(name) || run_git(repo, &["check-ref-format", &format!("refs/tags/{name}")]).is_err() { return Err(reject("tag name", name)); }
  if !valid_rev(rev) { return Err(reject("revision", rev)); }
  if message.contains('\0') || message.len() > 2000 { return Err("the message of the tag is not valid".into()); }
  if message.trim().is_empty() { result(repo, &["tag", name, rev]) } else { result(repo, &["tag", "-a", name, "-m", message, rev]) }
}

pub fn tag_delete(repo: &str, name: &str) -> Result<OpResult, String> {
  if !valid_rev(name) { return Err(reject("tag name", name)); }
  result(repo, &["tag", "-d", name])
}

/// Continues (`continue`) or abandons (`abort`) the merge, rebase, cherry-pick or revert that is in progress.
pub fn operation(repo: &str, action: &str) -> Result<OpResult, String> {
  let kind = operation_in_progress(repo).ok_or("nothing is in progress")?;
  let flag = match action { "continue" => "--continue", "abort" => "--abort", _ => return Err(reject("action", action)) };
  result(repo, &[kind, flag])
}

pub fn stash_push(repo: &str, message: &str, untracked: bool) -> Result<OpResult, String> {
  if message.contains('\0') || message.len() > 500 { return Err("the message of the stash is not valid".into()); }
  let mut args = vec!["stash", "push"];
  if untracked { args.push("--include-untracked"); }
  if !message.trim().is_empty() { args.extend(["-m", message]); }
  result(repo, &args)
}

pub fn stash_list(repo: &str) -> Result<Vec<StashEntry>, String> {
  let text = run_git(repo, &["stash", "list", "--format=%gd%x09%cI%x09%s"])?;
  Ok(text
    .lines()
    .filter_map(|line| {
      let mut parts = line.splitn(3, '\t');
      let index = parts.next()?.trim_start_matches("stash@{").trim_end_matches('}').parse().ok()?;
      Some(StashEntry { index, date: parts.next()?.to_string(), message: parts.next().unwrap_or_default().to_string() })
    })
    .collect())
}

/// `apply` keeps the stash, `pop` removes it after applying it, `drop` removes it without applying.
pub fn stash_action(repo: &str, index: u32, action: &str) -> Result<OpResult, String> {
  let name = format!("stash@{{{index}}}");
  match action {
    "apply" => result(repo, &["stash", "apply", &name]),
    "pop" => result(repo, &["stash", "pop", &name]),
    "drop" => result(repo, &["stash", "drop", &name]),
    _ => Err(reject("stash action", action)),
  }
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(job).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_fetch(repo: String) -> Result<OpResult, String> { blocking(move || fetch(&repo)).await }
#[tauri::command]
pub async fn git_branch_create(repo: String, name: String, start: String, checkout: bool) -> Result<OpResult, String> { blocking(move || branch_create(&repo, &name, &start, checkout)).await }
#[tauri::command]
pub async fn git_branch_delete(repo: String, name: String, force: bool) -> Result<OpResult, String> { blocking(move || branch_delete(&repo, &name, force)).await }
#[tauri::command]
pub async fn git_branch_rename(repo: String, old: String, new: String) -> Result<OpResult, String> { blocking(move || branch_rename(&repo, &old, &new)).await }
#[tauri::command]
pub async fn git_remote_branch_delete(repo: String, remote: String, name: String) -> Result<OpResult, String> { blocking(move || remote_branch_delete(&repo, &remote, &name)).await }
#[tauri::command]
pub async fn git_merge(repo: String, rev: String) -> Result<OpResult, String> { blocking(move || merge(&repo, &rev)).await }
#[tauri::command]
pub async fn git_rebase(repo: String, onto: String) -> Result<OpResult, String> { blocking(move || rebase(&repo, &onto)).await }
#[tauri::command]
pub async fn git_cherry_pick(repo: String, hash: String) -> Result<OpResult, String> { blocking(move || cherry_pick(&repo, &hash)).await }
#[tauri::command]
pub async fn git_revert(repo: String, hash: String) -> Result<OpResult, String> { blocking(move || revert(&repo, &hash)).await }
#[tauri::command]
pub async fn git_reset(repo: String, hash: String, mode: String) -> Result<OpResult, String> { blocking(move || reset(&repo, &hash, &mode)).await }
#[tauri::command]
pub async fn git_checkout_commit(repo: String, hash: String) -> Result<OpResult, String> { blocking(move || checkout_commit(&repo, &hash)).await }
#[tauri::command]
pub async fn git_tag_create(repo: String, name: String, rev: String, message: String) -> Result<OpResult, String> { blocking(move || tag_create(&repo, &name, &rev, &message)).await }
#[tauri::command]
pub async fn git_tag_delete(repo: String, name: String) -> Result<OpResult, String> { blocking(move || tag_delete(&repo, &name)).await }
#[tauri::command]
pub async fn git_operation(repo: String, action: String) -> Result<OpResult, String> { blocking(move || operation(&repo, &action)).await }
#[tauri::command]
pub async fn git_stash_push(repo: String, message: String, untracked: bool) -> Result<OpResult, String> { blocking(move || stash_push(&repo, &message, untracked)).await }
#[tauri::command]
pub async fn git_stash_list(repo: String) -> Result<Vec<StashEntry>, String> { blocking(move || stash_list(&repo)).await }
#[tauri::command]
pub async fn git_stash_action(repo: String, index: u32, action: String) -> Result<OpResult, String> { blocking(move || stash_action(&repo, index, &action)).await }

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn git(repo: &std::path::Path, args: &[&str]) -> String {
    let output = Command::new("git").arg("-C").arg(repo).args(args).output().unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8_lossy(&output.stdout).trim().to_string()
  }

  fn repository() -> (std::path::PathBuf, String) {
    let dir = std::env::temp_dir().join(format!("typenova-gitops-{}-{:?}", std::process::id(), std::thread::current().id()).replace(['(', ')'], ""));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    git(&dir, &["init", "-q", "-b", "main"]);
    for (key, value) in [("user.email", "t@e.com"), ("user.name", "T"), ("commit.gpgsign", "false"), ("core.autocrlf", "false")] { git(&dir, &["config", key, value]); }
    fs::write(dir.join("a.txt"), "one\n").unwrap();
    git(&dir, &["add", "."]);
    git(&dir, &["commit", "-q", "-m", "First"]);
    let path = dir.to_string_lossy().into_owned();
    (dir, path)
  }

  fn commit(dir: &std::path::Path, file: &str, text: &str, message: &str) -> String {
    fs::write(dir.join(file), text).unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", message]);
    git(dir, &["rev-parse", "HEAD"])
  }

  #[test]
  fn branches_are_made_renamed_and_deleted() {
    let (dir, repo) = repository();
    assert!(branch_create(&repo, "feature", "", false).unwrap().ok);
    assert!(branch_rename(&repo, "feature", "topic").unwrap().ok);
    assert!(git(&dir, &["branch", "--list", "topic"]).contains("topic"));
    assert!(branch_delete(&repo, "main", false).is_err(), "the branch in use stays");
    assert!(branch_create(&repo, "--bad", "", false).is_err());
    assert!(branch_create(&repo, "has space", "", false).is_err());
    assert!(branch_delete(&repo, "topic", false).unwrap().ok);
    assert!(branch_create(&repo, "next", "main", true).unwrap().ok);
    assert_eq!(current_branch(&repo).as_deref(), Some("next"));
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn a_merge_and_a_conflict_are_told_apart() {
    let (dir, repo) = repository();
    branch_create(&repo, "side", "", true).unwrap();
    commit(&dir, "b.txt", "side\n", "Side");
    git(&dir, &["switch", "-q", "main"]);
    commit(&dir, "c.txt", "main\n", "Main");
    assert!(merge(&repo, "side").unwrap().ok, "a clean merge");
    // a conflict on the same line
    git(&dir, &["switch", "-q", "-c", "x", "main~1"]);
    let _ = (commit(&dir, "a.txt", "x\n", "X"), git(&dir, &["switch", "-q", "main"]), commit(&dir, "a.txt", "y\n", "Y"));
    let stopped = merge(&repo, "x").unwrap();
    assert!(!stopped.ok);
    assert_eq!(stopped.in_progress.as_deref(), Some("merge"));
    let aborted = operation(&repo, "abort").unwrap();
    assert!(aborted.ok && aborted.in_progress.is_none());
    assert!(operation(&repo, "abort").is_err(), "nothing is in progress any more");
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn rebase_cherry_pick_revert_and_reset() {
    let (dir, repo) = repository();
    branch_create(&repo, "side", "", true).unwrap();
    let side = commit(&dir, "s.txt", "s\n", "Side");
    git(&dir, &["switch", "-q", "main"]);
    commit(&dir, "m.txt", "m\n", "Main");
    assert!(cherry_pick(&repo, &side).unwrap().ok);
    assert!(dir.join("s.txt").exists());
    let head = git(&dir, &["rev-parse", "HEAD"]);
    assert!(revert(&repo, &head).unwrap().ok);
    assert!(!dir.join("s.txt").exists());
    git(&dir, &["switch", "-q", "side"]);
    assert!(rebase(&repo, "main").unwrap().ok);
    assert!(dir.join("m.txt").exists());
    let head = git(&dir, &["rev-parse", "HEAD"]);
    fs::write(dir.join("m.txt"), "dirty\n").unwrap();
    assert!(reset(&repo, &head, "hard").unwrap().ok);
    assert_eq!(fs::read_to_string(dir.join("m.txt")).unwrap().replace("\r\n", "\n"), "m\n", "a hard reset throws the changes away");
    assert!(reset(&repo, &head, "bogus").is_err());
    assert!(reset(&repo, "--hard", "soft").is_err());
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn tags_checkout_and_stashes() {
    let (dir, repo) = repository();
    let first = git(&dir, &["rev-parse", "HEAD"]);
    assert!(tag_create(&repo, "v1", "HEAD", "").unwrap().ok);
    assert!(tag_create(&repo, "v2", "HEAD", "release two").unwrap().ok);
    assert!(tag_create(&repo, "bad name", "HEAD", "").is_err());
    assert!(tag_delete(&repo, "v1").unwrap().ok);
    commit(&dir, "a.txt", "two\n", "Second");
    assert!(checkout_commit(&repo, &first).unwrap().ok);
    assert_eq!(current_branch(&repo), None, "detached");
    git(&dir, &["switch", "-q", "main"]);
    fs::write(dir.join("a.txt"), "work in progress\n").unwrap();
    assert!(stash_push(&repo, "wip", false).unwrap().ok);
    assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap().replace("\r\n", "\n"), "two\n");
    let list = stash_list(&repo).unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].message.contains("wip"));
    assert!(stash_action(&repo, 0, "pop").unwrap().ok);
    assert!(stash_list(&repo).unwrap().is_empty());
    assert!(stash_action(&repo, 0, "bogus").is_err());
    let _ = fs::remove_dir_all(dir);
  }
}
