use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Image formats the preview may display from outside the pre-granted folders.
const PREVIEW_IMAGE_EXTENSIONS: [&str; 10] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "apng"];

/// Validates a path referenced by an image in an opened Markdown document and returns its canonical,
/// symlink-resolved form without the Windows verbatim (`\?\`) prefix.
///
/// Only existing regular files with an image extension are accepted, so the grant can never widen
/// to a directory, to a non-image file, or to a path that does not exist.
fn preview_image_grant_path(path: &str) -> Result<PathBuf, String> {
  let canonical = std::fs::canonicalize(Path::new(path)).map_err(|error| format!("cannot resolve image path: {error}"))?;
  let extension = canonical
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| value.to_ascii_lowercase())
    .unwrap_or_default();
  if !PREVIEW_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
    return Err("not an image file".into());
  }
  if !canonical.is_file() {
    return Err("not a file".into());
  }
  let text = canonical.to_string_lossy();
  Ok(match text.strip_prefix(r"\?\") {
    Some(stripped) if !stripped.starts_with("UNC\\") => PathBuf::from(stripped),
    _ => canonical,
  })
}

/// Lets the preview display one local image that a document the user opened refers to.
///
/// The asset protocol scope stays limited to the home and app-data folders and to folders the user
/// picked in native dialogs; this grants read access to exactly one image file, on demand.
fn grant_preview_image<R: tauri::Runtime>(app: &impl Manager<R>, path: &str) -> Result<(), String> {
  let granted = preview_image_grant_path(path)?;
  app.asset_protocol_scope().allow_file(&granted).map_err(|error| error.to_string())
}

#[tauri::command]
fn allow_preview_image(app: AppHandle, path: String) -> Result<(), String> {
  grant_preview_image(&app, &path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Register first: a second launch forwards to this instance instead of
    // creating a second application process/window.
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    // Persist filesystem grants created when users choose files or folders in native dialogs.
    .plugin(tauri_plugin_persisted_scope::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![allow_preview_image])
    .run(tauri::generate_context!())
    .expect("error while running TypeNova");
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("typenova-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn accepts_existing_image_through_parent_segments() {
    let root = temp_dir("accept");
    fs::create_dir_all(root.join("docs")).unwrap();
    fs::create_dir_all(root.join("assets/algorithms")).unwrap();
    fs::write(root.join("assets/algorithms/absolute-value.PNG"), b"png").unwrap();
    let reference = root.join("docs/../assets/algorithms/absolute-value.PNG");
    let granted = preview_image_grant_path(reference.to_str().unwrap()).unwrap();
    assert!(granted.ends_with("assets/algorithms/absolute-value.PNG") || granted.ends_with(r"assets\algorithms\absolute-value.PNG"));
    assert!(!granted.to_string_lossy().starts_with(r"\?\"));
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn rejects_non_images_directories_and_missing_files() {
    let root = temp_dir("reject");
    fs::write(root.join("secret.txt"), b"x").unwrap();
    fs::write(root.join("noextension"), b"x").unwrap();
    fs::create_dir_all(root.join("folder.png")).unwrap();
    assert!(preview_image_grant_path(root.join("secret.txt").to_str().unwrap()).is_err());
    assert!(preview_image_grant_path(root.join("noextension").to_str().unwrap()).is_err());
    assert!(preview_image_grant_path(root.join("folder.png").to_str().unwrap()).is_err());
    assert!(preview_image_grant_path(root.join("missing.png").to_str().unwrap()).is_err());
    let _ = fs::remove_dir_all(&root);
  }
}
