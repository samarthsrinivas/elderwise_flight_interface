use super::error::AiError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AsrWire {
    Elevenlabs,
    Openai,
}

#[derive(Debug, Clone)]
pub struct AsrConfig {
    pub wire: AsrWire,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

pub fn endpoint(config: &AsrConfig) -> String {
    let base = config.base_url.trim_end_matches('/');
    match config.wire {
        AsrWire::Elevenlabs => format!("{base}/v1/speech-to-text"),
        AsrWire::Openai => format!("{base}/v1/audio/transcriptions"),
    }
}

pub fn parse_text_response(raw: &str) -> Result<String, AiError> {
    #[derive(serde::Deserialize)]
    struct TextBody {
        text: String,
    }
    serde_json::from_str::<TextBody>(raw)
        .map(|body| body.text)
        .map_err(|err| AiError::Protocol(format!("invalid JSON body: {err}")))
}

pub async fn transcribe(
    http: &reqwest::Client,
    config: &AsrConfig,
    wav: Vec<u8>,
) -> Result<String, AiError> {
    if wav.is_empty() {
        return Err(AiError::MicUnavailable);
    }
    let part = reqwest::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|err| AiError::Protocol(err.to_string()))?;
    let request = http.post(endpoint(config));
    let (request, model_field) = match config.wire {
        AsrWire::Elevenlabs => (request.header("xi-api-key", &config.api_key), "model_id"),
        AsrWire::Openai => (request.bearer_auth(&config.api_key), "model"),
    };
    let form = reqwest::multipart::Form::new()
        .text(model_field, config.model.clone())
        .part("file", part);
    let response = request.multipart(form).send().await?;
    match response.status().as_u16() {
        200 => {
            let raw = response.text().await.map_err(AiError::from)?;
            parse_text_response(&raw)
        }
        401 | 403 => Err(AiError::Unauthorized),
        429 => Err(AiError::RateLimited),
        status => {
            let body = response.text().await.unwrap_or_default();
            Err(AiError::Protocol(format!("HTTP {status}: {body}")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_per_wire() {
        for (wire, base, expected) in [
            (
                AsrWire::Elevenlabs,
                "https://api.elevenlabs.io/",
                "https://api.elevenlabs.io/v1/speech-to-text",
            ),
            (
                AsrWire::Openai,
                "https://api.openai.com",
                "https://api.openai.com/v1/audio/transcriptions",
            ),
        ] {
            let config = AsrConfig {
                wire,
                base_url: base.to_string(),
                api_key: "test-key".to_string(),
                model: "test-model".to_string(),
            };
            let url = endpoint(&config);
            assert_eq!(url, expected);
        }
    }

    #[test]
    fn parses_text_shape() {
        assert_eq!(parse_text_response(r#"{"text":"hi"}"#).unwrap(), "hi");
        assert!(parse_text_response("{}").is_err());
        assert!(parse_text_response("not json").is_err());
    }
}
