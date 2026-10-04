pub mod asr;
pub mod chat;
pub mod error;
mod probe;
mod providers;
pub mod settings;
mod status;
pub mod store;
#[cfg(test)]
mod transport_tests;
pub mod tts;

use error::{AiError, ErrorPayload};
pub use probe::TestResult;
use providers::{parse_key_provider, resolve_asr, resolve_chat, resolve_tts};
use serde_json::Value;
use settings::AiSettings;
pub use status::AiStatus;
use std::path::PathBuf;
use tauri::{Manager, State};

pub struct AiState {
    http: tokio::sync::OnceCell<reqwest::Client>,
}

impl AiState {
    pub fn new() -> Self {
        Self {
            http: tokio::sync::OnceCell::new(),
        }
    }

    async fn http(&self) -> Result<&reqwest::Client, AiError> {
        self.http
            .get_or_try_init(|| async {
                reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(10))
                    .timeout(std::time::Duration::from_secs(30))
                    .build()
            })
            .await
            .map_err(AiError::from)
    }
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, AiError> {
    app.path()
        .app_config_dir()
        .map_err(|err| AiError::Settings(err.to_string()))
}

#[tauri::command]
pub async fn ai_get_settings(app: tauri::AppHandle) -> Result<AiSettings, ErrorPayload> {
    let dir = config_dir(&app).map_err(ErrorPayload::from)?;
    Ok(settings::load(&dir))
}

#[tauri::command]
pub async fn ai_set_settings(
    app: tauri::AppHandle,
    next: AiSettings,
) -> Result<AiSettings, ErrorPayload> {
    let dir = config_dir(&app).map_err(ErrorPayload::from)?;
    settings::save(&dir, &next).map_err(|err| ErrorPayload::from(AiError::Settings(err)))?;
    Ok(next)
}

#[tauri::command]
pub async fn ai_set_key(provider: String, key: String) -> Result<(), ErrorPayload> {
    let key_provider = parse_key_provider(&provider).map_err(ErrorPayload::from)?;
    let trimmed = key.trim();
    if trimmed.is_empty() {
        store::clear_key(key_provider).map_err(ErrorPayload::from)
    } else {
        store::save_key(key_provider, trimmed).map_err(ErrorPayload::from)
    }
}

#[tauri::command]
pub async fn ai_clear_key(provider: String) -> Result<(), ErrorPayload> {
    let key_provider = parse_key_provider(&provider).map_err(ErrorPayload::from)?;
    store::clear_key(key_provider).map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn ai_status(app: tauri::AppHandle) -> Result<AiStatus, ErrorPayload> {
    let dir = config_dir(&app).map_err(ErrorPayload::from)?;
    let openai = providers::key_source(store::KeyProvider::Openai).map_err(ErrorPayload::from)?;
    let elevenlabs =
        providers::key_source(store::KeyProvider::Elevenlabs).map_err(ErrorPayload::from)?;
    Ok(status::build_status(
        &settings::load(&dir),
        openai,
        elevenlabs,
    ))
}

#[tauri::command]
pub async fn ai_test(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    provider: String,
) -> Result<TestResult, ErrorPayload> {
    let provider = parse_key_provider(&provider).map_err(ErrorPayload::from)?;
    let dir = config_dir(&app).map_err(ErrorPayload::from)?;
    let config = settings::load(&dir);
    let http = state.http().await.map_err(ErrorPayload::from)?;
    probe::test_provider(http, &config, provider)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn transcribe_audio(
    app: tauri::AppHandle,
    wav: Vec<u8>,
    state: State<'_, AiState>,
) -> Result<String, ErrorPayload> {
    if wav.is_empty() {
        return Err(ErrorPayload::from(AiError::MicUnavailable));
    }
    let dir = config_dir(&app).map_err(ErrorPayload::from)?;
    let config = resolve_asr(&settings::load(&dir)).map_err(ErrorPayload::from)?;
    let http = state.http().await.map_err(ErrorPayload::from)?;
    asr::transcribe(http, &config, wav)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn synthesize_speech(
    app: tauri::AppHandle,
    text: String,
    state: State<'_, AiState>,
) -> Result<Vec<u8>, ErrorPayload> {
    let dir = config_dir(&app).map_err(ErrorPayload::from)?;
    let config = resolve_tts(&settings::load(&dir)).map_err(ErrorPayload::from)?;
    let http = state.http().await.map_err(ErrorPayload::from)?;
    tts::synthesize(http, &config, &text)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn summarize_assessment(
    app: tauri::AppHandle,
    results: Value,
    state: State<'_, AiState>,
) -> Result<String, ErrorPayload> {
    let dir = config_dir(&app).map_err(ErrorPayload::from)?;
    let config = resolve_chat(&settings::load(&dir)).map_err(ErrorPayload::from)?;
    let http = state.http().await.map_err(ErrorPayload::from)?;
    chat::complete(
        http,
        &config,
        chat::SUMMARY_SYSTEM_PROMPT,
        &results.to_string(),
    )
    .await
    .map_err(ErrorPayload::from)
}
