/** Pure helpers for hiding sections of a Markdown document: which lines a hidden section covers, and its sidecar config file. */

export interface SectionHeading { level: number; text: string; line: number; key: string }

/** Lines of a hidden section (1-based, inclusive), starting at its heading. */
export interface HiddenRange { key: string; title: string; startLine: number; endLine: number }

/** A section is identified by the level and text of its heading and by which occurrence of that pair it is. */
export function sectionKey(level: number, text: string, occurrence: number): string { return `${level}:${text}:${occurrence}`; }

/**
 * The line ranges covered by the hidden sections: each hidden heading and everything up to the next heading of the same
 * or a higher level (so its sub-sections go with it). Sections inside an already hidden one do not produce ranges of
 * their own. `headings` must be in document order.
 */
export function hiddenRangesFor(headings: readonly SectionHeading[], hiddenKeys: ReadonlySet<string>, totalLines: number): HiddenRange[] {
  const ranges: HiddenRange[] = [];
  let coveredUntil = 0;
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    if (!hiddenKeys.has(heading.key) || heading.line <= coveredUntil || heading.line > totalLines) continue;
    let end = totalLines;
    for (let next = index + 1; next < headings.length; next++) {
      if (headings[next].level <= heading.level) { end = Math.min(totalLines, headings[next].line - 1); break; }
    }
    if (end < heading.line) end = heading.line;
    ranges.push({ key: heading.key, title: heading.text, startLine: heading.line, endLine: end });
    coveredUntil = end;
  }
  return ranges;
}

/**
 * Ranges to hide so that only one section stays visible: everything before and after the focused heading's section,
 * plus the explicitly hidden sections that lie inside it. Null when no heading has that key. A hidden section that
 * contains the focused heading is ignored, since the user asked to see this one.
 */
export function focusRangesFor(headings: readonly SectionHeading[], focusKey: string, hidden: readonly HiddenRange[], totalLines: number): HiddenRange[] | null {
  const index = headings.findIndex(heading => heading.key === focusKey);
  if (index < 0 || headings[index].line > totalLines) return null;
  const focus = headings[index];
  let end = totalLines;
  for (let next = index + 1; next < headings.length; next++) {
    if (headings[next].level <= focus.level) { end = Math.min(totalLines, headings[next].line - 1); break; }
  }
  if (end < focus.line) end = focus.line;
  const ranges: HiddenRange[] = [];
  if (focus.line > 1) ranges.push({ key: "focus:before", title: "", startLine: 1, endLine: focus.line - 1 });
  for (const range of hidden) if (range.startLine > focus.line && range.endLine <= end) ranges.push(range);
  if (end < totalLines) ranges.push({ key: "focus:after", title: "", startLine: end + 1, endLine: totalLines });
  return ranges;
}

/** Keys of the headings that are hidden themselves or lie inside a hidden section. */
export function keysInsideRanges(headings: readonly SectionHeading[], ranges: readonly HiddenRange[]): Set<string> {
  const keys = new Set<string>();
  for (const heading of headings) if (ranges.some(range => heading.line >= range.startLine && heading.line <= range.endLine)) keys.add(heading.key);
  return keys;
}

/** The text without the hidden lines (used for print and export). */
export function removeHiddenLines(text: string, ranges: readonly HiddenRange[]): string {
  if (!ranges.length) return text;
  const lines = text.split("\n");
  const kept: string[] = [];
  let rangeIndex = 0;
  lines.forEach((line, offset) => {
    const number = offset + 1;
    while (rangeIndex < ranges.length && ranges[rangeIndex].endLine < number) rangeIndex++;
    const range = ranges[rangeIndex];
    if (!(range && number >= range.startLine && number <= range.endLine)) kept.push(line);
  });
  return kept.join("\n");
}

/** Name of the config file next to a Markdown file: the file's own name plus `.config.json`. */
export function sectionConfigPath(documentPath: string): string { return `${documentPath}.config.json`; }

interface StoredSection { level: number; title: string; occurrence: number }

/** The hidden section keys stored in a config file's text; anything malformed is ignored. */
export function parseSectionConfig(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = (parsed as { hiddenSections?: unknown } | null)?.hiddenSections;
    if (!Array.isArray(list)) return [];
    const keys: string[] = [];
    for (const item of list as Partial<StoredSection>[]) {
      if (item && Number.isInteger(item.level) && typeof item.title === "string" && Number.isInteger(item.occurrence)) {
        keys.push(sectionKey(item.level as number, item.title, item.occurrence as number));
      }
    }
    return [...new Set(keys)];
  } catch { return []; }
}

function storedFromKey(key: string): StoredSection | null {
  const match = /^(\d+):([\s\S]*):(\d+)$/.exec(key);
  return match ? { level: Number(match[1]), title: match[2], occurrence: Number(match[3]) } : null;
}

/** The section kept as the only visible one, as stored in a config file's text; null when there is none. */
export function parseFocusedSection(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const item = (JSON.parse(raw) as { focusedSection?: Partial<StoredSection> } | null)?.focusedSection;
    return item && Number.isInteger(item.level) && typeof item.title === "string" && Number.isInteger(item.occurrence) ? sectionKey(item.level as number, item.title, item.occurrence as number) : null;
  } catch { return null; }
}

/** The config file's text for the given hidden keys (`level:title:occurrence`) and the optional "show only this section" key. */
export function serializeSectionConfig(documentName: string, keys: Iterable<string>, focusKey: string | null = null): string {
  const sections: StoredSection[] = [];
  for (const key of keys) { const stored = storedFromKey(key); if (stored) sections.push(stored); }
  const focused = focusKey ? storedFromKey(focusKey) : null;
  return JSON.stringify({ version: 1, document: documentName, hiddenSections: sections, ...(focused ? { focusedSection: focused } : {}) }, null, 2) + "\n";
}
