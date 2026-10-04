use super::settings::{AiSettings, AsrProvider, ChatProvider, VoiceProvider};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: String,
    pub configured: bool,
    pub source: &'static str,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub configured: bool,
    pub source: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatuses {
    pub openai: KeyStatus,
    pub elevenlabs: KeyStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub asr: ProviderStatus,
    pub chat: ProviderStatus,
    pub voice: ProviderStatus,
    pub keys: KeyStatuses,
}

pub(super) fn build_status(
    config: &AiSettings,
    openai: &'static str,
    elevenlabs: &'static str,
) -> AiStatus {
    let (asr_provider, asr_source, asr_model) = match config.asr_provider {
        AsrProvider::Elevenlabs => (
            "elevenlabs",
            elevenlabs,
            Some(config.elevenlabs_asr_model.clone()),
        ),
        AsrProvider::Openai => ("openai", openai, Some(config.openai_asr_model.clone())),
        AsrProvider::Off => ("off", "none", None),
    };
    let (chat_provider, chat_source, chat_model) = match config.chat_provider {
        ChatProvider::Openai => ("openai", openai, Some(config.openai_chat_model.clone())),
        ChatProvider::Off => ("off", "none", None),
    };
    let voice = match config.voice_provider {
        VoiceProvider::System => ProviderStatus {
            provider: "system".to_string(),
            configured: true,
            source: "local",
            model: None,
        },
        VoiceProvider::Elevenlabs => ProviderStatus {
            provider: "elevenlabs".to_string(),
            configured: elevenlabs != "none"
                && !config.elevenlabs_voice_id.trim().is_empty()
                && !config.elevenlabs_tts_model.trim().is_empty(),
            source: elevenlabs,
            model: Some(config.elevenlabs_tts_model.clone()),
        },
    };
    AiStatus {
        asr: ProviderStatus {
            provider: asr_provider.to_string(),
            configured: asr_source != "none",
            source: asr_source,
            model: asr_model,
        },
        chat: ProviderStatus {
            provider: chat_provider.to_string(),
            configured: chat_source != "none",
            source: chat_source,
            model: chat_model,
        },
        voice,
        keys: KeyStatuses {
            openai: KeyStatus {
                configured: openai != "none",
                source: openai,
            },
            elevenlabs: KeyStatus {
                configured: elevenlabs != "none",
                source: elevenlabs,
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ai_status_serializes_camel_case_contract() {
        let config = AiSettings::default();
        let value = serde_json::to_value(build_status(&config, "env", "keychain")).unwrap();
        assert_eq!(
            value,
            json!({
                "asr": {"provider": "elevenlabs", "configured": true, "source": "keychain", "model": "scribe_v2"},
                "chat": {"provider": "openai", "configured": true, "source": "env", "model": "gpt-6.1-sol"},
                "voice": {"provider": "elevenlabs", "configured": true, "source": "keychain", "model": "eleven_v4"},
                "keys": {"openai": {"configured": true, "source": "env"}, "elevenlabs": {"configured": true, "source": "keychain"}}
            })
        );
    }

    #[test]
    fn disabled_capabilities_and_system_voice_ignore_keys() {
        let config = AiSettings {
            asr_provider: AsrProvider::Off,
            chat_provider: ChatProvider::Off,
            voice_provider: VoiceProvider::System,
            ..AiSettings::default()
        };
        let value = serde_json::to_value(build_status(&config, "env", "keychain")).unwrap();
        assert_eq!(
            value["asr"],
            json!({"provider": "off", "configured": false, "source": "none", "model": null})
        );
        assert_eq!(value["chat"], value["asr"]);
        assert_eq!(
            value["voice"],
            json!({"provider": "system", "configured": true, "source": "local", "model": null})
        );
    }

    #[test]
    fn missing_keys_leave_cloud_capabilities_unconfigured() {
        let config = AiSettings::default();
        let status = build_status(&config, "none", "none");
        assert!(!status.asr.configured && !status.chat.configured && !status.voice.configured);
        assert!(!status.keys.openai.configured && !status.keys.elevenlabs.configured);
    }

    #[test]
    fn openai_asr_uses_its_key_and_selected_model() {
        let config = AiSettings {
            asr_provider: AsrProvider::Openai,
            openai_asr_model: "custom-asr".to_string(),
            ..AiSettings::default()
        };
        let status = build_status(&config, "env", "none");
        assert_eq!(status.asr.provider, "openai");
        assert!(status.asr.configured);
        assert_eq!(status.asr.source, "env");
        assert_eq!(status.asr.model.as_deref(), Some("custom-asr"));
    }
}
