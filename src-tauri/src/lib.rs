mod android_window;
mod file_export;
mod google_authorization;
mod speech_recognition;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(android_window::init())
        .plugin(file_export::init())
        .plugin(google_authorization::init())
        .plugin(speech_recognition::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::focus_flow_storage_read,
            storage::focus_flow_storage_commit,
            storage::focus_flow_storage_recover_primary,
            storage::focus_flow_storage_quarantine,
            storage::focus_flow_storage_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
