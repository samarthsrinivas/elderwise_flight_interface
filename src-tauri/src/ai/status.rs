use super::settings::{AiSettings, AsrProvider, ChatProvider, DecisionProvider, VoiceProvider};
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
    pub cloudflare: KeyStatus,
    pub typesafe: KeyStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub asr: ProviderStatus,
    pub chat: ProviderStatus,
    pub voice: ProviderStatus,
    pub decision: ProviderStatus,
    pub keys: KeyStatuses,
}

/// Where each provider key was found: "keychain", "env" or "none".
#[derive(Debug, Clone, Copy)]
pub(super) struct KeySources {
    pub openai: &'static str,
    pub elevenlabs: &'static str,
    pub cloudflare: &'static str,
    pub typesafe: &'static str,
}

fn key_status(source: &'static str) -> KeyStatus {
    KeyStatus {
        configured: source != "none",
        source,
    }
}

pub(super) fn build_status(config: &AiSettings, keys: KeySources) -> AiStatus {
    let (asr_provider, asr_source, asr_model) = match config.asr_provider {
        AsrProvider::Elevenlabs => (
            "elevenlabs",
            keys.elevenlabs,
            Some(config.elevenlabs_asr_model.clone()),
        ),
        AsrProvider::Openai => ("openai", keys.openai, Some(config.openai_asr_model.clone())),
        AsrProvider::Off => ("off", "none", None),
    };
    let (chat_provider, chat_source, chat_model) = match config.chat_provider {
        ChatProvider::Openai => (
            "openai",
            keys.openai,
            Some(config.openai_chat_model.clone()),
        ),
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
            configured: keys.elevenlabs != "none"
                && !config.elevenlabs_voice_id.trim().is_empty()
                && !config.elevenlabs_tts_model.trim().is_empty(),
            source: keys.elevenlabs,
            model: Some(config.elevenlabs_tts_model.clone()),
        },
    };
    let decision = match config.decision_provider {
        DecisionProvider::ClefFlash | DecisionProvider::Clef => {
            let (provider, model) = if config.decision_provider == DecisionProvider::Clef {
                ("clef", "@cf/cloudflare/clef")
            } else {
                ("clef-flash", "@cf/cloudflare/clef-flash")
            };
            ProviderStatus {
                provider: provider.to_string(),
                configured: keys.cloudflare != "none"
                    && !config.cloudflare_account_id.trim().is_empty(),
                source: keys.cloudflare,
                model: Some(model.to_string()),
            }
        }
        DecisionProvider::Jev => ProviderStatus {
            provider: "jev".to_string(),
            configured: keys.typesafe != "none" && !config.jev_model.trim().is_empty(),
            source: keys.typesafe,
            model: Some(config.jev_model.clone()),
        },
        DecisionProvider::Off => ProviderStatus {
            provider: "off".to_string(),
            configured: false,
            source: "none",
            model: None,
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
        decision,
        keys: KeyStatuses {
            openai: key_status(keys.openai),
            elevenlabs: key_status(keys.elevenlabs),
            cloudflare: key_status(keys.cloudflare),
            typesafe: key_status(keys.typesafe),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const NO_KEYS: KeySources = KeySources {
        openai: "none",
        elevenlabs: "none",
        cloudflare: "none",
        typesafe: "none",
    };

    const OPENAI_ENV_ELEVENLABS_KEYCHAIN: KeySources = KeySources {
        openai: "env",
        elevenlabs: "keychain",
        ..NO_KEYS
    };

    #[test]
    fn ai_status_serializes_camel_case_contract() {
        let config = AiSettings::default();
        let value =
            serde_json::to_value(build_status(&config, OPENAI_ENV_ELEVENLABS_KEYCHAIN)).unwrap();
        assert_eq!(
            value,
            json!({
                "asr": {"provider": "elevenlabs", "configured": true, "source": "keychain", "model": "scribe_v2"},
                "chat": {"provider": "openai", "configured": true, "source": "env", "model": "gpt-6.1-sol"},
                "voice": {"provider": "elevenlabs", "configured": true, "source": "keychain", "model": "eleven_v4"},
                "decision": {"provider": "off", "configured": false, "source": "none", "model": null},
                "keys": {
                    "openai": {"configured": true, "source": "env"},
                    "elevenlabs": {"configured": true, "source": "keychain"},
                    "cloudflare": {"configured": false, "source": "none"},
                    "typesafe": {"configured": false, "source": "none"}
                }
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
        let value =
            serde_json::to_value(build_status(&config, OPENAI_ENV_ELEVENLABS_KEYCHAIN)).unwrap();
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
        let status = build_status(&config, NO_KEYS);
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
        let status = build_status(
            &config,
            KeySources {
                openai: "env",
                ..NO_KEYS
            },
        );
        assert_eq!(status.asr.provider, "openai");
        assert!(status.asr.configured);
        assert_eq!(status.asr.source, "env");
        assert_eq!(status.asr.model.as_deref(), Some("custom-asr"));
    }

    #[test]
    fn clef_flash_needs_cloudflare_token_and_account_id() {
        let config = AiSettings {
            decision_provider: DecisionProvider::ClefFlash,
            cloudflare_account_id: "acct-123".to_string(),
            ..AiSettings::default()
        };
        let with_key = KeySources {
            cloudflare: "keychain",
            ..NO_KEYS
        };
        let value = serde_json::to_value(build_status(&config, with_key)).unwrap();
        assert_eq!(
            value["decision"],
            json!({"provider": "clef-flash", "configured": true, "source": "keychain", "model": "@cf/cloudflare/clef-flash"})
        );
        assert_eq!(
            value["keys"]["cloudflare"],
            json!({"configured": true, "source": "keychain"})
        );

        let no_account = AiSettings {
            cloudflare_account_id: "  ".to_string(),
            ..config.clone()
        };
        assert!(!build_status(&no_account, with_key).decision.configured);
        assert!(!build_status(&config, NO_KEYS).decision.configured);
    }

    #[test]
    fn clef_and_jev_report_their_models() {
        let clef = AiSettings {
            decision_provider: DecisionProvider::Clef,
            cloudflare_account_id: "acct-123".to_string(),
            ..AiSettings::default()
        };
        let status = build_status(
            &clef,
            KeySources {
                cloudflare: "env",
                ..NO_KEYS
            },
        );
        assert_eq!(status.decision.provider, "clef");
        assert_eq!(
            status.decision.model.as_deref(),
            Some("@cf/cloudflare/clef")
        );
        assert!(status.decision.configured);

        let jev = AiSettings {
            decision_provider: DecisionProvider::Jev,
            ..AiSettings::default()
        };
        let status = build_status(
            &jev,
            KeySources {
                typesafe: "env",
                ..NO_KEYS
            },
        );
        assert_eq!(status.decision.provider, "jev");
        assert_eq!(status.decision.source, "env");
        assert_eq!(status.decision.model.as_deref(), Some("jev-1.13.0"));
        assert!(status.decision.configured);
        assert!(!build_status(&jev, NO_KEYS).decision.configured);
    }
}
