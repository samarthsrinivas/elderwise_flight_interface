use serde::Serialize;

/// Error payload crossing the Tauri IPC boundary. `code` is a stable
/// discriminant the frontend narrows on; `message` is human-readable.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorPayload {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error("failed to resolve the app data directory: {0}")]
    Path(String),
    #[error("history storage failed: {0}")]
    Io(String),
    #[error("failed to encode the session record: {0}")]
    Serialize(String),
    #[error("background task failed: {0}")]
    Join(String),
}

impl HistoryError {
    const fn code(&self) -> &'static str {
        match self {
            Self::Path(_) => "path",
            Self::Io(_) => "io",
            Self::Serialize(_) => "serialize",
            Self::Join(_) => "join",
        }
    }
}

impl From<HistoryError> for ErrorPayload {
    fn from(err: HistoryError) -> Self {
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
        assert_eq!(
            ErrorPayload::from(HistoryError::Path("p".to_string())).code,
            "path"
        );
        assert_eq!(
            ErrorPayload::from(HistoryError::Io("io".to_string())).code,
            "io"
        );
        assert_eq!(
            ErrorPayload::from(HistoryError::Serialize("s".to_string())).code,
            "serialize"
        );
        assert_eq!(
            ErrorPayload::from(HistoryError::Join("j".to_string())).code,
            "join"
        );
    }
}
