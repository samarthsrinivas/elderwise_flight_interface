use serde::Serialize;

/// Error payload crossing the Tauri IPC boundary. `code` is a stable
/// discriminant the frontend narrows on; `message` is human-readable.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorPayload {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("no API key is configured for the selected provider")]
    MissingCredentials,
    #[error("no audio was provided to transcribe")]
    MicUnavailable,
    #[error("authentication failed; check the provider API key")]
    Unauthorized,
    #[error("provider rate limit exceeded; retry later")]
    RateLimited,
    #[error("network error: {0}")]
    Network(String),
    #[error("unexpected provider response: {0}")]
    Protocol(String),
    #[error("keychain access failed: {0}")]
    Keychain(String),
    #[error("settings storage failed: {0}")]
    Settings(String),
    #[error("this AI capability is turned off in AI Settings")]
    Disabled,
    #[error("provider is not fully configured: {0}")]
    NotConfigured(String),
}

impl AiError {
    const fn code(&self) -> &'static str {
        match self {
            Self::MissingCredentials => "missing_credentials",
            Self::MicUnavailable => "mic_unavailable",
            Self::Unauthorized => "unauthorized",
            Self::RateLimited => "rate_limited",
            Self::Network(_) => "network",
            Self::Protocol(_) => "protocol",
            Self::Keychain(_) => "keychain",
            Self::Settings(_) => "settings",
            Self::Disabled => "disabled",
            Self::NotConfigured(_) => "not_configured",
        }
    }
}

impl From<AiError> for ErrorPayload {
    fn from(err: AiError) -> Self {
        Self {
            code: err.code(),
            message: err.to_string(),
        }
    }
}

impl From<reqwest::Error> for AiError {
    fn from(err: reqwest::Error) -> Self {
        Self::Network(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_stable() {
        assert_eq!(
            ErrorPayload::from(AiError::MissingCredentials).code,
            "missing_credentials"
        );
        assert_eq!(
            ErrorPayload::from(AiError::MicUnavailable).code,
            "mic_unavailable"
        );
        assert_eq!(
            ErrorPayload::from(AiError::Unauthorized).code,
            "unauthorized"
        );
        assert_eq!(
            ErrorPayload::from(AiError::RateLimited).code,
            "rate_limited"
        );
        assert_eq!(
            ErrorPayload::from(AiError::Network("net".to_string())).code,
            "network"
        );
        assert_eq!(
            ErrorPayload::from(AiError::Protocol("p".to_string())).code,
            "protocol"
        );
        assert_eq!(
            ErrorPayload::from(AiError::Keychain("k".to_string())).code,
            "keychain"
        );
        assert_eq!(
            ErrorPayload::from(AiError::Settings("io".to_string())).code,
            "settings"
        );
        assert_eq!(ErrorPayload::from(AiError::Disabled).code, "disabled");
        assert_eq!(
            ErrorPayload::from(AiError::NotConfigured("voice model".to_string())).code,
            "not_configured"
        );
    }
}
