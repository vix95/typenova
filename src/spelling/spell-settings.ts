/** Spell checking settings: on or off, the languages, and the personal dictionary. They live in this program's local storage on this computer. */
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";
import { addToWordList, cleanUserWord, parseLanguages, parseWordList, removeFromWordList, serializeLanguages, wordKey, type SpellLanguage } from "./spell-model";

const ENABLED_KEY = "typenova.spell.enabled";
const LANGUAGES_KEY = "typenova.spell.languages";
const WORDS_KEY = "typenova.spell.words";

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
  return personalKeys.has(key) || ignored.has(key);
}
