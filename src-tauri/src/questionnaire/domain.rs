use serde::{Deserialize, Serialize};

use super::Error;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppearancePerception {
    MuchYounger,
    LittleYounger,
    AboutSame,
    LittleOlder,
    MuchOlder,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireAnswers {
    pub chronological_age: i32,
    pub appearance_perception: AppearancePerception,
    pub felt_age: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionnaireFeatures {
    pub chronological_age: i32,
    pub appearance_perception: AppearancePerception,
    pub felt_age: i32,
    pub felt_age_delta_years: i32,
    pub felt_age_delta_ratio: f64,
}

impl QuestionnaireAnswers {
    pub fn validate(self) -> Result<QuestionnaireFeatures, Error> {
        if !(18..=120).contains(&self.chronological_age) {
            return Err(Error::new(
                "invalid_input",
                "chronologicalAge must be an integer from 18 to 120",
            ));
        }
        if !(1..=120).contains(&self.felt_age) {
            return Err(Error::new(
                "invalid_input",
                "feltAge must be an integer from 1 to 120",
            ));
        }
        let delta = self.felt_age - self.chronological_age;
        Ok(QuestionnaireFeatures {
            chronological_age: self.chronological_age,
            appearance_perception: self.appearance_perception,
            felt_age: self.felt_age,
            felt_age_delta_years: delta,
            felt_age_delta_ratio: f64::from(delta) / f64::from(self.chronological_age),
        })
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Profile {
    YoungerSelfPerception,
    AgeAligned,
    OlderSelfPerception,
    Mixed,
}
