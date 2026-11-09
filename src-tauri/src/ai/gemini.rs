//! Gemini, through the Google Generative Language API. The key goes in a header, never in the address.

use super::{agent, classify, failure, failure_from_ureq, read_stream, sse_data, tidy, AiFailure, ChatRequest, Piece};
use serde_json::{json, Value};
use std::io::BufReader;
use std::sync::atomic::AtomicBool;

/// Why Gemini stopped: a finished answer, a cut one, or one it declined to give.
fn stop_of(reason: &str) -> Option<&'static str> {
  match reason {
    "" | "FINISH_REASON_UNSPECIFIED" => None,
    "STOP" | "OTHER" | "MALFORMED_FUNCTION_CALL" => Some("end"),
    "MAX_TOKENS" => Some("max_tokens"),
    _ => Some("refusal"),
  }
}

/// A line of the stream (server-sent events): the text is in the parts of the first candidate.
fn parse_line(line: &str) -> Vec<Piece> {
  let Some(data) = sse_data(line) else { return Vec::new() };
  let Ok(value) = serde_json::from_str::<Value>(data) else { return Vec::new() };
  if value["error"].is_object() {
    return vec![Piece::Fail(classify(None, &value, "error"))];
  }
  let mut pieces = Vec::new();
  if value["promptFeedback"]["blockReason"].is_string() {
    pieces.push(Piece::Stop("refusal".into()));
  }
  let candidate = &value["candidates"][0];
  for part in candidate["content"]["parts"].as_array().map(Vec::as_slice).unwrap_or_default() {
    // A part marked as a thought is the model's reasoning, not the answer.
    if part["thought"] == true {
      continue;
    }
    if let Some(text) = part["text"].as_str().filter(|text| !text.is_empty()) {
      pieces.push(Piece::Text(text.to_string()));
    }
  }
  if let Some(stop) = candidate["finishReason"].as_str().and_then(stop_of) {
    pieces.push(Piece::Stop(stop.into()));
  }
  pieces
}

/// Only characters a model name has, so that it cannot change the address it is put in.
fn valid_model(name: &str) -> bool { !name.is_empty() && name.len() <= 100 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) }

pub(super) fn chat(base: &str, key: Option<&str>, request: &ChatRequest, cancel: &AtomicBool, send: &dyn Fn(String)) -> Result<String, AiFailure> {
  let model = request.model.trim().trim_start_matches("models/");
  if !valid_model(model) {
    return Err(failure("bad_request", None, "The model name is not valid."));
  }
  let contents: Vec<Value> = request
    .messages
    .iter()
    .map(|message| json!({ "role": if message.role == "assistant" { "model" } else { "user" }, "parts": [{ "text": message.content }] }))
    .collect();
  let body = json!({ "systemInstruction": { "parts": [{ "text": request.system }] }, "contents": contents });
  let response = agent(15, 180)
    .post(&format!("{base}/v1beta/models/{model}:streamGenerateContent?alt=sse"))
    .set("x-goog-api-key", key.unwrap_or(""))
    .set("content-type", "application/json")
    .send_json(body)
    .map_err(failure_from_ureq)?;
  read_stream(BufReader::new(response.into_reader()), parse_line, cancel, send)
}

pub(super) fn models(base: &str, key: Option<&str>) -> Result<Vec<String>, AiFailure> {
  let response = agent(8, 15).get(&format!("{base}/v1beta/models?pageSize=1000")).set("x-goog-api-key", key.unwrap_or("")).call().map_err(failure_from_ureq)?;
  let value: Value = response.into_json().map_err(|error| classify(None, &Value::Null, &error.to_string()))?;
  let names = value["models"]
    .as_array()
    .map(|items| {
      items
        .iter()
        .filter(|item| item["supportedGenerationMethods"].as_array().is_some_and(|methods| methods.iter().any(|method| method == "generateContent")))
        .filter_map(|item| item["name"].as_str().map(|name| name.trim_start_matches("models/").to_string()))
        .collect()
    })
    .unwrap_or_default();
  Ok(tidy(names))
}

#[cfg(test)]
mod tests {
  use super::super::test_support::{collect, request, serve_once};
  use super::*;

  #[test]
  fn lines_give_text_and_the_end() {
    assert_eq!(parse_line(r#"data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Cześć"}]}}]}"#), vec![Piece::Text("Cześć".into())]);
    assert_eq!(parse_line(r#"data: {"candidates":[{"content":{"parts":[{"text":"!"}]},"finishReason":"STOP"}]}"#), vec![Piece::Text("!".into()), Piece::Stop("end".into())]);
    assert_eq!(parse_line(r#"data: {"candidates":[{"finishReason":"MAX_TOKENS"}]}"#), vec![Piece::Stop("max_tokens".into())]);
    assert_eq!(parse_line(r#"data: {"candidates":[{"finishReason":"SAFETY"}]}"#), vec![Piece::Stop("refusal".into())]);
    assert_eq!(parse_line(r#"data: {"promptFeedback":{"blockReason":"PROHIBITED_CONTENT"}}"#), vec![Piece::Stop("refusal".into())]);
    assert!(parse_line(r#"data: {"candidates":[{"content":{"parts":[{"text":"thinking…","thought":true}]}}]}"#).is_empty(), "the model's reasoning is not shown");
    assert!(parse_line("").is_empty());
    assert_eq!(parse_line(r#"data: {"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}"#), vec![Piece::Fail(AiFailure { kind: "auth".into(), status: None, message: "API key not valid. Please pass a valid API key.".into() })]);
  }

  #[test]
  fn model_names_cannot_change_the_address() {
    assert!(valid_model("gemini-2.5-pro"));
    assert!(valid_model("gemini-1.5-flash-001"));
    assert!(!valid_model("x/../y"));
    assert!(!valid_model("a?b=c"));
    assert!(!valid_model(""));
  }

  #[test]
  fn an_answer_is_streamed_with_the_key_in_a_header() {
    let body = "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"Ala \"}]}}]}\n\ndata: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"ma kota\"}]},\"finishReason\":\"STOP\"}]}\n\n";
    let (base, server) = serve_once("200 OK", body);
    let mut req = request("gemini");
    req.model = "models/gemini-2.5-flash".into();
    let (result, text) = collect(|send| chat(&base, Some("AIza-test-1234"), &req, &AtomicBool::new(false), send));
    assert_eq!(result.unwrap(), "end");
    assert_eq!(text, "Ala ma kota");
    let received = server.join().unwrap();
    let lower = received.to_ascii_lowercase();
    assert!(lower.contains("post /v1beta/models/gemini-2.5-flash:streamgeneratecontent?alt=sse"), "{received}");
    assert!(lower.contains("x-goog-api-key: aiza-test-1234"));
    assert!(!lower.lines().next().unwrap().contains("aiza"), "the key is not in the address");
    assert!(received.contains("\"systemInstruction\"") && received.contains("\"role\":\"model\"") && received.contains("\"role\":\"user\""));
  }

  #[test]
  fn a_wrong_key_is_reported_although_google_answers_400() {
    let (base, server) = serve_once("400 Bad Request", "{\"error\":{\"code\":400,\"message\":\"API key not valid. Please pass a valid API key.\",\"status\":\"INVALID_ARGUMENT\"}}");
    let (result, _) = collect(|send| chat(&base, Some("bad"), &request("gemini"), &AtomicBool::new(false), send));
    assert_eq!(result.unwrap_err().kind, "auth");
    server.join().unwrap();
  }

  #[test]
  fn a_bad_model_name_is_refused_before_any_request() {
    let mut req = request("gemini");
    req.model = "x/../y".into();
    let (result, _) = collect(|send| chat("http://127.0.0.1:1", Some("k"), &req, &AtomicBool::new(false), send));
    assert_eq!(result.unwrap_err().kind, "bad_request");
  }

  #[test]
  fn only_models_that_generate_text_are_listed() {
    let body = "{\"models\":[{\"name\":\"models/gemini-2.5-pro\",\"supportedGenerationMethods\":[\"generateContent\",\"countTokens\"]},{\"name\":\"models/text-embedding-004\",\"supportedGenerationMethods\":[\"embedContent\"]},{\"name\":\"models/gemini-2.5-flash\",\"supportedGenerationMethods\":[\"generateContent\"]}]}";
    let (base, server) = serve_once("200 OK", body);
    assert_eq!(models(&base, Some("k")).unwrap(), vec!["gemini-2.5-flash".to_string(), "gemini-2.5-pro".to_string()]);
    assert!(server.join().unwrap().to_ascii_lowercase().contains("get /v1beta/models?pagesize=1000"));
  }
}
