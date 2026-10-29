use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

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

/// Number used to give every extra document window its own label (`doc-1`, `doc-2`, ...).
static DOCUMENT_WINDOWS: AtomicU32 = AtomicU32::new(1);

/// In-app URL of a document window. The token only names a hand-off entry the frontend staged for the new window, so
/// anything but a short plain token is refused.
fn document_window_url(token: &str) -> Result<String, String> {
  let plain = !token.is_empty() && token.len() <= 64 && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
  if !plain {
    return Err("invalid document hand-off token".to_string());
  }
  Ok(format!("index.html?detach={token}"))
}

/// Opens an additional editor window for a document torn off a tab. Async on purpose: creating a window from a
/// synchronous command can deadlock on Windows.
#[tauri::command]
async fn open_document_window(app: AppHandle, token: String) -> Result<(), String> {
  let url = document_window_url(&token)?;
  let label = format!("doc-{}", DOCUMENT_WINDOWS.fetch_add(1, Ordering::Relaxed));
  tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App(url.into()))
    .title("TypeNova")
    .inner_size(1200.0, 800.0)
    .min_inner_size(900.0, 500.0)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

/// Editor windows are the main window and the document windows; helper windows (the drag ghost) never take drops.
fn is_editor_window_label(label: &str) -> bool {
  label == "main" || label.starts_with("doc-")
}

/// Label of the small click-through window that follows the cursor while a tab is dragged outside its window.
const DRAG_GHOST_LABEL: &str = "drag-ghost";

/// Percent-encodes text for use in a URL fragment.
fn percent_encode(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for byte in text.bytes() {
    if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
      out.push(byte as char);
    } else {
      out.push_str(&format!("%{byte:02X}"));
    }
  }
  out
}

/// Shows (creating it on first use) the drag ghost: a transparent, borderless, always-on-top window that ignores the
/// mouse, so the dragged tab stays visible above any other window, including other TypeNova windows. `payload` is a JSON
/// object with the texts and colours the page `ghost.html` displays.
#[tauri::command]
async fn drag_ghost_show(app: AppHandle, payload: String) -> Result<(), String> {
  if let Some(ghost) = app.get_webview_window(DRAG_GHOST_LABEL) {
    let literal = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    let _ = ghost.eval(format!("window.setGhost && window.setGhost(JSON.parse({literal}))"));
    drag_ghost_follow(&app);
    let _ = ghost.show();
    return Ok(());
  }
  let url = format!("ghost.html#{}", percent_encode(&payload));
  let ghost = tauri::WebviewWindowBuilder::new(&app, DRAG_GHOST_LABEL, tauri::WebviewUrl::App(url.into()))
    .title("")
    .inner_size(300.0, 72.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
  let _ = ghost.set_ignore_cursor_events(true);
  drag_ghost_follow(&app);
  let _ = ghost.show();
  Ok(())
}

/// Puts the drag ghost next to the real cursor position.
fn drag_ghost_follow(app: &AppHandle) {
  if let (Some(ghost), Ok(cursor)) = (app.get_webview_window(DRAG_GHOST_LABEL), app.cursor_position()) {
    let _ = ghost.set_position(tauri::PhysicalPosition::new(cursor.x as i32 + 16, cursor.y as i32 + 16));
  }
}

#[tauri::command]
fn drag_ghost_move(app: AppHandle) {
  drag_ghost_follow(&app);
}

#[tauri::command]
fn drag_ghost_hide(app: AppHandle) {
  if let Some(ghost) = app.get_webview_window(DRAG_GHOST_LABEL) {
    let _ = ghost.hide();
  }
}

/// A window's outer rectangle in physical screen pixels: x, y, width, height.
type WindowRect = (i32, i32, u32, u32);

/// The label of the first candidate window whose rectangle contains the point (physical screen pixels).
fn window_at_point(cursor: (f64, f64), windows: &[(String, WindowRect)]) -> Option<String> {
  windows
    .iter()
    .find(|(_, (x, y, width, height))| {
      cursor.0 >= f64::from(*x) && cursor.0 < f64::from(*x) + f64::from(*width) && cursor.1 >= f64::from(*y) && cursor.1 < f64::from(*y) + f64::from(*height)
    })
    .map(|(label, _)| label.clone())
}

/// Another visible TypeNova window under the mouse cursor, if any.
fn other_window_under_cursor(app: &AppHandle, exclude: &str) -> Option<String> {
  let cursor = app.cursor_position().ok()?;
  let candidates: Vec<(String, WindowRect)> = app
    .webview_windows()
    .into_iter()
    .filter(|(label, window)| label != exclude && is_editor_window_label(label) && window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false))
    .filter_map(|(label, window)| {
      let position = window.outer_position().ok()?;
      let size = window.outer_size().ok()?;
      Some((label, (position.x, position.y, size.width, size.height)))
    })
    .collect();
  window_at_point((cursor.x, cursor.y), &candidates)
}

/// The mouse cursor in the client coordinates (CSS pixels) of the window with this label.
fn cursor_in_window(app: &AppHandle, label: &str) -> Option<(f64, f64)> {
  let cursor = app.cursor_position().ok()?;
  let window = app.get_webview_window(label)?;
  let origin = window.inner_position().ok()?;
  let scale = window.scale_factor().ok()?;
  Some(((cursor.x - f64::from(origin.x)) / scale, (cursor.y - f64::from(origin.y)) / scale))
}

/// Window that currently shows the drop placeholder for a dragged tab (so it can be told when the tab leaves).
static HOVER_TARGET: Mutex<Option<String>> = Mutex::new(None);

#[derive(Clone, serde::Serialize)]
struct TabHoverPayload {
  title: String,
  x: f64,
  y: f64,
}

#[derive(Clone, serde::Serialize)]
struct TabDropPayload {
  token: String,
  x: f64,
  y: f64,
}

/// Tells the window that lost the dragged tab that it is gone (so it removes its drop placeholder).
fn leave_hover_target(app: &AppHandle) {
  let previous = HOVER_TARGET.lock().ok().and_then(|mut guard| guard.take());
  if let Some(label) = previous {
    let _ = app.emit_to(label.as_str(), "tab-drag-leave", ());
  }
}

/// Called repeatedly while a tab is dragged outside its window: returns the other TypeNova window under the cursor and
/// tells that window where the cursor is (`tab-drag-over`) so it can show a placeholder tab; the window the tab left is
/// told with `tab-drag-leave`.
#[tauri::command]
fn drag_hover(app: AppHandle, window: tauri::WebviewWindow, title: String) -> Option<String> {
  let target = other_window_under_cursor(&app, window.label());
  let changed = HOVER_TARGET.lock().map(|guard| *guard != target).unwrap_or(true);
  if changed {
    leave_hover_target(&app);
    if let Ok(mut guard) = HOVER_TARGET.lock() {
      *guard = target.clone();
    }
  }
  if let Some(label) = &target {
    if let Some((x, y)) = cursor_in_window(&app, label) {
      let _ = app.emit_to(label.as_str(), "tab-drag-over", TabHoverPayload { title, x, y });
    }
  }
  target
}

/// The dragged tab no longer hovers another window (it came back or was released).
#[tauri::command]
fn drag_hover_end(app: AppHandle) {
  leave_hover_target(&app);
}

/// Label of another TypeNova window under the cursor; used while a tab is being dragged to tell where it would land.
#[tauri::command]
fn window_under_cursor(app: AppHandle, window: tauri::WebviewWindow) -> Option<String> {
  other_window_under_cursor(&app, window.label())
}

/// Hands a staged document to the other window under the cursor, together with where the cursor is in that window
/// (so it can open the tab at the drop position), and brings that window forward. Returns false when no other window
/// is there (nothing was sent).
#[tauri::command]
fn deliver_tab(app: AppHandle, window: tauri::WebviewWindow, token: String) -> Result<bool, String> {
  document_window_url(&token)?;
  let Some(target) = other_window_under_cursor(&app, window.label()) else { return Ok(false) };
  if let Ok(mut guard) = HOVER_TARGET.lock() {
    *guard = None;
  }
  let (x, y) = cursor_in_window(&app, &target).unwrap_or((-1.0, -1.0));
  app.emit_to(target.as_str(), "tab-dropped", TabDropPayload { token, x, y }).map_err(|error| error.to_string())?;
  if let Some(window) = app.get_webview_window(&target) {
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
  Ok(true)
}

/// Closes the calling window without any close prompt; used by a document window whose only document moved elsewhere.
#[tauri::command]
fn close_current_window(window: tauri::WebviewWindow) -> Result<(), String> {
  window.destroy().map_err(|error| error.to_string())
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
    .invoke_handler(tauri::generate_handler![allow_preview_image, open_document_window, window_under_cursor, deliver_tab, close_current_window, drag_ghost_show, drag_ghost_move, drag_ghost_hide, drag_hover, drag_hover_end])
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

  #[test]
  fn document_window_url_accepts_plain_tokens_only() {
    assert_eq!(document_window_url("lx3k-a9f2q1").unwrap(), "index.html?detach=lx3k-a9f2q1");
    assert!(document_window_url("").is_err());
    assert!(document_window_url("a/b").is_err());
    assert!(document_window_url("a&b=1").is_err());
    assert!(document_window_url("../x").is_err());
    assert!(document_window_url(&"a".repeat(65)).is_err());
  }

  #[test]
  fn window_at_point_picks_the_window_containing_the_cursor() {
    let windows = vec![
      ("main".to_string(), (0, 0, 1000, 800)),
      ("doc-1".to_string(), (1200, 100, 600, 500)),
    ];
    assert_eq!(window_at_point((10.0, 10.0), &windows).as_deref(), Some("main"));
    assert_eq!(window_at_point((1500.0, 300.0), &windows).as_deref(), Some("doc-1"));
    assert_eq!(window_at_point((1100.0, 300.0), &windows), None);
    assert_eq!(window_at_point((1000.0, 10.0), &windows), None);
    assert_eq!(window_at_point((-5.0, 10.0), &windows), None);
    assert_eq!(window_at_point((10.0, 10.0), &[]), None);
  }

  #[test]
  fn percent_encode_keeps_unreserved_and_escapes_the_rest() {
    assert_eq!(percent_encode("a-Z_0.~"), "a-Z_0.~");
    assert_eq!(percent_encode("{\"t\":\"ł x\"}"), "%7B%22t%22%3A%22%C5%82%20x%22%7D");
  }

  #[test]
  fn only_editor_windows_take_drops() {
    assert!(is_editor_window_label("main"));
    assert!(is_editor_window_label("doc-3"));
    assert!(!is_editor_window_label("drag-ghost"));
  }
}
