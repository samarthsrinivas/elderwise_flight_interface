use super::asr::{AsrConfig, AsrWire};
use super::chat::{ChatConfig, ChatWire};
use super::error::AiError;
use super::settings::{AiSettings, AsrProvider, ChatProvider, VoiceProvider};
use super::store::{self, KeyProvider};
use super::tts::TtsConfig;

pub(super) const OPENAI_BASE_URL: &str = "https://api.openai.com";
const ELEVENLABS_BASE_URL: &str = "https://api.elevenlabs.io";

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn elevenlabs_base_url() -> String {
    env_nonempty("ELEVENLABS_BASE_URL")
        .unwrap_or_else(|| ELEVENLABS_BASE_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

const fn key_env(provider: KeyProvider) -> &'static str {
    match provider {
        KeyProvider::Openai => "OPENAI_API_KEY",
        KeyProvider::Elevenlabs => "ELEVENLABS_API_KEY",
    }
}

pub(super) fn resolve_key(provider: KeyProvider) -> Result<Option<String>, AiError> {
    if let Some(key) = store::load_key(provider)? {
        return Ok(Some(key));
    }
    Ok(env_nonempty(key_env(provider)))
}

pub(super) fn key_source(provider: KeyProvider) -> Result<&'static str, AiError> {
    if store::load_key(provider)?.is_some() {
        return Ok("keychain");
    }
    if env_nonempty(key_env(provider)).is_some() {
        return Ok("env");
    }
    Ok("none")
}

pub(super) fn parse_key_provider(provider: &str) -> Result<KeyProvider, AiError> {
    match provider {
        "openai" => Ok(KeyProvider::Openai),
        "elevenlabs" => Ok(KeyProvider::Elevenlabs),
        other => Err(AiError::Protocol(format!("unknown key provider: {other}"))),
    }
}

pub(super) fn resolve_asr(config: &AiSettings) -> Result<AsrConfig, AiError> {
    match config.asr_provider {
        AsrProvider::Off => Err(AiError::Disabled),
        AsrProvider::Elevenlabs => Ok(AsrConfig {
            wire: AsrWire::Elevenlabs,
            base_url: elevenlabs_base_url(),
            api_key: resolve_key(KeyProvider::Elevenlabs)?.ok_or(AiError::MissingCredentials)?,
            model: config.elevenlabs_asr_model.clone(),
        }),
        AsrProvider::Openai => Ok(AsrConfig {
            wire: AsrWire::Openai,
            base_url: OPENAI_BASE_URL.to_string(),
            api_key: resolve_key(KeyProvider::Openai)?.ok_or(AiError::MissingCredentials)?,
            model: config.openai_asr_model.clone(),
        }),
    }
}

pub(super) fn resolve_chat(config: &AiSettings) -> Result<ChatConfig, AiError> {
    match config.chat_provider {
        ChatProvider::Off => Err(AiError::Disabled),
        ChatProvider::Openai => Ok(ChatConfig {
            wire: ChatWire::OpenAiResponses,
            base_url: OPENAI_BASE_URL.to_string(),
            api_key: Some(resolve_key(KeyProvider::Openai)?.ok_or(AiError::MissingCredentials)?),
            model: config.openai_chat_model.clone(),
        }),
    }
}

pub(super) fn elevenlabs_tts_config(config: &AiSettings) -> Result<TtsConfig, AiError> {
    let voice_id = config.elevenlabs_voice_id.trim();
    let model = config.elevenlabs_tts_model.trim();
    if voice_id.is_empty() {
        return Err(AiError::NotConfigured(
            "choose an ElevenLabs voice ID in AI Settings".to_string(),
        ));
    }
    if model.is_empty() {
        return Err(AiError::NotConfigured(
            "choose an ElevenLabs model in AI Settings".to_string(),
        ));
    }
    let api_key = resolve_key(KeyProvider::Elevenlabs)?.ok_or(AiError::MissingCredentials)?;
    Ok(TtsConfig {
        base_url: elevenlabs_base_url(),
        api_key,
        voice_id: voice_id.to_string(),
        model: model.to_string(),
    })
}

pub(super) fn resolve_tts(config: &AiSettings) -> Result<TtsConfig, AiError> {
    match config.voice_provider {
        VoiceProvider::System => Err(AiError::Disabled),
        VoiceProvider::Elevenlabs => elevenlabs_tts_config(config),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asr_off_is_disabled() {
        let config = AiSettings {
            asr_provider: AsrProvider::Off,
            ..AiSettings::default()
        };
        assert!(matches!(resolve_asr(&config), Err(AiError::Disabled)));
    }

    #[test]
    fn chat_off_is_disabled() {
        let config = AiSettings {
            chat_provider: ChatProvider::Off,
            ..AiSettings::default()
        };
        assert!(matches!(resolve_chat(&config), Err(AiError::Disabled)));
    }

    #[test]
    fn system_voice_is_disabled() {
        let config = AiSettings {
            voice_provider: VoiceProvider::System,
            ..AiSettings::default()
        };
        assert!(matches!(resolve_tts(&config), Err(AiError::Disabled)));
    }

    #[test]
    fn unknown_key_provider_is_rejected() {
        assert!(matches!(
            parse_key_provider("unknown"),
            Err(AiError::Protocol(_))
        ));
    }
}
