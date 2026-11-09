//! Ollama: a model that runs on this computer or in the local network. No key.

use super::{agent, api_messages, classify, failure, failure_from_ureq, read_stream, stop_reason_of, tidy, AiFailure, ChatRequest, Piece};
use serde_json::{json, Value};
use std::io::BufReader;
use std::sync::atomic::AtomicBool;

/// A line of the stream (one JSON object per line).
fn parse_line(line: &str) -> Vec<Piece> {
  let Ok(value) = serde_json::from_str::<Value>(line.trim()) else { return Vec::new() };
  if let Some(message) = value["error"].as_str() {
    return vec![Piece::Fail(failure(if message.contains("not found") { "model_missing" } else { "api" }, None, message))];
  }
  let mut pieces = Vec::new();
  if let Some(text) = value["message"]["content"].as_str() {
    if !text.is_empty() {
      pieces.push(Piece::Text(text.to_string()));
    }
  }
  if value["done"] == true {
    pieces.push(Piece::Stop(stop_reason_of(value["done_reason"].as_str().unwrap_or("stop")).into()));
  }
  pieces
}

pub(super) fn chat(base: &str, _key: Option<&str>, request: &ChatRequest, cancel: &AtomicBool, send: &dyn Fn(String)) -> Result<String, AiFailure> {
  let mut messages = vec![json!({ "role": "system", "content": request.system })];
  messages.extend(api_messages(request));
  let body = json!({ "model": request.model, "messages": messages, "stream": true });
  // The first word can take long to come when the model has to be loaded into memory.
  let response = agent(5, 600).post(&format!("{base}/api/chat")).set("content-type", "application/json").send_json(body).map_err(failure_from_ureq)?;
  read_stream(BufReader::new(response.into_reader()), parse_line, cancel, send)
}

pub(super) fn models(base: &str, _key: Option<&str>) -> Result<Vec<String>, AiFailure> {
  let response = agent(4, 8).get(&format!("{base}/api/tags")).call().map_err(failure_from_ureq)?;
  let value: Value = response.into_json().map_err(|error| classify(None, &Value::Null, &error.to_string()))?;
  Ok(tidy(value["models"].as_array().map(|items| items.iter().filter_map(|item| item["name"].as_str().map(str::to_string)).collect()).unwrap_or_default()))
}

#[cfg(test)]
mod tests {
  use super::super::test_support::{closed_address, collect, request, serve_once};
  use super::*;

  #[test]
  fn lines_give_text_and_the_end() {
    assert_eq!(parse_line(r#"{"message":{"role":"assistant","content":"Hel"},"done":false}"#), vec![Piece::Text("Hel".into())]);
    assert_eq!(parse_line(r#"{"message":{"content":""},"done":true,"done_reason":"length"}"#), vec![Piece::Stop("max_tokens".into())]);
    assert_eq!(parse_line(r#"{"done":true,"done_reason":"stop"}"#), vec![Piece::Stop("end".into())]);
    assert_eq!(parse_line(r#"{"error":"model 'x' not found"}"#), vec![Piece::Fail(failure("model_missing", None, "model 'x' not found"))]);
  }

  #[test]
  fn an_answer_is_streamed() {
    let body = "{\"message\":{\"role\":\"assistant\",\"content\":\"Dzień \"},\"done\":false}\n{\"message\":{\"role\":\"assistant\",\"content\":\"dobry\"},\"done\":false}\n{\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done\":true,\"done_reason\":\"stop\"}\n";
    let (base, server) = serve_once("200 OK", body);
    let (result, text) = collect(|send| chat(&base, None, &request("ollama"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap(), "end");
    assert_eq!(text, "Dzień dobry");
    let received = server.join().unwrap();
    assert!(received.contains("POST /api/chat") && received.contains("\"role\":\"system\""), "{received}");
  }

  #[test]
  fn a_missing_model_and_a_closed_port_are_reported() {
    let (base, server) = serve_once("404 Not Found", "{\"error\":\"model \\\"nope\\\" not found, try pulling it first\"}");
    let (result, _) = collect(|send| chat(&base, None, &request("ollama"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap_err().kind, "model_missing");
    server.join().unwrap();
    let (result, _) = collect(|send| chat(&closed_address(), None, &request("ollama"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap_err().kind, "connection");
  }

  #[test]
  fn a_cancelled_answer_stops_early() {
    let body = "{\"message\":{\"content\":\"a\"},\"done\":false}\n{\"message\":{\"content\":\"b\"},\"done\":false}\n";
    let (base, server) = serve_once("200 OK", body);
    let cancel = AtomicBool::new(true);
    let (result, text) = collect(|send| chat(&base, None, &request("ollama"), &cancel, send));
    assert_eq!(result.unwrap(), "cancelled");
    assert!(text.is_empty());
    server.join().unwrap();
  }

  #[test]
  fn models_are_listed() {
    let (base, server) = serve_once("200 OK", "{\"models\":[{\"name\":\"llama3.2:3b\"},{\"name\":\"bielik:11b\"},{\"name\":\"llama3.2:3b\"}]}");
    assert_eq!(models(&base, None).unwrap(), vec!["bielik:11b".to_string(), "llama3.2:3b".to_string()]);
    server.join().unwrap();
  }
}
