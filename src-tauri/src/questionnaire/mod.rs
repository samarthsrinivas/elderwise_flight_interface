mod client;
mod credentials;
mod domain;
mod request;
mod response;
#[cfg(test)]
mod tests;

use domain::QuestionnaireAnswers;
use response::QuestionnaireAssessment;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}
impl Error {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Independent questionnaire API. Does not read or mutate assessment sessions.
#[tauri::command]
pub async fn assess_questionnaire(
    answers: QuestionnaireAnswers,
) -> Result<QuestionnaireAssessment, Error> {
    let features = answers.validate()?;
    let (key, _) = credentials::resolve()?;
    client::assess(features, &key).await
}

#[tauri::command]
pub async fn questionnaire_set_key(key: String) -> Result<(), Error> {
    credentials::set(&key)
}
#[tauri::command]
pub async fn questionnaire_clear_key() -> Result<(), Error> {
    credentials::clear()
}
#[tauri::command]
pub async fn questionnaire_key_status() -> Result<credentials::KeyStatus, Error> {
    credentials::status()
}
