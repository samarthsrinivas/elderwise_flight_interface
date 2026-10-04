use std::time::Duration;

use super::{
    domain::QuestionnaireFeatures,
    request,
    response::{self, QuestionnaireAssessment},
    Error,
};

const ENDPOINT: &str = "https://api.typesafe.ai/v1/systemone";

pub async fn assess(
    features: QuestionnaireFeatures,
    key: &str,
) -> Result<QuestionnaireAssessment, Error> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| Error::new("transport_error", "Unable to initialize Jev HTTP client"))?;
    send(&client, ENDPOINT, features, key).await
}

async fn send(
    client: &reqwest::Client,
    endpoint: &str,
    features: QuestionnaireFeatures,
    key: &str,
) -> Result<QuestionnaireAssessment, Error> {
    let result = client
        .post(endpoint)
        .bearer_auth(key)
        .json(&request::build(features.clone()))
        .send()
        .await
        .map_err(|_| Error::new("transport_error", "Jev request failed or timed out"))?;
    if !result.status().is_success() {
        return Err(Error::new(
            "provider_error",
            format!("Jev returned HTTP {}", result.status().as_u16()),
        ));
    }
    let bytes = result
        .bytes()
        .await
        .map_err(|_| Error::new("transport_error", "Unable to read Jev response"))?;
    response::parse(&bytes, features)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::questionnaire::domain::{AppearancePerception, QuestionnaireAnswers};
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn features() -> QuestionnaireFeatures {
        QuestionnaireAnswers {
            chronological_age: 75,
            appearance_perception: AppearancePerception::LittleYounger,
            felt_age: 64,
        }
        .validate()
        .unwrap()
    }

    fn serve(status: u16, body: &str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1/systemone", listener.local_addr().unwrap());
        let response = format!(
            "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let count = stream.read(&mut buffer).unwrap();
                assert!(count > 0);
                request.extend_from_slice(&buffer[..count]);
                if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap();
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8(request).unwrap()
        });
        (endpoint, worker)
    }

    #[test]
    fn http_contract_posts_bearer_features_and_parses_typed_answer() {
        let (endpoint, worker) = serve(
            200,
            r#"{"model":"jev-test","answers":{"profile":{"type":"choice","choice":"younger_self_perception","confidence":0.9,"probabilities":{"younger_self_perception":0.85,"age_aligned":0.05,"older_self_perception":0.0,"mixed":0.1}}},"usage":{"input_tokens":88}}"#,
        );
        let result = tauri::async_runtime::block_on(async {
            send(
                &reqwest::Client::new(),
                &endpoint,
                features(),
                "test-only-key",
            )
            .await
            .unwrap()
        });
        let raw = worker.join().unwrap();
        assert!(raw.starts_with("POST /v1/systemone HTTP/1.1\r\n"));
        assert!(raw.contains("authorization: Bearer test-only-key\r\n"));
        assert!(raw.contains("content-type: application/json\r\n"));
        let (_, body) = raw.split_once("\r\n\r\n").unwrap();
        let body: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(body["model"], "jev-latest");
        assert_eq!(body["state"]["feltAgeDeltaYears"], -11);
        assert_eq!(body["state"].as_object().unwrap().len(), 5);
        assert_eq!(body["questions"].as_object().unwrap().len(), 1);
        assert_eq!(body["questions"]["profile"]["type"], "choice");
        assert!(!body.to_string().contains("test-only-key"));
        assert_eq!(result.model, "jev-test");
        assert_eq!(result.input_tokens, 88);
    }

    #[test]
    fn provider_errors_do_not_expose_response_body_or_key() {
        let (endpoint, worker) = serve(401, "test-only-key and sensitive provider detail");
        let err = tauri::async_runtime::block_on(async {
            send(
                &reqwest::Client::new(),
                &endpoint,
                features(),
                "test-only-key",
            )
            .await
            .unwrap_err()
        });
        worker.join().unwrap();
        assert_eq!(err.code, "provider_error");
        assert_eq!(err.message, "Jev returned HTTP 401");
    }
}
