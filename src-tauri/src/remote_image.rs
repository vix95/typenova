//! Fetching a picture from the web for the "copy image" command.
//!
//! The web view cannot copy a picture that comes from another site: drawing it on a canvas marks the canvas as tainted and reading it back fails with a
//! security error. The program fetches the bytes itself and the page decodes them, so the canvas stays clean.

use std::io::Read;
use std::time::Duration;

/// The largest picture that is fetched.
const MAX_BYTES: u64 = 25_000_000;

fn fetch(url: &str) -> Result<Vec<u8>, String> {
  if !(url.starts_with("https://") || url.starts_with("http://")) {
    return Err("only http and https addresses can be fetched".to_string());
  }
  let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).redirects(5).build();
  let response = agent.get(url).call().map_err(|error| error.to_string())?;
  let kind = response.content_type().to_string();
  if !kind.starts_with("image/") {
    return Err(format!("the address is not a picture ({kind})"));
  }
  let mut bytes = Vec::new();
  response.into_reader().take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
  if bytes.len() as u64 > MAX_BYTES {
    return Err("the picture is too big".to_string());
  }
  Ok(bytes)
}

/// The bytes of a picture on the web (raw, not as a list of numbers).
#[tauri::command]
pub async fn fetch_remote_image(url: String) -> Result<tauri::ipc::Response, String> {
  tauri::async_runtime::spawn_blocking(move || fetch(&url).map(tauri::ipc::Response::new)).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
  use super::fetch;

  #[test]
  fn only_web_addresses_are_fetched() {
    assert!(fetch("file:///C:/secret.png").is_err());
    assert!(fetch("ftp://example.com/a.png").is_err());
    assert!(fetch("C:\\a.png").is_err());
  }
}
