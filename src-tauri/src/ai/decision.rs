use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::error::AiError;

/// SystemOne question as accepted by Clef, Clef-flash and Jev (same wire format).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Question {
    Noul {
        instructions: String,
    },
    Choice {
        instructions: String,
        criteria: BTreeMap<String, String>,
    },
    Score {
        instructions: String,
        criteria: Vec<String>,
    },
}

pub fn noul(instructions: &str) -> Question {
    Question::Noul {
        instructions: instructions.to_string(),
    }
}

#[cfg(test)]
pub fn choice(instructions: &str, criteria: &[(&str, &str)]) -> Question {
    Question::Choice {
        instructions: instructions.to_string(),
        criteria: criteria
            .iter()
            .map(|(id, description)| (id.to_string(), description.to_string()))
            .collect(),
    }
}

#[cfg(test)]
pub fn score(instructions: &str, criteria: &[&str]) -> Question {
    Question::Score {
        instructions: instructions.to_string(),
        criteria: criteria.iter().map(|level| level.to_string()).collect(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DecisionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub state: Value,
    pub questions: BTreeMap<String, Question>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum Answer {
    Noul(f64),
    Choice {
        choice: String,
        confidence: f64,
        probabilities: BTreeMap<String, f64>,
    },
    Score {
        score: f64,
        confidence: f64,
        legend: String,
        probabilities: BTreeMap<String, f64>,
    },
}

impl Answer {
    pub fn as_noul(&self) -> Option<f64> {
        match self {
            Self::Noul(value) => Some(*value),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct DecisionResponse {
    #[serde(default)]
    pub model: Option<String>,
    pub answers: BTreeMap<String, Answer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionConfig {
    pub url: String,
    pub api_key: String,
    pub model: Option<String>,
}

fn map_status(status: reqwest::StatusCode) -> AiError {
    match status.as_u16() {
        401 | 403 => AiError::Unauthorized,
        429 => AiError::RateLimited,
        code => AiError::Protocol(format!("HTTP {code} from decision model")),
    }
}

pub async fn decide(
    http: &reqwest::Client,
    config: &DecisionConfig,
    state: Value,
    questions: BTreeMap<String, Question>,
) -> Result<DecisionResponse, AiError> {
    let body = DecisionRequest {
        model: config.model.clone(),
        state,
        questions,
    };
    let response = http
        .post(&config.url)
        .bearer_auth(&config.api_key)
        .json(&body)
        .send()
        .await
        .map_err(AiError::from)?;
    if !response.status().is_success() {
        return Err(map_status(response.status()));
    }
    let raw = response.text().await.map_err(AiError::from)?;
    parse_response(&raw)
}

pub fn parse_response(raw: &str) -> Result<DecisionResponse, AiError> {
    let value: Value =
        serde_json::from_str(raw).map_err(|err| AiError::Protocol(err.to_string()))?;
    // Cloudflare's REST envelope wraps the model output in `result`; TypeSafe returns it bare.
    let payload = value.get("result").cloned().unwrap_or(value);
    serde_json::from_value(payload).map_err(|err| AiError::Protocol(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn question_wire_format_matches_systemone() {
        assert_eq!(
            serde_json::to_value(noul("The sky is blue.")).unwrap(),
            json!({"type": "noul", "instructions": "The sky is blue."})
        );
        assert_eq!(
            serde_json::to_value(choice("Pick one.", &[("a", "First"), ("b", "Second")])).unwrap(),
            json!({
                "type": "choice",
                "instructions": "Pick one.",
                "criteria": {"a": "First", "b": "Second"}
            })
        );
        assert_eq!(
            serde_json::to_value(score("Rate it.", &["Low", "Mid", "High"])).unwrap(),
            json!({
                "type": "score",
                "instructions": "Rate it.",
                "criteria": ["Low", "Mid", "High"]
            })
        );
    }

    #[test]
    fn request_omits_model_when_unset() {
        let request = DecisionRequest {
            model: None,
            state: json!({"k": 1}),
            questions: BTreeMap::from([("q".to_string(), noul("x"))]),
        };
        assert_eq!(
            serde_json::to_value(request).unwrap(),
            json!({"state": {"k": 1}, "questions": {"q": {"type": "noul", "instructions": "x"}}})
        );
    }

    #[test]
    fn all_answer_types_deserialize() {
        let parsed = parse_response(
            r#"{
                "model": "jev-1.13.0",
                "answers": {
                    "n": 0.82,
                    "c": {"choice": "a", "confidence": 0.7, "probabilities": {"a": 0.7, "b": 0.3}},
                    "s": {"score": 2, "confidence": 0.6, "legend": "High", "probabilities": {"0": 0.1, "1": 0.3, "2": 0.6}}
                },
                "usage": {"input_tokens": 12}
            }"#,
        )
        .unwrap();
        assert_eq!(parsed.model.as_deref(), Some("jev-1.13.0"));
        assert_eq!(parsed.answers["n"].as_noul(), Some(0.82));
        assert_eq!(
            parsed.answers["c"],
            Answer::Choice {
                choice: "a".to_string(),
                confidence: 0.7,
                probabilities: BTreeMap::from([("a".to_string(), 0.7), ("b".to_string(), 0.3)]),
            }
        );
        assert_eq!(
            parsed.answers["s"],
            Answer::Score {
                score: 2.0,
                confidence: 0.6,
                legend: "High".to_string(),
                probabilities: BTreeMap::from([
                    ("0".to_string(), 0.1),
                    ("1".to_string(), 0.3),
                    ("2".to_string(), 0.6)
                ]),
            }
        );
    }

    #[test]
    fn cloudflare_result_envelope_is_unwrapped() {
        let parsed = parse_response(
            r#"{"success": true, "errors": [], "result": {"answers": {"n": 0.25}}}"#,
        )
        .unwrap();
        assert_eq!(parsed.model, None);
        assert_eq!(parsed.answers["n"].as_noul(), Some(0.25));
    }

    #[test]
    fn malformed_response_is_protocol_error() {
        let error = parse_response(r#"{"answers": {"n": "not a number"}}"#).unwrap_err();
        assert_eq!(
            super::super::error::ErrorPayload::from(error).code,
            "protocol"
        );
    }
}
