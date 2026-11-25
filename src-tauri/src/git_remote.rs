//! Making a Git repository, cloning one from the web and fetching the latest changes into the current branch.
//!
//! Like the rest of the Git code, everything goes through the `git` executable with an argument list (never a shell). A clone only accepts web and ssh addresses
//! (never a local path, `file:` or an `ext::` transport that could run a command), never starts with `-`, and never goes into a folder that exists. Fetching is a
//! plain `git pull --ff-only`: it never makes a merge commit, never rewrites anything and stops with git's own message when the branches have diverged.

use crate::git::run_git;
use std::path::Path;

/// The address of a repository on the web or on an ssh server (`https://…`, `http://…`, `ssh://…`, `git://…` or `user@host:path`).
fn valid_url(url: &str) -> bool {
  let url = url.trim();
  if url.is_empty() || url.starts_with('-') || url.contains(char::is_whitespace) || url.contains("::") {
    return false;
  }
  let lower = url.to_lowercase();
  ["https://", "http://", "ssh://", "git://"].iter().any(|scheme| lower.starts_with(scheme)) || (url.contains('@') && url.contains(':') && !url.contains("://"))
}

/// A folder name for a clone: one plain name, no separators, no drive.
fn valid_name(name: &str) -> bool {
  !name.is_empty() && name != "." && name != ".." && name.len() <= 100 && !name.starts_with('-') && name.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
}

fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> impl std::future::Future<Output = Result<T, String>> {
  async move { tauri::async_runtime::spawn_blocking(job).await.map_err(|error| error.to_string())? }
}

fn init(path: &str) -> Result<String, String> {
  let folder = Path::new(path);
  if !folder.is_dir() {
    return Err("the folder does not exist".to_string());
  }
  if folder.join(".git").exists() {
    return Err("there is a Git repository in this folder already".to_string());
  }
  // `-b` needs git 2.28; with an older git the repository is made with its default branch name.
  if run_git(path, &["init", "-b", "main"]).is_err() {
    run_git(path, &["init"])?;
  }
  Ok(path.to_string())
}

fn clone(url: &str, parent: &str, name: &str) -> Result<String, String> {
  if !valid_url(url) {
    return Err("the address of the repository is not valid (use https://, ssh:// or user@host:path)".to_string());
  }
  if !valid_name(name) {
    return Err("the name of the folder is not valid".to_string());
  }
  let parent_folder = Path::new(parent);
  if !parent_folder.is_dir() {
    return Err("the folder to clone into does not exist".to_string());
  }
  let destination = parent_folder.join(name);
  if destination.exists() {
    return Err(format!("{} exists already", destination.display()));
  }
  run_git(parent, &["-c", "protocol.ext.allow=never", "clone", "--", url.trim(), name])?;
  Ok(destination.to_string_lossy().into_owned())
}

fn pull(repo: &str) -> Result<String, String> {
  Ok(run_git(repo, &["pull", "--ff-only", "--no-edit"])?.trim().to_string())
}

/// Makes a repository (branch `main`) in an existing folder.
#[tauri::command]
pub async fn git_init(path: String) -> Result<String, String> { blocking(move || init(&path)).await }

/// Clones `url` into the new folder `name` inside `parent`; gives the path of the clone.
#[tauri::command]
pub async fn git_clone(url: String, parent: String, name: String) -> Result<String, String> { blocking(move || clone(&url, &parent, &name)).await }

/// Fetches the latest changes of the current branch and fast-forwards to them; gives what git said.
#[tauri::command]
pub async fn git_pull(repo: String) -> Result<String, String> { blocking(move || pull(&repo)).await }

#[cfg(test)]
mod tests {
  use super::{valid_name, valid_url};

  #[test]
  fn only_web_and_ssh_addresses_are_cloned() {
    for good in ["https://github.com/vix95/typenova.git", "http://host/x.git", "ssh://git@host/x.git", "git://host/x.git", "git@github.com:vix95/typenova.git"] {
      assert!(valid_url(good), "{good}");
    }
    for bad in ["", "-oProxyCommand=x", "--upload-pack=x", "file:///C:/repo", "C:\\repo", "/home/me/repo", "ext::sh -c touch% /tmp/x", "https://host/a b.git", "../repo"] {
      assert!(!valid_url(bad), "{bad}");
    }
  }

  #[test]
  fn a_clone_goes_into_a_plain_folder_name() {
    for good in ["typenova", "my-repo.v2", "My Repo"] {
      assert!(valid_name(good), "{good}");
    }
    for bad in ["", ".", "..", "a/b", "a\\b", "C:", "-x", "a:b"] {
      assert!(!valid_name(bad), "{bad}");
    }
  }
}
