use super::asr::{AsrConfig, AsrWire};
use super::chat::{ChatConfig, ChatWire};
use super::decision::DecisionConfig;
use super::error::AiError;
use super::settings::{AiSettings, AsrProvider, ChatProvider, DecisionProvider, VoiceProvider};
use super::store::{self, KeyProvider};
use super::tts::TtsConfig;

pub(super) const OPENAI_BASE_URL: &str = "https://api.openai.com";
const ELEVENLABS_BASE_URL: &str = "https://api.elevenlabs.io";
const CLOUDFLARE_API_BASE_URL: &str = "https://api.cloudflare.com";
const TYPESAFE_BASE_URL: &str = "https://api.typesafe.ai";

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn base_url_with_override(env_name: &str, default: &str) -> String {
    env_nonempty(env_name)
        .unwrap_or_else(|| default.to_string())
        .trim_end_matches('/')
        .to_string()
}

fn elevenlabs_base_url() -> String {
    base_url_with_override("ELEVENLABS_BASE_URL", ELEVENLABS_BASE_URL)
}

fn cloudflare_api_base_url() -> String {
    base_url_with_override("CLOUDFLARE_API_BASE_URL", CLOUDFLARE_API_BASE_URL)
}

fn typesafe_base_url() -> String {
    base_url_with_override("TYPESAFE_BASE_URL", TYPESAFE_BASE_URL)
}

const fn key_env(provider: KeyProvider) -> &'static str {
    match provider {
        KeyProvider::Openai => "OPENAI_API_KEY",
        KeyProvider::Elevenlabs => "ELEVENLABS_API_KEY",
        KeyProvider::Cloudflare => "CLOUDFLARE_API_TOKEN",
        KeyProvider::Typesafe => "TYPESAFE_API_KEY",
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
        "cloudflare" => Ok(KeyProvider::Cloudflare),
        "typesafe" => Ok(KeyProvider::Typesafe),
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

struct DecisionEndpoint {
    url: String,
    key_provider: KeyProvider,
    model: Option<String>,
}

fn decision_endpoint(
    provider: DecisionProvider,
    config: &AiSettings,
) -> Result<DecisionEndpoint, AiError> {
    match provider {
        DecisionProvider::Off => Err(AiError::Disabled),
        DecisionProvider::ClefFlash | DecisionProvider::Clef => {
            let account_id = config.cloudflare_account_id.trim();
            if account_id.is_empty() {
                return Err(AiError::NotConfigured(
                    "enter your Cloudflare account ID in AI Settings".to_string(),
                ));
            }
            let model = match provider {
                DecisionProvider::Clef => "clef",
                _ => "clef-flash",
            };
            Ok(DecisionEndpoint {
                url: format!(
                    "{}/client/v4/accounts/{account_id}/ai/run/@cf/cloudflare/{model}",
                    cloudflare_api_base_url()
                ),
                key_provider: KeyProvider::Cloudflare,
                model: None,
            })
        }
        DecisionProvider::Jev => {
            let model = config.jev_model.trim();
            if model.is_empty() {
                return Err(AiError::NotConfigured(
                    "choose a Jev model in AI Settings".to_string(),
                ));
            }
            Ok(DecisionEndpoint {
                url: format!("{}/v1/systemone", typesafe_base_url()),
                key_provider: KeyProvider::Typesafe,
                model: Some(model.to_string()),
            })
        }
    }
}

fn decision_config(
    provider: DecisionProvider,
    config: &AiSettings,
) -> Result<DecisionConfig, AiError> {
    let endpoint = decision_endpoint(provider, config)?;
    let api_key = resolve_key(endpoint.key_provider)?.ok_or(AiError::MissingCredentials)?;
    Ok(DecisionConfig {
        url: endpoint.url,
        api_key,
        model: endpoint.model,
    })
}

pub(super) fn decision_config_for_key(
    config: &AiSettings,
    key_provider: KeyProvider,
) -> Result<DecisionConfig, AiError> {
    let provider = match key_provider {
        KeyProvider::Cloudflare => match config.decision_provider {
            DecisionProvider::Clef => DecisionProvider::Clef,
            _ => DecisionProvider::ClefFlash,
        },
        KeyProvider::Typesafe => DecisionProvider::Jev,
        KeyProvider::Openai | KeyProvider::Elevenlabs => {
            return Err(AiError::Protocol(
                "key provider does not back a decision model".to_string(),
            ))
        }
    };
    decision_config(provider, config)
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
    fn decision_off_is_disabled() {
        assert!(matches!(
            decision_config(DecisionProvider::Off, &AiSettings::default()),
            Err(AiError::Disabled)
        ));
    }

    #[test]
    fn clef_without_account_id_is_not_configured() {
        let config = AiSettings {
            decision_provider: DecisionProvider::ClefFlash,
            cloudflare_account_id: "   ".to_string(),
            ..AiSettings::default()
        };
        assert!(matches!(
            decision_endpoint(DecisionProvider::ClefFlash, &config),
            Err(AiError::NotConfigured(_))
        ));
    }

    #[test]
    fn clef_endpoints_target_workers_ai_run_url() {
        let config = AiSettings {
            cloudflare_account_id: " acct-123 ".to_string(),
            ..AiSettings::default()
        };
        let flash = decision_endpoint(DecisionProvider::ClefFlash, &config).unwrap();
        assert_eq!(
            flash.url,
            "https://api.cloudflare.com/client/v4/accounts/acct-123/ai/run/@cf/cloudflare/clef-flash"
        );
        assert_eq!(flash.key_provider, KeyProvider::Cloudflare);
        assert_eq!(flash.model, None);

        let clef = decision_endpoint(DecisionProvider::Clef, &config).unwrap();
        assert!(clef.url.ends_with("/ai/run/@cf/cloudflare/clef"));
    }

    #[test]
    fn jev_endpoint_carries_model_id() {
        let config = AiSettings {
            jev_model: "jev-custom".to_string(),
            ..AiSettings::default()
        };
        let jev = decision_endpoint(DecisionProvider::Jev, &config).unwrap();
        assert_eq!(jev.url, "https://api.typesafe.ai/v1/systemone");
        assert_eq!(jev.key_provider, KeyProvider::Typesafe);
        assert_eq!(jev.model.as_deref(), Some("jev-custom"));

        let blank = AiSettings {
            jev_model: String::new(),
            ..AiSettings::default()
        };
        assert!(matches!(
            decision_endpoint(DecisionProvider::Jev, &blank),
            Err(AiError::NotConfigured(_))
        ));
    }

    #[test]
    fn non_decision_keys_cannot_probe_decision_models() {
        assert!(matches!(
            decision_config_for_key(&AiSettings::default(), KeyProvider::Openai),
            Err(AiError::Protocol(_))
        ));
    }

    #[test]
    fn unknown_key_provider_is_rejected() {
        assert!(matches!(
            parse_key_provider("unknown"),
            Err(AiError::Protocol(_))
        ));
        assert_eq!(
            parse_key_provider("cloudflare").unwrap(),
            KeyProvider::Cloudflare
        );
        assert_eq!(
            parse_key_provider("typesafe").unwrap(),
            KeyProvider::Typesafe
        );
    }
}
