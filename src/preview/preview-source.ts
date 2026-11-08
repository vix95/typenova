/** What the preview renders for files that are not Markdown: CSV and TSV become a table, Mermaid files a diagram (pure). */

import { canvasToMarkdown, structuredToMarkdown, type StructuredMessages } from "./structured-preview.js";

export type DelimitedRows = string[][];

/** Splits CSV/TSV text into rows and cells (RFC 4180: quoted cells may hold the delimiter, quotes and line breaks). */
export function parseDelimited(text: string, delimiter: string): DelimitedRows {
  const rows: DelimitedRows = [];
  let row: string[] = [], cell = "", quoted = false;
  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') { if (text[index + 1] === '"') { cell += '"'; index++; } else quoted = false; }
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) endCell();
    else if (char === "\n") endRow();
    else if (char === "\r") { if (text[index + 1] === "\n") index++; endRow(); }
    else cell += char;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

/** The delimiter of a CSV file: the one of comma, semicolon and tab that is most common (and consistent) in the first lines. */
export function detectDelimiter(text: string, extension: string): string {
  if (extension === "tsv") return "\t";
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 10);
  let best = ",", bestScore = -1;
  for (const candidate of [",", ";", "\t"]) {
    const counts = lines.map(line => parseDelimited(line, candidate)[0]?.length ?? 1);
    const consistent = counts.every(count => count === counts[0]);
    const score = counts[0] > 1 ? counts[0] * (consistent ? 10 : 1) : 0;
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}

const MAX_ROWS = 2000, MAX_COLUMNS = 60;
const escapeCell = (cell: string) => cell.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").replace(/\s+$/, "");

/** A Markdown table of the data, with the first row as the header (large files are cut, with a note). */
export function csvToMarkdown(text: string, extension: string, notes: { truncated: (rows: number, total: number) => string }): string {
  const rows = parseDelimited(text, detectDelimiter(text, extension)).filter(row => row.some(cell => cell.trim() !== ""));
  if (!rows.length) return "";
  const columns = Math.min(MAX_COLUMNS, Math.max(...rows.map(row => row.length)));
  const shown = rows.slice(0, MAX_ROWS + 1);
  const line = (row: string[]) => `| ${Array.from({ length: columns }, (_, column) => escapeCell(row[column] ?? "")).join(" | ")} |`;
  const out = [line(shown[0]), `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`, ...shown.slice(1).map(line)];
  if (rows.length > shown.length) out.push("", notes.truncated(shown.length - 1, rows.length - 1));
  return out.join("\n");
}

/** The longest run of backticks in a text, to choose a fence that cannot be closed by the content. */
function fenceFor(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
  return "`".repeat(longest + 1);
}

/** Wraps Mermaid source so that the Markdown renderer draws it as a diagram. */
export function mermaidToMarkdown(text: string): string {
  const fence = fenceFor(text);
  return `${fence}mermaid\n${text}\n${fence}`;
}

export type PreviewKind = "table" | "diagram" | "json" | "xml" | "canvas";

export function previewSourceFor(kind: PreviewKind, extension: string, text: string, truncatedNote: (rows: number, total: number) => string, messages?: StructuredMessages): string {
  if (kind === "canvas") return canvasToMarkdown(text, messages);
  if (kind === "json" || kind === "xml") return structuredToMarkdown(kind, text, messages);
  return kind === "table" ? csvToMarkdown(text, extension, { truncated: truncatedNote }) : mermaidToMarkdown(text);
}
