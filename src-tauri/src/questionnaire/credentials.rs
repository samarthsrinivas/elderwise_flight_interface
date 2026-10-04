use keyring::Entry;
use serde::Serialize;

use super::Error;

const SERVICE: &str = "com.elderwise.app";
const ACCOUNT: &str = "typesafe-api-key";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeySource {
    Keychain,
    Environment,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub configured: bool,
    pub source: Option<KeySource>,
}

fn entry() -> Result<Entry, Error> {
    Entry::new(SERVICE, ACCOUNT).map_err(|_| keychain_error())
}
fn keychain_error() -> Error {
    Error::new(
        "keychain_error",
        "Unable to access TypeSafe keychain credentials",
    )
}
fn nonempty(key: Option<String>) -> Option<String> {
    key.map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty())
}

pub fn select_key(
    stored: Option<String>,
    environment: Option<String>,
) -> Result<(String, KeySource), Error> {
    if let Some(key) = nonempty(stored) {
        return Ok((key, KeySource::Keychain));
    }
    if let Some(key) = nonempty(environment) {
        return Ok((key, KeySource::Environment));
    }
    Err(Error::new(
        "missing_api_key",
        "Configure a TypeSafe API key in the keychain or TYPESAFE_API_KEY",
    ))
}

pub fn resolve() -> Result<(String, KeySource), Error> {
    let environment = nonempty(std::env::var("TYPESAFE_API_KEY").ok());
    let stored = match entry().and_then(|entry| match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(keychain_error()),
    }) {
        Ok(stored) => stored,
        // Development fallback remains usable on machines without a keychain service.
        Err(_) if environment.is_some() => None,
        Err(err) => return Err(err),
    };
    select_key(stored, environment)
}

pub fn status() -> Result<KeyStatus, Error> {
    match resolve() {
        Ok((_, source)) => Ok(KeyStatus {
            configured: true,
            source: Some(source),
        }),
        Err(err) if err.code == "missing_api_key" => Ok(KeyStatus {
            configured: false,
            source: None,
        }),
        Err(err) => Err(err),
    }
}
pub fn set(key: &str) -> Result<(), Error> {
    let key = key.trim();
    if key.is_empty() {
        return Err(Error::new(
            "invalid_input",
            "TypeSafe API key must not be empty",
        ));
    }
    entry()?.set_password(key).map_err(|_| keychain_error())
}
pub fn clear() -> Result<(), Error> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(keychain_error()),
    }
}
