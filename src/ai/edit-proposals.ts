/** Changes the assistant proposes to notes, as differences to approve: reading them from an answer, checking that they still fit the file, and showing them with their surroundings. Pure, no DOM. */
import { lineDiff, type DiffLine } from "./ai-model.js";

export interface EditProposal { file: string; find: string; replace: string }
export interface ParsedAnswer {
  /** The answer without the edit blocks (and without an edit block that has not arrived completely yet). */
  prose: string;
  proposals: EditProposal[];
  /** An edit block is still being written. */
  pending: boolean;
}

const BLOCK = /<edit\s+file\s*=\s*"([^"]+)"\s*>\s*<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>\s*<\/edit>/g;
const trimBreaks = (text: string): string => text.replace(/^\r?\n/, "").replace(/\r?\n$/, "");

export function parseAnswer(answer: string): ParsedAnswer {
  const proposals: EditProposal[] = [];
  const withoutBlocks = answer.replace(BLOCK, (_all, file: string, find: string, replace: string) => { proposals.push({ file: file.trim(), find: trimBreaks(find), replace: trimBreaks(replace) }); return ""; });
  const open = withoutBlocks.search(/<edit[\s>]/);
  const pending = open >= 0;
  return { prose: (pending ? withoutBlocks.slice(0, open) : withoutBlocks).replace(/\n{3,}/g, "\n\n").trim(), proposals, pending };
}

export type Applied = { ok: true; from: number; to: number } | { ok: false; reason: "missing" | "ambiguous" | "empty" };

/** Where a proposal applies in `text`: the place of its `find`, which must occur exactly once. */
export function locateProposal(text: string, proposal: EditProposal): Applied {
  if (!proposal.find) return { ok: false, reason: "empty" };
  const first = text.indexOf(proposal.find);
  if (first < 0) return { ok: false, reason: "missing" };
  if (text.indexOf(proposal.find, first + 1) >= 0) return { ok: false, reason: "ambiguous" };
  return { ok: true, from: first, to: first + proposal.find.length };
}

const CONTEXT_LINES = 2;

/** The difference a proposal makes, with a few lines around it from the file: what the person approves. Null when it does not fit the file. */
export function proposalDiff(text: string, proposal: EditProposal): DiffLine[] | null {
  const place = locateProposal(text, proposal);
  if (!place.ok) return null;
  const lineStart = text.lastIndexOf("\n", place.from - 1) + 1;
  const lineEndAt = text.indexOf("\n", place.to);
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
  const before = lineStart > 0 ? text.slice(0, lineStart - 1).split("\n").slice(-CONTEXT_LINES) : [];
  const after = lineEndAt < 0 ? [] : text.slice(lineEndAt + 1).split("\n").slice(0, CONTEXT_LINES);
  const head = text.slice(lineStart, place.from), tail = text.slice(place.to, lineEnd);
  const join = (middle: string): string => [...before, `${head}${middle}${tail}`, ...after].join("\n");
  return lineDiff(join(proposal.find), join(proposal.replace));
}

/** Resolves the file an edit names against the files the assistant was shown: exactly (relative path), else a file name that only one of them has. */
export function resolveFile(name: string, known: readonly { file: string; path: string }[]): string | null {
  const clean = (value: string): string => value.replace(/\\/g, "/").replace(/^\.\//, "").toLocaleLowerCase();
  const wanted = clean(name);
  const exact = known.find(item => clean(item.file) === wanted);
  if (exact) return exact.path;
  const byName = known.filter(item => clean(item.file).split("/").pop() === wanted.split("/").pop());
  const paths = new Set(byName.map(item => item.path));
  return paths.size === 1 ? [...paths][0] : null;
}
