//! Files copied in the system file manager: telling the UI whether there are any and pasting them into a project folder.
//!
//! The webview cannot read file paths from the clipboard, and the paths are never taken from the frontend: the list is read
//! here, from the clipboard itself, at the moment of pasting.

use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFiles {
  /// File and folder names found on the clipboard.
  pub names: Vec<String>,
  /// Changes whenever the clipboard content changes (0 where unsupported), to tell which of two copies is newer.
  pub sequence: u32,
}

#[cfg(windows)]
fn clipboard_paths() -> Vec<PathBuf> {
  use clipboard_win::{formats, get_clipboard, is_format_avail};
  if !is_format_avail(formats::CF_HDROP) {
    return Vec::new();
  }
  let list: Result<Vec<String>, _> = get_clipboard(formats::FileList);
  list.map(|items| items.into_iter().map(PathBuf::from).collect()).unwrap_or_default()
}

#[cfg(not(windows))]
fn clipboard_paths() -> Vec<PathBuf> {
  Vec::new()
}

#[cfg(windows)]
fn clipboard_sequence() -> u32 {
  clipboard_win::seq_num().map(|number| number.get()).unwrap_or(0)
}

#[cfg(not(windows))]
fn clipboard_sequence() -> u32 {
  0
}

/// A free name for `name` in `dir`: the name itself, or `name (label)`, `name (label 2)`… keeping the extension of a file.
pub fn unique_destination(dir: &Path, name: &str, is_dir: bool, label: &str) -> PathBuf {
  let candidate = dir.join(name);
  if !candidate.exists() {
    return candidate;
  }
  let dot = if is_dir { None } else { name.rfind('.').filter(|index| *index > 0) };
  let (stem, extension) = match dot {
    Some(index) => (&name[..index], &name[index..]),
    None => (name, ""),
  };
  let mut number = 1;
  loop {
    let suffix = if number == 1 { format!(" ({label})") } else { format!(" ({label} {number})") };
    let candidate = dir.join(format!("{stem}{suffix}{extension}"));
    if !candidate.exists() {
      return candidate;
    }
    number += 1;
  }
}

fn copy_recursive(source: &Path, destination: &Path) -> io::Result<()> {
  if source.is_dir() {
    fs::create_dir(destination)?;
    for entry in fs::read_dir(source)? {
      let entry = entry?;
      if entry.file_type()?.is_symlink() {
        continue; // links are not followed or recreated
      }
      copy_recursive(&entry.path(), &destination.join(entry.file_name()))?;
    }
    Ok(())
  } else {
    fs::copy(source, destination).map(|_| ())
  }
}

/// Copies `sources` into `dest_dir` with collision-safe names; returns the created paths.
pub fn paste_into(sources: &[PathBuf], dest_dir: &Path, label: &str) -> Result<Vec<String>, String> {
  if !dest_dir.is_dir() {
    return Err("the destination is not a folder".into());
  }
  let canonical_dest = fs::canonicalize(dest_dir).map_err(|error| error.to_string())?;
  let mut created = Vec::new();
  for source in sources {
    let Some(name) = source.file_name().and_then(|value| value.to_str()) else { continue };
    if !source.exists() {
      continue;
    }
    let is_dir = source.is_dir();
    if is_dir && fs::canonicalize(source).map(|path| canonical_dest.starts_with(&path)).unwrap_or(false) {
      return Err(format!("cannot paste the folder {name} into itself"));
    }
    let destination = unique_destination(dest_dir, name, is_dir, label);
    if let Err(error) = copy_recursive(source, &destination) {
      let _ = if is_dir { fs::remove_dir_all(&destination) } else { fs::remove_file(&destination) };
      return Err(format!("{name}: {error}"));
    }
    created.push(destination.to_string_lossy().into_owned());
  }
  if created.is_empty() {
    return Err("no files on the clipboard".into());
  }
  Ok(created)
}

#[tauri::command]
pub fn clipboard_file_list() -> ClipboardFiles {
  let names = clipboard_paths()
    .iter()
    .filter_map(|path| path.file_name().and_then(|value| value.to_str()).map(str::to_owned))
    .collect();
  ClipboardFiles { names, sequence: clipboard_sequence() }
}

#[tauri::command]
pub fn paste_clipboard_files(dest_dir: String, copy_label: String) -> Result<Vec<String>, String> {
  paste_into(&clipboard_paths(), Path::new(&dest_dir), &copy_label)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("typenova-clip-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn names_that_exist_get_a_copy_suffix_and_keep_the_extension() {
    let dir = temp_dir("names");
    fs::write(dir.join("a.txt"), "x").unwrap();
    assert_eq!(unique_destination(&dir, "b.txt", false, "kopia"), dir.join("b.txt"));
    assert_eq!(unique_destination(&dir, "a.txt", false, "kopia"), dir.join("a (kopia).txt"));
    fs::write(dir.join("a (kopia).txt"), "x").unwrap();
    assert_eq!(unique_destination(&dir, "a.txt", false, "kopia"), dir.join("a (kopia 2).txt"));
    fs::create_dir(dir.join("docs")).unwrap();
    assert_eq!(unique_destination(&dir, "docs", true, "copy"), dir.join("docs (copy)"));
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn files_and_folders_are_copied_without_overwriting() {
    let root = temp_dir("paste");
    let source = root.join("source");
    let dest = root.join("dest");
    fs::create_dir_all(source.join("folder/inner")).unwrap();
    fs::create_dir(&dest).unwrap();
    fs::write(source.join("note.md"), "new").unwrap();
    fs::write(source.join("folder/inner/deep.txt"), "deep").unwrap();
    fs::write(dest.join("note.md"), "old").unwrap();
    let created = paste_into(&[source.join("note.md"), source.join("folder")], &dest, "copy").unwrap();
    assert_eq!(created.len(), 2);
    assert_eq!(fs::read_to_string(dest.join("note.md")).unwrap(), "old");
    assert_eq!(fs::read_to_string(dest.join("note (copy).md")).unwrap(), "new");
    assert_eq!(fs::read_to_string(dest.join("folder/inner/deep.txt")).unwrap(), "deep");
    assert!(paste_into(&[source.join("folder")], &source.join("folder"), "copy").is_err());
    assert!(paste_into(&[], &dest, "copy").is_err());
    let _ = fs::remove_dir_all(&root);
  }
}
