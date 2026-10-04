use keyring::Entry;

use super::error::AiError;

const SERVICE: &str = "com.elderwise.app";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyProvider {
    Openai,
    Elevenlabs,
}

impl KeyProvider {
    const fn account(self) -> &'static str {
        match self {
            Self::Openai => "openai-api-key",
            Self::Elevenlabs => "elevenlabs-api-key",
        }
    }
}

fn entry(provider: KeyProvider) -> Result<Entry, AiError> {
    Entry::new(SERVICE, provider.account()).map_err(|err| AiError::Keychain(err.to_string()))
}

pub fn load_key(provider: KeyProvider) -> Result<Option<String>, AiError> {
    match entry(provider)?.get_password() {
        Ok(key) if key.is_empty() => Ok(None),
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(AiError::Keychain(err.to_string())),
    }
}

pub fn save_key(provider: KeyProvider, key: &str) -> Result<(), AiError> {
    entry(provider)?
        .set_password(key)
        .map_err(|err| AiError::Keychain(err.to_string()))
}

pub fn clear_key(provider: KeyProvider) -> Result<(), AiError> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(AiError::Keychain(err.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_names_are_stable() {
        assert_eq!(KeyProvider::Openai.account(), "openai-api-key");
        assert_eq!(KeyProvider::Elevenlabs.account(), "elevenlabs-api-key");
    }
}
