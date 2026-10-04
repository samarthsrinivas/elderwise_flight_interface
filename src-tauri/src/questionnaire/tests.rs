use super::{credentials, domain::*, request, response};
use serde_json::{json, Value};

fn answers(age: i32, felt: i32) -> QuestionnaireAnswers {
    QuestionnaireAnswers {
        chronological_age: age,
        appearance_perception: AppearancePerception::LittleYounger,
        felt_age: felt,
    }
}
fn features() -> QuestionnaireFeatures {
    answers(75, 64).validate().unwrap()
}
fn wire() -> Value {
    json!({"model":"jev-1.13.0","answers":{"profile":{"type":"choice","choice":"younger_self_perception","confidence":0.8,"probabilities":{"younger_self_perception":0.7,"age_aligned":0.1,"older_self_perception":0.05,"mixed":0.15}}},"usage":{"input_tokens":123,"output_tokens":20}})
}
fn parse(value: Value) -> Result<response::QuestionnaireAssessment, super::Error> {
    response::parse(&serde_json::to_vec(&value).unwrap(), features())
}

#[test]
fn all_appearance_values_round_trip() {
    for appearance in [
        "much_younger",
        "little_younger",
        "about_same",
        "little_older",
        "much_older",
    ] {
        let input = json!({"chronologicalAge":75,"appearancePerception":appearance,"feltAge":64});
        let answers: QuestionnaireAnswers = serde_json::from_value(input.clone()).unwrap();
        let result = serde_json::to_value(answers.validate().unwrap()).unwrap();
        assert_eq!(
            result["appearancePerception"],
            input["appearancePerception"]
        );
    }
}
#[test]
fn deterministic_deltas_and_ratios() {
    for (age, felt, delta, ratio) in [
        (75, 64, -11, -11.0 / 75.0),
        (50, 60, 10, 0.2),
        (80, 80, 0, 0.0),
        (18, 1, -17, -17.0 / 18.0),
        (120, 120, 0, 0.0),
    ] {
        let f = answers(age, felt).validate().unwrap();
        assert_eq!(f.felt_age_delta_years, delta);
        assert!((f.felt_age_delta_ratio - ratio).abs() < 1e-12);
    }
}
#[test]
fn invalid_ages_are_rejected() {
    for age in [i32::MIN, -1, 0, 17, 121, i32::MAX] {
        assert!(answers(age, 64).validate().is_err());
    }
    for felt in [i32::MIN, -1, 0, 121, i32::MAX] {
        assert!(answers(75, felt).validate().is_err());
    }
}
#[test]
fn malformed_answers_are_rejected() {
    for value in [
        json!({"chronologicalAge":75.5,"appearancePerception":"about_same","feltAge":64}),
        json!({"chronologicalAge":75,"appearancePerception":"unknown","feltAge":64}),
        json!({"chronologicalAge":75,"appearancePerception":"about_same","feltAge":64,"feltAgeDeltaYears":99}),
    ] {
        assert!(serde_json::from_value::<QuestionnaireAnswers>(value).is_err());
    }
}
#[test]
fn valid_jev_response_preserves_provider_values() {
    let output = parse(wire()).unwrap();
    assert_eq!(output.profile, Profile::YoungerSelfPerception);
    assert_eq!(output.model, "jev-1.13.0");
    assert_eq!(output.confidence, 0.8);
    assert_eq!(output.input_tokens, 123);
    assert_eq!(output.probabilities.younger_self_perception, 0.7);
    assert_eq!(output.features.felt_age_delta_years, -11);
}
#[test]
fn every_probability_key_is_required() {
    for key in [
        "younger_self_perception",
        "age_aligned",
        "older_self_perception",
        "mixed",
    ] {
        let mut w = wire();
        w["answers"]["profile"]["probabilities"]
            .as_object_mut()
            .unwrap()
            .remove(key);
        assert!(parse(w).is_err());
    }
}
#[test]
fn invalid_probability_and_confidence_are_rejected() {
    for field in ["confidence", "probability"] {
        for value in [json!(-0.1), json!(1.1), Value::Null, json!("NaN")] {
            let mut w = wire();
            if field == "confidence" {
                w["answers"]["profile"][field] = value;
            } else {
                w["answers"]["profile"]["probabilities"]["mixed"] = value;
            }
            assert!(parse(w).is_err());
        }
    }
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.1, 1.1] {
        assert!(!response::unit_interval(value));
    }
}
#[test]
fn malformed_distribution_and_wrong_winner_are_rejected() {
    let mut w = wire();
    w["answers"]["profile"]["probabilities"]["mixed"] = json!(0.4);
    assert!(parse(w).is_err());
    let mut w = wire();
    w["answers"]["profile"]["choice"] = json!("age_aligned");
    assert!(parse(w).is_err());
    let mut w = wire();
    w["answers"]["profile"]["probabilities"]["unexpected"] = json!(0.0);
    assert!(parse(w).is_err());
}
#[test]
fn unexpected_profile_and_answer_type_are_rejected() {
    let mut w = wire();
    w["answers"]["profile"]["choice"] = json!("biological_age");
    assert!(parse(w).is_err());
    let mut w = wire();
    w["answers"]["profile"]["type"] = json!("score");
    assert!(parse(w).is_err());
    assert!(response::parse(b"not json", features()).is_err());
}
#[test]
fn request_contains_only_features_and_one_choice() {
    let w = serde_json::to_value(request::build(features())).unwrap();
    assert_eq!(w["model"], "jev-latest");
    assert_eq!(
        w["state"],
        json!({"chronologicalAge":75,"appearancePerception":"little_younger","feltAge":64,"feltAgeDeltaYears":-11,"feltAgeDeltaRatio":-11.0/75.0})
    );
    assert_eq!(w["questions"].as_object().unwrap().len(), 1);
    assert_eq!(w["questions"]["profile"]["type"], "choice");
    assert_eq!(
        w["questions"]["profile"]["criteria"]
            .as_object()
            .unwrap()
            .len(),
        4
    );
}
#[test]
fn missing_api_key_and_credential_precedence() {
    assert_eq!(
        credentials::select_key(None, None).unwrap_err().code,
        "missing_api_key"
    );
    assert!(credentials::select_key(Some("  ".into()), Some("".into())).is_err());
    assert_eq!(
        credentials::select_key(Some("stored".into()), Some("env".into()))
            .unwrap()
            .0,
        "stored"
    );
    assert_eq!(
        credentials::select_key(None, Some(" env ".into()))
            .unwrap()
            .0,
        "env"
    );
}

#[test]
fn all_profiles_and_boundary_confidences_are_accepted() {
    for profile in [
        "younger_self_perception",
        "age_aligned",
        "older_self_perception",
        "mixed",
    ] {
        for confidence in [0.0, 1.0] {
            let mut w = wire();
            w["answers"]["profile"]["choice"] = json!(profile);
            w["answers"]["profile"]["confidence"] = json!(confidence);
            w["answers"]["profile"]["probabilities"] = json!({"younger_self_perception":0.25,"age_aligned":0.25,"older_self_perception":0.25,"mixed":0.25});
            assert!(
                parse(w).is_ok(),
                "ties permit any highest-probability profile"
            );
        }
    }
}

#[test]
fn distribution_tolerance_is_bounded() {
    let mut w = wire();
    w["answers"]["profile"]["probabilities"]["mixed"] = json!(0.1500005);
    assert!(parse(w).is_ok());
    let mut w = wire();
    w["answers"]["profile"]["probabilities"]["mixed"] = json!(0.150002);
    assert!(parse(w).is_err());
}
