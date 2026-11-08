//! The `tnpage` URL scheme: serves the files of a previewed web page, so that its relative links (`css/style.css`, `../img/a.png`)
//! resolve the way they do in a browser. The asset protocol cannot do this, because it keeps a whole file path in one URL segment.
//!
//! A URL is `tnpage://localhost/<id>/<path inside the root>` (`http://tnpage.localhost/...` on Windows). `<id>` names a root folder
//! the frontend registered with `open_page` for the page it shows; nothing outside that folder can be reached, and only web file
//! types are served.

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::http::{header, Request, Response, StatusCode};

/// Files a previewed web page may load: the page itself, its styles and scripts, images, fonts, data and media.
pub const PAGE_EXTENSIONS: [&str; 30] = [
  "html", "htm", "xhtml", "css", "js", "mjs", "json", "txt", "xml", "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp",
  "woff", "woff2", "ttf", "otf", "mp3", "wav", "ogg", "mp4", "webm", "m4a", "pdf", "map",
];

/// Largest file that is served to a page.
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// How many pages keep a registered root; the oldest one is forgotten first.
const MAX_ROOTS: usize = 8;

static ROOTS: Mutex<Vec<(String, PathBuf)>> = Mutex::new(Vec::new());
static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// What the served page may load: its own files and inline code, nothing from the network.
const PAGE_CSP: &str = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";

fn percent_decode(text: &str) -> Option<String> {
  let bytes = text.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut index = 0;
  while index < bytes.len() {
    if bytes[index] == b'%' {
      let hex = text.get(index + 1..index + 3)?;
      out.push(u8::from_str_radix(hex, 16).ok()?);
      index += 3;
    } else {
      out.push(bytes[index]);
      index += 1;
    }
  }
  String::from_utf8(out).ok()
}

fn percent_encode_segment(segment: &str) -> String {
  let mut out = String::new();
  for byte in segment.bytes() {
    if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
      out.push(byte as char);
    } else {
      out.push_str(&format!("%{byte:02X}"));
    }
  }
  out
}

fn strip_verbatim(path: PathBuf) -> PathBuf {
  let text = path.to_string_lossy();
  match text.strip_prefix(r"\\?\") {
    Some(stripped) if !stripped.starts_with("UNC\\") => PathBuf::from(stripped),
    _ => path,
  }
}

pub fn mime_for(extension: &str) -> &'static str {
  match extension {
    "html" | "htm" | "xhtml" => "text/html; charset=utf-8",
    "css" => "text/css; charset=utf-8",
    "js" | "mjs" => "text/javascript; charset=utf-8",
    "json" | "map" => "application/json; charset=utf-8",
    "txt" => "text/plain; charset=utf-8",
    "xml" => "application/xml; charset=utf-8",
    "svg" => "image/svg+xml",
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    "gif" => "image/gif",
    "webp" => "image/webp",
    "avif" => "image/avif",
    "ico" => "image/x-icon",
    "bmp" => "image/bmp",
    "woff" => "font/woff",
    "woff2" => "font/woff2",
    "ttf" => "font/ttf",
    "otf" => "font/otf",
    "mp3" => "audio/mpeg",
    "wav" => "audio/wav",
    "ogg" => "audio/ogg",
    "m4a" => "audio/mp4",
    "mp4" => "video/mp4",
    "webm" => "video/webm",
    "pdf" => "application/pdf",
    _ => "application/octet-stream",
  }
}

/// The folder a page's links may reach: `root` when the page lies inside it (a project folder), else the page's own folder.
/// A drive root or `/` is never accepted.
pub fn page_root(file: &Path, requested: Option<&str>) -> Option<PathBuf> {
  let file = strip_verbatim(file.to_path_buf());
  let own = file.parent()?.to_path_buf();
  let Some(requested) = requested else { return Some(own) };
  let candidate = std::fs::canonicalize(requested).ok().map(strip_verbatim)?;
  let acceptable = candidate.is_dir() && candidate.file_name().is_some() && file.starts_with(&candidate);
  Some(if acceptable { candidate } else { own })
}

/// Registers `file` for serving and returns its URL path (`<id>/<relative path>`, each segment percent-encoded).
pub fn register_page(file: &Path, requested_root: Option<&str>) -> Result<String, String> {
  let file = strip_verbatim(file.to_path_buf());
  let root = page_root(&file, requested_root).ok_or("the page has no folder")?;
  let relative = file.strip_prefix(&root).map_err(|_| "the page is outside its folder".to_string())?;
  let segments: Vec<String> = relative.components().filter_map(|part| match part { Component::Normal(name) => Some(percent_encode_segment(&name.to_string_lossy())), _ => None }).collect();
  let id = format!("p{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
  let mut roots = ROOTS.lock().map_err(|_| "page registry unavailable".to_string())?;
  roots.push((id.clone(), root));
  while roots.len() > MAX_ROOTS {
    roots.remove(0);
  }
  Ok(format!("{id}/{}", segments.join("/")))
}

/// The file a request path names, or the HTTP status to answer with.
pub fn resolve_request(roots: &[(String, PathBuf)], url_path: &str) -> Result<PathBuf, StatusCode> {
  let trimmed = url_path.trim_start_matches('/');
  let (id, rest) = trimmed.split_once('/').ok_or(StatusCode::NOT_FOUND)?;
  let root = roots.iter().find(|(known, _)| known == id).map(|(_, root)| root).ok_or(StatusCode::NOT_FOUND)?;
  let decoded = percent_decode(rest).ok_or(StatusCode::BAD_REQUEST)?;
  if decoded.is_empty() || decoded.contains('\0') || decoded.contains('\\') {
    return Err(StatusCode::BAD_REQUEST);
  }
  let mut path = root.clone();
  for segment in decoded.split('/') {
    match segment {
      "" | "." => {}
      ".." => return Err(StatusCode::FORBIDDEN),
      other => path.push(other),
    }
  }
  let canonical = std::fs::canonicalize(&path).map(strip_verbatim).map_err(|_| StatusCode::NOT_FOUND)?;
  if !canonical.starts_with(root) {
    return Err(StatusCode::FORBIDDEN);
  }
  let extension = canonical.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
  if !PAGE_EXTENSIONS.contains(&extension.as_str()) {
    return Err(StatusCode::FORBIDDEN);
  }
  match std::fs::metadata(&canonical) {
    Ok(meta) if meta.is_file() && meta.len() <= MAX_FILE_BYTES => Ok(canonical),
    Ok(_) => Err(StatusCode::FORBIDDEN),
    Err(_) => Err(StatusCode::NOT_FOUND),
  }
}

fn reply(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
  Response::builder()
    .status(status)
    .header(header::CONTENT_TYPE, content_type)
    .header(header::CONTENT_SECURITY_POLICY, PAGE_CSP)
    .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
    .header(header::CACHE_CONTROL, "no-store")
    .header("Referrer-Policy", "no-referrer")
    .body(body)
    .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Answers one request of the `tnpage` scheme.
pub fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
  let roots = ROOTS.lock().map(|roots| roots.clone()).unwrap_or_default();
  match resolve_request(&roots, request.uri().path()) {
    Ok(path) => match std::fs::read(&path) {
      Ok(bytes) => {
        let extension = path.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
        reply(StatusCode::OK, mime_for(&extension), bytes)
      }
      Err(_) => reply(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
    },
    Err(status) => reply(status, "text/plain", Vec::new()),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("typenova-page-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    strip_verbatim(fs::canonicalize(&dir).unwrap())
  }

  #[test]
  fn relative_links_resolve_inside_the_root_only() {
    let root = temp_dir("serve");
    fs::create_dir_all(root.join("site/css")).unwrap();
    fs::create_dir_all(root.join("shared")).unwrap();
    fs::write(root.join("site/index.html"), b"<p>x</p>").unwrap();
    fs::write(root.join("site/css/style.css"), b"p{}").unwrap();
    fs::write(root.join("shared/base.css"), b"p{}").unwrap();
    fs::write(root.join("site/run.exe"), b"x").unwrap();
    let roots = vec![("p1".to_string(), root.clone())];
    assert_eq!(resolve_request(&roots, "/p1/site/css/style.css").unwrap(), root.join("site/css/style.css"));
    assert_eq!(resolve_request(&roots, "/p1/shared/base.css").unwrap(), root.join("shared/base.css"));
    assert_eq!(resolve_request(&roots, "/p1/site/with%20space.css"), Err(StatusCode::NOT_FOUND));
    assert_eq!(resolve_request(&roots, "/p1/site/run.exe"), Err(StatusCode::FORBIDDEN));
    assert_eq!(resolve_request(&roots, "/p1/site/../../outside.css"), Err(StatusCode::FORBIDDEN));
    assert_eq!(resolve_request(&roots, "/p1/site/%2E%2E/%2E%2E/x.css"), Err(StatusCode::FORBIDDEN));
    assert_eq!(resolve_request(&roots, "/p1/site%5Cindex.html"), Err(StatusCode::BAD_REQUEST));
    assert_eq!(resolve_request(&roots, "/p2/site/index.html"), Err(StatusCode::NOT_FOUND));
    assert_eq!(resolve_request(&roots, "/p1/site"), Err(StatusCode::FORBIDDEN));
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn a_page_is_registered_with_a_project_root_only_when_it_lies_inside() {
    let root = temp_dir("register");
    fs::create_dir_all(root.join("pages")).unwrap();
    fs::create_dir_all(root.join("other")).unwrap();
    fs::write(root.join("pages/my page.html"), b"x").unwrap();
    let file = root.join("pages/my page.html");
    assert_eq!(page_root(&file, Some(root.to_str().unwrap())), Some(root.clone()));
    assert_eq!(page_root(&file, Some(root.join("other").to_str().unwrap())), Some(root.join("pages")));
    assert_eq!(page_root(&file, None), Some(root.join("pages")));
    let url = register_page(&file, Some(root.to_str().unwrap())).unwrap();
    assert!(url.ends_with("/pages/my%20page.html"), "{url}");
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn mime_types_match_what_pages_need() {
    assert_eq!(mime_for("js"), "text/javascript; charset=utf-8");
    assert_eq!(mime_for("css"), "text/css; charset=utf-8");
    assert_eq!(mime_for("woff2"), "font/woff2");
    assert_eq!(mime_for("unknown"), "application/octet-stream");
  }
}

#[cfg(test)]
mod handler_tests {
  use super::*;

  #[test]
  fn the_handler_serves_a_registered_page() {
    let dir = std::env::temp_dir().join(format!("typenova-page-handler-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("css")).unwrap();
    std::fs::write(dir.join("index.html"), b"<h1>hi</h1>").unwrap();
    std::fs::write(dir.join("css/a.css"), b"h1{color:red}").unwrap();
    let file = std::fs::canonicalize(dir.join("index.html")).unwrap(); // keeps the Windows verbatim prefix, as `open_page` receives it
    let url_path = register_page(&file, None).unwrap();
    for (path, type_prefix, body) in [(format!("http://tnpage.localhost/{url_path}?v=3"), "text/html", "<h1>hi</h1>"), (format!("http://tnpage.localhost/{}/css/a.css", url_path.split('/').next().unwrap()), "text/css", "h1{color:red}")] {
      let response = handle(Request::builder().uri(path.as_str()).body(Vec::new()).unwrap());
      assert_eq!(response.status(), StatusCode::OK, "{path}");
      assert!(response.headers()[header::CONTENT_TYPE].to_str().unwrap().starts_with(type_prefix));
      assert_eq!(response.body(), body.as_bytes());
    }
    let _ = std::fs::remove_dir_all(&dir);
  }
}
