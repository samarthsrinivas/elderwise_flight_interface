pub mod error;
pub mod store;

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use tauri::Manager;

use error::{ErrorPayload, HistoryError};

/// Serializes store access from concurrent command invocations so JSONL
/// lines are never interleaved and reads never observe a torn write.
pub struct HistoryState {
    lock: Mutex<()>,
}

impl HistoryState {
    pub fn new() -> Self {
        Self {
            lock: Mutex::new(()),
        }
    }
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, HistoryError> {
    // Sessions are data, not config: ~/Library/Application Support/com.elderwise.app
    app.path()
        .app_data_dir()
        .map_err(|err| HistoryError::Path(err.to_string()))
}

/// Runs a blocking store operation off the async runtime. The owned
/// `AppHandle` moves into the closure (a `State<'_, _>` param could not);
/// the shared lock is re-fetched inside via `app.state()`.
async fn with_store<T, F>(app: tauri::AppHandle, op: F) -> Result<T, ErrorPayload>
where
    T: Send + 'static,
    F: FnOnce(&std::path::Path) -> Result<T, HistoryError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let dir = data_dir(&app)?;
        let state = app.state::<HistoryState>();
        let _guard = state
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        op(&dir)
    })
    .await
    .map_err(|err| ErrorPayload::from(HistoryError::Join(err.to_string())))?
    .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn history_append(app: tauri::AppHandle, record: Value) -> Result<(), ErrorPayload> {
    with_store(app, move |dir| store::append(dir, &record)).await
}

#[tauri::command]
pub async fn history_read(app: tauri::AppHandle) -> Result<Vec<Value>, ErrorPayload> {
    with_store(app, store::read_all).await
}

#[tauri::command]
pub async fn history_clear(app: tauri::AppHandle) -> Result<(), ErrorPayload> {
    with_store(app, store::clear).await
}
