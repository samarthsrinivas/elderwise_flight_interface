// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::Manager;

mod age;
mod ai;
mod export;
mod history;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    builder
        .manage(ai::AiState::new())
        .manage(history::HistoryState::new())
        .setup(|app| {
            // Version from Cargo (bumped in lockstep with the other manifests
            // at release) so the window title shows the running build.
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("Elderwise v{}", env!("CARGO_PKG_VERSION")))?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai::ai_get_settings,
            ai::ai_set_settings,
            ai::ai_set_key,
            ai::ai_clear_key,
            ai::ai_status,
            ai::ai_test,
            ai::transcribe_audio,
            ai::synthesize_speech,
            ai::summarize_assessment,
            age::age_model_status,
            age::age_download_weights,
            age::estimate_voice_age,
            export::export_default_dir,
            export::export_dialog_mode,
            export::export_save_pdf,
            history::history_append,
            history::history_read,
            history::history_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
