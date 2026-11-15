/** The dictionary file of a repository: reading and writing its text, and combining it with the personal dictionary. Pure, no files. */
import { cleanUserWord, wordKey } from "./spell-model.js";

/** Where the file lives, relative to the top folder of the repository. */
export const REPO_DICTIONARY_FILE = ".typenova/dictionary.txt";
const MAX_WORDS = 20000;
const HEADER = "# TypeNova dictionary of this repository: one word per line. Lines that start with # are comments.";

const byWord = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);

/** The words of the file: one per line, comments and blank lines skipped, anything that is not a word dropped, each word once (ignoring case). */
export function parseRepoDictionary(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const word = cleanUserWord(line);
    if (!word || seen.has(wordKey(word))) continue;
    seen.add(wordKey(word));
    words.push(word);
    if (words.length >= MAX_WORDS) break;
  }
  return words;
}

/** The text of the file for a list of words: a comment, then the words sorted, one per line (sorted, so that two people adding words rarely conflict in Git). */
export function serializeRepoDictionary(words: readonly string[]): string {
  return `${HEADER}\n${[...words].sort(byWord).join("\n")}${words.length ? "\n" : ""}`;
}

/** Both lists as one: each word once (ignoring case; the first spelling wins), sorted. */
export function mergeDictionaries(first: readonly string[], second: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const word of [...first, ...second]) {
    const clean = cleanUserWord(word);
    if (!clean || seen.has(wordKey(clean))) continue;
    seen.add(wordKey(clean));
    merged.push(clean);
  }
  return merged.sort(byWord);
}

/** The words of `incoming` that `existing` does not have yet. */
export function wordsNotIn(existing: readonly string[], incoming: readonly string[]): string[] {
  const have = new Set(existing.map(wordKey));
  return incoming.filter(word => !have.has(wordKey(word)));
}
