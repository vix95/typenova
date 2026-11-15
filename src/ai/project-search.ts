/** Finding the passages of a project that answer a question: BM25 over words (no model, no network, nothing leaves the computer). Pure, no DOM. */
import type { Chunk } from "./project-chunks.js";

const STOP_WORDS = new Set((
  "a aby ale am an and are as at be but by co czy dla do for from gdy go ich ja jak jest jego jej już ma na nad nie od oraz po pod się są ta tak te ten to w we z za że " +
  "the this that with was were what when where which who why how i in is it of on or to"
).split(" "));

/** Words are compared by their beginning, so that inflected forms (notatka, notatki, notatek; report, reports) meet. */
export function stem(word: string): string { return word.length <= 3 ? word : word.slice(0, Math.min(5, Math.max(3, word.length - 1))); }

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const word of text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)) if (word.length >= 2 && !STOP_WORDS.has(word)) out.push(stem(word));
  return out;
}

interface Doc { chunk: Chunk; counts: Map<string, number>; length: number }
export interface SearchIndex { docs: Doc[]; df: Map<string, number>; average: number }
export interface Hit { chunk: Chunk; score: number }

const K1 = 1.2, B = 0.75;
/** A word in the heading counts three times, one in the file name twice: they say what a passage is about. */
const HEADING_WEIGHT = 3, NAME_WEIGHT = 2;

export function buildSearchIndex(chunks: readonly Chunk[]): SearchIndex {
  const docs: Doc[] = chunks.map(chunk => {
    const counts = new Map<string, number>();
    const add = (word: string, weight: number) => counts.set(word, (counts.get(word) ?? 0) + weight);
    for (const word of tokens(chunk.text)) add(word, 1);
    for (const word of tokens(chunk.section)) add(word, HEADING_WEIGHT);
    for (const word of tokens(chunk.name.replace(/\.[^.]+$/, ""))) add(word, NAME_WEIGHT);
    let length = 0;
    for (const count of counts.values()) length += count;
    return { chunk, counts, length };
  });
  const df = new Map<string, number>();
  for (const doc of docs) for (const word of doc.counts.keys()) df.set(word, (df.get(word) ?? 0) + 1);
  const total = docs.reduce((sum, doc) => sum + doc.length, 0);
  return { docs, df, average: docs.length ? total / docs.length : 0 };
}

/** The passages that best match `query`, best first. `prefer` (a path) gets a small boost: the note being worked on is more likely what the question is about. */
export function searchIndex(index: SearchIndex, query: string, limit: number, prefer?: string): Hit[] {
  const words = [...new Set(tokens(query))];
  if (!words.length || !index.docs.length) return [];
  const lowered = query.toLocaleLowerCase();
  const hits: Hit[] = [];
  for (const doc of index.docs) {
    let score = 0;
    for (const word of words) {
      const frequency = doc.counts.get(word);
      if (!frequency) continue;
      const documents = index.df.get(word) ?? 1;
      const idf = Math.log(1 + (index.docs.length - documents + 0.5) / (documents + 0.5));
      score += idf * (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * (doc.length / (index.average || 1))));
    }
    if (score <= 0) continue;
    if (lowered.includes(doc.chunk.name.toLocaleLowerCase())) score *= 1.5;
    if (prefer && doc.chunk.path === prefer) score *= 1.25;
    hits.push({ chunk: doc.chunk, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.chunk.path.localeCompare(b.chunk.path) || a.chunk.line - b.chunk.line).slice(0, limit);
}
