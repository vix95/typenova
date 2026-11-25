//! Remembers how the main window was left (its place and size, maximized, full screen) and restores it at the next start.
//!
//! The state is a small JSON file in the data folder of the program. The place and size are the ones of the window in its normal state:
//! while it is maximized or full screen they are not updated, so leaving those modes returns to the last normal size.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const FILE_NAME: &str = "window-state.json";
const MIN_WIDTH: u32 = 900;
const MIN_HEIGHT: u32 = 500;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
pub struct WindowState {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
  pub maximized: bool,
  pub fullscreen: bool,
}

/// The last known state, kept while the program runs and written when the window closes.
static CURRENT: Mutex<Option<WindowState>> = Mutex::new(None);
/// Whether the program was used here before this start: the state file is written when the window closes, so on the first start of a fresh install it is not there yet.
static EARLIER_SESSION: AtomicBool = AtomicBool::new(false);

/// For the page: true when the program had been started and closed here before (an update or an ordinary start), false on the first start of a fresh install.
#[tauri::command]
pub fn earlier_session() -> bool {
  EARLIER_SESSION.load(Ordering::Relaxed)
}

fn state_path(app: &AppHandle) -> Option<PathBuf> {
  app.path().app_data_dir().ok().map(|dir| dir.join(FILE_NAME))
}

/// Reads a saved state; anything unreadable or with a size that could not belong to a window gives `None`.
fn parse(text: &str) -> Option<WindowState> {
  let state: WindowState = serde_json::from_str(text).ok()?;
  (state.width >= MIN_WIDTH && state.height >= MIN_HEIGHT && state.width <= 20_000 && state.height <= 20_000).then_some(state)
}

fn read(path: &Path) -> Option<WindowState> {
  parse(&std::fs::read_to_string(path).ok()?)
}

fn write(path: &Path, state: &WindowState) {
  if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
  if let Ok(text) = serde_json::to_string(state) { let _ = std::fs::write(path, text); }
}

/// Whether the saved place is on a screen that is still there: at least part of the title bar must lie inside some monitor.
fn on_some_monitor(window: &WebviewWindow, state: &WindowState) -> bool {
  let Ok(monitors) = window.available_monitors() else { return true };
  if monitors.is_empty() { return true; }
  let (left, right, top) = (state.x, state.x + state.width as i32, state.y);
  monitors.iter().any(|monitor| {
    let (position, size) = (monitor.position(), monitor.size());
    let (m_left, m_right, m_top, m_bottom) = (position.x, position.x + size.width as i32, position.y, position.y + size.height as i32);
    right > m_left + 100 && left < m_right - 100 && top >= m_top - 20 && top < m_bottom - 50
  })
}

/// Puts the main window back as it was left. A place that is no longer on a screen is dropped (the size is kept).
pub fn restore(app: &AppHandle, window: &WebviewWindow) {
  let path = state_path(app);
  EARLIER_SESSION.store(path.as_deref().is_some_and(Path::exists), Ordering::Relaxed);
  let Some(state) = path.and_then(|path| read(&path)) else { return };
  // The saved size is the outer one (with the frame); the size to set is the one of the page, so the frame is taken off, or the window would grow at every start.
  let frame = match (window.outer_size(), window.inner_size()) { (Ok(outer), Ok(inner)) => (outer.width.saturating_sub(inner.width), outer.height.saturating_sub(inner.height)), _ => (0, 0) };
  let _ = window.set_size(PhysicalSize::new(state.width.saturating_sub(frame.0).max(1), state.height.saturating_sub(frame.1).max(1)));
  if on_some_monitor(window, &state) { let _ = window.set_position(PhysicalPosition::new(state.x, state.y)); }
  if let Ok(mut current) = CURRENT.lock() { *current = Some(state); }
  if state.fullscreen { let _ = window.set_fullscreen(true); } else if state.maximized { let _ = window.maximize(); }
}

/// Notes the state of the window after it moved, was resized or changed its mode.
pub fn track(window: &WebviewWindow) {
  let (maximized, fullscreen) = (window.is_maximized().unwrap_or(false), window.is_fullscreen().unwrap_or(false));
  let Ok(mut current) = CURRENT.lock() else { return };
  let mut state = current.unwrap_or_default();
  state.maximized = maximized;
  state.fullscreen = fullscreen;
  if !maximized && !fullscreen && !window.is_minimized().unwrap_or(false) {
    if let (Ok(size), Ok(position)) = (window.outer_size(), window.outer_position()) {
      // The events of a window that is becoming maximized can arrive before it says so: a size that covers the whole work area of the screen is not a normal size.
      let covers_screen = matches!(window.current_monitor(), Ok(Some(monitor)) if size.width >= monitor.work_area().size.width && size.height >= monitor.work_area().size.height);
      if !covers_screen { (state.x, state.y, state.width, state.height) = (position.x, position.y, size.width, size.height); }
    }
  }
  // A window that was maximized before it ever had a normal size gets the size it opens with.
  if state.width < MIN_WIDTH { (state.x, state.y, state.width, state.height) = (100, 100, 1665, 896); }
  *current = Some(state);
}

/// Writes the last known state; called when the main window closes.
pub fn save(app: &AppHandle) {
  let state = CURRENT.lock().ok().and_then(|current| *current);
  if let (Some(path), Some(state)) = (state_path(app), state) { write(&path, &state); }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_saved_state_reads_back() {
    let state = WindowState { x: 10, y: 20, width: 1400, height: 900, maximized: true, fullscreen: false };
    assert_eq!(parse(&serde_json::to_string(&state).unwrap()), Some(state));
  }

  #[test]
  fn nonsense_is_not_a_state() {
    assert_eq!(parse("not json"), None);
    assert_eq!(parse(r#"{"x":0,"y":0,"width":10,"height":10,"maximized":false,"fullscreen":false}"#), None);
    assert_eq!(parse(r#"{"x":0,"y":0,"width":900000,"height":900,"maximized":false,"fullscreen":false}"#), None);
  }

  #[test]
  fn the_state_goes_through_a_file() {
    let dir = std::env::temp_dir().join(format!("typenova-test-window-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let path = dir.join(FILE_NAME);
    assert_eq!(read(&path), None);
    let state = WindowState { x: -5, y: 7, width: 1000, height: 600, maximized: false, fullscreen: true };
    write(&path, &state);
    assert_eq!(read(&path), Some(state));
    let _ = std::fs::remove_dir_all(&dir);
  }
}
