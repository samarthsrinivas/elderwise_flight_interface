use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::JoinHandle;
use std::time::Duration;

use super::{asr, chat, decision, error::AiError, tts, AiState};

fn serve(status: u16, body: &str) -> (String, JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
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
        let mut buffer = [0; 4096];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0, "request ended before its body");
            request.extend_from_slice(&buffer[..count]);
            if let Some(end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    break;
                }
            }
        }
        stream.write_all(response.as_bytes()).unwrap();
        String::from_utf8(request).unwrap()
    });
    (base, worker)
}

#[test]
fn elevenlabs_stt_posts_multipart_to_speech_to_text_endpoint() {
    let (base_url, server) = serve(200, r#"{"text":"Hello from speech"}"#);
    let config = asr::AsrConfig {
        wire: asr::AsrWire::Elevenlabs,
        base_url,
        api_key: "test-key".to_string(),
        model: "scribe_v2".to_string(),
    };
    let transcript = tauri::async_runtime::block_on(async {
        let state = AiState::new();
        asr::transcribe(
            state.http().await.unwrap(),
            &config,
            b"RIFF-test-audio".to_vec(),
        )
        .await
        .unwrap()
    });
    let request = server.join().unwrap();
    assert_eq!(transcript, "Hello from speech");
    assert!(request.starts_with("POST /v1/speech-to-text HTTP/1.1\r\n"));
    assert!(request.contains("xi-api-key: test-key\r\n"));
    assert!(!request.contains("authorization:"));
    assert!(request.contains("multipart/form-data; boundary="));
    assert!(request.contains("name=\"model_id\"\r\n\r\nscribe_v2"));
    assert!(request.contains("name=\"file\"; filename=\"audio.wav\""));
    assert!(request.contains("Content-Type: audio/wav"));
    assert!(request.contains("RIFF-test-audio"));
}

#[test]
fn openai_stt_preserves_bearer_multipart_contract() {
    let (base_url, server) = serve(200, r#"{"text":"OpenAI transcript"}"#);
    let config = asr::AsrConfig {
        wire: asr::AsrWire::Openai,
        base_url,
        api_key: "test-key".to_string(),
        model: "custom-transcribe".to_string(),
    };
    let transcript = tauri::async_runtime::block_on(async {
        let state = AiState::new();
        asr::transcribe(state.http().await.unwrap(), &config, b"RIFF-audio".to_vec())
            .await
            .unwrap()
    });
    let request = server.join().unwrap();
    assert_eq!(transcript, "OpenAI transcript");
    assert!(request.starts_with("POST /v1/audio/transcriptions HTTP/1.1\r\n"));
    assert!(request.contains("authorization: Bearer test-key\r\n"));
    assert!(request.contains("name=\"model\"\r\n\r\ncustom-transcribe"));
    assert!(!request.contains("xi-api-key:"));
}

#[test]
fn asr_maps_authentication_and_rate_limit_errors() {
    for (status, code) in [
        (401, "unauthorized"),
        (403, "unauthorized"),
        (429, "rate_limited"),
        (500, "protocol"),
    ] {
        let (base_url, server) = serve(status, "failure");
        let config = asr::AsrConfig {
            wire: asr::AsrWire::Elevenlabs,
            base_url,
            api_key: "test-key".to_string(),
            model: "scribe_v2".to_string(),
        };
        let error = tauri::async_runtime::block_on(async {
            let state = AiState::new();
            asr::transcribe(state.http().await.unwrap(), &config, vec![1])
                .await
                .unwrap_err()
        });
        server.join().unwrap();
        assert_eq!(super::error::ErrorPayload::from(error).code, code);
    }
}

#[test]
fn empty_audio_is_rejected_before_network_access() {
    let config = asr::AsrConfig {
        wire: asr::AsrWire::Elevenlabs,
        base_url: "invalid".to_string(),
        api_key: String::new(),
        model: String::new(),
    };
    let outcome = tauri::async_runtime::block_on(async {
        let state = AiState::new();
        asr::transcribe(state.http().await.unwrap(), &config, Vec::new()).await
    });
    assert!(matches!(outcome, Err(AiError::MicUnavailable)));
}

#[test]
fn complete_reads_responses_sse_over_http() {
    let body = concat!(
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Wellness \"}\r\n\r\n",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"summary.\"}\r\n\r\n",
        "data: [DONE]\r\n\r\n"
    );
    let (base_url, server) = serve(200, body);
    let config = chat::ChatConfig {
        wire: chat::ChatWire::OpenAiResponses,
        base_url,
        api_key: Some("test-key".to_string()),
        model: "gpt-6.1-sol".to_string(),
    };
    let result = tauri::async_runtime::block_on(async {
        let state = AiState::new();
        chat::complete(
            state.http().await.unwrap(),
            &config,
            "system fixture",
            "assessment fixture",
        )
        .await
        .unwrap()
    });
    let request = server.join().unwrap();
    assert_eq!(result, "Wellness summary.");
    assert!(request.starts_with("POST /v1/responses HTTP/1.1\r\n"));
    assert!(request.contains("accept: text/event-stream\r\n"));
    assert!(request.contains("authorization: Bearer test-key\r\n"));
    let (_, body) = request.split_once("\r\n\r\n").unwrap();
    let body: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(body["input"][0]["content"][0]["text"], "assessment fixture");
}

#[test]
fn converse_reads_compatible_chat_over_http() {
    let (base_url, server) = serve(200, r#"{"choices":[{"message":{"content":"Next turn"}}]}"#);
    let config = chat::ChatConfig {
        wire: chat::ChatWire::OpenAiCompatibleChat,
        base_url,
        api_key: Some("test-key".to_string()),
        model: "chat-model".to_string(),
    };
    let turns = [chat::ChatTurn {
        role: "user".to_string(),
        content: "Hello".to_string(),
    }];
    let result = tauri::async_runtime::block_on(async {
        let state = AiState::new();
        chat::converse(state.http().await.unwrap(), &config, "sys", &turns, 400)
            .await
            .unwrap()
    });
    let request = server.join().unwrap();
    assert_eq!(result, "Next turn");
    assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"));
}

#[test]
fn elevenlabs_tts_returns_audio_bytes_over_http() {
    let (base_url, server) = serve(200, "ID3-test-audio");
    let config = tts::TtsConfig {
        base_url,
        api_key: "test-key".to_string(),
        voice_id: "voice-1".to_string(),
        model: "eleven_v4".to_string(),
    };
    let audio = tauri::async_runtime::block_on(async {
        let state = AiState::new();
        tts::synthesize(state.http().await.unwrap(), &config, " Hello ")
            .await
            .unwrap()
    });
    let request = server.join().unwrap();
    assert_eq!(audio, b"ID3-test-audio");
    assert!(request
        .starts_with("POST /v1/text-to-speech/voice-1?output_format=mp3_44100_128 HTTP/1.1\r\n"));
    assert!(request.contains("xi-api-key: test-key\r\n"));
}

#[test]
fn decision_request_is_posted_with_bearer_and_exact_body() {
    let (base, server) = serve(
        200,
        r#"{"model":"jev-1.13.0","answers":{"q":0.8},"usage":{}}"#,
    );
    let config = decision::DecisionConfig {
        url: format!("{base}/v1/systemone"),
        api_key: "test-key".to_string(),
        model: Some("jev-1.13.0".to_string()),
    };
    let questions = std::collections::BTreeMap::from([(
        "q".to_string(),
        decision::noul("The statement describes a colour."),
    )]);
    let response = tauri::async_runtime::block_on(async {
        let state = AiState::new();
        decision::decide(
            state.http().await.unwrap(),
            &config,
            serde_json::json!("The sky is blue."),
            questions,
        )
        .await
    })
    .unwrap();
    let request = server.join().unwrap();
    assert!(request.starts_with("POST /v1/systemone HTTP/1.1\r\n"));
    assert!(request.contains("authorization: Bearer test-key\r\n"));
    let (_, body) = request.split_once("\r\n\r\n").unwrap();
    let body: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({
            "model": "jev-1.13.0",
            "state": "The sky is blue.",
            "questions": {"q": {"type": "noul", "instructions": "The statement describes a colour."}}
        })
    );
    assert_eq!(response.model.as_deref(), Some("jev-1.13.0"));
    assert_eq!(
        response
            .answers
            .get("q")
            .and_then(decision::Answer::as_noul),
        Some(0.8)
    );
}

#[test]
fn decision_errors_map_to_payload_codes() {
    for (status, code) in [
        (401, "unauthorized"),
        (403, "unauthorized"),
        (429, "rate_limited"),
        (500, "protocol"),
    ] {
        let (base, server) = serve(status, "failure");
        let config = decision::DecisionConfig {
            url: format!("{base}/v1/systemone"),
            api_key: "test-key".to_string(),
            model: None,
        };
        let error = tauri::async_runtime::block_on(async {
            let state = AiState::new();
            decision::decide(
                state.http().await.unwrap(),
                &config,
                serde_json::json!("x"),
                std::collections::BTreeMap::new(),
            )
            .await
        })
        .unwrap_err();
        server.join().unwrap();
        assert_eq!(super::error::ErrorPayload::from(error).code, code);
    }
}
