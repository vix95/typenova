//! Commit and push of the pending changes of one repository, for the "Commit and push" button of the project panel.
//!
//! This is the only place where the program writes to Git. It does exactly what the button promises and nothing more: stage everything the repository shows as changed
//! (`add -A`, so `.gitignore` is respected), commit with the message the user saw, and push the current branch with a plain `git push`. It never forces, never skips hooks,
//! and refuses a detached HEAD or a merge, rebase, cherry-pick or revert in progress (staging everything there would commit conflict markers). A push that fails leaves the
//! commit in place and reports why. Everything goes through the `git` executable with an argument list (never a shell).

use crate::git::run_git;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// More changes than this are counted but not listed.
const MAX_LISTED: usize = 500;
const MAX_MESSAGE: usize = 2000;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingChange {
  /// `A` new (also untracked), `M` modified, `D` deleted, `R` renamed.
  pub status: String,
  pub path: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
  /// The branch in use; none when HEAD is detached.
  pub branch: Option<String>,
  pub upstream: Option<String>,
  /// The remote a first push would go to (when the branch has no upstream yet).
  pub remote: Option<String>,
  pub changes: Vec<PendingChange>,
  pub total: u32,
  /// A merge, rebase, cherry-pick or revert is in progress, or files are in conflict: nothing is committed then.
  pub blocked: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
  /// Short hash of the new commit; none when there was nothing to commit.
  pub commit: Option<String>,
  pub pushed: bool,
  /// Where it was pushed to (`origin/main`).
  pub target: Option<String>,
  /// Why it was not pushed (the commit stays).
  pub push_error: Option<String>,
}

fn parse_pending(text: &str) -> (Vec<PendingChange>, bool) {
  let mut changes = Vec::new();
  let mut conflicts = false;
  let mut parts = text.split('\0');
  while let Some(entry) = parts.next() {
    if entry.len() < 4 || !entry.is_char_boundary(3) {
      continue;
    }
    let code = &entry[..2];
    let path = entry[3..].to_string();
    let (x, y) = (code.as_bytes()[0] as char, code.as_bytes()[1] as char);
    if matches!(code, "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU") {
      conflicts = true;
    }
    let renamed = x == 'R' || x == 'C' || y == 'R' || y == 'C';
    if renamed {
      parts.next(); // the old name follows
    }
    let status = if code == "??" || x == 'A' || y == 'A' || x == 'C' || y == 'C' {
      "A"
    } else if x == 'D' || y == 'D' {
      "D"
    } else if renamed {
      "R"
    } else {
      "M"
    };
    changes.push(PendingChange { status: status.to_string(), path });
  }
  (changes, conflicts)
}

fn git_dir(repo: &str) -> Option<PathBuf> {
  let text = run_git(repo, &["rev-parse", "--git-dir"]).ok()?;
  let dir = PathBuf::from(text.trim());
  Some(if dir.is_absolute() { dir } else { Path::new(repo).join(dir) })
}

/// What is in progress in the repository (a state in which staging everything is wrong), if anything.
pub(crate) fn operation_in_progress(repo: &str) -> Option<&'static str> {
  let dir = git_dir(repo)?;
  [("MERGE_HEAD", "merge"), ("rebase-merge", "rebase"), ("rebase-apply", "rebase"), ("CHERRY_PICK_HEAD", "cherry-pick"), ("REVERT_HEAD", "revert")]
    .into_iter()
    .find(|(name, _)| dir.join(name).exists())
    .map(|(_, label)| label)
}

pub(crate) fn current_branch(repo: &str) -> Option<String> {
  run_git(repo, &["symbolic-ref", "--short", "-q", "HEAD"]).ok().map(|text| text.trim().to_string()).filter(|text| !text.is_empty())
}

pub(crate) fn upstream_of_head(repo: &str) -> Option<String> {
  run_git(repo, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).ok().map(|text| text.trim().to_string()).filter(|text| !text.is_empty())
}

/// The remote a branch without an upstream is pushed to: `origin`, or the only remote there is.
pub(crate) fn push_remote(repo: &str) -> Option<String> {
  let text = run_git(repo, &["remote"]).ok()?;
  let remotes: Vec<&str> = text.lines().map(str::trim).filter(|line| !line.is_empty()).collect();
  if remotes.contains(&"origin") { Some("origin".to_string()) } else if remotes.len() == 1 { Some(remotes[0].to_string()) } else { None }
}

pub(crate) fn blocked_reason(repo: &str, conflicts: bool, branch: &Option<String>) -> Option<String> {
  if branch.is_none() {
    return Some("detached HEAD".into());
  }
  if let Some(operation) = operation_in_progress(repo) {
    return Some(format!("{operation} in progress"));
  }
  if conflicts { Some("conflicts".into()) } else { None }
}

pub(crate) fn plan(repo: &str) -> Result<SyncPlan, String> {
  let status = run_git(repo, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
  let (mut changes, conflicts) = parse_pending(&status);
  let total = changes.len() as u32;
  changes.truncate(MAX_LISTED);
  let branch = current_branch(repo);
  let upstream = if branch.is_some() { upstream_of_head(repo) } else { None };
  let remote = if upstream.is_none() { push_remote(repo) } else { None };
  let blocked = blocked_reason(repo, conflicts, &branch);
  Ok(SyncPlan { branch, upstream, remote, changes, total, blocked })
}

/// Pushes the branch in use with a plain `git push`: to its upstream, else (first push) to `origin` or the only remote, setting the upstream. Returns whether it was pushed, where to, and why not.
pub(crate) fn push_branch(repo: &str, upstream: &Option<String>, remote: &Option<String>, branch: &str) -> (bool, Option<String>, Option<String>) {
  match (upstream, remote) {
    (Some(upstream), _) => match run_git(repo, &["push"]) {
      Ok(_) => (true, Some(upstream.clone()), None),
      Err(error) => (false, None, Some(error)),
    },
    (None, Some(remote)) => match run_git(repo, &["push", "-u", remote, branch]) {
      Ok(_) => (true, Some(format!("{remote}/{branch}")), None),
      Err(error) => (false, None, Some(error)),
    },
    (None, None) => (false, None, Some("the repository has no remote to push to".to_string())),
  }
}

fn commit_and_push(repo: &str, message: &str) -> Result<SyncResult, String> {
  let message = message.trim();
  if message.is_empty() || message.len() > MAX_MESSAGE || message.contains('\0') {
    return Err("the commit message is empty or too long".into());
  }
  let current = plan(repo)?;
  if let Some(reason) = &current.blocked {
    return Err(format!("nothing was committed: {reason}"));
  }
  let branch = current.branch.clone().ok_or("detached HEAD")?;
  run_git(repo, &["add", "-A"])?;
  let staged = run_git(repo, &["diff", "--cached", "--quiet"]).is_err();
  let commit = if staged {
    run_git(repo, &["commit", "-m", message])?;
    run_git(repo, &["rev-parse", "--short", "HEAD"]).ok().map(|text| text.trim().to_string())
  } else {
    None
  };
  let (pushed, target, push_error) = push_branch(repo, &current.upstream, &current.remote, &branch);
  Ok(SyncResult { commit, pushed, target, push_error })
}

/// What a click on the button would commit and push.
#[tauri::command]
pub async fn git_sync_plan(repo: String) -> Result<SyncPlan, String> {
  tauri::async_runtime::spawn_blocking(move || plan(&repo)).await.map_err(|error| error.to_string())?
}

/// Stages everything, commits it with `message` and pushes. Runs off the main thread: a push can take a while.
#[tauri::command]
pub async fn git_commit_push(repo: String, message: String) -> Result<SyncResult, String> {
  tauri::async_runtime::spawn_blocking(move || commit_and_push(&repo, &message)).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::process::Command;

  fn git_available() -> bool {
    Command::new("git").arg("--version").output().map(|output| output.status.success()).unwrap_or(false)
  }

  fn git_in(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(output.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&output.stderr));
    String::from_utf8_lossy(&output.stdout).into_owned()
  }

  fn init(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    git_in(dir, &["init", "-q", "-b", "main"]);
    for (key, value) in [("user.email", "t@example.com"), ("user.name", "Tester"), ("commit.gpgsign", "false")] {
      git_in(dir, &["config", key, value]);
    }
  }

  #[test]
  fn the_status_is_parsed() {
    let (changes, conflicts) = parse_pending(" M notes.md\0?? ideas/assets/screen.png\0D  gone.md\0R  new.md\0old.md\0A  added.md\0");
    let got: Vec<(&str, &str)> = changes.iter().map(|change| (change.status.as_str(), change.path.as_str())).collect();
    assert_eq!(got, vec![("M", "notes.md"), ("A", "ideas/assets/screen.png"), ("D", "gone.md"), ("R", "new.md"), ("A", "added.md")]);
    assert!(!conflicts);
    assert!(parse_pending("UU a.md\0").1);
    assert!(parse_pending("").0.is_empty());
  }

  #[test]
  fn new_and_changed_files_are_committed_and_pushed_and_nothing_else_happens() {
    if !git_available() {
      return;
    }
    let base = std::env::temp_dir().join(format!("typenova-sync-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let (remote, work) = (base.join("remote.git"), base.join("work"));
    fs::create_dir_all(&remote).unwrap();
    git_in(&remote, &["init", "-q", "--bare", "-b", "main"]);
    init(&work);
    fs::write(work.join("first.md"), "one\n").unwrap();
    git_in(&work, &["add", "."]);
    git_in(&work, &["commit", "-q", "-m", "First"]);
    git_in(&work, &["remote", "add", "origin", &remote.to_string_lossy()]);
    let repo = work.to_string_lossy().into_owned();

    // No upstream yet: the first push sets it. Ignored files stay out.
    fs::write(work.join(".gitignore"), "secret.txt\n").unwrap();
    fs::write(work.join("secret.txt"), "x\n").unwrap();
    fs::write(work.join("notes.md"), "# notes\n").unwrap();
    fs::create_dir_all(work.join("ideas/assets")).unwrap();
    fs::write(work.join("ideas/assets/screen.png"), [0u8, 1, 2]).unwrap();
    fs::write(work.join("first.md"), "one\ntwo\n").unwrap();
    let planned = plan(&repo).unwrap();
    assert_eq!(planned.branch.as_deref(), Some("main"));
    assert_eq!((planned.upstream.clone(), planned.remote.as_deref()), (None, Some("origin")));
    assert!(planned.blocked.is_none());
    assert!(planned.changes.iter().any(|change| change.path == "ideas/assets/screen.png" && change.status == "A"), "untracked files are listed one by one");
    assert!(!planned.changes.iter().any(|change| change.path == "secret.txt"));

    assert!(commit_and_push(&repo, "   ").is_err());
    let result = commit_and_push(&repo, "Add notes and a screenshot").unwrap();
    assert!(result.commit.is_some() && result.pushed && result.push_error.is_none());
    assert_eq!(result.target.as_deref(), Some("origin/main"));
    assert_eq!(git_in(&work, &["status", "--porcelain"]).trim(), "");
    assert!(git_in(&work, &["ls-files"]).contains("ideas/assets/screen.png") && !git_in(&work, &["ls-files"]).contains("secret.txt"));
    assert_eq!(git_in(&remote, &["log", "-1", "--format=%s", "main"]).trim(), "Add notes and a screenshot");
    assert_eq!(plan(&repo).unwrap().upstream.as_deref(), Some("origin/main"));

    // Now the branch has an upstream; a deleted file is committed too.
    fs::remove_file(work.join("notes.md")).unwrap();
    let again = commit_and_push(&repo, "Remove notes").unwrap();
    assert!(again.pushed && again.commit.is_some());
    assert_eq!(git_in(&remote, &["log", "-1", "--format=%s", "main"]).trim(), "Remove notes");
    // Nothing to commit: no empty commit, the push is a no-op.
    assert_eq!(commit_and_push(&repo, "Nothing").unwrap().commit, None);

    // A failing push keeps the commit and says why.
    git_in(&work, &["remote", "set-url", "origin", &base.join("missing.git").to_string_lossy()]);
    fs::write(work.join("late.md"), "late\n").unwrap();
    let failed = commit_and_push(&repo, "Late").unwrap();
    assert!(failed.commit.is_some() && !failed.pushed && failed.push_error.is_some());

    // A detached HEAD and a merge in progress are refused.
    fs::write(work.join("more.md"), "more\n").unwrap();
    git_in(&work, &["checkout", "-q", "--detach"]);
    assert!(plan(&repo).unwrap().blocked.is_some());
    assert!(commit_and_push(&repo, "No").is_err());
    git_in(&work, &["checkout", "-q", "main"]);
    fs::write(work.join(".git").join("MERGE_HEAD"), "0000000000000000000000000000000000000000\n").unwrap();
    assert!(commit_and_push(&repo, "No").unwrap_err().contains("merge"));
    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn a_repository_without_a_remote_is_committed_locally() {
    if !git_available() {
      return;
    }
    let dir = std::env::temp_dir().join(format!("typenova-sync-local-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    init(&dir);
    fs::write(dir.join("a.md"), "a\n").unwrap();
    let result = commit_and_push(&dir.to_string_lossy(), "Add a").unwrap();
    assert!(result.commit.is_some() && !result.pushed && result.push_error.is_some());
    let _ = fs::remove_dir_all(&dir);
  }
}
