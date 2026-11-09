/** Calls to the spell checker of the program (Hunspell dictionaries in the Tauri backend). Outside the desktop program there is no backend, and nothing is checked. */
import { invoke } from "@tauri-apps/api/core";
import type { SpellLanguage } from "./spell-model";

const CHUNK = 1000;

/** True when the program runs in its desktop window, where the spell checker is. */
export function spellBackendAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** For each word: true when it is spelled right in one of the languages. Null when there is no spell checker to ask. */
export async function checkWords(words: readonly string[], languages: readonly SpellLanguage[]): Promise<boolean[] | null> {
  if (!spellBackendAvailable()) return null;
  const result: boolean[] = [];
  try {
    for (let start = 0; start < words.length; start += CHUNK) {
      result.push(...await invoke<boolean[]>("spell_check", { words: words.slice(start, start + CHUNK), languages: [...languages] }));
    }
  } catch { return null; }
  return result;
}

/** Replacements for a wrong word, the best first; an empty list when there are none or there is no spell checker. */
export async function suggestWord(word: string, languages: readonly SpellLanguage[]): Promise<string[]> {
  if (!spellBackendAvailable()) return [];
  try { return await invoke<string[]>("spell_suggest", { word, languages: [...languages] }); } catch { return []; }
}
