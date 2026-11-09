//! The AI assistant's requests. One adapter per kind of service: Claude (the Anthropic API), OpenAI and everything that
//! speaks its protocol (OpenRouter, LM Studio, a company gateway…), Gemini (Google) and Ollama (a model on this computer
//! or in the local network). Each adapter lives in its own file and offers the same two things: `chat` (a streamed
//! answer) and `models` (the models the service offers, which is also how a connection is tested).
//!
//! The requests are made here and not in the webview, so that an API key stays in the backend: it is read from the
//! encrypted secret store (`secrets.rs`) at the moment of a request and is never given to the interface. The answer is
//! streamed to the interface piece by piece through a channel. Claude and Gemini are always contacted at their own
//! address; only OpenAI-compatible services and Ollama take an address from the user.

mod anthropic;
mod gemini;
mod ollama;
mod openai;
#[cfg(test)]
mod test_support;

use crate::secrets;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::AppHandle;
use zeroize::Zeroizing;

const MAX_MESSAGES: usize = 200;
const MAX_REQUEST_CHARS: usize = 4_000_000;
const MAX_ERROR_BODY: u64 = 16 * 1024;

#[derive(Deserialize, Debug, Clone)]
pub struct ChatMessage {
  pub role: String,
  pub content: String,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
  /// Chosen by the interface, so that a request can be cancelled.
  pub id: String,
  /// "anthropic", "openai", "gemini" or "ollama".
  pub adapter: String,
  pub model: String,
  pub system: String,
  pub messages: Vec<ChatMessage>,
  /// The address of the service (only OpenAI-compatible services and Ollama use it).
  pub base_url: Option<String>,
  /// The name of the stored API key to use.
  pub key_name: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
  Text { text: String },
}

/// How an answer ended: "end", "max_tokens", "refusal" or "cancelled".
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutcome {
  pub stop_reason: String,
}

/// Why a request failed, in a form the interface can turn into a message: `kind` is one of `no_key`, `auth`,
/// `permission`, `rate_limit`, `quota`, `bad_request`, `model_missing`, `connection`, `server`, `api`.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiFailure {
  pub kind: String,
  pub status: Option<u16>,
  pub message: String,
}

fn failure(kind: &str, status: Option<u16>, message: impl Into<String>) -> AiFailure {
  AiFailure { kind: kind.into(), status, message: message.into() }
}

/// What a line of a streamed answer says.
#[derive(Debug, PartialEq, Eq)]
enum Piece {
  Text(String),
  Stop(String),
  Fail(AiFailure),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Adapter {
  Anthropic,
  OpenAi,
  Gemini,
  Ollama,
}

const OPENAI_BASE: &str = "https://api.openai.com/v1";

impl Adapter {
  fn parse(name: &str) -> Result<Self, AiFailure> {
    match name {
      "anthropic" => Ok(Adapter::Anthropic),
      "openai" => Ok(Adapter::OpenAi),
      "gemini" => Ok(Adapter::Gemini),
      "ollama" => Ok(Adapter::Ollama),
      _ => Err(failure("bad_request", None, "Unknown provider.")),
    }
  }

  fn default_base(self) -> &'static str {
    match self {
      Adapter::Anthropic => "https://api.anthropic.com",
      Adapter::OpenAi => OPENAI_BASE,
      Adapter::Gemini => "https://generativelanguage.googleapis.com",
      Adapter::Ollama => "http://localhost:11434",
    }
  }

  /// Claude and Gemini are always contacted at their own address, so a key can never be sent elsewhere.
  fn base_is_fixed(self) -> bool { matches!(self, Adapter::Anthropic | Adapter::Gemini) }
}

/// An address as given by the user: an http or https address without a trailing slash; the default one when empty.
fn clean_base(url: Option<&str>, default: &str) -> Result<String, AiFailure> {
  let url = url.map(str::trim).filter(|value| !value.is_empty()).unwrap_or(default);
  if !(url.starts_with("http://") || url.starts_with("https://")) || url.contains(char::is_whitespace) {
    return Err(failure("bad_request", None, "The address must start with http:// or https://"));
  }
  Ok(url.trim_end_matches('/').to_string())
}

/// Where a request goes and with which key.
struct Target {
  adapter: Adapter,
  base: String,
  key: Option<Zeroizing<String>>,
}

/// Works out the address and reads the key. Claude and Gemini need a key; OpenAI needs one at its own address (a
/// service of the user's own may not); Ollama has none.
fn resolve(app: &AppHandle, adapter: &str, base_url: Option<&str>, key_name: Option<&str>) -> Result<Target, AiFailure> {
  let adapter = Adapter::parse(adapter)?;
  let base = if adapter.base_is_fixed() { adapter.default_base().to_string() } else { clean_base(base_url, adapter.default_base())? };
  let key = if adapter == Adapter::Ollama { None } else { key_name.and_then(|name| secrets::read_secret(app, name)) };
  let key_needed = matches!(adapter, Adapter::Anthropic | Adapter::Gemini) || (adapter == Adapter::OpenAi && base == OPENAI_BASE);
  if key_needed && key.is_none() {
    return Err(failure("no_key", None, "No API key is stored."));
  }
  Ok(Target { adapter, base, key })
}

fn stop_reason_of(reason: &str) -> &'static str {
  match reason {
    "max_tokens" | "length" => "max_tokens",
    "refusal" => "refusal",
    _ => "end",
  }
}

/// The text of a `data:` line of a server-sent-events stream.
fn sse_data(line: &str) -> Option<&str> { line.strip_prefix("data:").map(str::trim) }

fn kind_of_error_type(error_type: &str) -> &'static str {
  match error_type {
    "authentication_error" => "auth",
    "permission_error" => "permission",
    "rate_limit_error" => "rate_limit",
    "invalid_request_error" => "bad_request",
    "not_found_error" => "model_missing",
    "overloaded_error" | "api_error" => "server",
    _ => "api",
  }
}

/// The failure described by an error object, as Claude, OpenAI and Google send them (each names the reason differently).
fn classify(status: Option<u16>, value: &Value, fallback: &str) -> AiFailure {
  let error = &value["error"];
  let message = error["message"].as_str().or_else(|| error.as_str()).unwrap_or(fallback.trim()).to_string();
  let code = error["code"].as_str().unwrap_or("");
  let google = error["status"].as_str().unwrap_or("");
  let kind = if code == "insufficient_quota" {
    "quota"
  } else if code == "invalid_api_key" || google == "UNAUTHENTICATED" || message.contains("API key not valid") {
    "auth"
  } else if code == "model_not_found" || google == "NOT_FOUND" {
    "model_missing"
  } else if google == "PERMISSION_DENIED" {
    "permission"
  } else if google == "RESOURCE_EXHAUSTED" {
    "rate_limit"
  } else {
    match status {
      Some(401) => "auth",
      Some(403) => "permission",
      Some(404) => "model_missing",
      Some(429) => "rate_limit",
      Some(400 | 413 | 422) => "bad_request",
      Some(500..=599) => "server",
      _ => error["type"].as_str().map(kind_of_error_type).unwrap_or("api"),
    }
  };
  failure(kind, status, message)
}

/// The failure for an HTTP error status, with the reason the service gave in the body.
fn failure_from_response(status: u16, body: &str) -> AiFailure {
  let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
  classify(Some(status), &value, body)
}

fn failure_from_ureq(error: ureq::Error) -> AiFailure {
  match error {
    ureq::Error::Status(status, response) => {
      let mut body = String::new();
      let _ = response.into_reader().take(MAX_ERROR_BODY).read_to_string(&mut body);
      failure_from_response(status, &body)
    }
    ureq::Error::Transport(transport) => failure("connection", None, transport.to_string()),
  }
}

fn agent(connect_secs: u64, read_secs: u64) -> ureq::Agent {
  ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(connect_secs)).timeout_read(Duration::from_secs(read_secs)).build()
}

/// Reads a streamed answer line by line, sending the text as it arrives; returns how the answer ended.
fn read_stream(reader: impl BufRead, parse: fn(&str) -> Vec<Piece>, cancel: &AtomicBool, send: &dyn Fn(String)) -> Result<String, AiFailure> {
  let mut stop = String::from("end");
  for line in reader.lines() {
    if cancel.load(Ordering::Relaxed) {
      return Ok("cancelled".into());
    }
    let line = line.map_err(|error| failure("connection", None, error.to_string()))?;
    for piece in parse(&line) {
      match piece {
        Piece::Text(text) => send(text),
        Piece::Stop(reason) => stop = reason,
        Piece::Fail(error) => return Err(error),
      }
    }
  }
  Ok(stop)
}

/// The conversation in the shape most services use: a role and a text.
fn api_messages(request: &ChatRequest) -> Vec<Value> {
  request.messages.iter().map(|message| json!({ "role": message.role, "content": message.content })).collect()
}

/// A sorted list of names without repeats.
fn tidy(mut names: Vec<String>) -> Vec<String> {
  names.sort();
  names.dedup();
  names
}

fn validate(request: &ChatRequest) -> Result<(), AiFailure> {
  let size: usize = request.system.chars().count() + request.messages.iter().map(|message| message.content.chars().count()).sum::<usize>();
  let roles_ok = request.messages.iter().all(|message| message.role == "user" || message.role == "assistant");
  if request.model.trim().is_empty() || request.messages.is_empty() || request.messages.len() > MAX_MESSAGES || size > MAX_REQUEST_CHARS || !roles_ok {
    return Err(failure("bad_request", None, "The request is empty or too large."));
  }
  Ok(())
}

fn cancels() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
  static CANCELS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
  CANCELS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registers a request for cancelling, and forgets it when it ends.
struct Registered(String);
impl Registered {
  fn new(id: &str) -> (Self, Arc<AtomicBool>) {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = cancels().lock() {
      map.insert(id.to_string(), flag.clone());
    }
    (Registered(id.to_string()), flag)
  }
}
impl Drop for Registered {
  fn drop(&mut self) {
    if let Ok(mut map) = cancels().lock() {
      map.remove(&self.0);
    }
  }
}

fn run_chat(app: &AppHandle, request: ChatRequest, channel: Channel<ChatEvent>) -> Result<ChatOutcome, AiFailure> {
  validate(&request)?;
  let target = resolve(app, &request.adapter, request.base_url.as_deref(), request.key_name.as_deref())?;
  let (_registered, cancel) = Registered::new(&request.id);
  let send = |text: String| {
    let _ = channel.send(ChatEvent::Text { text });
  };
  let key = target.key.as_ref().map(|key| key.as_str());
  let stop = match target.adapter {
    Adapter::Anthropic => anthropic::chat(&target.base, key, &request, &cancel, &send)?,
    Adapter::OpenAi => openai::chat(&target.base, key, &request, &cancel, &send)?,
    Adapter::Gemini => gemini::chat(&target.base, key, &request, &cancel, &send)?,
    Adapter::Ollama => ollama::chat(&target.base, key, &request, &cancel, &send)?,
  };
  Ok(ChatOutcome { stop_reason: stop })
}

/// Sends a conversation to the chosen provider and streams the answer through `on_event`.
#[tauri::command]
pub async fn ai_chat(app: AppHandle, request: ChatRequest, on_event: Channel<ChatEvent>) -> Result<ChatOutcome, AiFailure> {
  tauri::async_runtime::spawn_blocking(move || run_chat(&app, request, on_event))
    .await
    .map_err(|error| failure("api", None, error.to_string()))?
}

/// Asks a running request to stop; its answer ends at the next piece that arrives.
#[tauri::command]
pub fn ai_cancel(id: String) {
  if let Ok(map) = cancels().lock() {
    if let Some(flag) = map.get(&id) {
      flag.store(true, Ordering::Relaxed);
    }
  }
}

fn run_models(app: &AppHandle, adapter: &str, base_url: Option<&str>, key_name: Option<&str>) -> Result<Vec<String>, AiFailure> {
  let target = resolve(app, adapter, base_url, key_name)?;
  let key = target.key.as_ref().map(|key| key.as_str());
  match target.adapter {
    Adapter::Anthropic => anthropic::models(&target.base, key),
    Adapter::OpenAi => openai::models(&target.base, key),
    Adapter::Gemini => gemini::models(&target.base, key),
    Adapter::Ollama => ollama::models(&target.base, key),
  }
}

/// The models a service offers. It asks the service itself, so it also shows whether the address and the key work:
/// this is what "Check the connection" does.
#[tauri::command]
pub async fn ai_list_models(app: AppHandle, adapter: String, base_url: Option<String>, key_name: Option<String>) -> Result<Vec<String>, AiFailure> {
  tauri::async_runtime::spawn_blocking(move || run_models(&app, &adapter, base_url.as_deref(), key_name.as_deref()))
    .await
    .map_err(|error| failure("api", None, error.to_string()))?
}

#[cfg(test)]
mod tests {
  use super::test_support::request;
  use super::*;

  #[test]
  fn http_errors_are_classified() {
    assert_eq!(failure_from_response(401, r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#), failure("auth", Some(401), "invalid x-api-key"));
    assert_eq!(failure_from_response(429, "{}").kind, "rate_limit");
    assert_eq!(failure_from_response(404, r#"{"error":"model \"x\" not found, try pulling it first"}"#).kind, "model_missing");
    assert_eq!(failure_from_response(529, "overloaded").kind, "server");
    assert_eq!(failure_from_response(400, r#"{"error":{"type":"invalid_request_error","message":"bad"}}"#).message, "bad");
  }

  #[test]
  fn openai_and_google_errors_are_classified() {
    assert_eq!(failure_from_response(401, r#"{"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key"}}"#).kind, "auth");
    assert_eq!(failure_from_response(429, r#"{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}"#).kind, "quota");
    assert_eq!(failure_from_response(404, r#"{"error":{"message":"The model `x` does not exist","code":"model_not_found"}}"#).kind, "model_missing");
    // Google answers a wrong key with 400, so the status text decides.
    assert_eq!(failure_from_response(400, r#"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}"#).kind, "auth");
    assert_eq!(failure_from_response(403, r#"{"error":{"code":403,"message":"denied","status":"PERMISSION_DENIED"}}"#).kind, "permission");
    assert_eq!(failure_from_response(429, r#"{"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}"#).kind, "rate_limit");
    assert_eq!(failure_from_response(404, r#"{"error":{"code":404,"message":"models/x is not found","status":"NOT_FOUND"}}"#).kind, "model_missing");
    assert_eq!(failure_from_response(500, "<html>oops</html>").kind, "server");
  }

  #[test]
  fn an_address_is_checked() {
    assert_eq!(clean_base(None, "http://localhost:11434").unwrap(), "http://localhost:11434");
    assert_eq!(clean_base(Some("  http://192.168.0.5:11434/ "), "x").unwrap(), "http://192.168.0.5:11434");
    assert_eq!(clean_base(Some("https://openrouter.ai/api/v1/"), "x").unwrap(), "https://openrouter.ai/api/v1");
    assert!(clean_base(Some("ftp://host"), "x").is_err());
    assert!(clean_base(Some("localhost:11434"), "x").is_err());
    assert!(clean_base(Some("http://a b"), "x").is_err());
  }

  #[test]
  fn adapters_are_known_and_two_have_fixed_addresses() {
    assert!(Adapter::parse("anthropic").unwrap().base_is_fixed());
    assert!(Adapter::parse("gemini").unwrap().base_is_fixed());
    assert!(!Adapter::parse("openai").unwrap().base_is_fixed());
    assert!(!Adapter::parse("ollama").unwrap().base_is_fixed());
    assert!(Adapter::parse("other").is_err());
  }

  #[test]
  fn requests_are_validated() {
    assert!(validate(&request("anthropic")).is_ok());
    let mut empty = request("anthropic");
    empty.messages.clear();
    assert!(validate(&empty).is_err());
    let mut odd = request("anthropic");
    odd.messages[0].role = "system".into();
    assert!(validate(&odd).is_err());
  }

  #[test]
  fn names_are_sorted_without_repeats() {
    assert_eq!(tidy(vec!["b".into(), "a".into(), "b".into()]), vec!["a".to_string(), "b".to_string()]);
  }
}
