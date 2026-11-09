//! Helpers for the tests of the adapters: a one-shot local server and a collector of the streamed text.

use super::{AiFailure, ChatMessage, ChatRequest};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;

pub fn request(adapter: &str) -> ChatRequest {
  ChatRequest {
    id: "t".into(),
    adapter: adapter.into(),
    model: "test-model".into(),
    system: "be brief".into(),
    messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }, ChatMessage { role: "assistant".into(), content: "hello".into() }],
    base_url: None,
    key_name: None,
  }
}

/// A server that answers one request with the given status line and body, and returns what it received.
pub fn serve_once(status: &str, body: &'static str) -> (String, std::thread::JoinHandle<String>) {
  let listener = TcpListener::bind("127.0.0.1:0").unwrap();
  let address = format!("http://{}", listener.local_addr().unwrap());
  let status = status.to_string();
  let handle = std::thread::spawn(move || {
    let (mut stream, _) = listener.accept().unwrap();
    let mut received = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
      let count = stream.read(&mut buffer).unwrap();
      received.extend_from_slice(&buffer[..count]);
      let text = String::from_utf8_lossy(&received).to_string();
      if let Some(split) = text.find("\r\n\r\n") {
        let length = text.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|value| value.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
        if received.len() >= split + 4 + length {
          break;
        }
      }
      if count == 0 {
        break;
      }
    }
    write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}").unwrap();
    String::from_utf8_lossy(&received).to_string()
  });
  (address, handle)
}

/// An address where nothing listens.
pub fn closed_address() -> String {
  let listener = TcpListener::bind("127.0.0.1:0").unwrap();
  format!("http://{}", listener.local_addr().unwrap())
}

/// Runs a call and returns its result together with all the text it sent.
pub fn collect(run: impl FnOnce(&dyn Fn(String)) -> Result<String, AiFailure>) -> (Result<String, AiFailure>, String) {
  let text = Mutex::new(String::new());
  let result = run(&|piece| text.lock().unwrap().push_str(&piece));
  let collected = text.lock().unwrap().clone();
  (result, collected)
}
