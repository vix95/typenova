//! Removes the disposable caches of the WebView profile when the program ends.
//!
//! The WebView keeps a code cache, a disk cache and shader caches in the program's data folder: thousands of small files that are rebuilt on demand and that
//! make removing the program slow. Everything the user may care about (local storage, IndexedDB, cookies, the settings) lives elsewhere in the profile and is left alone.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Folders of the profile (relative to `EBWebView`) that hold nothing but caches.
const CACHE_FOLDERS: [&str; 8] = [
  "Default/Code Cache",
  "Default/Cache",
  "Default/GPUCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "GrShaderCache",
  "ShaderCache",
  "GraphiteDawnCache",
];

/// Set by the instance that owns the profile: a second launch hands its start over and ends at once, and must not touch the caches of the one that runs.
static OWNS_PROFILE: AtomicBool = AtomicBool::new(false);

pub fn claim_profile() { OWNS_PROFILE.store(true, Ordering::SeqCst); }

fn profile_folder(app: &AppHandle) -> Option<PathBuf> { app.path().app_local_data_dir().ok().map(|dir| dir.join("EBWebView")) }

/// Deletes the caches under `profile`; returns how many folders are still there (the WebView may still hold files while it shuts down).
fn remove_caches(profile: &Path) -> usize {
  CACHE_FOLDERS.iter().filter(|folder| {
    let path = profile.join(folder);
    path.exists() && { let _ = std::fs::remove_dir_all(&path); path.exists() }
  }).count()
}

/// Called when the program ends. The WebView's own processes may need a moment to let go of their files, so a folder that cannot be removed yet is retried briefly.
pub fn clean_on_exit(app: &AppHandle) {
  if !OWNS_PROFILE.load(Ordering::SeqCst) { return; }
  let Some(profile) = profile_folder(app) else { return };
  for _ in 0..20 {
    if remove_caches(&profile) == 0 { return; }
    std::thread::sleep(Duration::from_millis(100));
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn removes_only_the_caches() {
    let root = std::env::temp_dir().join(format!("typenova-test-cache-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    for folder in ["Default/Code Cache/js", "Default/Local Storage/leveldb", "Default/IndexedDB", "ShaderCache"] { std::fs::create_dir_all(root.join(folder)).unwrap(); }
    std::fs::write(root.join("Default/Code Cache/js/a"), b"x").unwrap();
    std::fs::write(root.join("Default/Local Storage/leveldb/keep"), b"x").unwrap();
    assert_eq!(remove_caches(&root), 0);
    assert!(!root.join("Default/Code Cache").exists() && !root.join("ShaderCache").exists());
    assert!(root.join("Default/Local Storage/leveldb/keep").exists() && root.join("Default/IndexedDB").exists());
    let _ = std::fs::remove_dir_all(&root);
  }
}
