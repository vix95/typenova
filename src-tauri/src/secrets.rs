//! Secrets the program keeps for the user (the API keys of the assistant's providers), encrypted on disk in the same way on every system.
//!
//! A secret is sealed with AES-256-GCM. The encryption key is derived (HKDF-SHA256) from two things: a random secret of
//! this installation, kept in its own file in the program's data folder (readable by the current user only on Unix), and
//! the identifier of this machine. So the encrypted file is useless when it is copied alone, to another user or to
//! another computer, and the key is never written to the program's settings or shown in the interface: the interface can
//! only ask whether a secret exists and for its last few characters. This does not protect against a program that runs
//! as the same user on the same machine and reads both files; for that the operating system would have to ask for a
//! password, which the program does not do.

use aes_gcm::aead::{Aead, KeyInit, OsRng, Payload};
use aes_gcm::{AeadCore, Aes256Gcm, Nonce};
use hkdf::Hkdf;
use serde::Serialize;
use sha2::Sha256;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

/// The only names a secret may have (the API key of each provider that needs one); each is stored in its own file.
/// A fixed list, so that a name can never point outside the data folder.
const NAMES: [&str; 4] = ["anthropic-api-key", "openai-api-key", "gemini-api-key", "custom-api-key"];
const INSTALL_SECRET_FILE: &str = "secret-install.key";
const FORMAT_VERSION: u8 = 1;
const NONCE_LEN: usize = 12;
const HINT_CHARS: usize = 4;
const MAX_SECRET_CHARS: usize = 4096;

/// What the interface may know about a secret.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretInfo {
  /// A secret is stored.
  pub present: bool,
  /// It can be read on this machine (false e.g. when the files were copied from another computer).
  pub readable: bool,
  /// The last characters of the secret, to tell which one it is; empty when there is none.
  pub last_chars: String,
}

fn check_name(name: &str) -> Result<(), String> {
  if NAMES.contains(&name) { Ok(()) } else { Err("unknown secret".into()) }
}

fn secret_path(dir: &Path, name: &str) -> PathBuf { dir.join(format!("secret-{name}.bin")) }

/// The encryption key from the secret of this installation and the machine identifier.
fn derive_key(install_secret: &[u8], machine_id: &str) -> [u8; 32] {
  let mut input = Vec::with_capacity(install_secret.len() + machine_id.len());
  input.extend_from_slice(install_secret);
  input.extend_from_slice(machine_id.as_bytes());
  let hkdf = Hkdf::<Sha256>::new(Some(b"TypeNova secret store"), &input);
  let mut key = [0u8; 32];
  hkdf.expand(b"aes-256-gcm key v1", &mut key).expect("32 bytes is a valid length");
  key
}

/// Seals a secret: version, nonce and the encrypted text. The name is authenticated too, so a file cannot be passed off as another secret.
fn seal(key: &[u8; 32], name: &str, plain: &str) -> Result<Vec<u8>, String> {
  let cipher = Aes256Gcm::new(key.into());
  let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
  let encrypted = cipher.encrypt(&nonce, Payload { msg: plain.as_bytes(), aad: name.as_bytes() }).map_err(|_| "could not encrypt".to_string())?;
  let mut out = Vec::with_capacity(1 + NONCE_LEN + encrypted.len());
  out.push(FORMAT_VERSION);
  out.extend_from_slice(&nonce);
  out.extend_from_slice(&encrypted);
  Ok(out)
}

/// Opens a sealed secret; None when it was changed, belongs to another key or name, or is not in this format.
fn open(key: &[u8; 32], name: &str, sealed: &[u8]) -> Option<Zeroizing<String>> {
  if sealed.len() <= 1 + NONCE_LEN || sealed[0] != FORMAT_VERSION {
    return None;
  }
  let cipher = Aes256Gcm::new(key.into());
  let nonce = Nonce::from_slice(&sealed[1..1 + NONCE_LEN]);
  let plain = cipher.decrypt(nonce, Payload { msg: &sealed[1 + NONCE_LEN..], aad: name.as_bytes() }).ok()?;
  String::from_utf8(plain).ok().map(Zeroizing::new)
}

/// The last characters of a secret (all of it would not tell much, and for a short one nothing is shown).
fn last_chars(secret: &str) -> String {
  let chars: Vec<char> = secret.chars().collect();
  if chars.len() < HINT_CHARS * 2 { String::new() } else { chars[chars.len() - HINT_CHARS..].iter().collect() }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
  use std::io::Write;
  let mut options = std::fs::OpenOptions::new();
  options.write(true).create(true).truncate(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  let mut file = options.open(path).map_err(|error| error.to_string())?;
  file.write_all(bytes).map_err(|error| error.to_string())
}

/// The random secret of this installation, created on first use.
fn install_secret(dir: &Path) -> Result<Zeroizing<Vec<u8>>, String> {
  let path = dir.join(INSTALL_SECRET_FILE);
  if let Ok(existing) = std::fs::read(&path) {
    if existing.len() == 32 {
      return Ok(Zeroizing::new(existing));
    }
  }
  std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
  let mut fresh = Zeroizing::new(vec![0u8; 32]);
  aes_gcm::aead::rand_core::RngCore::fill_bytes(&mut OsRng, &mut fresh);
  write_private(&path, &fresh)?;
  Ok(fresh)
}

fn master_key(dir: &Path) -> Result<[u8; 32], String> {
  let secret = install_secret(dir)?;
  let machine = machine_uid::get().unwrap_or_else(|_| "unknown-machine".into());
  Ok(derive_key(&secret, &machine))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map_err(|error| error.to_string()) }

/// Stores (or replaces) a secret in an encrypted file.
pub fn store_in(dir: &Path, name: &str, value: &str) -> Result<SecretInfo, String> {
  check_name(name)?;
  let value = value.trim();
  if value.is_empty() || value.chars().count() > MAX_SECRET_CHARS || value.chars().any(char::is_control) {
    return Err("not a valid secret".into());
  }
  let key = Zeroizing::new(master_key(dir)?);
  let sealed = seal(&key, name, value)?;
  std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
  write_private(&secret_path(dir, name), &sealed)?;
  Ok(SecretInfo { present: true, readable: true, last_chars: last_chars(value) })
}

/// A stored secret, decrypted; None when there is none or it cannot be read here. For use inside the backend only.
pub fn read_from(dir: &Path, name: &str) -> Option<Zeroizing<String>> {
  check_name(name).ok()?;
  let sealed = std::fs::read(secret_path(dir, name)).ok()?;
  let key = Zeroizing::new(master_key(dir).ok()?);
  open(&key, name, &sealed)
}

pub fn info_in(dir: &Path, name: &str) -> SecretInfo {
  if check_name(name).is_err() || !secret_path(dir, name).exists() {
    return SecretInfo { present: false, readable: false, last_chars: String::new() };
  }
  match read_from(dir, name) {
    Some(secret) => SecretInfo { present: true, readable: true, last_chars: last_chars(&secret) },
    None => SecretInfo { present: true, readable: false, last_chars: String::new() },
  }
}

pub fn delete_in(dir: &Path, name: &str) -> Result<(), String> {
  check_name(name)?;
  match std::fs::remove_file(secret_path(dir, name)) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(error) => Err(error.to_string()),
  }
}

/// The secret as the backend uses it (for example the API key of a request).
pub fn read_secret(app: &AppHandle, name: &str) -> Option<Zeroizing<String>> { read_from(&data_dir(app).ok()?, name) }

/// Stores a secret. The interface gets back only whether it is stored and its last characters.
#[tauri::command]
pub fn secret_store(app: AppHandle, name: String, value: String) -> Result<SecretInfo, String> { store_in(&data_dir(&app)?, &name, &value) }

/// Whether a secret is stored, whether it can be read here, and its last characters.
#[tauri::command]
pub fn secret_info(app: AppHandle, name: String) -> Result<SecretInfo, String> { Ok(info_in(&data_dir(&app)?, &name)) }

#[tauri::command]
pub fn secret_delete(app: AppHandle, name: String) -> Result<(), String> { delete_in(&data_dir(&app)?, &name) }

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("typenova-secrets-{label}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
  }

  #[test]
  fn a_sealed_secret_opens_only_with_its_key_and_name() {
    let key = derive_key(b"install", "machine-a");
    let sealed = seal(&key, "anthropic-api-key", "sk-ant-secret-value-1234").unwrap();
    assert!(!String::from_utf8_lossy(&sealed).contains("sk-ant"), "the text is not readable in the file");
    assert_eq!(open(&key, "anthropic-api-key", &sealed).as_deref().map(String::as_str), Some("sk-ant-secret-value-1234"));
    assert!(open(&key, "other-name", &sealed).is_none(), "another name does not open it");
    assert!(open(&derive_key(b"install", "machine-b"), "anthropic-api-key", &sealed).is_none(), "another machine does not open it");
    assert!(open(&derive_key(b"other", "machine-a"), "anthropic-api-key", &sealed).is_none(), "another installation does not open it");
    let mut changed = sealed.clone();
    *changed.last_mut().unwrap() ^= 1;
    assert!(open(&key, "anthropic-api-key", &changed).is_none(), "a changed file is rejected");
    assert!(open(&key, "anthropic-api-key", &sealed[..5]).is_none());
  }

  #[test]
  fn two_seals_of_one_secret_differ() {
    let key = derive_key(b"install", "machine");
    assert_ne!(seal(&key, "anthropic-api-key", "same-value-12345").unwrap(), seal(&key, "anthropic-api-key", "same-value-12345").unwrap());
  }

  #[test]
  fn only_the_last_characters_are_shown() {
    assert_eq!(last_chars("sk-ant-api03-abcdefgh-WXYZ"), "WXYZ");
    assert_eq!(last_chars("short"), "", "a short secret shows nothing");
    assert_eq!(last_chars("zażółć-gęślą-jaźń"), "jaźń", "characters, not bytes");
  }

  #[test]
  fn a_secret_is_stored_encrypted_and_read_back() {
    let dir = temp_dir("roundtrip");
    let info = store_in(&dir, "anthropic-api-key", "  sk-ant-test-key-0123456789  ").unwrap();
    assert_eq!(info, SecretInfo { present: true, readable: true, last_chars: "6789".into() });
    let on_disk = std::fs::read(secret_path(&dir, "anthropic-api-key")).unwrap();
    assert!(!String::from_utf8_lossy(&on_disk).contains("sk-ant-test"));
    assert_eq!(read_from(&dir, "anthropic-api-key").as_deref().map(String::as_str), Some("sk-ant-test-key-0123456789"));
    assert_eq!(info_in(&dir, "anthropic-api-key").last_chars, "6789");
    // the files copied without the secret of the installation cannot be read
    std::fs::remove_file(dir.join(INSTALL_SECRET_FILE)).unwrap();
    assert_eq!(info_in(&dir, "anthropic-api-key"), SecretInfo { present: true, readable: false, last_chars: String::new() });
    delete_in(&dir, "anthropic-api-key").unwrap();
    assert!(!info_in(&dir, "anthropic-api-key").present);
    delete_in(&dir, "anthropic-api-key").unwrap();
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn names_and_values_are_checked() {
    let dir = temp_dir("checks");
    assert!(store_in(&dir, "../escape", "value-value-value").is_err());
    assert!(store_in(&dir, "anthropic-api-key", "   ").is_err());
    assert!(store_in(&dir, "anthropic-api-key", "two\nlines").is_err());
    assert!(read_from(&dir, "unknown").is_none());
    let _ = std::fs::remove_dir_all(&dir);
  }
}
