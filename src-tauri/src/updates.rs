//! Updates of the program from the releases on GitHub.
//!
//! The page asks `update_check` whether a newer release exists; if the person agrees, `update_install` downloads it, checks its
//! signature against the public key built into the program (`plugins.updater.pubkey` in `tauri.conf.json`: only a file signed with
//! the private key of the author is accepted), runs the installer (which updates in place and keeps the settings) and the program
//! ends and starts again. Nothing is sent but an ordinary HTTPS request to GitHub for the file `latest.json`.

use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update found by the last check, kept until the person agrees to install it.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
  pub version: String,
  pub current: String,
  /// A short general note of the release (may be empty).
  pub notes: String,
}

#[derive(Serialize, Clone)]
struct Progress {
  downloaded: u64,
  total: Option<u64>,
}

/// Asks GitHub whether a newer release exists. `None` = the program is up to date.
#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
  let updater = app.updater_builder().timeout(Duration::from_secs(20)).build().map_err(|error| error.to_string())?;
  let found = updater.check().await.map_err(|error| error.to_string())?;
  let info = found.as_ref().map(|update| UpdateInfo { version: update.version.clone(), current: update.current_version.clone(), notes: update.body.clone().unwrap_or_default() });
  *pending.0.lock().map_err(|_| "update state is poisoned".to_string())? = found;
  Ok(info)
}

/// Downloads the update found by `update_check` (reporting `update-progress` events) and installs it; the program ends when the
/// installer starts, so this returns only when something went wrong.
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
  let update = pending.0.lock().map_err(|_| "update state is poisoned".to_string())?.take().ok_or_else(|| "there is no update to install".to_string())?;
  let mut downloaded = 0u64;
  let progress_app = app.clone();
  let exit_app = app.clone();
  update
    .download_and_install(
      move |chunk, total| {
        downloaded += chunk as u64;
        let _ = progress_app.emit("update-progress", Progress { downloaded, total });
      },
      // The shells of the terminal are stopped before the program ends for the installer, as when it is closed.
      move || { crate::terminal::kill_all(&exit_app); },
    )
    .await
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_info_of_an_update_is_plain_data() {
    let info = UpdateInfo { version: "1.2.3".into(), current: "1.2.2".into(), notes: String::new() };
    assert_eq!(serde_json::to_string(&info).unwrap(), r#"{"version":"1.2.3","current":"1.2.2","notes":""}"#);
  }
}
