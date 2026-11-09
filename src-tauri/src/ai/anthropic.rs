//! Claude, through the Anthropic API.

use super::{agent, api_messages, classify, failure, failure_from_ureq, kind_of_error_type, read_stream, sse_data, stop_reason_of, tidy, AiFailure, ChatRequest, Piece};
use serde_json::{json, Value};
use std::io::BufReader;
use std::sync::atomic::AtomicBool;

const VERSION: &str = "2023-06-01";
const MAX_OUTPUT_TOKENS: u32 = 32000;

/// A line of the stream (server-sent events): only `data:` lines carry something.
fn parse_line(line: &str) -> Vec<Piece> {
  let Some(data) = sse_data(line) else { return Vec::new() };
  let Ok(value) = serde_json::from_str::<Value>(data) else { return Vec::new() };
  match value["type"].as_str() {
    Some("content_block_delta") if value["delta"]["type"] == "text_delta" => value["delta"]["text"].as_str().map(|text| vec![Piece::Text(text.to_string())]).unwrap_or_default(),
    Some("message_delta") => value["delta"]["stop_reason"].as_str().map(|reason| vec![Piece::Stop(stop_reason_of(reason).into())]).unwrap_or_default(),
    Some("error") => vec![Piece::Fail(failure(kind_of_error_type(value["error"]["type"].as_str().unwrap_or("")), None, value["error"]["message"].as_str().unwrap_or("error")))],
    _ => Vec::new(),
  }
}

pub(super) fn chat(base: &str, key: Option<&str>, request: &ChatRequest, cancel: &AtomicBool, send: &dyn Fn(String)) -> Result<String, AiFailure> {
  let body = json!({
    "model": request.model,
    "max_tokens": MAX_OUTPUT_TOKENS,
    "stream": true,
    "system": request.system,
    "messages": api_messages(request),
    "output_config": { "effort": "medium" },
  });
  let response = agent(15, 180)
    .post(&format!("{base}/v1/messages"))
    .set("x-api-key", key.unwrap_or(""))
    .set("anthropic-version", VERSION)
    .set("content-type", "application/json")
    .send_json(body)
    .map_err(failure_from_ureq)?;
  read_stream(BufReader::new(response.into_reader()), parse_line, cancel, send)
}

pub(super) fn models(base: &str, key: Option<&str>) -> Result<Vec<String>, AiFailure> {
  let response = agent(8, 15)
    .get(&format!("{base}/v1/models?limit=1000"))
    .set("x-api-key", key.unwrap_or(""))
    .set("anthropic-version", VERSION)
    .call()
    .map_err(failure_from_ureq)?;
  let value: Value = response.into_json().map_err(|error| classify(None, &Value::Null, &error.to_string()))?;
  Ok(tidy(value["data"].as_array().map(|items| items.iter().filter_map(|item| item["id"].as_str().map(str::to_string)).collect()).unwrap_or_default()))
}

#[cfg(test)]
mod tests {
  use super::super::test_support::{collect, request, serve_once};
  use super::*;

  #[test]
  fn lines_give_text_and_the_end() {
    let text = parse_line(r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Cześć"}}"#);
    assert_eq!(text, vec![Piece::Text("Cześć".into())]);
    assert_eq!(parse_line(r#"data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}"#), vec![Piece::Stop("max_tokens".into())]);
    assert_eq!(parse_line(r#"data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}"#), vec![Piece::Stop("refusal".into())]);
    assert!(parse_line("event: ping").is_empty());
    assert!(parse_line(r#"data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"x"}}"#).is_empty());
    assert_eq!(parse_line(r#"data: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}"#), vec![Piece::Fail(failure("server", None, "busy"))]);
  }

  #[test]
  fn an_answer_is_streamed_with_the_key_in_the_header_only() {
    let body = "event: message_start\ndata: {\"type\":\"message_start\"}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Ala \"}}\n\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"ma kota\"}}\n\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n";
    let (base, server) = serve_once("200 OK", body);
    let (result, text) = collect(|send| chat(&base, Some("test-key-1234"), &request("anthropic"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap(), "end");
    assert_eq!(text, "Ala ma kota");
    let received = server.join().unwrap().to_ascii_lowercase();
    assert!(received.contains("x-api-key: test-key-1234"));
    assert!(received.contains("anthropic-version: 2023-06-01"));
    assert!(received.contains("post /v1/messages"));
    assert!(received.contains("\"stream\":true") && received.contains("\"model\":\"test-model\""));
  }

  #[test]
  fn a_rejected_key_is_reported() {
    let (base, server) = serve_once("401 Unauthorized", "{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"invalid x-api-key\"}}");
    let (result, text) = collect(|send| chat(&base, Some("bad"), &request("anthropic"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap_err(), failure("auth", Some(401), "invalid x-api-key"));
    assert!(text.is_empty());
    server.join().unwrap();
  }

  #[test]
  fn models_are_listed_with_the_key() {
    let (base, server) = serve_once("200 OK", "{\"data\":[{\"id\":\"claude-sonnet-5-5\"},{\"id\":\"claude-haiku-5-5\"}],\"has_more\":false}");
    assert_eq!(models(&base, Some("k-123")).unwrap(), vec!["claude-haiku-5-5".to_string(), "claude-sonnet-5-5".to_string()]);
    let received = server.join().unwrap().to_ascii_lowercase();
    assert!(received.contains("get /v1/models") && received.contains("x-api-key: k-123"));
  }
}
