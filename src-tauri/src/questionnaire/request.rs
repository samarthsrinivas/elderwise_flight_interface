use serde::Serialize;
use std::collections::BTreeMap;

use super::domain::QuestionnaireFeatures;

pub const MODEL: &str = "jev-latest";

#[derive(Serialize)]
pub struct JevRequest {
    model: &'static str,
    state: QuestionnaireFeatures,
    questions: BTreeMap<&'static str, ChoiceQuestion>,
}

#[derive(Serialize)]
struct ChoiceQuestion {
    r#type: &'static str,
    instructions: &'static str,
    criteria: BTreeMap<&'static str, &'static str>,
}

pub fn build(features: QuestionnaireFeatures) -> JevRequest {
    JevRequest {
        model: MODEL,
        state: features,
        questions: BTreeMap::from([("profile", ChoiceQuestion {
            r#type: "choice",
            instructions: "Which profile best represents these questionnaire answers overall? This represents subjective/self-perceived age only. It is NOT biological age, diagnosis, medical risk, or clinical assessment. Use only the structured questionnaire features supplied in state. Rust has already computed feltAgeDeltaYears and feltAgeDeltaRatio; do not calculate or recompute them. Negative deltas indicate feeling younger, zero indicates the same age, and positive deltas indicate feeling older. Appearance is the respondent's perception relative to chronological age. Use mixed when appearance and felt-age answers conflict or are not coherently represented by the other categories.",
            criteria: BTreeMap::from([
                ("younger_self_perception", "Answers overall indicate feeling/looking younger than chronological age."),
                ("age_aligned", "Answers broadly align with chronological age."),
                ("older_self_perception", "Answers overall indicate feeling/looking older than chronological age."),
                ("mixed", "Appearance and felt-age answers conflict or are not coherently represented by the other categories."),
            ]),
        })]),
    }
}
