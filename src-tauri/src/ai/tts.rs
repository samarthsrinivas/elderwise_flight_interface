use serde_json::json;

use super::error::AiError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TtsConfig {
    pub base_url: String,
    pub api_key: String,
    pub voice_id: String,
    pub model: String,
}

fn elevenlabs_text_to_speech_url(base_url: &str, voice_id: &str) -> String {
    format!(
        "{}/v1/text-to-speech/{}?output_format=mp3_44100_128",
        base_url.trim_end_matches('/'),
        voice_id
    )
}

fn elevenlabs_voice_url(base_url: &str, voice_id: &str) -> String {
    format!("{}/v1/voices/{}", base_url.trim_end_matches('/'), voice_id)
}

fn map_status(status: reqwest::StatusCode, provider: &str) -> AiError {
    match status.as_u16() {
        401 | 403 => AiError::Unauthorized,
        429 => AiError::RateLimited,
        code => AiError::Protocol(format!("HTTP {code} from {provider}")),
    }
}

pub async fn synthesize(
    http: &reqwest::Client,
    config: &TtsConfig,
    text: &str,
) -> Result<Vec<u8>, AiError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let response = http
        .post(elevenlabs_text_to_speech_url(
            &config.base_url,
            &config.voice_id,
        ))
        .header("xi-api-key", &config.api_key)
        .header("accept", "audio/mpeg")
        .json(&json!({
            "text": trimmed,
            "model_id": config.model,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75
            }
        }))
        .send()
        .await
        .map_err(AiError::from)?;

    if !response.status().is_success() {
        return Err(map_status(response.status(), "ElevenLabs text-to-speech"));
    }
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(AiError::from)
}

pub async fn probe_voice(http: &reqwest::Client, config: &TtsConfig) -> Result<(), AiError> {
    let response = http
        .get(elevenlabs_voice_url(&config.base_url, &config.voice_id))
        .header("xi-api-key", &config.api_key)
        .send()
        .await
        .map_err(AiError::from)?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(map_status(response.status(), "ElevenLabs voice lookup"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_elevenlabs_urls_without_double_slashes() {
        assert_eq!(
            elevenlabs_text_to_speech_url("https://api.elevenlabs.io/", "voice-1"),
            "https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128"
        );
        assert_eq!(
            elevenlabs_voice_url("https://api.elevenlabs.io/", "voice-1"),
            "https://api.elevenlabs.io/v1/voices/voice-1"
        );
    }

    #[test]
    fn maps_provider_status_codes_to_existing_error_kinds() {
        assert!(matches!(
            map_status(reqwest::StatusCode::UNAUTHORIZED, "ElevenLabs"),
            AiError::Unauthorized
        ));
        assert!(matches!(
            map_status(reqwest::StatusCode::TOO_MANY_REQUESTS, "ElevenLabs"),
            AiError::RateLimited
        ));
        assert!(matches!(
            map_status(reqwest::StatusCode::BAD_REQUEST, "ElevenLabs"),
            AiError::Protocol(_)
        ));
    }
}
