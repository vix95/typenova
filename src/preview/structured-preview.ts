/** Preview of JSON and XML (also XAML, RSS, project files...): the structure as a Markdown tree, arrays of objects as tables (pure). */

export type StructuredKind = "json" | "xml";
export interface StructuredMessages {
  invalid: (detail: string) => string;
  limit: (shown: number) => string;
}
export const DEFAULT_MESSAGES: StructuredMessages = {
  invalid: detail => `Cannot show the structure: ${detail}`,
  limit: shown => `Only the first ${shown} items are shown.`,
};

export const JSON_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set(["json", "geojson", "jsonld"]);
export const XML_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set([
  "xml", "xaml", "axaml", "xsd", "xsl", "xslt", "rss", "atom", "opml", "csproj", "vbproj", "fsproj", "props", "targets", "resx", "plist", "drawio",
]);

const MAX_ITEMS = 5000, MAX_TEXT = 300, MAX_CELL = 120, MAX_ROWS = 2000, MAX_COLUMNS = 60, MAX_DEPTH = 24;

const shorten = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

/** Text as an inline code span that cannot be broken by backticks inside it. */
function code(text: string): string {
  const flat = text.replace(/\s+/g, " ");
  if (flat === "") return "";
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map(run => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

interface Context { lines: string[]; tables: Array<{ label: string; rows: Array<Record<string, Json>> }>; budget: number; cut: boolean }

// ---- JSON ----

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObject = (value: unknown): value is Record<string, Json> => typeof value === "object" && value !== null && !Array.isArray(value);
const scalar = (value: Json) => code(shorten(JSON.stringify(value), MAX_TEXT));

function isTabular(value: Json): value is Array<Record<string, Json>> {
  if (!Array.isArray(value) || !value.length || !value.every(isObject)) return false;
  const columns = new Set(value.flatMap(row => Object.keys(row)));
  return columns.size > 0 && columns.size <= MAX_COLUMNS;
}

function jsonTable(rows: Array<Record<string, Json>>): string[] {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const cell = (value: Json | undefined) => value === undefined ? "" : code(shorten(typeof value === "string" ? value : JSON.stringify(value), MAX_CELL)).replace(/\|/g, "\\|");
  const head = (name: string) => (code(name) || "&nbsp;").replace(/\|/g, "\\|");
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(columns.map(head)), line(columns.map(() => "---")), ...rows.slice(0, MAX_ROWS).map(row => line(columns.map(name => cell(row[name]))))];
}

function jsonItem(label: string, value: Json, depth: number, path: string, context: Context): void {
  if (context.budget <= 0) { context.cut = true; return; }
  context.budget--;
  const indent = "  ".repeat(depth);
  if (Array.isArray(value) && isTabular(value)) {
    context.lines.push(`${indent}- ${label} (${value.length}) — ${code(path)}`);
    context.tables.push({ label: path, rows: value });
  } else if (Array.isArray(value) || isObject(value)) {
    const entries: Array<[string, Json]> = Array.isArray(value) ? value.map((child, index) => [String(index), child]) : Object.entries(value);
    if (!entries.length) { context.lines.push(`${indent}- ${label}: ${code(Array.isArray(value) ? "[]" : "{}")}`); return; }
    context.lines.push(`${indent}- ${label} (${entries.length})`);
    if (depth >= MAX_DEPTH) { context.lines.push(`${indent}  - …`); return; }
    for (const [key, child] of entries) jsonItem(code(key) || '""', child, depth + 1, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, context);
  } else context.lines.push(`${indent}- ${label}: ${scalar(value)}`);
}

function jsonToMarkdown(text: string, messages: StructuredMessages): string {
  let data: Json;
  try { data = JSON.parse(text) as Json; } catch (error) { return `> ${messages.invalid(error instanceof Error ? error.message : String(error))}`; }
  const context: Context = { lines: [], tables: [], budget: MAX_ITEMS, cut: false };
  if (isTabular(data)) return finish(jsonTable(data), [], context, messages, data.length > MAX_ROWS ? MAX_ROWS : 0);
  if (Array.isArray(data) || isObject(data)) {
    const entries: Array<[string, Json]> = Array.isArray(data) ? data.map((child, index) => [String(index), child]) : Object.entries(data);
    for (const [key, child] of entries) jsonItem(code(key) || '""', child, 0, Array.isArray(data) ? `[${key}]` : key, context);
  } else context.lines.push(scalar(data));
  return finish(context.lines, context.tables, context, messages, 0);
}

function finish(lines: string[], tables: Context["tables"], context: Context, messages: StructuredMessages, rowLimit: number): string {
  const out = [...lines];
  for (const table of tables) out.push("", `**${code(table.label)}**`, "", ...jsonTable(table.rows));
  if (context.cut) out.push("", messages.limit(MAX_ITEMS));
  else if (rowLimit) out.push("", messages.limit(rowLimit));
  return out.join("\n");
}

// ---- XML ----

interface XmlNode { name: string; attributes: string[]; children: XmlNode[]; text: string }

const XML_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z_:](?:"[^"]*"|'[^']*'|[^>"'])*>|[^<]+/g;
const ATTRIBUTE = /([^\s=/<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
    if (named[lower]) return named[lower];
    try { return String.fromCodePoint(lower[1] === "x" ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10)); } catch { return whole; }
  });
}

/** Builds the element tree; throws an Error with a short description when the tags do not match. */
export function parseXmlTree(text: string): XmlNode {
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  for (const [token] of text.matchAll(XML_TOKEN)) {
    if (token.startsWith("<!--") || token.startsWith("<?") || (token.startsWith("<!") && !token.startsWith("<![CDATA["))) continue;
    const top = stack[stack.length - 1];
    if (token.startsWith("<![CDATA[")) { if (top) top.text += (top.text ? " " : "") + token.slice(9, -3).trim(); continue; }
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim();
      if (!top || top.name !== name) throw new Error(top ? `</${name}> does not match <${top.name}>` : `</${name}> has no opening tag`);
      stack.pop();
    } else if (token.startsWith("<")) {
      const name = /^<([^\s/>]+)/.exec(token)?.[1] ?? "?";
      const attributes = [...token.matchAll(ATTRIBUTE)].map(match => `${match[1]}="${shorten(decodeEntities(match[2] ?? match[3] ?? ""), 80)}"`);
      const node: XmlNode = { name, attributes, children: [], text: "" };
      if (top) top.children.push(node);
      else if (root) throw new Error("more than one root element");
      else root = node;
      if (!token.endsWith("/>")) stack.push(node);
    } else if (top) {
      const value = decodeEntities(token).trim();
      if (value) top.text += (top.text ? " " : "") + value;
    }
  }
  if (stack.length) throw new Error(`<${stack[stack.length - 1].name}> is not closed`);
  if (!root) throw new Error("no root element");
  return root;
}

function xmlItem(node: XmlNode, depth: number, context: Context): void {
  if (context.budget <= 0) { context.cut = true; return; }
  context.budget--;
  const attributes = node.attributes.length ? ` (${node.attributes.map(code).join(", ")})` : "";
  const text = node.text ? ` — ${code(shorten(node.text, MAX_TEXT))}` : "";
  context.lines.push(`${"  ".repeat(depth)}- ${code(node.name)}${attributes}${text}`);
  if (depth >= MAX_DEPTH) { if (node.children.length) context.lines.push(`${"  ".repeat(depth + 1)}- …`); return; }
  for (const child of node.children) xmlItem(child, depth + 1, context);
}

function xmlToMarkdown(text: string, messages: StructuredMessages): string {
  let root: XmlNode;
  try { root = parseXmlTree(text); } catch (error) { return `> ${messages.invalid(error instanceof Error ? error.message : String(error))}`; }
  const context: Context = { lines: [], tables: [], budget: MAX_ITEMS, cut: false };
  xmlItem(root, 0, context);
  if (context.cut) context.lines.push("", messages.limit(MAX_ITEMS));
  return context.lines.join("\n");
}

export function structuredToMarkdown(kind: StructuredKind, text: string, messages: StructuredMessages = DEFAULT_MESSAGES): string {
  if (!text.trim()) return "";
  return kind === "json" ? jsonToMarkdown(text, messages) : xmlToMarkdown(text, messages);
}

// ---- Canvas (JSON Canvas / Obsidian .canvas) ----

interface CanvasNode { id?: unknown; type?: unknown; text?: unknown; file?: unknown; url?: unknown; label?: unknown }
interface CanvasEdge { fromNode?: unknown; toNode?: unknown; label?: unknown }

const canvasLabel = (node: CanvasNode): string => {
  const raw = [node.text, node.file, node.url, node.label].find(value => typeof value === "string" && value.trim()) ?? node.type ?? node.id ?? "";
  return shorten(String(raw).replace(/\s+/g, " ").trim(), 60).replace(/"/g, "#quot;").replace(/`/g, "'").replace(/[<>]/g, " ");
};

/** A JSON Canvas board as a Mermaid flowchart (positions are not kept; links and labels are). Other JSON falls back to the tree. */
export function canvasToMarkdown(text: string, messages: StructuredMessages = DEFAULT_MESSAGES): string {
  let data: unknown;
  try { data = JSON.parse(text); } catch (error) { return `> ${messages.invalid(error instanceof Error ? error.message : String(error))}`; }
  const nodes = isObject(data) && Array.isArray(data.nodes) ? (data.nodes as CanvasNode[]).filter(isObject).slice(0, MAX_ITEMS) : null;
  if (!nodes) return jsonToMarkdown(text, messages);
  const ids = new Map<string, string>();
  const lines = ["flowchart LR"];
  nodes.forEach((node, index) => {
    const key = `n${index}`;
    if (typeof node.id === "string") ids.set(node.id, key);
    const label = `"${canvasLabel(node)}"`;
    lines.push(`  ${key}${node.type === "file" ? `([${label}])` : node.type === "link" ? `{{${label}}}` : node.type === "group" ? `[/${label}/]` : `[${label}]`}`);
  });
  const edges = isObject(data) && Array.isArray(data.edges) ? (data.edges as CanvasEdge[]).filter(isObject).slice(0, MAX_ITEMS) : [];
  for (const edge of edges) {
    const from = typeof edge.fromNode === "string" ? ids.get(edge.fromNode) : undefined, to = typeof edge.toNode === "string" ? ids.get(edge.toNode) : undefined;
    if (!from || !to) continue;
    const label = typeof edge.label === "string" && edge.label.trim() ? `|"${canvasLabel({ text: edge.label })}"|` : "";
    lines.push(`  ${from} -->${label} ${to}`);
  }
  return "```mermaid\n" + lines.join("\n") + "\n```";
}

// ---- Collapsible tree (the model behind the tree view) ----

export type TreeKind = "object" | "array" | "string" | "number" | "boolean" | "null" | "element";
export interface TreeNode {
  /** Property name, array index or element name. */
  key: string;
  kind: TreeKind;
  /** Shown after the key: a scalar value or the text of an XML element. */
  value: string;
  /** Shown dimmed: the number of children of an object or array, or the attributes of an XML element. */
  meta: string;
  children: TreeNode[];
}
export interface TreeResult { root: TreeNode | null; error: string; cut: boolean }

function jsonTreeNode(key: string, value: Json, depth: number, budget: { left: number; cut: boolean }): TreeNode {
  budget.left--;
  if (Array.isArray(value) || isObject(value)) {
    const entries: Array<[string, Json]> = Array.isArray(value) ? value.map((child, index) => [String(index), child]) : Object.entries(value);
    const node: TreeNode = { key, kind: Array.isArray(value) ? "array" : "object", value: "", meta: Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`, children: [] };
    for (const [childKey, child] of entries) {
      if (budget.left <= 0 || depth >= MAX_DEPTH) { budget.cut = true; break; }
      node.children.push(jsonTreeNode(childKey, child, depth + 1, budget));
    }
    return node;
  }
  const kind: TreeKind = value === null ? "null" : typeof value === "string" ? "string" : typeof value === "number" ? "number" : "boolean";
  return { key, kind, value: shorten(JSON.stringify(value), MAX_TEXT), meta: "", children: [] };
}

function xmlTreeNode(node: XmlNode, depth: number, budget: { left: number; cut: boolean }): TreeNode {
  budget.left--;
  const result: TreeNode = { key: node.name, kind: "element", value: shorten(node.text, MAX_TEXT), meta: node.attributes.join(" "), children: [] };
  for (const child of node.children) {
    if (budget.left <= 0 || depth >= MAX_DEPTH) { budget.cut = true; break; }
    result.children.push(xmlTreeNode(child, depth + 1, budget));
  }
  return result;
}

/** The structure of a JSON or XML text as a tree of nodes (an error message instead when it cannot be parsed). */
export function structuredTree(kind: StructuredKind, text: string): TreeResult {
  const budget = { left: MAX_ITEMS, cut: false };
  if (!text.trim()) return { root: null, error: "", cut: false };
  try {
    const root = kind === "json" ? jsonTreeNode("", JSON.parse(text) as Json, 0, budget) : xmlTreeNode(parseXmlTree(text), 0, budget);
    return { root, error: "", cut: budget.cut };
  } catch (error) {
    return { root: null, error: error instanceof Error ? error.message : String(error), cut: false };
  }
}
