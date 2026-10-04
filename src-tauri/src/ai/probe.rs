use super::{decision, error::AiError, providers, settings::AiSettings, store::KeyProvider, tts};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

const PROBE_STATE: &str = "The sky is blue.";
const PROBE_INSTRUCTIONS: &str = "The statement describes a colour.";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub detail: String,
    pub models: Vec<String>,
}

fn parse_model_ids(raw: &str) -> Vec<String> {
    let value: Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    match value["data"].as_array() {
        Some(entries) => entries
            .iter()
            .filter_map(|entry| entry["id"].as_str().map(str::to_string))
            .collect(),
        None => Vec::new(),
    }
}

async fn probe_models(
    http: &reqwest::Client,
    base_url: &str,
    api_key: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut request = http
        .get(format!("{base_url}/v1/models"))
        .timeout(std::time::Duration::from_secs(10));
    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    if status != 200 {
        return Err(format!("HTTP {status} from /v1/models"));
    }
    let raw = response.text().await.map_err(|err| err.to_string())?;
    Ok(parse_model_ids(&raw))
}

pub(super) async fn test_provider(
    http: &reqwest::Client,
    config: &AiSettings,
    provider: KeyProvider,
) -> Result<TestResult, AiError> {
    let outcome = match provider {
        KeyProvider::Openai => match providers::resolve_key(provider)? {
            None => TestResult {
                ok: false,
                detail: "no OpenAI key configured".to_string(),
                models: Vec::new(),
            },
            Some(key) => match probe_models(http, providers::OPENAI_BASE_URL, Some(&key)).await {
                Ok(models) => TestResult {
                    ok: true,
                    detail: "OpenAI key is valid".to_string(),
                    models,
                },
                Err(detail) => TestResult {
                    ok: false,
                    detail,
                    models: Vec::new(),
                },
            },
        },
        KeyProvider::Elevenlabs => match providers::elevenlabs_tts_config(config) {
            Ok(tts_config) => match tts::probe_voice(http, &tts_config).await {
                Ok(()) => TestResult {
                    ok: true,
                    detail: "ElevenLabs voice is reachable".to_string(),
                    models: Vec::new(),
                },
                Err(err) => TestResult {
                    ok: false,
                    detail: err.to_string(),
                    models: Vec::new(),
                },
            },
            Err(err) => TestResult {
                ok: false,
                detail: err.to_string(),
                models: Vec::new(),
            },
        },
        KeyProvider::Cloudflare | KeyProvider::Typesafe => {
            match providers::decision_config_for_key(config, provider) {
                Ok(decision_config) => {
                    let questions =
                        BTreeMap::from([("probe".to_string(), decision::noul(PROBE_INSTRUCTIONS))]);
                    match decision::decide(http, &decision_config, json!(PROBE_STATE), questions)
                        .await
                    {
                        Ok(response) => {
                            let probability = response
                                .answers
                                .get("probe")
                                .and_then(decision::Answer::as_noul);
                            TestResult {
                                ok: true,
                                detail: match probability {
                                    Some(p) => {
                                        format!("Decision model answered the probe (p={p:.2})")
                                    }
                                    None => "Decision model answered the probe".to_string(),
                                },
                                models: response.model.into_iter().collect(),
                            }
                        }
                        Err(err) => TestResult {
                            ok: false,
                            detail: err.to_string(),
                            models: Vec::new(),
                        },
                    }
                }
                Err(err) => TestResult {
                    ok: false,
                    detail: err.to_string(),
                    models: Vec::new(),
                },
            }
        }
    };
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_id_parsing_is_tolerant() {
        assert_eq!(
            parse_model_ids(r#"{"data":[{"id":"a"},{"id":"b"}]}"#),
            vec!["a".to_string(), "b".to_string()]
        );
        assert!(parse_model_ids("{}").is_empty());
        assert!(parse_model_ids("garbage").is_empty());
    }
}
