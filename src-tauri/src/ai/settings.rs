use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AsrProvider {
    Elevenlabs,
    Openai,
    Off,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatProvider {
    Openai,
    Off,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceProvider {
    Elevenlabs,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    pub asr_provider: AsrProvider,
    pub chat_provider: ChatProvider,
    pub voice_provider: VoiceProvider,
    pub elevenlabs_voice_id: String,
    pub elevenlabs_tts_model: String,
    pub elevenlabs_asr_model: String,
    pub openai_asr_model: String,
    pub openai_chat_model: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            asr_provider: AsrProvider::Elevenlabs,
            chat_provider: ChatProvider::Openai,
            voice_provider: VoiceProvider::Elevenlabs,
            elevenlabs_voice_id: "JBFqnCBsd6RMkjVDRZzb".to_string(),
            elevenlabs_tts_model: "eleven_multilingual_v2".to_string(),
            elevenlabs_asr_model: "scribe_v1".to_string(),
            openai_asr_model: "gpt-4o-mini-transcribe".to_string(),
            openai_chat_model: "gpt-5.5".to_string(),
        }
    }
}

const FILE_NAME: &str = "ai-settings.json";

/// Load settings; a missing or unparseable file yields defaults.
pub fn load(dir: &Path) -> AiSettings {
    match fs::read_to_string(dir.join(FILE_NAME)) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => AiSettings::default(),
    }
}

pub fn save(dir: &Path, settings: &AiSettings) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    let raw = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    fs::write(dir.join(FILE_NAME), raw).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("elderwise-settings-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn missing_file_yields_defaults() {
        let dir = temp_dir();
        let settings = load(&dir);
        assert_eq!(settings, AiSettings::default());
    }

    #[test]
    fn roundtrip_preserves_values() {
        let dir = temp_dir();
        let settings = AiSettings {
            asr_provider: AsrProvider::Openai,
            chat_provider: ChatProvider::Off,
            voice_provider: VoiceProvider::System,
            elevenlabs_voice_id: "custom-voice".to_string(),
            elevenlabs_tts_model: "custom-tts".to_string(),
            elevenlabs_asr_model: "custom-asr".to_string(),
            openai_asr_model: "custom-transcribe".to_string(),
            openai_chat_model: "gpt-4o-mini".to_string(),
        };
        save(&dir, &settings).unwrap();
        let loaded = load(&dir);
        assert_eq!(loaded, settings);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn wire_format_is_camel_case_with_lowercase_providers() {
        let settings = AiSettings::default();
        let value = serde_json::to_value(settings).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "asrProvider": "elevenlabs",
                "chatProvider": "openai",
                "voiceProvider": "elevenlabs",
                "elevenlabsVoiceId": "JBFqnCBsd6RMkjVDRZzb",
                "elevenlabsTtsModel": "eleven_multilingual_v2",
                "elevenlabsAsrModel": "scribe_v1",
                "openaiAsrModel": "gpt-4o-mini-transcribe",
                "openaiChatModel": "gpt-5.5"
            })
        );
    }

    #[test]
    fn unknown_fields_and_partial_files_tolerated() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(FILE_NAME),
            r#"{"chatProvider":"off","futureField":123}"#,
        )
        .unwrap();
        let settings = load(&dir);
        assert_eq!(
            settings,
            AiSettings {
                chat_provider: ChatProvider::Off,
                ..AiSettings::default()
            }
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_file_yields_defaults() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE_NAME), "not json").unwrap();
        let settings = load(&dir);
        assert_eq!(settings, AiSettings::default());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unknown_provider_yields_defaults() {
        for field in ["asrProvider", "chatProvider", "voiceProvider"] {
            let dir = temp_dir();
            fs::create_dir_all(&dir).unwrap();
            let raw = serde_json::json!({field: "unknown", "openaiChatModel": "custom"});
            fs::write(dir.join(FILE_NAME), raw.to_string()).unwrap();
            let settings = load(&dir);
            assert_eq!(settings, AiSettings::default());
            fs::remove_dir_all(dir).unwrap();
        }
    }
}
