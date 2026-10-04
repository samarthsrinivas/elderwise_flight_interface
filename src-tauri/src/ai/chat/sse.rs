use super::{AiError, ChatConfig};
use futures::StreamExt;
use serde_json::Value;

fn responses_output_text(value: &Value) -> Option<String> {
    if let Some(text) = value["output_text"].as_str() {
        return Some(text.to_string());
    }
    let mut text = String::new();
    for item in value["output"].as_array()? {
        let Some(parts) = item["content"].as_array() else {
            continue;
        };
        for part in parts {
            if part["type"].as_str() == Some("output_text") {
                if let Some(part_text) = part["text"].as_str() {
                    text.push_str(part_text);
                }
            }
        }
    }
    (!text.is_empty()).then_some(text)
}

fn responses_error_message(value: &Value) -> String {
    value["message"]
        .as_str()
        .or_else(|| value["error"]["message"].as_str())
        .or_else(|| value["response"]["error"]["message"].as_str())
        .unwrap_or("provider returned an error event")
        .to_string()
}

fn process_responses_event(frame: &str, output: &mut String) -> Result<(), AiError> {
    for line in frame.lines().map(|line| line.trim_end_matches('\r')) {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let value: Value = serde_json::from_str(data)
            .map_err(|err| AiError::Protocol(format!("invalid SSE JSON body: {err}")))?;
        match value["type"].as_str() {
            Some("response.output_text.delta") => {
                if let Some(delta) = value["delta"].as_str() {
                    output.push_str(delta);
                }
            }
            Some("response.output_text.done") => {
                if output.is_empty() {
                    if let Some(text) = value["text"].as_str() {
                        output.push_str(text);
                    }
                }
            }
            Some("response.completed") => {
                if output.is_empty() {
                    if let Some(text) = responses_output_text(&value["response"]) {
                        output.push_str(&text);
                    }
                }
            }
            Some("response.failed") | Some("error") => {
                return Err(AiError::Protocol(responses_error_message(&value)))
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn parse_responses_stream(raw: &str) -> Result<String, AiError> {
    let normalized = raw.replace("\r\n", "\n");
    let mut output = String::new();
    for frame in normalized
        .split("\n\n")
        .filter(|frame| !frame.trim().is_empty())
    {
        process_responses_event(frame, &mut output)?;
    }
    if output.is_empty() {
        return Err(AiError::Protocol(
            "missing response.output_text.delta".to_string(),
        ));
    }
    Ok(output)
}

fn sse_delimiter(buffer: &[u8]) -> Option<(usize, usize)> {
    if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
        return Some((index, 4));
    }
    buffer
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|index| (index, 2))
}

pub(super) async fn send_responses_stream(
    http: &reqwest::Client,
    config: &ChatConfig,
    body: &Value,
) -> Result<String, AiError> {
    let url = format!("{}/v1/responses", config.base_url);
    let mut request = http
        .post(url)
        .timeout(std::time::Duration::from_secs(120))
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(body);
    if let Some(key) = &config.api_key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await?;
    match response.status().as_u16() {
        200 => {
            let mut output = String::new();
            let mut buffer = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(AiError::from)?;
                buffer.extend_from_slice(&chunk);
                while let Some((frame_end, delimiter_len)) = sse_delimiter(&buffer) {
                    let frame = String::from_utf8_lossy(&buffer[..frame_end]).to_string();
                    buffer.drain(..frame_end + delimiter_len);
                    process_responses_event(&frame, &mut output)?;
                }
            }
            if !buffer.is_empty() {
                let frame = String::from_utf8_lossy(&buffer).to_string();
                process_responses_event(&frame, &mut output)?;
            }
            if output.is_empty() {
                return Err(AiError::Protocol(
                    "missing response.output_text.delta".to_string(),
                ));
            }
            Ok(output)
        }
        401 | 403 => Err(AiError::Unauthorized),
        429 => Err(AiError::RateLimited),
        status => {
            let body = response.text().await.unwrap_or_default();
            Err(AiError::Protocol(format!("HTTP {status}: {body}")))
        }
    }
}
