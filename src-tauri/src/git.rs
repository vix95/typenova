//! Read-only Git history for the Git panel: branches, tags, the commit list, one commit's files and a file's diff.
//!
//! Everything goes through the `git` executable with an argument list (never a shell); revisions, hashes and paths from the
//! frontend are validated first.

use serde::Serialize;
use std::process::Command;

const FIELD: char = '\u{1f}';
const RECORD: char = '\u{1e}';
const MAX_DIFF_BYTES: usize = 300_000;

fn run_git(repo: &str, args: &[&str]) -> Result<String, String> {
  let mut command = Command::new("git");
  command
    .arg("-C")
    .arg(repo)
    .args(["-c", "core.quotepath=false", "-c", "log.showSignature=false", "--no-pager"])
    .args(args)
    .env("GIT_TERMINAL_PROMPT", "0")
    .env("GIT_OPTIONAL_LOCKS", "0");
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000); // no console window
  }
  let output = command.output().map_err(|error| {
    if error.kind() == std::io::ErrorKind::NotFound { "Git is not installed or not on the PATH".to_string() } else { error.to_string() }
  })?;
  if !output.status.success() {
    return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
  }
  Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn valid_hash(value: &str) -> bool {
  (7..=64).contains(&value.len()) && value.chars().all(|c| c.is_ascii_hexdigit())
}

fn valid_rev(value: &str) -> bool {
  !value.is_empty()
    && value.len() <= 200
    && !value.starts_with('-')
    && !value.contains("..")
    && value.chars().all(|c| c.is_ascii_alphanumeric() || "._/@+#-".contains(c))
}

fn safe_relative_path(value: &str) -> bool {
  !value.is_empty()
    && !value.starts_with('-')
    && !value.contains('\0')
    && !std::path::Path::new(value).is_absolute()
    && !value.replace('\\', "/").split('/').any(|part| part == "..")
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
  pub name: String,
  pub remote: bool,
  pub current: bool,
  pub hash: String,
  pub upstream: Option<String>,
  pub ahead: u32,
  pub behind: u32,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Tag {
  pub name: String,
  pub hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
  pub head: String,
  pub detached: bool,
  pub branches: Vec<Branch>,
  pub tags: Vec<Tag>,
  pub dirty: u32,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
  pub hash: String,
  pub parents: Vec<String>,
  pub author: String,
  pub email: String,
  pub date: String,
  pub refs: Vec<String>,
  pub subject: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
  pub status: String,
  pub path: String,
  pub old_path: Option<String>,
  pub added: Option<u32>,
  pub deleted: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
  pub hash: String,
  pub parents: Vec<String>,
  pub author: String,
  pub email: String,
  pub date: String,
  pub committer: String,
  pub body: String,
  pub files: Vec<FileChange>,
}

/// `ahead 2, behind 1` (as printed by `%(upstream:track,nobracket)`) into the two counts.
fn parse_track(track: &str) -> (u32, u32) {
  let mut ahead = 0;
  let mut behind = 0;
  for part in track.split(',') {
    let part = part.trim();
    if let Some(number) = part.strip_prefix("ahead ") {
      ahead = number.trim().parse().unwrap_or(0);
    } else if let Some(number) = part.strip_prefix("behind ") {
      behind = number.trim().parse().unwrap_or(0);
    }
  }
  (ahead, behind)
}

fn parse_branches(text: &str) -> Vec<Branch> {
  let mut branches = Vec::new();
  for line in text.lines() {
    let fields: Vec<&str> = line.split('\t').collect();
    if fields.len() < 5 {
      continue;
    }
    let (name, remote) = if let Some(rest) = fields[0].strip_prefix("refs/heads/") {
      (rest, false)
    } else if let Some(rest) = fields[0].strip_prefix("refs/remotes/") {
      (rest, true)
    } else {
      continue;
    };
    if remote && name.ends_with("/HEAD") {
      continue;
    }
    let (ahead, behind) = parse_track(fields[4]);
    branches.push(Branch {
      name: name.to_string(),
      remote,
      current: fields[2] == "*",
      hash: fields[1].to_string(),
      upstream: if fields[3].is_empty() { None } else { Some(fields[3].to_string()) },
      ahead,
      behind,
    });
  }
  branches
}

fn parse_tags(text: &str) -> Vec<Tag> {
  text
    .lines()
    .filter_map(|line| {
      let fields: Vec<&str> = line.split('\t').collect();
      if fields.len() < 3 || fields[0].is_empty() {
        return None;
      }
      // An annotated tag points at a tag object; `*objectname` is the commit behind it.
      let hash = if fields[2].is_empty() { fields[1] } else { fields[2] };
      Some(Tag { name: fields[0].to_string(), hash: hash.to_string() })
    })
    .collect()
}

fn parse_commits(text: &str) -> Vec<Commit> {
  text
    .split(RECORD)
    .filter_map(|record| {
      let record = record.trim_start_matches('\n');
      let fields: Vec<&str> = record.split(FIELD).collect();
      if fields.len() < 7 || fields[0].is_empty() {
        return None;
      }
      Some(Commit {
        hash: fields[0].to_string(),
        parents: fields[1].split_whitespace().map(str::to_owned).collect(),
        author: fields[2].to_string(),
        email: fields[3].to_string(),
        date: fields[4].to_string(),
        refs: fields[5].split(", ").filter(|item| !item.is_empty()).map(str::to_owned).collect(),
        subject: fields[6].to_string(),
      })
    })
    .collect()
}

/// Joins `--name-status` and `--numstat` listings (same order, same length) into file changes.
fn parse_changes(name_status: &str, numstat: &str) -> Vec<FileChange> {
  let counts: Vec<(Option<u32>, Option<u32>)> = numstat
    .lines()
    .map(|line| {
      let mut parts = line.split('\t');
      (parts.next().and_then(|value| value.parse().ok()), parts.next().and_then(|value| value.parse().ok()))
    })
    .collect();
  name_status
    .lines()
    .enumerate()
    .filter_map(|(index, line)| {
      let parts: Vec<&str> = line.split('\t').collect();
      if parts.len() < 2 {
        return None;
      }
      let status = parts[0].chars().next()?.to_string();
      let (path, old_path) = if (status == "R" || status == "C") && parts.len() >= 3 { (parts[2], Some(parts[1].to_string())) } else { (parts[1], None) };
      let (added, deleted) = counts.get(index).copied().unwrap_or((None, None));
      Some(FileChange { status, path: path.to_string(), old_path, added, deleted })
    })
    .collect()
}

#[tauri::command]
pub fn git_repo_root(path: String) -> Option<String> {
  run_git(&path, &["rev-parse", "--show-toplevel"]).ok().map(|text| text.trim().to_string()).filter(|text| !text.is_empty())
}

#[tauri::command]
pub fn git_overview(repo: String) -> Result<Overview, String> {
  let head = run_git(&repo, &["rev-parse", "--abbrev-ref", "HEAD"]).map(|text| text.trim().to_string()).unwrap_or_default();
  let refs = run_git(
    &repo,
    &["for-each-ref", "--format=%(refname)%09%(objectname)%09%(HEAD)%09%(upstream:short)%09%(upstream:track,nobracket)", "refs/heads", "refs/remotes"],
  )?;
  let tags = run_git(&repo, &["for-each-ref", "--sort=-creatordate", "--format=%(refname:short)%09%(objectname)%09%(*objectname)", "refs/tags"])?;
  let dirty = run_git(&repo, &["status", "--porcelain"]).map(|text| text.lines().count() as u32).unwrap_or(0);
  Ok(Overview { detached: head == "HEAD", head, branches: parse_branches(&refs), tags: parse_tags(&tags), dirty })
}

/// One page of the history of `rev` (a branch, tag or hash), or of every branch when `rev` is empty.
#[tauri::command]
pub fn git_log(repo: String, rev: String, skip: u32, limit: u32) -> Result<Vec<Commit>, String> {
  let skip_arg = format!("--skip={skip}");
  let count_arg = format!("--max-count={}", limit.clamp(1, 500));
  let format = format!("--format=%H{FIELD}%P{FIELD}%an{FIELD}%ae{FIELD}%aI{FIELD}%D{FIELD}%s{RECORD}");
  let mut args: Vec<&str> = vec!["log", "--topo-order", &skip_arg, &count_arg, &format];
  if rev.is_empty() {
    args.push("--all");
  } else if valid_rev(&rev) {
    args.push(&rev);
  } else {
    return Err("invalid revision".into());
  }
  match run_git(&repo, &args) {
    Ok(text) => Ok(parse_commits(&text)),
    Err(message) if message.contains("does not have any commits") => Ok(Vec::new()),
    Err(message) => Err(message),
  }
}

fn first_parent(repo: &str, hash: &str) -> Result<Option<String>, String> {
  let line = run_git(repo, &["rev-list", "--parents", "-n", "1", hash])?;
  Ok(line.split_whitespace().nth(1).map(str::to_owned))
}

#[tauri::command]
pub fn git_commit_detail(repo: String, hash: String) -> Result<CommitDetail, String> {
  if !valid_hash(&hash) {
    return Err("invalid commit".into());
  }
  let format = format!("--format=%H{FIELD}%P{FIELD}%an{FIELD}%ae{FIELD}%aI{FIELD}%cn{FIELD}%B{RECORD}");
  let header = run_git(&repo, &["show", "-s", &format, &hash])?;
  let fields: Vec<&str> = header.split(RECORD).next().unwrap_or("").trim_start_matches('\n').split(FIELD).collect();
  if fields.len() < 7 {
    return Err("unexpected git output".into());
  }
  let parent = first_parent(&repo, &hash)?;
  let (name_status, numstat) = match &parent {
    Some(parent) => (
      run_git(&repo, &["diff", "--name-status", "-M", parent, &hash])?,
      run_git(&repo, &["diff", "--numstat", "-M", parent, &hash])?,
    ),
    None => (
      run_git(&repo, &["diff-tree", "--root", "-r", "-M", "--no-commit-id", "--name-status", &hash])?,
      run_git(&repo, &["diff-tree", "--root", "-r", "-M", "--no-commit-id", "--numstat", &hash])?,
    ),
  };
  Ok(CommitDetail {
    hash: fields[0].to_string(),
    parents: fields[1].split_whitespace().map(str::to_owned).collect(),
    author: fields[2].to_string(),
    email: fields[3].to_string(),
    date: fields[4].to_string(),
    committer: fields[5].to_string(),
    body: fields[6].trim_end().to_string(),
    files: parse_changes(&name_status, &numstat),
  })
}

/// Unified diff of one file in a commit against its first parent (or against nothing for the first commit).
#[tauri::command]
pub fn git_file_diff(repo: String, hash: String, path: String, old_path: Option<String>) -> Result<String, String> {
  if !valid_hash(&hash) || !safe_relative_path(&path) || old_path.as_deref().is_some_and(|old| !safe_relative_path(old)) {
    return Err("invalid argument".into());
  }
  let parent = first_parent(&repo, &hash)?;
  let mut args: Vec<&str> = match &parent {
    Some(parent) => vec!["diff", "-M", "--no-color", "--unified=3", parent, &hash, "--", &path],
    None => vec!["show", "--format=", "--root", "-M", "--no-color", "--unified=3", &hash, "--", &path],
  };
  if let Some(old) = old_path.as_deref() {
    args.push(old);
  }
  let mut text = run_git(&repo, &args)?;
  if text.len() > MAX_DIFF_BYTES {
    let mut cut = MAX_DIFF_BYTES;
    while !text.is_char_boundary(cut) {
      cut -= 1;
    }
    text.truncate(cut);
    text.push_str("\n… (diff truncated)");
  }
  Ok(text)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::path::PathBuf;

  fn git_available() -> bool {
    Command::new("git").arg("--version").output().map(|output| output.status.success()).unwrap_or(false)
  }

  fn git_in(dir: &PathBuf, args: &[&str]) {
    let output = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(output.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&output.stderr));
  }

  #[test]
  fn arguments_from_the_frontend_are_validated() {
    assert!(valid_hash("abc1234") && !valid_hash("abc12") && !valid_hash("--output=x") && !valid_hash("zzzzzzzz"));
    assert!(valid_rev("main") && valid_rev("feature/a-b_c") && valid_rev("origin/main") && !valid_rev("-x") && !valid_rev("a..b") && !valid_rev("a b") && !valid_rev(""));
    assert!(safe_relative_path("src/a.txt") && !safe_relative_path("../a") && !safe_relative_path("a/../../b") && !safe_relative_path("-p") && !safe_relative_path(""));
    assert!(!safe_relative_path(if cfg!(windows) { "C:/x" } else { "/etc/passwd" }));
  }

  #[test]
  fn git_output_is_parsed() {
    assert_eq!(parse_track("ahead 2, behind 1"), (2, 1));
    assert_eq!(parse_track("behind 3"), (0, 3));
    assert_eq!(parse_track("gone"), (0, 0));
    let branches = parse_branches("refs/heads/main\taaa\t*\torigin/main\tahead 1\nrefs/remotes/origin/HEAD\taaa\t\t\t\nrefs/remotes/origin/dev\tbbb\t\t\t\n");
    assert_eq!(branches.len(), 2);
    assert!(branches[0].current && !branches[0].remote && branches[0].ahead == 1 && branches[0].upstream.as_deref() == Some("origin/main"));
    assert!(branches[1].remote && branches[1].name == "origin/dev");
    let tags = parse_tags("v1\tt1\tc1\nv0\tc0\t\n");
    assert_eq!((tags[0].hash.as_str(), tags[1].hash.as_str()), ("c1", "c0"));
    let commits = parse_commits(&format!("h1{FIELD}p1 p2{FIELD}Ann{FIELD}a@x{FIELD}2025-01-01T10:00:00+01:00{FIELD}HEAD -> main, tag: v1{FIELD}Subject{RECORD}\nh2{FIELD}{FIELD}Bob{FIELD}b@x{FIELD}2025-01-02T10:00:00+01:00{FIELD}{FIELD}Root{RECORD}"));
    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0].parents, vec!["p1", "p2"]);
    assert_eq!(commits[0].refs, vec!["HEAD -> main", "tag: v1"]);
    assert!(commits[1].parents.is_empty() && commits[1].refs.is_empty());
    let changes = parse_changes("M\ta.txt\nR100\told.txt\tnew.txt\nA\tbin.png\n", "3\t1\ta.txt\n0\t0\tnew.txt\n-\t-\tbin.png\n");
    assert_eq!(changes.len(), 3);
    assert_eq!((changes[0].added, changes[0].deleted), (Some(3), Some(1)));
    assert_eq!((changes[1].status.as_str(), changes[1].path.as_str(), changes[1].old_path.as_deref()), ("R", "new.txt", Some("old.txt")));
    assert_eq!((changes[2].added, changes[2].deleted), (None, None));
  }

  #[test]
  fn a_real_repository_is_read() {
    if !git_available() {
      return;
    }
    let dir = std::env::temp_dir().join(format!("typenova-git-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    git_in(&dir, &["init", "-q", "-b", "main"]);
    git_in(&dir, &["config", "user.email", "t@example.com"]);
    git_in(&dir, &["config", "user.name", "Tester"]);
    git_in(&dir, &["config", "commit.gpgsign", "false"]);
    fs::write(dir.join("a.txt"), "one\n").unwrap();
    git_in(&dir, &["add", "."]);
    git_in(&dir, &["commit", "-q", "-m", "First"]);
    git_in(&dir, &["tag", "v1"]);
    git_in(&dir, &["checkout", "-q", "-b", "feature"]);
    fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
    fs::write(dir.join("b.txt"), "b\n").unwrap();
    git_in(&dir, &["add", "."]);
    git_in(&dir, &["commit", "-q", "-m", "Second\n\nBody text"]);
    let repo = dir.to_string_lossy().into_owned();

    assert!(git_repo_root(repo.clone()).is_some());
    let overview = git_overview(repo.clone()).unwrap();
    assert_eq!(overview.head, "feature");
    assert!(overview.branches.iter().any(|branch| branch.name == "main") && overview.branches.iter().any(|branch| branch.current && branch.name == "feature"));
    assert_eq!(overview.tags.len(), 1);
    let all = git_log(repo.clone(), String::new(), 0, 50).unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].subject, "Second");
    assert_eq!(all[0].parents, vec![all[1].hash.clone()]);
    assert!(all[0].refs.iter().any(|item| item.contains("feature")));
    assert_eq!(git_log(repo.clone(), "main".into(), 0, 50).unwrap().len(), 1);
    assert_eq!(git_log(repo.clone(), "feature".into(), 1, 50).unwrap().len(), 1);
    assert!(git_log(repo.clone(), "--all".into(), 0, 5).is_err());

    let detail = git_commit_detail(repo.clone(), all[0].hash.clone()).unwrap();
    assert!(detail.body.contains("Body text"));
    assert_eq!(detail.files.len(), 2);
    let a = detail.files.iter().find(|file| file.path == "a.txt").unwrap();
    assert_eq!((a.status.as_str(), a.added, a.deleted), ("M", Some(1), Some(0)));
    let root = git_commit_detail(repo.clone(), all[1].hash.clone()).unwrap();
    assert_eq!(root.files.len(), 1);
    let diff = git_file_diff(repo.clone(), all[0].hash.clone(), "a.txt".into(), None).unwrap();
    assert!(diff.contains("+two"));
    let first_diff = git_file_diff(repo.clone(), all[1].hash.clone(), "a.txt".into(), None).unwrap();
    assert!(first_diff.contains("+one"));
    assert!(git_file_diff(repo.clone(), all[0].hash.clone(), "../x".into(), None).is_err());
    assert!(git_commit_detail(repo, "--version".into()).is_err());
    let _ = fs::remove_dir_all(&dir);
  }
}
