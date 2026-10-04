use super::sse::parse_responses_stream;
use super::*;

#[test]
fn body_pins_safety_parameters() {
    let body = chat_body("gpt-4o-mini", "sys", "user");
    assert_eq!(body["model"], "gpt-4o-mini");
    assert_eq!(body["temperature"], json!(0.3));
    assert_eq!(body["max_tokens"], json!(350));
    assert_eq!(body["stream"], json!(false));
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][1]["role"], "user");
    assert_eq!(body["messages"][1]["content"], "user");
}

#[test]
fn responses_body_uses_latest_openai_streaming_contract() {
    let turns = vec![
        ChatTurn {
            role: "assistant".to_string(),
            content: "q1".to_string(),
        },
        ChatTurn {
            role: "user".to_string(),
            content: "a1".to_string(),
        },
    ];
    let body = responses_body("gpt-5.5", "sys", &turns, 400);
    assert_eq!(body["model"], "gpt-5.5");
    assert_eq!(body["instructions"], "sys");
    assert_eq!(body["max_output_tokens"], json!(400));
    assert_eq!(body["stream"], json!(true));
    assert_eq!(body["store"], json!(false));
    assert_eq!(body["reasoning"]["effort"], "low");
    assert_eq!(body["text"]["verbosity"], "low");
    assert_eq!(body["input"][0]["type"], "message");
    assert_eq!(body["input"][0]["role"], "assistant");
    assert_eq!(body["input"][0]["content"][0]["type"], "input_text");
    assert_eq!(body["input"][0]["content"][0]["text"], "q1");
    assert_eq!(body["input"][1]["role"], "user");
    assert_eq!(body["input"][1]["content"][0]["text"], "a1");
}

#[test]
fn parses_chat_shape() {
    let raw = r#"{"choices":[{"message":{"role":"assistant","content":"Summary."}}]}"#;
    assert_eq!(parse_chat_response(raw).unwrap(), "Summary.");
    assert!(parse_chat_response(r#"{"choices":[{}]}"#).is_err());
    assert!(parse_chat_response("nope").is_err());
}

#[test]
fn parses_responses_stream_text_events() {
    let raw = concat!(
        "event: response.created\ndata: {\"type\":\"response.created\"}\n\n",
        "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"Sum\"}\n\n",
        "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"mary.\"}\n\n",
        "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[]}}\n\n"
    );
    assert_eq!(parse_responses_stream(raw).unwrap(), "Summary.");
    assert!(parse_responses_stream("event: response.created\n").is_err());
    assert!(parse_responses_stream("data: {\"type\":\"error\",\"message\":\"bad\"}\n\n").is_err());
}

#[test]
fn converse_body_keeps_turn_order_after_system() {
    let turns = vec![
        ChatTurn {
            role: "assistant".to_string(),
            content: "q1".to_string(),
        },
        ChatTurn {
            role: "user".to_string(),
            content: "a1".to_string(),
        },
    ];
    let body = converse_body("m", "sys", &turns, 400);
    assert_eq!(body["max_tokens"], json!(400));
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][1]["role"], "assistant");
    assert_eq!(body["messages"][1]["content"], "q1");
    assert_eq!(body["messages"][2]["role"], "user");
    assert_eq!(body["messages"][2]["content"], "a1");
}
