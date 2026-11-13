/** Renaming a section: which `[[links]]` have to change so that they keep pointing at it. Pure (no DOM, no files): it gets the texts and says which characters to replace. It resolves links exactly like the section graph does, so a link is rewritten only when the graph would have drawn it to the renamed section. */
import { consumeFenceLine, HEADING_PATTERN, normalizeFileKey, WIKI_LINK_PATTERN, type FenceState } from "./section-model.js";

export interface RenameRequest {
  /** The file of the renamed section and the line of its heading (1-based), in the text given for that file (which already has the new heading). */
  path: string;
  line: number;
  oldTitle: string;
  newTitle: string;
}

export interface SourceText { path: string; name: string; text: string }
export interface TextEdit { from: number; to: number; insert: string }
export interface FilePlan { path: string; edits: TextEdit[] }

export interface RenamePlan {
  files: FilePlan[];
  /** How many links will be rewritten. */
  linkCount: number;
  /** Links that might point at the renamed section but could not be told from links to another section with the same title; they are left as they are. */
  ambiguous: number;
  /** The new title cannot be written inside a link (it contains `[`, `]`, `|` or `#`), so no link can be updated. */
  blocked: boolean;
}

interface Heading { path: string; name: string; line: number; title: string }

const NO_PLAN: RenamePlan = { files: [], linkCount: 0, ambiguous: 0, blocked: false };
/** Whether the file part of a link names a file (a path or a name with an extension) rather than a section title. */
const isFileTarget = (raw: string): boolean => /[\\/]/.test(raw) || /\.[a-z0-9]{1,8}$/i.test(raw);
const LINK_WITH_INDICES =new RegExp(WIKI_LINK_PATTERN.source, "gd");

/** Characters that end or split a link target: a title containing them cannot be part of a link. */
export const canBeLinkTitle = (title: string): boolean => title.trim() !== "" && !/[[\]|#\r\n]/.test(title);

/** The title of a heading as the section graph sees it. */
const titleOf = (raw: string): string => raw.replace(/\s+\{#.*?\}\s*$/, "").trim();

/** The title of a heading line (null when the line is not an ATX heading); a line inside a code fence is not told apart here. */
export function headingTitleOfLine(line: string): string | null {
  const match = HEADING_PATTERN.exec(line);
  return match ? titleOf(match[2]) : null;
}

/** The lines of a text with the offset each starts at. */
function splitLines(text: string): { lines: string[]; starts: number[] } {
  const lines: string[] = [], starts: number[] = [];
  let at = 0;
  while (at <= text.length) {
    const end = text.indexOf("\n", at);
    const stop = end < 0 ? text.length : end;
    lines.push(text.slice(at, stop).replace(/\r$/, ""));
    starts.push(at);
    if (end < 0) break;
    at = end + 1;
  }
  return { lines, starts };
}

/** The headings of a text (outside code fences), as the section graph finds them. */
function headingsOf(source: SourceText, lines: readonly string[]): Heading[] {
  const found: Heading[] = [];
  const fence: FenceState = { marker: null, length: 0 };
  lines.forEach((line, index) => {
    if (consumeFenceLine(fence, line) || fence.marker) return;
    const match = HEADING_PATTERN.exec(line);
    if (match) found.push({ path: source.path, name: source.name, line: index + 1, title: titleOf(match[2]) });
  });
  return found;
}

/** Spans of inline code in a line: a link written inside them is shown as text, not as a link. */
function inlineCodeSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  const pattern = /(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) spans.push([match.index, match.index + match[0].length]);
  return spans;
}

interface Resolved { section: Heading | undefined; ambiguous: boolean; span: [number, number] | null }

class Index {
  readonly byTitle = new Map<string, Heading[]>();
  readonly byPath = new Map<string, Heading[]>();
  readonly byFile = new Map<string, Heading[]>();

  add(heading: Heading): void {
    for (const [map, key] of [[this.byTitle, heading.title.toLocaleLowerCase()], [this.byPath, normalizeFileKey(heading.path)], [this.byFile, normalizeFileKey(heading.name)]] as const) {
      const bucket = map.get(key);
      if (bucket) bucket.push(heading); else map.set(key, [heading]);
    }
  }

  /** What a link points at, resolved like `resolveWikiLink` of the section graph, and the characters of the link that hold the section's title (null when the link does not name a section). */
  resolve(match: RegExpExecArray & { indices?: [number, number][] }, sourcePath: string, target: Heading): Resolved {
    const rawFileTarget = (match[1] || "").trim();
    const rawAnchor = (match[2] || "").trim();
    const span = (group: 1 | 2): [number, number] | null => {
      const range = match.indices?.[group];
      if (!range) return null;
      const text = match[group] ?? "";
      const lead = text.length - text.trimStart().length;
      return [range[0] + lead, range[0] + lead + text.trim().length];
    };
    const looksLikeFileTarget = /[\\/]/.test(rawFileTarget) || /\.[a-z0-9]{1,8}$/i.test(rawFileTarget);
    if (rawFileTarget && looksLikeFileTarget) {
      const targetPath = normalizeFileKey(rawFileTarget.replace(/\\/g, "/"));
      const normalizedSource = normalizeFileKey(sourcePath);
      const sourceDirectory = normalizedSource.includes("/") ? normalizedSource.slice(0, normalizedSource.lastIndexOf("/") + 1) : "";
      const relativeTargetPath = targetPath.startsWith("/") ? targetPath : `${sourceDirectory}${targetPath}`;
      const basename = targetPath.split("/").pop() || targetPath;
      const candidates = this.byPath.get(relativeTargetPath) || this.byPath.get(`${relativeTargetPath}.md`) || this.byPath.get(targetPath) || this.byPath.get(`${targetPath}.md`)
        || this.byFile.get(basename) || this.byFile.get(basename.endsWith(".md") ? basename : `${basename}.md`);
      if (!candidates?.length) return { section: undefined, ambiguous: false, span: null };
      if (!rawAnchor) return { section: candidates[0], ambiguous: false, span: null };
      const named = candidates.filter(candidate => candidate.title.toLocaleLowerCase() === rawAnchor.toLocaleLowerCase());
      return { section: named[0], ambiguous: named.length > 1 && named[0] === target, span: span(2) };
    }
    const titleTarget = (rawAnchor || rawFileTarget).replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,8}$/i, "").toLocaleLowerCase();
    const candidates = this.byTitle.get(titleTarget) || [];
    const section = candidates.find(candidate => candidate.path === sourcePath) || candidates[0];
    // A link from another file to a title that several sections share may mean any of them: it is not touched.
    const ambiguous = section === target && sourcePath !== target.path && candidates.length > 1;
    return { section, ambiguous, span: span(rawAnchor ? 2 : 1) };
  }
}

/** The text with the edits applied (they must not overlap). */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to);
  return out;
}

/**
 * Works out the links to rewrite when a section is renamed. `sources` are the current texts of every Markdown file
 * that can link to it (the renamed section's own file with its new heading already in place).
 */
export function planLinkRename(sources: readonly SourceText[], request: RenameRequest, options: { qualify?: boolean } = {}): RenamePlan {
  if (!canBeLinkTitle(request.newTitle)) {
    // Nothing can be written, but the caller may still want to say that links exist that were not updated.
    const probe = planLinkRename(sources, { ...request, newTitle: "x" });
    return { files: [], linkCount: probe.linkCount, ambiguous: probe.ambiguous, blocked: true };
  }
  const oldLower = request.oldTitle.trim().toLocaleLowerCase();
  // Links match titles without regard to case, so a change of case alone leaves every link working.
  if (!oldLower || oldLower === request.newTitle.trim().toLocaleLowerCase()) return NO_PLAN;

  const split = new Map(sources.map(source => [source.path, splitLines(source.text)]));
  const index = new Index();
  let target: Heading | undefined;
  for (const source of sources) {
    for (const heading of headingsOf(source, split.get(source.path)!.lines)) {
      // The renamed section is indexed under its old title: that is how the links that exist now were resolved.
      if (source.path === request.path && heading.line === request.line) { heading.title = request.oldTitle.trim(); target = heading; }
      index.add(heading);
    }
  }
  if (!target) return NO_PLAN;

  const files: FilePlan[] = [];
  const allPaths = sources.map(source => source.path);
  let linkCount = 0, ambiguous = 0;
  for (const source of sources) {
    const { lines, starts } = split.get(source.path)!;
    const edits: TextEdit[] = [];
    const fence: FenceState = { marker: null, length: 0 };
    lines.forEach((line, lineIndex) => {
      if (consumeFenceLine(fence, line) || fence.marker || !line.includes("[[")) return;
      const code = inlineCodeSpans(line);
      LINK_WITH_INDICES.lastIndex = 0;
      for (let match = LINK_WITH_INDICES.exec(line) as (RegExpExecArray & { indices?: [number, number][] }) | null; match; match = LINK_WITH_INDICES.exec(line) as (RegExpExecArray & { indices?: [number, number][] }) | null) {
        if (code.some(([from, to]) => match!.index >= from && match!.index < to)) continue;
        const resolved = index.resolve(match, source.path, target!);
        if (resolved.section !== target) continue;
        if (resolved.ambiguous) { ambiguous++; continue; }
        const span = resolved.span;
        if (!span || line.slice(span[0], span[1]).toLocaleLowerCase() !== oldLower) continue;
        // A link that named only the title now names the file too (`[[File.md#New title]]`): every link then says which header of which file it means.
        const bare = options.qualify && !match[2] && !isFileTarget((match[1] || "").trim());
        const insert = bare ? `${linkPathFor(source.path, target!.path, allPaths)}#${request.newTitle.trim()}` : request.newTitle.trim();
        edits.push({ from: starts[lineIndex] + span[0], to: starts[lineIndex] + span[1], insert });
      }
    });
    if (edits.length) { files.push({ path: source.path, edits }); linkCount += edits.length; }
  }
  return { files, linkCount, ambiguous, blocked: false };
}

export interface LinkTarget { path: string; line: number; title: string }

/** Where a link written in `sourcePath` leads (`inner` is the text between `[[` and `]]`), resolved like the section graph does; null when no section matches. */
export function resolveLinkTarget(sources: readonly SourceText[], sourcePath: string, inner: string): LinkTarget | null {
  const match = new RegExp(WIKI_LINK_PATTERN.source).exec(`[[${inner}]]`);
  if (!match) return null;
  const index = new Index();
  for (const source of sources) for (const heading of headingsOf(source, splitLines(source.text).lines)) index.add(heading);
  const found = index.resolve(match as RegExpExecArray, sourcePath, { path: "", name: "", line: 0, title: "" }).section;
  return found ? { path: found.path, line: found.line, title: found.title } : null;
}

/** What the links of a text name, lowercased (a title, an anchor, a file name): enough to tell which files may hold a link to a given title without reading them again. Links in code are not links. */
export function linkKeysOf(text: string): string[] {
  const keys = new Set<string>();
  const fence: FenceState = { marker: null, length: 0 };
  for (const line of splitLines(text).lines) {
    if (consumeFenceLine(fence, line) || fence.marker || !line.includes("[[")) continue;
    const code = inlineCodeSpans(line);
    for (const match of line.matchAll(WIKI_LINK_PATTERN)) {
      if (code.some(([from, to]) => match.index! >= from && match.index! < to)) continue;
      const file = (match[1] || "").trim(), anchor = (match[2] || "").trim();
      for (const key of [anchor, file, file.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,8}$/i, "")]) if (key) keys.add(key.toLocaleLowerCase());
    }
  }
  return [...keys];
}

/** The links that name only a title, written out in full (`[[Title]]` → `[[File.md#Title]]`), so that each says which header of which file it means. A title that several sections share is not guessed (counted as ambiguous), and a link to no section is left alone. */
export function planQualifyLinks(sources: readonly SourceText[]): RenamePlan {
  const split = new Map(sources.map(source => [source.path, splitLines(source.text)]));
  const index = new Index();
  for (const source of sources) for (const heading of headingsOf(source, split.get(source.path)!.lines)) index.add(heading);
  const allPaths = sources.map(source => source.path);
  const none: Heading = { path: "", name: "", line: 0, title: "" };
  const files: FilePlan[] = [];
  let linkCount = 0, ambiguous = 0;
  for (const source of sources) {
    const { lines, starts } = split.get(source.path)!;
    const edits: TextEdit[] = [];
    const fence: FenceState = { marker: null, length: 0 };
    lines.forEach((line, lineIndex) => {
      if (consumeFenceLine(fence, line) || fence.marker || !line.includes("[[")) return;
      const code = inlineCodeSpans(line);
      for (const match of line.matchAll(LINK_WITH_INDICES) as IterableIterator<RegExpExecArray & { indices?: [number, number][] }>) {
        if (code.some(([from, to]) => match.index >= from && match.index < to)) continue;
        if (match[2] || !(match[1] || "").trim() || isFileTarget((match[1] || "").trim())) continue;
        const { section, span } = index.resolve(match, source.path, none);
        if (!section || !span || !canBeLinkTitle(section.title)) continue;
        const sharing = index.byTitle.get(section.title.toLocaleLowerCase()) ?? [];
        if (sharing.length > 1 && !sharing.some(candidate => candidate.path === source.path)) { ambiguous++; continue; }
        edits.push({ from: starts[lineIndex] + span[0], to: starts[lineIndex] + span[1], insert: `${linkPathFor(source.path, section.path, allPaths)}#${section.title}` });
      }
    });
    if (edits.length) { files.push({ path: source.path, edits }); linkCount += edits.length; }
  }
  return { files, linkCount, ambiguous, blocked: false };
}

export interface SectionTitle { title: string; line: number }

/** The titles of the sections of a text (outside code fences), with their lines: what a link to a section of that file may name. */
export function sectionTitles(text: string): SectionTitle[] {
  return headingsOf({ path: "", name: "", text }, splitLines(text).lines).map(heading => ({ title: heading.title, line: heading.line }));
}

const stem = (name: string): string => name.replace(/\.[a-z0-9]{1,8}$/i, "").toLocaleLowerCase();

/** How a link names a file: its name when that is unique among `allPaths`, else its path relative to the folder of the document the link is in. */
export function linkPathFor(sourcePath: string, filePath: string, allPaths: readonly string[]): string {
  const parts = (path: string): string[] => path.split(/[\\/]/);
  const name = parts(filePath).pop() ?? filePath;
  const same = allPaths.filter(path => path !== filePath && stem(parts(path).pop() ?? "") === stem(name));
  if (!same.length) return name;
  const from = parts(sourcePath).slice(0, -1), to = parts(filePath);
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common].toLocaleLowerCase() === to[common].toLocaleLowerCase()) common++;
  return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}

/** Whether `typed` (the file part of a link as written) names the file: by its name or its path, with or without the extension. */
export function linkNamesFile(sourcePath: string, filePath: string, allPaths: readonly string[], typed: string): boolean {
  const wanted = typed.trim().replace(/\\/g, "/").toLocaleLowerCase();
  const written = linkPathFor(sourcePath, filePath, allPaths).toLocaleLowerCase();
  return wanted === written || wanted === stem(written) || wanted === (filePath.split(/[\\/]/).pop() ?? "").toLocaleLowerCase() || wanted === stem(filePath.split(/[\\/]/).pop() ?? "");
}

/** One link, in some file, that leads into another file. */
export interface LinkOccurrence {
  path: string;
  name: string;
  /** The line of the link (1-based). */
  line: number;
  /** The line it stands in, trimmed and shortened. */
  text: string;
  /** The text between `[[` and `]]`. */
  inner: string;
  /** The section the link leads to. */
  targetTitle: string;
  targetLine: number;
}

const OCCURRENCE_TEXT = 200;
const NO_TARGET: Heading = { path: "", name: "", line: 0, title: "" };

/**
 * Every link in `sources` that leads into the file `targetPath`, resolved the way the section graph does (a link to a title, to a file, to a section of a file).
 * Links inside the file itself are not counted, and a link in code is not a link.
 */
export function linksInto(sources: readonly SourceText[], targetPath: string): LinkOccurrence[] {
  const split = new Map(sources.map(source => [source.path, splitLines(source.text)]));
  const index = new Index();
  for (const source of sources) for (const heading of headingsOf(source, split.get(source.path)!.lines)) index.add(heading);
  const found: LinkOccurrence[] = [];
  for (const source of sources) {
    if (source.path === targetPath) continue;
    const fence: FenceState = { marker: null, length: 0 };
    split.get(source.path)!.lines.forEach((line, lineIndex) => {
      if (consumeFenceLine(fence, line) || fence.marker || !line.includes("[[")) return;
      const code = inlineCodeSpans(line);
      for (const match of line.matchAll(WIKI_LINK_PATTERN)) {
        if (code.some(([from, to]) => match.index! >= from && match.index! < to)) continue;
        const section = index.resolve(match as RegExpExecArray, source.path, NO_TARGET).section;
        if (!section || section.path !== targetPath) continue;
        const text = line.trim();
        found.push({ path: source.path, name: source.name, line: lineIndex + 1, text: text.length > OCCURRENCE_TEXT ? `${text.slice(0, OCCURRENCE_TEXT)}…` : text, inner: match[0].slice(2, -2), targetTitle: section.title, targetLine: section.line });
      }
    });
  }
  return found;
}
