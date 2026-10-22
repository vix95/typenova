use tauri::Manager;

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
    .run(tauri::generate_context!())
    .expect("error while running TypeNova");
}
