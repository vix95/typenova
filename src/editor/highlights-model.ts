/** Highlights: a pure model (no DOM, no CodeMirror) for passages of a file that the user marked as important, with an optional note, group and colour. */
import { normalizeSessionPath } from "../documents/session.js";

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;
export type HighlightColor = typeof HIGHLIGHT_COLORS[number];

export interface Highlight {
  id: string;
  /** Path of the file as it was opened. */
  path: string;
  /** Start and end of the passage as character offsets in the document (line breaks counted as one character). */
  from: number;
  to: number;
  /** The highlighted text, used to find the passage again when the file changed while it was closed. */
  text: string;
  note: string;
  /** Name of the group the highlight belongs to; empty means "no group". */
  group: string;
  color: HighlightColor;
  created: number;
}

export const MAX_HIGHLIGHTS = 2000;
export const MAX_HIGHLIGHT_TEXT = 4000;
export const MAX_NOTE = 2000;
export const MAX_GROUP = 60;

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === "string" && (HIGHLIGHT_COLORS as readonly string[]).includes(value);
}

export function samePath(a: string, b: string): boolean { return normalizeSessionPath(a) === normalizeSessionPath(b); }

/** A passage cut to `limit` characters on one line, for lists and tooltips. */
export function shorten(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export function highlightsOfFile(list: readonly Highlight[], path: string): Highlight[] { return list.filter(item => samePath(item.path, path)); }

/** The highlights of a file that overlap `from..to`; for an empty range (a caret) those that contain it, edges included. */
export function highlightsTouching(list: readonly Highlight[], path: string, from: number, to: number): Highlight[] {
  return highlightsOfFile(list, path).filter(item => (from === to ? item.from <= from && from <= item.to : item.from < to && from < item.to));
}

export interface NewHighlight { path: string; from: number; to: number; text: string; color: HighlightColor; id: string; now: number }

/** Adds a highlight; an empty passage, one that overlaps another highlight of the file, or one beyond the limit is not added. */
export function addHighlight(list: readonly Highlight[], input: NewHighlight): Highlight[] {
  if (input.to <= input.from || !input.text.trim() || list.length >= MAX_HIGHLIGHTS) return [...list];
  if (highlightsTouching(list, input.path, input.from, input.to).length) return [...list];
  const item: Highlight = { id: input.id, path: input.path, from: input.from, to: input.to, text: input.text.slice(0, MAX_HIGHLIGHT_TEXT), note: "", group: "", color: input.color, created: input.now };
  return [...list, item];
}

export function removeHighlight(list: readonly Highlight[], id: string): Highlight[] { return list.filter(item => item.id !== id); }

export function removeHighlights(list: readonly Highlight[], ids: ReadonlySet<string>): Highlight[] { return list.filter(item => !ids.has(item.id)); }

/** Changes the note, group or colour of a highlight; text is trimmed and limited. */
export function editHighlight(list: readonly Highlight[], id: string, changes: { note?: string; group?: string; color?: HighlightColor }): Highlight[] {
  return list.map(item => {
    if (item.id !== id) return item;
    return {
      ...item,
      note: changes.note === undefined ? item.note : changes.note.trim().slice(0, MAX_NOTE),
      group: changes.group === undefined ? item.group : changes.group.trim().slice(0, MAX_GROUP),
      color: changes.color && isHighlightColor(changes.color) ? changes.color : item.color,
    };
  });
}

/** Moves a highlight to where its text is now (after the document was edited). */
export function moveHighlight(list: readonly Highlight[], id: string, place: { from: number; to: number; text: string }): Highlight[] {
  return list.map(item => (item.id === id ? { ...item, from: place.from, to: place.to, text: place.text.slice(0, MAX_HIGHLIGHT_TEXT) } : item));
}

/** A renamed or moved file or folder keeps its highlights. */
export function renamePath(list: readonly Highlight[], from: string, to: string): Highlight[] {
  const fromKey = normalizeSessionPath(from);
  const toNormal = to.replace(/[\\/]+$/, "");
  return list.map(item => {
    const key = normalizeSessionPath(item.path);
    if (key === fromKey) return { ...item, path: to };
    if (key.startsWith(`${fromKey}/`)) {
      const rest = item.path.replace(/\\/g, "/").slice(from.replace(/\\/g, "/").replace(/\/+$/, "").length);
      const separator = to.includes("\\") ? "\\" : "/";
      return { ...item, path: toNormal + rest.replace(/\//g, separator) };
    }
    return item;
  });
}

export function removeFile(list: readonly Highlight[], path: string): Highlight[] { return list.filter(item => !samePath(item.path, path)); }

/** Highlights in the order of reading: by file, then by position. */
export function sortHighlights(list: readonly Highlight[]): Highlight[] {
  return [...list].sort((a, b) => normalizeSessionPath(a.path).localeCompare(normalizeSessionPath(b.path)) || a.from - b.from);
}

/** The next (1) or previous (-1) highlight from a position, continuing into the next file and wrapping around. */
export function neighbourHighlight(list: readonly Highlight[], here: { path: string | null; position: number }, direction: 1 | -1): Highlight | undefined {
  const sorted = sortHighlights(list);
  if (!sorted.length) return undefined;
  if (!here.path) return direction === 1 ? sorted[0] : sorted[sorted.length - 1];
  const herePath = normalizeSessionPath(here.path);
  const order = (item: Highlight) => [normalizeSessionPath(item.path), item.from] as const;
  const cmp = (item: Highlight): number => {
    const [path, from] = order(item);
    return path.localeCompare(herePath) || from - here.position;
  };
  if (direction === 1) return sorted.find(item => cmp(item) > 0) ?? sorted[0];
  return [...sorted].reverse().find(item => cmp(item) < 0) ?? sorted[sorted.length - 1];
}

/** The group names in use, sorted. */
export function groupNames(list: readonly Highlight[]): string[] {
  return [...new Set(list.map(item => item.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Highlights whose text, note, group or file contain every word of the query. */
export function filterHighlights(list: readonly Highlight[], query: string): Highlight[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...list];
  return list.filter(item => {
    const haystack = `${item.text} ${item.note} ${item.group} ${item.path}`.toLocaleLowerCase();
    return words.every(word => haystack.includes(word));
  });
}

export interface HighlightGroup { key: string; label: string; items: Highlight[] }

/** The highlights in sections: one per file, or one per group (highlights without a group come last under `noGroupLabel`). */
export function groupHighlights(list: readonly Highlight[], by: "file" | "group", labels: { noGroup: string; fileName: (path: string) => string }): HighlightGroup[] {
  const sorted = sortHighlights(list);
  const sections = new Map<string, HighlightGroup>();
  for (const item of sorted) {
    const key = by === "file" ? normalizeSessionPath(item.path) : item.group.toLocaleLowerCase();
    const label = by === "file" ? labels.fileName(item.path) : item.group || labels.noGroup;
    const section = sections.get(key);
    if (section) section.items.push(item); else sections.set(key, { key, label, items: [item] });
  }
  const result = [...sections.values()];
  if (by === "group") result.sort((a, b) => (a.key === "" ? 1 : 0) - (b.key === "" ? 1 : 0) || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  return result;
}

/** All highlights as Markdown: a heading per file or group, each passage as a quotation with its note below. */
export function highlightsToMarkdown(list: readonly Highlight[], by: "file" | "group", labels: { noGroup: string; fileName: (path: string) => string; title: string }): string {
  const sections = groupHighlights(list, by, labels);
  const lines: string[] = [`# ${labels.title}`, ""];
  for (const section of sections) {
    lines.push(`## ${section.label}`, "");
    for (const item of section.items) {
      for (const line of item.text.split("\n")) lines.push(`> ${line}`.trimEnd());
      if (item.note) lines.push("", item.note);
      if (by === "group" && item.path) lines.push("", `— ${labels.fileName(item.path)}`);
      lines.push("");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Where a highlight is now in `documentText`: where it was if its text is still there, else the nearest place that holds
 * the same text. Null when the text is gone (the highlight stays in the list, marked as not found).
 */
export function relocateHighlight(item: Pick<Highlight, "from" | "to" | "text">, documentText: string): { from: number; to: number } | null {
  if (!item.text) return null;
  // The stored text is limited, so a long passage is recognised by its beginning and keeps its length.
  const span = Math.max(item.to - item.from, item.text.length);
  if (documentText.startsWith(item.text, item.from)) return { from: item.from, to: item.from + span };
  const before = documentText.lastIndexOf(item.text, item.from);
  const after = documentText.indexOf(item.text, item.from);
  const candidates = [before, after].filter(index => index >= 0);
  if (!candidates.length) return null;
  const start = candidates.reduce((best, index) => (Math.abs(index - item.from) < Math.abs(best - item.from) ? index : best));
  return { from: start, to: Math.min(start + span, documentText.length) };
}

/** The text of a passage as it is shown after Markdown is rendered (best effort), used to find it in the preview. */
export function plainText(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>+|[-+*]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~|==|`)/g, "")
    .replace(/(^|[^\w*])\*(?=\S)|(?<=\S)\*(?=[^\w*]|$)/g, "$1")
    .replace(/(^|\W)_(?=\S)|(?<=\S)_(?=\W|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isHighlight(value: unknown): value is Highlight {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length > 0 && typeof item.path === "string" && item.path.length > 0
    && Number.isInteger(item.from) && (item.from as number) >= 0 && Number.isInteger(item.to) && (item.to as number) > (item.from as number)
    && typeof item.text === "string" && item.text.length > 0 && typeof item.note === "string" && typeof item.group === "string"
    && isHighlightColor(item.color) && typeof item.created === "number";
}

/** Reads stored highlights; anything malformed is dropped, ids stay unique, and the list is limited. */
export function parseStoredHighlights(raw: string | null): Highlight[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Highlight[] = [];
  for (const item of value) {
    if (!isHighlight(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({ ...item, text: item.text.slice(0, MAX_HIGHLIGHT_TEXT), note: item.note.slice(0, MAX_NOTE), group: item.group.slice(0, MAX_GROUP) });
    if (result.length >= MAX_HIGHLIGHTS) break;
  }
  return result;
}

/** The highlights of one document as they are written in its config file: without a path, in the order of the document. */
export function highlightEntries(list: readonly Highlight[]): Omit<Highlight, "path">[] {
  return [...list].sort((a, b) => a.from - b.from).map(({ path: _path, ...rest }) => rest);
}

/** The highlights in a list read from a config file, placed in the document at `path`; malformed entries are dropped. */
export function parseHighlightList(list: unknown, path: string): Highlight[] {
  if (!Array.isArray(list)) return [];
  return parseStoredHighlights(JSON.stringify(list.map(item => (typeof item === "object" && item !== null ? { ...item, path } : item))));
}

/** True when two lists hold the same highlights of a document (the order and the path do not matter). */
export function sameHighlightContent(a: readonly Highlight[], b: readonly Highlight[]): boolean {
  const text = (list: readonly Highlight[]) => JSON.stringify(highlightEntries([...list].sort((x, y) => x.id.localeCompare(y.id))));
  return text(a) === text(b);
}

/**
 * Replaces the highlights of one file with `replacement` (read from its config file). A copied document brings a copy
 * of its config file with the same ids, so an id that another file already uses is renewed with `makeId`.
 */
export function replaceFileHighlights(list: readonly Highlight[], path: string, replacement: readonly Highlight[], makeId: () => string): Highlight[] {
  const others = list.filter(item => !samePath(item.path, path));
  const used = new Set(others.map(item => item.id));
  const fresh = replacement.slice(0, Math.max(0, MAX_HIGHLIGHTS - others.length)).map(item => {
    let id = item.id;
    while (used.has(id)) id = makeId();
    used.add(id);
    return { ...item, path, id };
  });
  return [...others, ...fresh];
}
