/** A note cut into passages for searching and citing: one passage per section (and long sections in pieces), each knowing its file, its heading path and its first line. Pure, no DOM, no files. */

export interface Chunk {
  path: string;
  /** File name, for display and for matching a question that names the file. */
  name: string;
  /** The headings above the passage, outermost first, joined with " › " (empty before the first heading). */
  section: string;
  /** Line of the heading (or of the first line of a continued piece), counted from 1. */
  line: number;
  text: string;
}

/** A section longer than this is cut at a blank line, so that a cited passage stays readable. */
export const MAX_CHUNK_CHARS = 1800;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

interface Open { section: string; line: number; lines: string[] }

/** Where the front matter of a note ends (the line after the closing `---`), or 0 when there is none. */
function frontMatterEnd(lines: readonly string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let index = 1; index < lines.length && index < 200; index++) if (lines[index].trim() === "---" || lines[index].trim() === "...") return index + 1;
  return 0;
}

export function chunkMarkdown(path: string, name: string, text: string): Chunk[] {
  const lines = text.split(/\r?\n/);
  const chunks: Chunk[] = [];
  const stack: { level: number; title: string }[] = [];
  let current: Open = { section: "", line: 1, lines: [] };
  const flush = (): void => {
    const body = current.lines.join("\n").trim();
    const hasBody = current.lines.some((line, index) => (index === 0 && HEADING.test(line) ? false : line.trim() !== ""));
    if (body && hasBody) chunks.push({ path, name, section: current.section, line: current.line, text: body });
  };
  let fenced = false;
  const start = frontMatterEnd(lines);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (FENCE.test(line)) fenced = !fenced;
    const heading = !fenced && index >= start ? HEADING.exec(line) : null;
    if (heading) {
      flush();
      const level = heading[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: heading[2] });
      current = { section: stack.map(item => item.title).join(" › "), line: index + 1, lines: [line] };
      continue;
    }
    // A long section is continued in a new piece at a blank line (never inside a code block).
    if (!fenced && line.trim() === "" && current.lines.join("\n").length > MAX_CHUNK_CHARS) { flush(); current = { section: current.section, line: index + 2, lines: [] }; continue; }
    current.lines.push(line);
  }
  flush();
  return chunks;
}
