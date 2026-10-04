use serde::{Deserialize, Serialize};

use super::{
    domain::{Profile, QuestionnaireFeatures},
    Error,
};

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileProbabilities {
    pub younger_self_perception: f64,
    pub age_aligned: f64,
    pub older_self_perception: f64,
    pub mixed: f64,
}

impl ProfileProbabilities {
    fn entries(&self) -> [(Profile, f64); 4] {
        [
            (Profile::YoungerSelfPerception, self.younger_self_perception),
            (Profile::AgeAligned, self.age_aligned),
            (Profile::OlderSelfPerception, self.older_self_perception),
            (Profile::Mixed, self.mixed),
        ]
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionnaireAssessment {
    pub features: QuestionnaireFeatures,
    /// Actual provider-returned model version, which may resolve the requested alias.
    pub model: String,
    pub profile: Profile,
    pub confidence: f64,
    pub probabilities: ProfileProbabilities,
    pub input_tokens: u64,
}

#[derive(Deserialize)]
struct JevResponse {
    model: String,
    answers: Answers,
    usage: Usage,
}
#[derive(Deserialize)]
struct Answers {
    profile: ChoiceAnswer,
}
#[derive(Deserialize)]
struct ChoiceAnswer {
    r#type: String,
    choice: Profile,
    confidence: f64,
    probabilities: ProfileProbabilities,
}
#[derive(Deserialize)]
struct Usage {
    input_tokens: u64,
}

pub fn unit_interval(value: f64) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

pub fn parse(
    bytes: &[u8],
    features: QuestionnaireFeatures,
) -> Result<QuestionnaireAssessment, Error> {
    // Do not include provider bodies or deserialization details in errors.
    let response: JevResponse = serde_json::from_slice(bytes).map_err(|_| {
        Error::new(
            "invalid_response",
            "Jev returned a malformed typed response",
        )
    })?;
    let answer = response.answers.profile;
    if answer.r#type != "choice"
        || response.model.trim().is_empty()
        || !unit_interval(answer.confidence)
    {
        return Err(Error::new(
            "invalid_response",
            "Jev returned an invalid model, answer type, or confidence",
        ));
    }
    let entries = answer.probabilities.entries();
    if entries.iter().any(|(_, p)| !unit_interval(*p)) {
        return Err(Error::new(
            "invalid_response",
            "Jev returned an invalid probability",
        ));
    }
    // Allow rounding drift, but never silently normalize a malformed distribution.
    if (entries.iter().map(|(_, p)| p).sum::<f64>() - 1.0).abs() > 1e-6 {
        return Err(Error::new(
            "invalid_response",
            "Jev probabilities must sum to 1 within 0.000001",
        ));
    }
    let selected = entries
        .iter()
        .find(|(profile, _)| *profile == answer.choice)
        .map(|(_, p)| *p)
        .ok_or_else(|| Error::new("invalid_response", "Jev returned an unexpected profile"))?;
    if entries.iter().any(|(_, p)| *p > selected) {
        return Err(Error::new(
            "invalid_response",
            "Jev profile must have the highest probability",
        ));
    }
    Ok(QuestionnaireAssessment {
        features,
        model: response.model,
        profile: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        input_tokens: response.usage.input_tokens,
    })
}
