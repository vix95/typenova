/** Spell checking: a pure model (no DOM, no CodeMirror) that finds the words of a text worth checking, and keeps the user's languages and word lists. */

export const SPELL_LANGUAGES = ["pl", "en"] as const;
export type SpellLanguage = typeof SPELL_LANGUAGES[number];

export interface SpellWord { word: string; from: number; to: number }

/** A word: letters, with apostrophes and hyphens between letters; not part of a longer run of letters, digits or underscores. */
const WORD = /(?<![\p{L}\p{N}_])[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*(?![\p{L}\p{N}_])/gu;

/** Things in a text that are not prose: they are blanked out (replaced by spaces of the same length) before the words are found. */
const NOT_PROSE: readonly RegExp[] = [
  /\bhttps?:\/\/[^\s<>)\]]+/g,
  /\bwww\.[^\s<>)\]]+/g,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /(?<=\])\([^)\n]*\)/g,
  /`[^`\n]*`/g,
  /<\/?[A-Za-z][^>\n]*>/g,
  /&[A-Za-z0-9#]+;/g,
  /\$[^$\n]+\$/g,
  /[A-Za-z]:\\[^\s]*/g,
  /\\[A-Za-z]+/g,
  /(?:^|(?<=\s))\.{0,2}\/[\w.\-]+(?:\/[\w.\-]+)*/g,
  /:[a-z0-9_+-]+:/g,
];

const MAX_WORD_LENGTH = 40;

/** The text with everything that is not prose replaced by spaces, so positions stay the same. */
export function maskNonProse(text: string): string {
  let masked = text;
  for (const pattern of NOT_PROSE) masked = masked.replace(pattern, match => " ".repeat(match.length));
  return masked;
}

/** True for words a spell checker should leave alone: one letter, acronyms in capitals, camelCase and PascalCase names, very long words. */
export function isSkippedWord(word: string): boolean {
  const letters = Array.from(word.replace(/['’\-]/g, ""));
  if (letters.length < 2 || word.length > MAX_WORD_LENGTH) return true;
  if (word === word.toUpperCase() && word !== word.toLowerCase()) return true;
  return /\p{Ll}\p{Lu}/u.test(word);
}

/** The words of a text to check, with their positions (`base` is added to them, for a text that is a part of a document). */
export function findWords(text: string, base = 0): SpellWord[] {
  const masked = maskNonProse(text);
  const words: SpellWord[] = [];
  for (const match of masked.matchAll(WORD)) {
    const word = match[0];
    if (isSkippedWord(word)) continue;
    const from = base + (match.index ?? 0);
    words.push({ word, from, to: from + word.length });
  }
  return words;
}

/** The parts of `from..to` that lie outside the ignored ranges (sorted or not, overlapping or not). */
export function rangesOutside(from: number, to: number, ignored: readonly { from: number; to: number }[]): { from: number; to: number }[] {
  const sorted = [...ignored].filter(range => range.to > from && range.from < to).sort((a, b) => a.from - b.from);
  const parts: { from: number; to: number }[] = [];
  let position = from;
  for (const range of sorted) {
    if (range.from > position) parts.push({ from: position, to: Math.min(range.from, to) });
    position = Math.max(position, range.to);
  }
  if (position < to) parts.push({ from: position, to });
  return parts;
}

/** What a word is called in lists and caches: lower case, typographic apostrophes written plainly. */
export function wordKey(word: string): string {
  return word.replace(/[’‘ʼ]/g, "'").toLocaleLowerCase();
}

/** The languages in a stored setting; anything unknown is dropped, and an empty result means both. */
export function parseLanguages(raw: string | null | undefined): SpellLanguage[] {
  const chosen = (raw ?? "").split(",").map(part => part.trim()).filter((part): part is SpellLanguage => (SPELL_LANGUAGES as readonly string[]).includes(part));
  const unique = SPELL_LANGUAGES.filter(language => chosen.includes(language));
  return unique.length ? [...unique] : [...SPELL_LANGUAGES];
}

export function serializeLanguages(languages: readonly SpellLanguage[]): string { return languages.join(","); }

export const MAX_PERSONAL_WORDS = 5000;
const MAX_PERSONAL_WORD_LENGTH = 64;

/** A word as the user wrote it for the personal dictionary: trimmed, and null when it is not a word. */
export function cleanUserWord(input: string): string | null {
  const word = input.trim().replace(/[’‘ʼ]/g, "'");
  if (!word || word.length > MAX_PERSONAL_WORD_LENGTH || /\s/.test(word)) return null;
  return /^[\p{L}\p{M}]+(?:['\-][\p{L}\p{M}]+)*$/u.test(word) ? word : null;
}

/** Reads a stored word list; anything malformed is dropped, words are unique (ignoring case) and the list is limited. */
export function parseWordList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const item of value) {
    const word = typeof item === "string" ? cleanUserWord(item) : null;
    if (!word || seen.has(wordKey(word))) continue;
    seen.add(wordKey(word));
    words.push(word);
    if (words.length >= MAX_PERSONAL_WORDS) break;
  }
  return words;
}

const byWord = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base" });

/** The list with a word added (a word that is already there, in any case, is not added twice). */
export function addToWordList(list: readonly string[], input: string): string[] {
  const word = cleanUserWord(input);
  if (!word || list.length >= MAX_PERSONAL_WORDS || list.some(other => wordKey(other) === wordKey(word))) return [...list];
  return [...list, word].sort(byWord);
}

export function removeFromWordList(list: readonly string[], word: string): string[] {
  return list.filter(other => wordKey(other) !== wordKey(word));
}

/** What a word is called in the cache of answers of the spell checker: as written (case counts, for names), typographic apostrophes written plainly. */
export function checkKey(word: string): string { return word.replace(/[’‘ʼ]/g, "'"); }

/** The words that must still be asked about: not yet known (in the cache) and not repeated. */
export function unknownWords(words: readonly SpellWord[], known: ReadonlyMap<string, boolean>): string[] {
  const wanted = new Set<string>();
  for (const { word } of words) if (!known.has(checkKey(word))) wanted.add(checkKey(word));
  return [...wanted];
}

const PROSE_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mdx", "txt", "text", "rst", "adoc", "asciidoc", "org"]);

/** Whether a document is prose (Markdown or plain text) and so worth spell checking; code is not. An unsaved document counts as Markdown. */
export function isProseDocument(path: string | null | undefined): boolean {
  if (!path) return true;
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? true : PROSE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
