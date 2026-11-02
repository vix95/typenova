/** Pure edits of Mermaid flowchart source by node and link, used when a diagram is edited by clicking its preview. */
import { NODE_SHAPES } from "./mermaid-templates.js";

export interface ChainNode { id: string; raw: string }
export interface ChainArrow { arrow: string; label: string }
interface ChainLine { indent: string; nodes: ChainNode[]; arrows: ChainArrow[] }
type Line = { raw: string } | ChainLine;

export interface FlowEdge { from: string; to: string; arrow: string; label: string; /** Which of the links between the same two nodes this is (0-based). */ index: number }

const OPENERS = NODE_SHAPES.map((shape, index) => ({ index, open: shape.open, close: shape.close })).sort((a, b) => b.open.length - a.open.length);
const KEYWORDS = new Set(["flowchart", "graph", "subgraph", "end", "style", "classdef", "class", "click", "linkstyle", "direction"]);
const ARROW = /(?:<?-{2,}[>ox]?|<?={2,}>?|-\.+->?|~{3})/y;
const ID = /[A-Za-z_]\w*/y;

/** Reads `id` and an optional shape such as `[text]`, `{text}` or `(("text"))` starting at `from`; null when the text is not a plain node. */
function readNode(text: string, from: number): { node: ChainNode; end: number } | null {
  ID.lastIndex = from;
  const match = ID.exec(text);
  if (!match) return null;
  let end = from + match[0].length;
  const opener = OPENERS.find(item => text.startsWith(item.open, end));
  if (opener) {
    let position = end + opener.open.length, quoted = false;
    for (; position < text.length; position++) {
      if (text[position] === '"') quoted = !quoted;
      else if (!quoted && text.startsWith(opener.close, position)) break;
    }
    if (position >= text.length) return null;
    end = position + opener.close.length;
  }
  return { node: { id: match[0], raw: text.slice(from, end) }, end };
}

/** Parses a line made only of nodes and links (`A[x] -->|y| B --> C`); null for anything else (subgraph, style, `&`, link text between dashes…). */
function parseChain(line: string): ChainLine | null {
  const indent = /^\s*/.exec(line)![0];
  const rest = line.slice(indent.length);
  const word = /^[A-Za-z]+/.exec(rest)?.[0].toLowerCase();
  if (!rest || rest.startsWith("%%") || (word && KEYWORDS.has(word))) return null;
  const nodes: ChainNode[] = [], arrows: ChainArrow[] = [];
  let position = indent.length;
  for (;;) {
    const read = readNode(line, position);
    if (!read) return null;
    nodes.push(read.node); position = read.end;
    while (line[position] === " ") position++;
    if (position >= line.length || line[position] === ";") break;
    ARROW.lastIndex = position;
    const arrow = ARROW.exec(line);
    if (!arrow) return null;
    position += arrow[0].length;
    let label = "";
    if (line[position] === "|") {
      const close = line.indexOf("|", position + 1);
      if (close < 0) return null;
      label = line.slice(position + 1, close); position = close + 1;
    }
    arrows.push({ arrow: arrow[0], label });
    while (line[position] === " ") position++;
  }
  return { indent, nodes, arrows };
}

function parse(source: string): Line[] { return source.split("\n").map(raw => parseChain(raw) ?? { raw }); }
const isChain = (line: Line): line is ChainLine => "nodes" in line;
const arrowText = (item: ChainArrow) => (item.label ? `${item.arrow}|${item.label}|` : item.arrow);
function format(lines: Line[]): string {
  return lines.map(line => isChain(line) ? line.indent + line.nodes.map((node, index) => (index ? ` ${arrowText(line.arrows[index - 1])} ` : "") + node.raw).join("") : line.raw).join("\n");
}

const cleanText = (text: string) => text.replace(/["\r\n]+/g, " ").trim();
function shapeOf(raw: string, id: string): number { return OPENERS.find(item => raw.startsWith(item.open, id.length))?.index ?? -1; }
function textOf(raw: string, id: string): string {
  const shape = shapeOf(raw, id);
  if (shape < 0) return id;
  const { open, close } = NODE_SHAPES[shape];
  return raw.slice(id.length + open.length, raw.length - close.length).replace(/^"|"$/g, "");
}
function rawFor(id: string, shape: number, text: string): string {
  const { open, close } = NODE_SHAPES[shape];
  return `${id}${open}"${cleanText(text) || id}"${close}`;
}

/** Text and shape of a node as written in the source (the id and the rectangle when it is only named in links). */
export function describeNode(source: string, id: string): { text: string; shape: number; defined: boolean } | null {
  let found: { text: string; shape: number; defined: boolean } | null = null;
  for (const line of parse(source)) {
    if (!isChain(line)) continue;
    for (const node of line.nodes) {
      if (node.id !== id) continue;
      const shape = shapeOf(node.raw, id);
      if (shape >= 0) return { text: textOf(node.raw, id), shape, defined: true };
      found = { text: id, shape: 0, defined: false };
    }
  }
  return found;
}

/** Changes the text and/or shape of a node everywhere it is drawn; a node only named in links gets its shape on its first mention. */
export function updateNode(source: string, id: string, change: { text?: string; shape?: number }): string {
  const current = describeNode(source, id);
  if (!current) return source;
  const text = change.text ?? current.text, shape = change.shape ?? current.shape;
  const lines = parse(source);
  let done = false;
  for (const line of lines) {
    if (!isChain(line)) continue;
    for (const node of line.nodes) {
      if (node.id !== id) continue;
      if (shapeOf(node.raw, id) >= 0 || (!current.defined && !done)) { node.raw = rawFor(id, shape, text); done = true; }
    }
  }
  return format(lines);
}

/** Rebuilds a chain without some links and/or one node; the pieces that stay become lines of their own. */
function splitChain(line: ChainLine, dropEdge: (index: number) => boolean, dropNode: string | null): Line[] {
  const out: Line[] = [];
  let nodes: ChainNode[] = [], arrows: ChainArrow[] = [];
  const flush = () => {
    if (arrows.length) out.push({ indent: line.indent, nodes, arrows });
    else if (nodes.length === 1 && shapeOf(nodes[0].raw, nodes[0].id) >= 0) out.push({ indent: line.indent, nodes, arrows });
    nodes = []; arrows = [];
  };
  line.nodes.forEach((node, index) => {
    if (node.id !== dropNode) nodes.push(node);
    const arrow = line.arrows[index];
    if (!arrow) return;
    const next = line.nodes[index + 1];
    if (dropEdge(index) || node.id === dropNode || next.id === dropNode) flush(); else arrows.push(arrow);
  });
  flush();
  return out;
}

/** Deletes a node together with every link that touches it. */
export function removeNode(source: string, id: string): string {
  const out: Line[] = [];
  for (const line of parse(source)) {
    if (isChain(line) && line.nodes.some(node => node.id === id)) out.push(...splitChain(line, () => false, id)); else out.push(line);
  }
  return format(out);
}

export function listEdges(source: string): FlowEdge[] {
  const edges: FlowEdge[] = [], seen = new Map<string, number>();
  for (const line of parse(source)) {
    if (!isChain(line)) continue;
    line.arrows.forEach((item, index) => {
      const from = line.nodes[index].id, to = line.nodes[index + 1].id, key = `${from}\u0000${to}`;
      const count = seen.get(key) ?? 0; seen.set(key, count + 1);
      edges.push({ from, to, arrow: item.arrow, label: item.label, index: count });
    });
  }
  return edges;
}

function mapEdge(source: string, from: string, to: string, index: number, apply: (arrow: ChainArrow) => ChainArrow | null): string {
  const lines = parse(source), out: Line[] = [], seen = new Map<string, number>();
  for (const line of lines) {
    if (!isChain(line)) { out.push(line); continue; }
    const drop = new Set<number>();
    line.arrows.forEach((item, position) => {
      const key = `${line.nodes[position].id}\u0000${line.nodes[position + 1].id}`;
      const count = seen.get(key) ?? 0; seen.set(key, count + 1);
      if (key !== `${from}\u0000${to}` || count !== index) return;
      const changed = apply(item);
      if (changed) line.arrows[position] = changed; else drop.add(position);
    });
    if (drop.size) out.push(...splitChain(line, position => drop.has(position), null)); else out.push(line);
  }
  return format(out);
}

export function updateEdge(source: string, from: string, to: string, index: number, change: { label?: string; arrow?: string }): string {
  return mapEdge(source, from, to, index, item => ({ arrow: change.arrow ?? item.arrow, label: change.label !== undefined ? change.label.replace(/[|\r\n]+/g, " ").trim() : item.label }));
}

export function removeEdge(source: string, from: string, to: string, index: number): string {
  return mapEdge(source, from, to, index, () => null);
}

function appendLines(source: string, additions: string[]): string {
  return source.replace(/\s+$/, "") + "\n" + additions.join("\n") + "\n";
}

export function addLink(source: string, from: string, to: string, arrow = "-->", label = ""): string {
  const tail = label.trim() ? `${arrow}|${label.replace(/[|\r\n]+/g, " ").trim()}|` : arrow;
  return appendLines(source, [`  ${from} ${tail} ${to}`]);
}

/** Adds a node (linked from `from` when given) and returns the new source with the new node's id. */
export function addNode(source: string, ids: string[], from: string | null, shape = 0, text = "Nowy węzeł"): { source: string; id: string } {
  let id = "";
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!ids.includes(letter)) { id = letter; break; }
  if (!id) id = `N${ids.length + 1}`;
  const lines = [`  ${rawFor(id, shape, text)}`];
  if (from) lines.push(`  ${from} --> ${id}`);
  return { source: appendLines(source, lines), id };
}
