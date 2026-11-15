//! The dictionary of a Git repository: one plain text file, `.typenova/dictionary.txt`, with the words the people working in it have added (names, terms), so that they are not marked as spelling mistakes for anyone who opens the repository.
//!
//! The interface may read and write this one file and nothing else here: the folder it names must be the top folder of a Git repository (checked with git itself), the file name is fixed,
//! a link instead of the folder or the file is refused, the size is limited, and a write goes through a temporary file that replaces the old one, so a failed write never leaves half a file.

use crate::git::run_git;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const FOLDER: &str = ".typenova";
const FILE: &str = "dictionary.txt";
const MAX_BYTES: usize = 1_000_000;

/// The path of the dictionary file in `repo`, after checking that `repo` is the top folder of a Git repository.
fn dictionary_path(repo: &str) -> Result<PathBuf, String> {
  let top = run_git(repo, &["rev-parse", "--show-toplevel"]).map_err(|_| "not a Git repository".to_string())?;
  let given = fs::canonicalize(repo).map_err(|error| error.to_string())?;
  let real = fs::canonicalize(top.trim()).map_err(|error| error.to_string())?;
  if given != real {
    return Err("the folder is not the top folder of the repository".into());
  }
  Ok(given.join(FOLDER).join(FILE))
}

fn is_link(path: &Path) -> bool {
  fs::symlink_metadata(path).map(|meta| meta.file_type().is_symlink()).unwrap_or(false)
}

fn read(repo: &str) -> Result<Option<String>, String> {
  let path = dictionary_path(repo)?;
  let folder = path.parent().ok_or("no folder")?;
  if is_link(folder) || is_link(&path) {
    return Err("the dictionary file is a link".into());
  }
  match fs::read(&path) {
    Ok(bytes) if bytes.len() > MAX_BYTES => Err("the dictionary file is too big".into()),
    Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(error) => Err(error.to_string()),
  }
}

/// Writes the file and returns its path.
fn write(repo: &str, text: &str) -> Result<String, String> {
  if text.len() > MAX_BYTES {
    return Err("the dictionary is too big".into());
  }
  let path = dictionary_path(repo)?;
  let folder = path.parent().ok_or("no folder")?.to_path_buf();
  if is_link(&folder) || is_link(&path) {
    return Err("the dictionary file is a link".into());
  }
  fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
  let temporary = folder.join(format!("{FILE}.tmp"));
  {
    let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    file.write_all(text.as_bytes()).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
  }
  fs::rename(&temporary, &path).map_err(|error| { let _ = fs::remove_file(&temporary); error.to_string() })?;
  Ok(path.to_string_lossy().into_owned())
}

/// The text of the repository's dictionary, or nothing when it has none yet.
#[tauri::command]
pub async fn repo_dictionary_read(repo: String) -> Result<Option<String>, String> {
  tauri::async_runtime::spawn_blocking(move || read(&repo)).await.map_err(|error| error.to_string())?
}

/// Replaces the repository's dictionary with `text`; resolves with the path of the file.
#[tauri::command]
pub async fn repo_dictionary_write(repo: String, text: String) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || write(&repo, &text)).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::process::Command;

  fn init(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    assert!(Command::new("git").arg("-C").arg(dir).args(["init", "-q"]).status().map(|s| s.success()).unwrap_or(false));
  }

  #[test]
  fn the_dictionary_is_written_and_read_only_in_a_repository() {
    if Command::new("git").arg("--version").output().is_err() {
      return;
    }
    let base = std::env::temp_dir().join(format!("typenova-dict-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let (repo, plain, sub) = (base.join("repo"), base.join("plain"), base.join("repo").join("docs"));
    init(&repo);
    fs::create_dir_all(&plain).unwrap();
    fs::create_dir_all(&sub).unwrap();
    let repo_text = repo.to_string_lossy().into_owned();

    assert_eq!(read(&repo_text).unwrap(), None, "no file yet");
    let path = write(&repo_text, "# words\nAnna\nTypeNova\n").unwrap();
    assert!(path.ends_with("dictionary.txt") && Path::new(&path).exists());
    assert_eq!(read(&repo_text).unwrap().as_deref(), Some("# words\nAnna\nTypeNova\n"));
    write(&repo_text, "Anna\n").unwrap();
    assert_eq!(read(&repo_text).unwrap().as_deref(), Some("Anna\n"), "a second write replaces the first");
    assert!(!repo.join(FOLDER).join("dictionary.txt.tmp").exists(), "no temporary file is left");

    // Not a repository, a folder inside one (not its top), and a too big text are refused.
    assert!(write(&plain.to_string_lossy(), "x\n").is_err() && read(&plain.to_string_lossy()).is_err());
    assert!(write(&sub.to_string_lossy(), "x\n").is_err(), "only the top folder of the repository");
    assert!(!sub.join(FOLDER).exists());
    assert!(write(&repo_text, &"a".repeat(MAX_BYTES + 1)).is_err());
    let _ = fs::remove_dir_all(&base);
  }
}
