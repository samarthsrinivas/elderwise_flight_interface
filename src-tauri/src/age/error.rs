use crate::ai::error::ErrorPayload;

/// Failures of the on-device voice-age model (Python + MLX subprocess).
///
/// Codes are stable: the frontend treats everything except `too_short`,
/// `decode_failed` and `empty_input` as "model not available" and keeps the
/// locally computed voice markers.
#[derive(Debug, thiserror::Error)]
pub enum AgeError {
    #[error("the ml/ scripts were not found; set ELDERWISE_ML_DIR to the repo's ml directory")]
    ScriptsMissing,
    #[error(
        "no Python environment for the age model was found; create .venv-ml from ml/requirements.txt \
         or set ELDERWISE_AGE_PYTHON"
    )]
    PythonMissing,
    #[error("{0}")]
    ModelMissing(String),
    #[error("WavLM weights are not downloaded yet")]
    WeightsMissing,
    #[error("{0}")]
    TooShort(String),
    #[error("{0}")]
    DecodeFailed(String),
    #[error("no audio was provided to the age model")]
    EmptyInput,
    #[error("the age model did not respond within {0} s")]
    Timeout(u64),
    #[error("could not start the age model process: {0}")]
    Spawn(String),
    #[error("unexpected age model output: {0}")]
    Protocol(String),
    #[error("age model error: {0}")]
    Service(String),
    #[error("background task failed: {0}")]
    Join(String),
}

impl AgeError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::ScriptsMissing => "scripts_missing",
            Self::PythonMissing => "python_missing",
            Self::ModelMissing(_) => "model_missing",
            Self::WeightsMissing => "weights_missing",
            Self::TooShort(_) => "too_short",
            Self::DecodeFailed(_) => "decode_failed",
            Self::EmptyInput => "empty_input",
            Self::Timeout(_) => "timeout",
            Self::Spawn(_) => "spawn",
            Self::Protocol(_) => "protocol",
            Self::Service(_) => "service",
            Self::Join(_) => "join",
        }
    }

    /// Map an `{"error": {"code", "message"}}` payload printed by
    /// `ml/age_service.py` onto a typed error.
    pub fn from_service(code: &str, message: String) -> Self {
        match code {
            "model_missing" => Self::ModelMissing(message),
            "weights_missing" => Self::WeightsMissing,
            "too_short" => Self::TooShort(message),
            "decode_failed" => Self::DecodeFailed(message),
            "empty_input" => Self::EmptyInput,
            _ => Self::Service(message),
        }
    }
}

impl From<AgeError> for ErrorPayload {
    fn from(err: AgeError) -> Self {
        Self {
            code: err.code(),
            message: err.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_stable() {
        assert_eq!(AgeError::ScriptsMissing.code(), "scripts_missing");
        assert_eq!(AgeError::PythonMissing.code(), "python_missing");
        assert_eq!(AgeError::ModelMissing("x".into()).code(), "model_missing");
        assert_eq!(AgeError::WeightsMissing.code(), "weights_missing");
        assert_eq!(AgeError::TooShort("x".into()).code(), "too_short");
        assert_eq!(AgeError::DecodeFailed("x".into()).code(), "decode_failed");
        assert_eq!(AgeError::EmptyInput.code(), "empty_input");
        assert_eq!(AgeError::Timeout(1).code(), "timeout");
        assert_eq!(AgeError::Spawn("x".into()).code(), "spawn");
        assert_eq!(AgeError::Protocol("x".into()).code(), "protocol");
        assert_eq!(AgeError::Service("x".into()).code(), "service");
        assert_eq!(AgeError::Join("x".into()).code(), "join");
    }

    #[test]
    fn service_codes_map_to_variants() {
        let payload = ErrorPayload::from(AgeError::from_service(
            "too_short",
            "need at least 1 s of speech, got 0.4 s".into(),
        ));
        assert_eq!(payload.code, "too_short");
        assert_eq!(payload.message, "need at least 1 s of speech, got 0.4 s");

        assert_eq!(
            AgeError::from_service("weights_missing", String::new()).code(),
            "weights_missing"
        );
        assert_eq!(
            AgeError::from_service("internal", "ValueError: boom".into()).code(),
            "service"
        );
    }
}
