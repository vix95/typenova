/** Formatting and validation of whole documents by type: JSON, JSON Lines, YAML (comments kept), TOML (validated), XML and Markdown tables (pure, no editor). */
import { parseDocument } from "yaml";
import { parse as parseToml } from "smol-toml";

export type FormatResult = { ok: true; text: string; note?: string } | { ok: false; message: string; line?: number; column?: number };

const lineColumnAt = (text: string, offset: number) => {
  const before = text.slice(0, Math.max(0, offset));
  const line = before.split("\n").length;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) + 1 };
};

type FormatFailure = Extract<FormatResult, { ok: false }>;

function jsonError(text: string, error: unknown): FormatFailure {
  const message = error instanceof Error ? error.message : String(error);
  const position = /position (\d+)/.exec(message), lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn) return { ok: false, message, line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
  if (position) return { ok: false, message, ...lineColumnAt(text, Number(position[1])) };
  return { ok: false, message };
}

function formatJson(text: string): FormatResult {
  try {
    const formatted = JSON.stringify(JSON.parse(text), null, 2);
    return { ok: true, text: formatted + (text.endsWith("\n") ? "\n" : "") };
  } catch (error) { return jsonError(text, error); }
}

function formatJsonLines(text: string): FormatResult {
  const out: string[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) { out.push(lines[index]); continue; }
    try { out.push(JSON.stringify(JSON.parse(lines[index]))); }
    catch (error) { const failed = jsonError(lines[index], error); return { ok: false, message: failed.message, line: index + 1, column: failed.column }; }
  }
  return { ok: true, text: out.join("\n") };
}

function formatYaml(text: string): FormatResult {
  const document = parseDocument(text);
  if (document.errors.length) {
    const error = document.errors[0];
    return { ok: false, message: error.message.split("\n")[0], line: error.linePos?.[0].line, column: error.linePos?.[0].col };
  }
  return { ok: true, text: document.toString({ indent: 2, lineWidth: 0 }) };
}

function validateToml(text: string): FormatResult {
  try { parseToml(text); return { ok: true, text, note: "valid" }; }
  catch (error) {
    const detail = error as { message?: string; line?: number; column?: number };
    return { ok: false, message: String(detail.message ?? error).split("\n")[0], line: detail.line, column: detail.column };
  }
}

const XML_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z_:](?:"[^"]*"|'[^']*'|[^>"'])*>|[^<]+/g;

/** Re-indents XML with two spaces and checks that the tags match. */
function formatXml(text: string): FormatResult {
  const tokens: Array<{ value: string; offset: number }> = [];
  for (let match = XML_TOKEN.exec(text); match; match = XML_TOKEN.exec(text)) tokens.push({ value: match[0], offset: match.index });
  const out: string[] = [], stack: string[] = [];
  const tagName = (tag: string) => /^<\/?([^\s/>]+)/.exec(tag)?.[1] ?? "";
  const indent = () => "  ".repeat(stack.length);
  for (let index = 0; index < tokens.length; index++) {
    const { value, offset } = tokens[index];
    if (!value.startsWith("<")) { const content = value.trim(); if (content) out.push(indent() + content.replace(/\s*\n\s*/g, " ")); continue; }
    if (value.startsWith("</")) {
      const expected = stack.pop();
      if (expected !== tagName(value)) return { ok: false, message: `Unexpected closing tag </${tagName(value)}>${expected ? ` (expected </${expected}>)` : ""}`, ...lineColumnAt(text, offset) };
      out.push(indent() + value); continue;
    }
    const opening = !/^<[!?]/.test(value) && !value.endsWith("/>");
    if (!opening) { out.push(indent() + value); continue; }
    const text1 = tokens[index + 1], close = tokens[index + 2];
    if (text1 && close && !text1.value.startsWith("<") && text1.value.trim() && !text1.value.includes("\n") && close.value === `</${tagName(value)}>`) {
      out.push(indent() + value + text1.value.trim() + close.value); index += 2; continue;
    }
    out.push(indent() + value); stack.push(tagName(value));
  }
  if (stack.length) return { ok: false, message: `Tag <${stack[stack.length - 1]}> is not closed`, line: text.split("\n").length };
  return { ok: true, text: out.join("\n") + (text.endsWith("\n") ? "\n" : "") };
}

const splitRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = []; let current = "";
  for (let index = 0; index < trimmed.length; index++) {
    if (trimmed[index] === "\\" && trimmed[index + 1] === "|") { current += "\\|"; index++; }
    else if (trimmed[index] === "|") { cells.push(current.trim()); current = ""; }
    else current += trimmed[index];
  }
  cells.push(current.trim());
  return cells;
};
const isSeparatorRow = (cells: string[]) => cells.length > 0 && cells.every(cell => /^:?-{1,}:?$/.test(cell));

/** Aligns the columns of every pipe table outside code fences. */
export function formatMarkdownTables(text: string): string {
  const lines = text.split("\n"), out: string[] = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(lines[index])?.[1];
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = null; }
    const headerLine = lines[index], separatorLine = lines[index + 1];
    if (fence || !headerLine.includes("|") || !separatorLine || !separatorLine.includes("-") || !isSeparatorRow(splitRow(separatorLine))) { out.push(headerLine); continue; }
    const rows = [splitRow(headerLine)], separator = splitRow(separatorLine);
    let end = index + 2;
    while (end < lines.length && lines[end].includes("|") && lines[end].trim()) { rows.push(splitRow(lines[end])); end++; }
    const columns = Math.max(rows[0].length, separator.length);
    const widths = Array.from({ length: columns }, (_, column) => Math.max(3, ...rows.map(row => (row[column] ?? "").length)));
    const align = Array.from({ length: columns }, (_, column) => { const cell = separator[column] ?? "---"; return cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : "none"; });
    const pad = (cell: string, column: number) => align[column] === "right" ? cell.padStart(widths[column]) : align[column] === "center" ? cell.padStart(Math.floor((widths[column] + cell.length) / 2)).padEnd(widths[column]) : cell.padEnd(widths[column]);
    const render = (row: string[]) => `| ${Array.from({ length: columns }, (_, column) => pad(row[column] ?? "", column)).join(" | ")} |`;
    const dash = (column: number) => align[column] === "center" ? `:${"-".repeat(widths[column] - 2)}:` : align[column] === "right" ? `${"-".repeat(widths[column] - 1)}:` : align[column] === "left" ? `:${"-".repeat(widths[column] - 1)}` : "-".repeat(widths[column]);
    out.push(render(rows[0]), `| ${Array.from({ length: columns }, (_, column) => dash(column)).join(" | ")} |`, ...rows.slice(1).map(render));
    index = end - 1;
  }
  return out.join("\n");
}

const JSON_EXTENSIONS = new Set(["json", "geojson", "topojson", "webmanifest", "canvas", "excalidraw", "ipynb"]);
const XML_EXTENSIONS = new Set(["xml", "xhtml", "xsd", "xsl", "xslt", "svg", "rss", "atom", "opml", "xaml", "csproj", "vbproj", "fsproj", "props", "targets", "resx", "plist", "drawio", "dtd"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mdx", "rmd", "qmd", "mdc"]);

/** What "Format document" can do for a file name: its label, or null when there is no formatter for the type. */
export function formatterFor(path: string): { kind: string; format: (text: string) => FormatResult } | null {
  const extension = (path.split(/[\\/]/).pop() || path).toLowerCase().split(".").pop() || "";
  if (JSON_EXTENSIONS.has(extension)) return { kind: "JSON", format: formatJson };
  if (extension === "jsonl" || extension === "ndjson") return { kind: "JSON Lines", format: formatJsonLines };
  if (extension === "yaml" || extension === "yml") return { kind: "YAML", format: formatYaml };
  if (extension === "toml") return { kind: "TOML", format: validateToml };
  if (XML_EXTENSIONS.has(extension)) return { kind: "XML", format: formatXml };
  if (MARKDOWN_EXTENSIONS.has(extension)) return { kind: "Markdown", format: text => ({ ok: true, text: formatMarkdownTables(text) }) };
  return null;
}
