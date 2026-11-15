//! Keeps a new window inside the usable area of the screen it opens on.
//!
//! The windows open at a fixed logical size (1665x896 for the main one). On a small screen or at a high display scale that is taller than the
//! area above the taskbar, so the lower part of the window - the status bar, the bottom of a dialog and its "Done" button - lies under the
//! taskbar and cannot be reached. The window is made smaller and moved back when it does not fit.

use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

/// Shrinks `window` to the work area of its monitor (the screen without the taskbar) and moves it inside, when it sticks out. A maximized or
/// full-screen window is left alone: the system already fits it.
pub fn fit_to_work_area(window: &WebviewWindow) {
  if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
    return;
  }
  let monitor = match window.current_monitor() {
    Ok(Some(monitor)) => monitor,
    _ => match window.primary_monitor() {
      Ok(Some(monitor)) => monitor,
      _ => return,
    },
  };
  let (Ok(outer), Ok(inner), Ok(position)) = (window.outer_size(), window.inner_size(), window.outer_position()) else { return };
  let work = monitor.work_area();
  let (work_x, work_y) = (work.position.x, work.position.y);
  let (work_w, work_h) = (work.size.width, work.size.height);
  // The frame around the page (title bar, borders) stays the same, so only the page area is reduced.
  let frame_w = outer.width.saturating_sub(inner.width);
  let frame_h = outer.height.saturating_sub(inner.height);
  let width = outer.width.min(work_w);
  let height = outer.height.min(work_h);
  if width < outer.width || height < outer.height {
    let _ = window.set_size(PhysicalSize::new(width.saturating_sub(frame_w).max(1), height.saturating_sub(frame_h).max(1)));
  }
  let x = position.x.min(work_x + work_w as i32 - width as i32).max(work_x);
  let y = position.y.min(work_y + work_h as i32 - height as i32).max(work_y);
  if x != position.x || y != position.y {
    let _ = window.set_position(PhysicalPosition::new(x, y));
  }
}
