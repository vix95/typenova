//! Spell checking with Hunspell dictionaries (Polish and English).
//!
//! The dictionaries are part of the program (`src-tauri/dictionaries`, see the README there for their licenses) and are
//! read the first time a language is used. The webview has no spell checker of its own that can be given a language or
//! asked for suggestions, so the editor sends words here: `spell_check` says which of them are wrong, `spell_suggest`
//! offers replacements for one word. A word is right when it is right in any of the languages that were asked for.

use spellbook::Dictionary;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};

/// Languages with a dictionary: code, `.aff` file, `.dic` file.
const LANGUAGES: [(&str, &str, &str); 2] = [
  ("pl", include_str!("../dictionaries/pl/index.aff"), include_str!("../dictionaries/pl/index.dic")),
  ("en", include_str!("../dictionaries/en/index.aff"), include_str!("../dictionaries/en/index.dic")),
];

/// Limits, so that one request cannot keep the program busy for long.
const MAX_WORDS_PER_CHECK: usize = 4000;
const MAX_WORD_CHARS: usize = 64;
const MAX_SUGGESTIONS: usize = 8;

type Loaded = RwLock<HashMap<&'static str, Arc<Dictionary>>>;

fn loaded() -> &'static Loaded {
  static LOADED: OnceLock<Loaded> = OnceLock::new();
  LOADED.get_or_init(|| RwLock::new(HashMap::new()))
}

/// The dictionary of a language, read from the program's data on first use.
fn dictionary(code: &str) -> Option<Arc<Dictionary>> {
  let (known, aff, dic) = LANGUAGES.iter().find(|(language, _, _)| *language == code)?;
  if let Some(found) = loaded().read().ok()?.get(known) {
    return Some(found.clone());
  }
  let mut guard = loaded().write().ok()?;
  if let Some(found) = guard.get(known) {
    return Some(found.clone());
  }
  let parsed = Arc::new(Dictionary::new(aff, dic).ok()?);
  guard.insert(known, parsed.clone());
  Some(parsed)
}

/// The dictionaries for the languages asked for (unknown codes are ignored).
fn dictionaries(languages: &[String]) -> Vec<Arc<Dictionary>> {
  let mut found: Vec<Arc<Dictionary>> = Vec::new();
  for code in languages {
    if let Some(dictionary) = dictionary(code.trim()) {
      if !found.iter().any(|other| Arc::ptr_eq(other, &dictionary)) {
        found.push(dictionary);
      }
    }
  }
  found
}

/// A typographic apostrophe is written as a plain one, which is what the dictionaries have.
fn normalized(word: &str) -> String {
  word.replace(['\u{2019}', '\u{2018}', '\u{02BC}'], "'")
}

/// Whether a word is right in a dictionary; a hyphenated word is also right when every part of it is.
fn is_correct(dictionary: &Dictionary, word: &str) -> bool {
  if dictionary.check(word) {
    return true;
  }
  if word.contains('-') {
    let parts: Vec<&str> = word.split('-').filter(|part| !part.is_empty()).collect();
    return parts.len() > 1 && parts.iter().all(|part| dictionary.check(part));
  }
  false
}

/// For each word: true when it is right in at least one of the languages. With no dictionary at all everything counts as right.
pub fn check_words(words: &[String], languages: &[String]) -> Vec<bool> {
  let dictionaries = dictionaries(languages);
  if dictionaries.is_empty() {
    return vec![true; words.len()];
  }
  words
    .iter()
    .take(MAX_WORDS_PER_CHECK)
    .map(|word| {
      let word = normalized(word);
      word.chars().count() > MAX_WORD_CHARS || dictionaries.iter().any(|dictionary| is_correct(dictionary, &word))
    })
    .collect()
}

/// Replacements for a word from every language asked for, the best of each language first, without repeats.
pub fn suggest_word(word: &str, languages: &[String]) -> Vec<String> {
  let word = normalized(word);
  if word.chars().count() > MAX_WORD_CHARS {
    return Vec::new();
  }
  let lists: Vec<Vec<String>> = dictionaries(languages)
    .iter()
    .map(|dictionary| {
      let mut found = Vec::new();
      dictionary.suggest(&word, &mut found);
      found
    })
    .collect();
  let mut result: Vec<String> = Vec::new();
  let longest = lists.iter().map(Vec::len).max().unwrap_or(0);
  for index in 0..longest {
    for list in &lists {
      if let Some(candidate) = list.get(index) {
        if !result.contains(candidate) && *candidate != word {
          result.push(candidate.clone());
        }
      }
    }
    if result.len() >= MAX_SUGGESTIONS {
      break;
    }
  }
  result.truncate(MAX_SUGGESTIONS);
  result
}

/// Which of the given words are right (true) or wrong (false), judged by the dictionaries of the given languages.
#[tauri::command]
pub async fn spell_check(words: Vec<String>, languages: Vec<String>) -> Result<Vec<bool>, String> {
  tauri::async_runtime::spawn_blocking(move || check_words(&words, &languages)).await.map_err(|error| error.to_string())
}

/// Replacements for a wrong word, from the dictionaries of the given languages.
#[tauri::command]
pub async fn spell_suggest(word: String, languages: Vec<String>) -> Result<Vec<String>, String> {
  tauri::async_runtime::spawn_blocking(move || suggest_word(&word, &languages)).await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn languages(codes: &[&str]) -> Vec<String> {
    codes.iter().map(|code| code.to_string()).collect()
  }

  fn words(list: &[&str]) -> Vec<String> {
    list.iter().map(|word| word.to_string()).collect()
  }

  #[test]
  fn polish_words_are_checked_with_their_endings() {
    let result = check_words(&words(&["zdanie", "ważniejsze", "błędami", "Warszawa", "ważnejsze", "xyzzy"]), &languages(&["pl"]));
    assert_eq!(result, vec![true, true, true, true, false, false]);
  }

  #[test]
  fn a_word_is_right_when_it_is_right_in_any_language() {
    let list = words(&["zdanie", "programming", "prograaming"]);
    assert_eq!(check_words(&list, &languages(&["pl"])), vec![true, false, false]);
    assert_eq!(check_words(&list, &languages(&["en"])), vec![false, true, false]);
    assert_eq!(check_words(&list, &languages(&["pl", "en"])), vec![true, true, false]);
  }

  #[test]
  fn unknown_languages_and_typographic_apostrophes_are_handled() {
    assert_eq!(check_words(&words(&["qwerty"]), &languages(&["xx"])), vec![true], "without a dictionary nothing is flagged");
    assert_eq!(check_words(&words(&["don\u{2019}t", "dont"]), &languages(&["en"])), vec![true, false]);
  }

  #[test]
  fn hyphenated_words_are_right_when_their_parts_are() {
    assert_eq!(check_words(&words(&["well-known", "well-knoown"]), &languages(&["en"])), vec![true, false]);
  }

  #[test]
  fn suggestions_come_from_every_language() {
    let polish = suggest_word("ważnejsze", &languages(&["pl"]));
    assert!(polish.contains(&"ważniejsze".to_string()), "{polish:?}");
    let english = suggest_word("prograaming", &languages(&["en"]));
    assert!(english.contains(&"programming".to_string()), "{english:?}");
    let both = suggest_word("błendami", &languages(&["pl", "en"]));
    assert_eq!(both.first().map(String::as_str), Some("błędami"), "{both:?}");
    assert!(both.len() <= MAX_SUGGESTIONS);
    assert!(suggest_word(&"a".repeat(200), &languages(&["pl"])).is_empty());
  }
}
