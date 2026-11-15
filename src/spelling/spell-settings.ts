/** Spell checking settings: on or off, the languages, and the personal dictionary. They live in this program's local storage on this computer. */
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";
import { addToWordList, cleanUserWord, parseLanguages, parseWordList, removeFromWordList, serializeLanguages, wordKey, type SpellLanguage } from "./spell-model";

const ENABLED_KEY = "typenova.spell.enabled";
const LANGUAGES_KEY = "typenova.spell.languages";
const WORDS_KEY = "typenova.spell.words";

/** Dispatched when the misspelled words marked in an editor have changed (the count in the status bar follows it). */
export const SPELL_MARKS_EVENT = "typenova:spell-marks-changed";

/** Dispatched whenever a setting or the personal dictionary changes. */
export const SPELL_CHANGED_EVENT = "typenova:spell-settings-changed";
function changed(): void { document.dispatchEvent(new CustomEvent(SPELL_CHANGED_EVENT)); }

/** Spell checking is on by default. */
export function spellEnabled(): boolean { return readPreferenceFlag(ENABLED_KEY, true); }
export function setSpellEnabled(enabled: boolean): void { writePreferenceFlag(ENABLED_KEY, enabled); changed(); }

export function spellLanguages(): SpellLanguage[] {
  try { return parseLanguages(localStorage.getItem(LANGUAGES_KEY)); } catch { return parseLanguages(null); }
}
export function setSpellLanguages(languages: readonly SpellLanguage[]): void {
  try { localStorage.setItem(LANGUAGES_KEY, serializeLanguages(languages)); } catch { /* storage unavailable */ }
  changed();
}

let personal: string[] | null = null;
let personalKeys = new Set<string>();
/** Words the user chose to ignore until the program is closed. */
const ignored = new Set<string>();
/** Words of the dictionaries of the repositories the open documents belong to (see repo-dictionary.ts): known words, like the personal ones, but kept in the repository. */
let repositoryKeys = new Set<string>();

/** Dispatched with the word when one is added to the personal dictionary (the repository dictionary may follow it). */
export const SPELL_WORD_ADDED_EVENT = "typenova:spell-word-added";
const AUTO_KEY = "typenova.spell.repoAuto";
/** Whether a word added to the personal dictionary is also added to the dictionary of the repository the document is in. Off until the person turns it on. */
export function repositoryDictionaryAuto(): boolean { return readPreferenceFlag(AUTO_KEY, false); }
export function setRepositoryDictionaryAuto(on: boolean): void { writePreferenceFlag(AUTO_KEY, on); changed(); }

/** Sets the words of the repository dictionaries (all of them, replacing the earlier ones). */
export function setRepositoryWords(words: readonly string[]): void {
  const next = new Set(words.map(wordKey));
  if (next.size === repositoryKeys.size && [...next].every(key => repositoryKeys.has(key))) return;
  repositoryKeys = next;
  changed();
}

function loadPersonal(): string[] {
  if (personal) return personal;
  let raw: string | null = null;
  try { raw = localStorage.getItem(WORDS_KEY); } catch { /* storage unavailable */ }
  personal = parseWordList(raw);
  personalKeys = new Set(personal.map(wordKey));
  return personal;
}

function savePersonal(next: string[]): void {
  personal = next;
  personalKeys = new Set(next.map(wordKey));
  try { localStorage.setItem(WORDS_KEY, JSON.stringify(next)); } catch { /* the words last until the program is closed */ }
  changed();
}

export function personalWords(): readonly string[] { return loadPersonal(); }

/** Adds a word to the personal dictionary; false when it is not a word or is already there. */
export function addPersonalWord(word: string): boolean {
  const clean = cleanUserWord(word);
  // A word that is only ignored for now can still be added; a word that is already in the dictionary cannot.
  if (!clean || loadPersonal().length >= 5000 || personalKeys.has(wordKey(clean))) return false;
  savePersonal(addToWordList(loadPersonal(), clean));
  document.dispatchEvent(new CustomEvent(SPELL_WORD_ADDED_EVENT, { detail: clean }));
  return true;
}

export function removePersonalWord(word: string): void { savePersonal(removeFromWordList(loadPersonal(), word)); }
export function clearPersonalWords(): void { savePersonal([]); }

/** Leaves a word alone until the program is closed. */
export function ignoreWordForNow(word: string): void { ignored.add(wordKey(word)); changed(); }

/** True for words the user added or chose to ignore (in any letter case). */
export function isUserWord(word: string): boolean {
  loadPersonal();
  const key = wordKey(word);
  return personalKeys.has(key) || ignored.has(key) || repositoryKeys.has(key);
}
