//! OpenAI and every service that speaks the same protocol (chat completions): OpenRouter, LM Studio, llama.cpp,
//! a company gateway… The address is the user's; the key is optional for a service of their own.

use super::{agent, api_messages, classify, failure_from_ureq, read_stream, sse_data, tidy, AiFailure, ChatRequest, Piece};
use serde_json::{json, Value};
use std::io::BufReader;
use std::sync::atomic::AtomicBool;

/// Models that are not for chatting (they would only confuse the list).
const NOT_FOR_CHAT: [&str; 10] = ["embedding", "embed", "tts", "whisper", "dall-e", "moderation", "transcribe", "realtime", "image", "audio"];

/// A line of the stream (server-sent events): the text is in the first choice, the end in its finish reason.
fn parse_line(line: &str) -> Vec<Piece> {
  let Some(data) = sse_data(line) else { return Vec::new() };
  if data == "[DONE]" {
    return Vec::new();
  }
  let Ok(value) = serde_json::from_str::<Value>(data) else { return Vec::new() };
  if value["error"].is_object() {
    return vec![Piece::Fail(classify(None, &value, "error"))];
  }
  let choice = &value["choices"][0];
  let mut pieces = Vec::new();
  if let Some(text) = choice["delta"]["content"].as_str() {
    if !text.is_empty() {
      pieces.push(Piece::Text(text.to_string()));
    }
  }
  if let Some(reason) = choice["finish_reason"].as_str() {
    pieces.push(Piece::Stop(match reason {
      "length" => "max_tokens",
      "content_filter" => "refusal",
      _ => "end",
    }.into()));
  }
  pieces
}

fn authorized(request: ureq::Request, key: Option<&str>) -> ureq::Request {
  match key {
    Some(key) if !key.is_empty() => request.set("authorization", &format!("Bearer {key}")),
    _ => request,
  }
}

pub(super) fn chat(base: &str, key: Option<&str>, request: &ChatRequest, cancel: &AtomicBool, send: &dyn Fn(String)) -> Result<String, AiFailure> {
  let mut messages = vec![json!({ "role": "system", "content": request.system })];
  messages.extend(api_messages(request));
  let body = json!({ "model": request.model, "messages": messages, "stream": true });
  // A model of the user's own (LM Studio…) can take long to load before the first word comes.
  let response = authorized(agent(15, 600).post(&format!("{base}/chat/completions")).set("content-type", "application/json"), key)
    .send_json(body)
    .map_err(failure_from_ureq)?;
  read_stream(BufReader::new(response.into_reader()), parse_line, cancel, send)
}

pub(super) fn models(base: &str, key: Option<&str>) -> Result<Vec<String>, AiFailure> {
  let response = authorized(agent(8, 15).get(&format!("{base}/models")), key).call().map_err(failure_from_ureq)?;
  let value: Value = response.into_json().map_err(|error| classify(None, &Value::Null, &error.to_string()))?;
  let all = tidy(value["data"].as_array().map(|items| items.iter().filter_map(|item| item["id"].as_str().map(str::to_string)).collect()).unwrap_or_default());
  let chat: Vec<String> = all.iter().filter(|name| !NOT_FOR_CHAT.iter().any(|word| name.to_ascii_lowercase().contains(word))).cloned().collect();
  // A service with unusual names keeps its whole list rather than an empty one.
  Ok(if chat.is_empty() { all } else { chat })
}

#[cfg(test)]
mod tests {
  use super::super::test_support::{closed_address, collect, request, serve_once};
  use super::*;

  #[test]
  fn lines_give_text_and_the_end() {
    assert_eq!(parse_line(r#"data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Hej"},"finish_reason":null}]}"#), vec![Piece::Text("Hej".into())]);
    assert_eq!(parse_line(r#"data: {"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}"#), vec![Piece::Stop("max_tokens".into())]);
    assert_eq!(parse_line(r#"data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}"#), vec![Piece::Stop("refusal".into())]);
    assert_eq!(parse_line(r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#), vec![Piece::Stop("end".into())]);
    assert!(parse_line("data: [DONE]").is_empty());
    assert!(parse_line(r#"data: {"choices":[],"usage":{"total_tokens":3}}"#).is_empty());
    assert!(parse_line(": keep-alive").is_empty());
    assert_eq!(parse_line(r#"data: {"error":{"message":"bad key","code":"invalid_api_key"}}"#), vec![Piece::Fail(AiFailure { kind: "auth".into(), status: None, message: "bad key".into() })]);
  }

  #[test]
  fn an_answer_is_streamed_with_a_bearer_key() {
    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Dzień \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"dobry\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let (base, server) = serve_once("200 OK", body);
    let (result, text) = collect(|send| chat(&base, Some("sk-test-1234"), &request("openai"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap(), "end");
    assert_eq!(text, "Dzień dobry");
    let received = server.join().unwrap();
    let lower = received.to_ascii_lowercase();
    assert!(lower.contains("post /chat/completions") && lower.contains("authorization: bearer sk-test-1234"), "{received}");
    assert!(received.contains("\"role\":\"system\"") && received.contains("\"stream\":true"));
  }

  #[test]
  fn a_service_without_a_key_gets_no_authorization_header() {
    let (base, server) = serve_once("200 OK", "data: {\"choices\":[{\"delta\":{\"content\":\"x\"},\"finish_reason\":\"stop\"}]}\n\n");
    let (result, _) = collect(|send| chat(&base, None, &request("openai"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap(), "end");
    assert!(!server.join().unwrap().to_ascii_lowercase().contains("authorization"));
  }

  #[test]
  fn a_wrong_key_a_missing_model_and_a_closed_port_are_reported() {
    let (base, server) = serve_once("401 Unauthorized", "{\"error\":{\"message\":\"Incorrect API key provided\",\"code\":\"invalid_api_key\"}}");
    let (result, _) = collect(|send| chat(&base, Some("bad"), &request("openai"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap_err().kind, "auth");
    server.join().unwrap();
    let (base, server) = serve_once("404 Not Found", "{\"error\":{\"message\":\"The model `x` does not exist\",\"code\":\"model_not_found\"}}");
    let (result, _) = collect(|send| chat(&base, Some("k"), &request("openai"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap_err().kind, "model_missing");
    server.join().unwrap();
    let (result, _) = collect(|send| chat(&closed_address(), None, &request("openai"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap_err().kind, "connection");
  }

  #[test]
  fn models_are_listed_without_the_ones_that_do_not_chat() {
    let (base, server) = serve_once("200 OK", "{\"object\":\"list\",\"data\":[{\"id\":\"gpt-5\"},{\"id\":\"text-embedding-3-small\"},{\"id\":\"whisper-1\"},{\"id\":\"gpt-4o-mini\"},{\"id\":\"gpt-5\"}]}");
    assert_eq!(models(&base, Some("k-1")).unwrap(), vec!["gpt-4o-mini".to_string(), "gpt-5".to_string()]);
    assert!(server.join().unwrap().to_ascii_lowercase().contains("get /models"));
  }

  #[test]
  fn a_service_with_unusual_names_keeps_its_list() {
    let (base, server) = serve_once("200 OK", "{\"data\":[{\"id\":\"my-embedding-chat\"},{\"id\":\"image-bot\"}]}");
    assert_eq!(models(&base, None).unwrap().len(), 2);
    server.join().unwrap();
  }
}
