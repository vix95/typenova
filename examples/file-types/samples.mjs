// The single source of the sample files in this directory: their content and what TypeNova is expected to do with each.
// `node examples/file-types/generate-samples.mjs` writes the files and manifest.json; tests/sample-files.test.mjs checks both.
import { deflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { CLIP_WEBM_BASE64 } from "./video-clip.mjs";

const require = createRequire(import.meta.url);
const enc = new TextEncoder();
const text = (value) => enc.encode(value);

// ---------------------------------------------------------------- encoders for the legacy encodings
function encodeSingleByte(value, label) {
  const table = new Map();
  const decoder = new TextDecoder(label);
  for (let byte = 0; byte < 256; byte++) { const character = decoder.decode(Uint8Array.of(byte)); if (character !== "�" && !table.has(character)) table.set(character, byte); }
  return Uint8Array.from([...value].map((character) => { if (!table.has(character)) throw new Error(`${character} is not in ${label}`); return table.get(character); }));
}
function encodeUtf16(value, littleEndian, bom) {
  const out = new Uint8Array((bom ? 2 : 0) + value.length * 2);
  if (bom) out.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index), at = (bom ? 2 : 0) + index * 2;
    out[at] = littleEndian ? unit & 0xff : unit >> 8; out[at + 1] = littleEndian ? unit >> 8 : unit & 0xff;
  }
  return out;
}
const withBom = (bytes) => Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes]);

// ---------------------------------------------------------------- binary samples built from code
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u32 = (n) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

function png(width, height) {
  const chunk = (type, data) => { const body = concat(text(type), data); return concat(u32(data.length), body, u32(crc32(body))); };
  const rows = [];
  for (let y = 0; y < height; y++) { rows.push(0); for (let x = 0; x < width; x++) rows.push(Math.round((x / (width - 1)) * 255), Math.round((y / (height - 1)) * 255), 160); }
  const header = concat(u32(width), u32(height), Uint8Array.of(8, 2, 0, 0, 0));
  return concat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", header), chunk("IDAT", deflateSync(Uint8Array.from(rows), { level: 9 })), chunk("IEND", new Uint8Array(0)));
}

function tiff() { // 2x2 RGB, uncompressed, little endian
  const b = new Uint8Array(8 + 2 + 9 * 12 + 4 + 6 + 12), v = new DataView(b.buffer);
  b.set([0x49, 0x49, 42, 0]); v.setUint32(4, 8, true); v.setUint16(8, 9, true);
  const entry = (i, tag, type, count, value) => { const o = 10 + i * 12; v.setUint16(o, tag, true); v.setUint16(o + 2, type, true); v.setUint32(o + 4, count, true); if (type === 3 && count === 1) v.setUint16(o + 8, value, true); else v.setUint32(o + 8, value, true); };
  const extra = 10 + 9 * 12 + 4, pixels = extra + 6;
  entry(0, 256, 3, 1, 2); entry(1, 257, 3, 1, 2); entry(2, 258, 3, 3, extra); entry(3, 259, 3, 1, 1); entry(4, 262, 3, 1, 2);
  entry(5, 273, 4, 1, pixels); entry(6, 277, 3, 1, 3); entry(7, 278, 3, 1, 2); entry(8, 279, 4, 1, 12);
  v.setUint16(extra, 8, true); v.setUint16(extra + 2, 8, true); v.setUint16(extra + 4, 8, true);
  b.set([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0], pixels);
  return b;
}

function bmp() { // 2x2, 24 bit
  const pixels = Uint8Array.of(0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0).slice(0, 16); // rows padded to 4 bytes
  const header = new Uint8Array(54), v = new DataView(header.buffer);
  header.set([0x42, 0x4d]); v.setUint32(2, 54 + 16, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
  v.setInt32(18, 2, true); v.setInt32(22, 2, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, 16, true);
  return concat(header, pixels);
}

/** A 32x32 GIF (four colours, no transparency); the LZW stream restarts every two pixels, which keeps the encoder trivial. */
function gif() {
  const size = 32, palette = [0x1e, 0x3a, 0x8a, 0xf5, 0xc4, 0x2b, 0xff, 0xff, 0xff, 0xd9, 0x3f, 0x5c];
  const pixels = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) pixels.push(((x >> 3) + (y >> 3)) % 2 === 0 ? (x + y < size ? 0 : 1) : (x < y ? 2 : 3));
  const codes = [];
  for (let i = 0; i < pixels.length; i += 2) codes.push(4, pixels[i], ...(i + 1 < pixels.length ? [pixels[i + 1]] : []));
  codes.push(5);
  const bytes = []; let bits = 0, count = 0;
  for (const code of codes) { bits |= code << count; count += 3; while (count >= 8) { bytes.push(bits & 255); bits >>= 8; count -= 8; } }
  if (count) bytes.push(bits & 255);
  const blocks = []; for (let i = 0; i < bytes.length; i += 255) { const part = bytes.slice(i, i + 255); blocks.push(part.length, ...part); }
  return Uint8Array.from([...Buffer.from("GIF89a"), size, 0, size, 0, 0x81, 0, 0, ...palette, 0x2c, 0, 0, 0, 0, size, 0, size, 0, 0, 2, ...blocks, 0, 0x3b]);
}

function wav() { // 0.25 s of a 440 Hz tone, 8 kHz, 16 bit mono
  const rate = 8000, samples = 2000, data = new Uint8Array(samples * 2), dv = new DataView(data.buffer);
  for (let i = 0; i < samples; i++) dv.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), true);
  const header = new Uint8Array(44), v = new DataView(header.buffer);
  header.set(text("RIFF")); v.setUint32(4, 36 + data.length, true); header.set(text("WAVEfmt "), 8); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); header.set(text("data"), 36); v.setUint32(40, data.length, true);
  return concat(header, data);
}

function pdf() { // two pages with text, a proper cross-reference table
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R 5 0 R]/Count 2>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 7 0 R>>>>>>",
    stream("BT /F1 22 Tf 20 100 Td (Sample PDF - page 1) Tj ET"),
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 6 0 R/Resources<</Font<</F1 7 0 R>>>>>>",
    stream("BT /F1 22 Tf 20 100 Td (Sample PDF - page 2) Tj ET"),
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  function stream(content) { return `<</Length ${content.length}>>\nstream\n${content}\nendstream`; }
  let out = "%PDF-1.4\n"; const offsets = [];
  objects.forEach((body, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<</Root 1 0 R/Size ${objects.length + 1}>>\nstartxref\n${xref}\n%%EOF\n`;
  return text(out);
}

async function zipBytes(files) {
  const JSZip = require("jszip"), zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content, { date: new Date(Date.UTC(2026, 0, 1)), createFolders: false });
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "STORE" }));
}

const docx = () => zipBytes({
  "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml": '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Sample report</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold text</w:t></w:r><w:r><w:t xml:space="preserve"> and plain text in one paragraph.</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Second section</w:t></w:r></w:p><w:p><w:r><w:t>The last paragraph of the report.</w:t></w:r></w:p></w:body></w:document>',
});

const archive = () => zipBytes({ "inside.txt": "A text file inside a ZIP archive.\n" });

// ---------------------------------------------------------------- the samples
const POLISH = "The cities of Łódź, Kraków and Gdańsk are in Poland.";
const lines = (...items) => items.join("\n") + "\n";

/** path, content and the expectations: kind (file-types.ts), encoding / bom / lineEnding (text-codec.ts), contains, language (CodeMirror name or null), format / formatted, preview. */
export async function buildSamples() {
  const t = (path, content, expect) => ({ path, content: typeof content === "string" ? text(content) : content, expect });
  return [
    // ---- Markdown family
    t("markdown/sample.md", lines("# Sample document", "", "A paragraph with **bold**, *italic* and `code`, and a link to [[Second section]].", "", "## Second section", "", "- [ ] a task", "- [x] a finished task", "", "```js", "console.log('highlighted code');", "```"), { kind: "markdown", contains: "# Sample document", language: null }),
    t("markdown/sample.markdown", lines("# The .markdown extension", "", "Plain Markdown under a longer extension."), { kind: "markdown", contains: "longer extension" }),
    t("markdown/component.mdx", lines("# MDX document", "", "import Chart from './chart'", "", "Text next to a <Chart /> component."), { kind: "markdown", contains: "MDX document" }),
    t("markdown/analysis.rmd", lines("---", "title: R Markdown", "---", "", "# Analysis", "", "```{r}", "summary(cars)", "```"), { kind: "markdown", contains: "R Markdown" }),
    t("markdown/paper.qmd", lines("---", "title: Quarto document", "---", "", "# Paper", "", "Text of the paper."), { kind: "markdown", contains: "Quarto document" }),
    t("markdown/rules.mdc", lines("---", "description: Rules file", "---", "", "# Rules", "", "- Keep changes small."), { kind: "markdown", contains: "Rules file" }),
    t("markdown/math-and-diagrams.md", lines("# Math and diagrams", "", "Inline math $E = mc^2$ and a block:", "", "$$", "\\int_0^1 x^2 \\, dx = \\frac{1}{3}", "$$", "", "```mermaid", "graph TD", "  A[Start] --> B{Choice}", "  B -->|yes| C[Done]", "  B -->|no| A", "```"), { kind: "markdown", contains: "mermaid" }),
    t("markdown/tables.md", lines("# Tables", "", "| Name | Quantity |", "|---|--:|", "| apple | 3 |", "| watermelon | 12 |"), { kind: "markdown", contains: "| apple | 3 |", format: "ok", formatted: "| Name       | Quantity |" }),

    // ---- plain text and data
    t("text/plain.txt", lines("Plain text file.", "Nothing here is highlighted.", "", "Third line."), { kind: "text", contains: "Plain text file.", language: null }),
    t("text/server.log", lines("2026-01-01 10:00:00 INFO  Server started", "2026-01-01 10:00:05 WARN  Disk usage at 91 percent", "2026-01-01 10:01:12 ERROR Request failed: timeout"), { kind: "text", contains: "Server started", language: null }),
    t("data/comma.csv", lines("name,city,quantity", "Anna,Boston,3", "Ben,Denver,12"), { kind: "text", language: null, preview: "table", previewContains: "| name | city | quantity |" }),
    t("data/semicolon.csv", lines("name;city;quantity", "Zoe;Austin;7", "Yan;Chicago;21"), { kind: "text", language: null, preview: "table", previewContains: "| name | city | quantity |" }),
    t("data/quoted.csv", lines('title,notes', '"Hello, world","a ""quoted"" word"', '"Two lines","first', 'second"'), { kind: "text", language: null, preview: "table", previewContains: "a \"quoted\" word" }),
    t("data/data.tsv", "name\tcity\nAnna\tBoston\nBen\tDenver\n", { kind: "text", language: null, preview: "table", previewContains: "| name | city |" }),
    t("data/minified.json", '{"name":"TypeNova","tags":["markdown","editor"],"nested":{"enabled":true,"count":3}}\n', { kind: "text", language: "JSON", format: "ok", formatted: '{\n  "name": "TypeNova",', preview: "json", previewContains: '- `name`: `"TypeNova"`' }),
    t("data/users.json", JSON.stringify({ users: [{ id: 1, name: "Anna", tags: ["a", "b"] }, { id: 2, name: "Ben" }], total: 2 }, null, 2) + "\n", { kind: "text", language: "JSON", format: "ok", preview: "json", previewContains: "| `id` | `name` | `tags` |" }),
    t("data/broken.json", '{\n  "name": "TypeNova",\n  "tags": [\n}\n', { kind: "text", language: "JSON", format: "error", preview: "json", previewContains: "> Cannot show the structure" }),
    t("data/with-comments.jsonc", lines("{", "  // comments are allowed here", '  "indent": 2', "}"), { kind: "text", language: "JSON" }),
    t("data/events.jsonl", lines('{"id": 1, "event": "open"}', '{ "id" : 2 , "event" : "save" }'), { kind: "text", language: "JSON", format: "ok", formatted: '{"id":1,"event":"open"}' }),
    t("data/broken.jsonl", lines('{"id": 1}', "{not json}"), { kind: "text", language: "JSON", format: "error" }),
    t("data/settings.yaml", lines("# A comment that must survive", "name:    TypeNova", "items:", "    - first", "    -   second"), { kind: "text", language: "YAML", format: "ok", formatted: "# A comment that must survive\nname: TypeNova\nitems:\n  - first\n  - second\n" }),
    t("data/broken.yaml", lines("list: [1, 2", "other: 3"), { kind: "text", language: "YAML", format: "error" }),
    t("data/config.toml", lines('title = "TypeNova"', "", "[editor]", "tab_size = 2"), { kind: "text", language: "TOML", format: "ok" }),
    t("data/broken.toml", lines("title = ", "[editor"), { kind: "text", language: "TOML", format: "error" }),
    t("data/feed.xml", '<?xml version="1.0"?><feed><entry id="1"><title>First</title><tags><tag>a</tag><tag>b</tag></tags></entry><!-- the end --></feed>\n', { kind: "text", language: "XML", format: "ok", formatted: '<?xml version="1.0"?>\n<feed>\n  <entry id="1">\n    <title>First</title>', preview: "xml", previewContains: "- `title` — `First`" }),
    t("data/broken.xml", lines("<root>", "  <open>", "</root>"), { kind: "text", language: "XML", format: "error", preview: "xml", previewContains: "> Cannot show the structure" }),
    t("data/project.csproj", '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n', { kind: "text", language: "XML", format: "ok" }),
    t("data/notebook.ipynb", JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: "markdown", metadata: {}, source: ["# Notebook title"] }, { cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: ["print('hello')"] }] }) + "\n", { kind: "text", language: "JSON", format: "ok" }),
    t("data/places.geojson", '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"Origin"},"geometry":{"type":"Point","coordinates":[0,0]}}]}\n', { kind: "text", language: "JSON", format: "ok" }),
    t("data/board.canvas", '{"nodes":[{"id":"a","type":"text","text":"Hello","x":0,"y":0,"width":200,"height":80},{"id":"b","type":"file","file":"notes/todo.md","x":300,"y":0,"width":200,"height":80}],"edges":[{"id":"e","fromNode":"a","toNode":"b","label":"see"}]}\n', { kind: "text", language: "JSON", format: "ok", preview: "canvas", previewContains: 'n0 -->|"see"| n1' }),

    // ---- configuration files
    t("config/.editorconfig", lines("root = true", "", "[*]", "indent_style = space", "indent_size = 2"), { kind: "text", language: "Properties files" }),
    t("config/.gitignore", lines("node_modules/", "dist/", "*.log"), { kind: "text", language: null }),
    t("config/.env.example", lines("API_URL=https://example.com", "API_TOKEN=replace-me"), { kind: "text", language: null }),
    t("config/settings.ini", lines("[server]", "host = localhost", "port = 8080"), { kind: "text", language: "Properties files" }),
    t("config/app.conf", lines("listen = 8080", "workers = 4"), { kind: "text", language: "Properties files" }),
    t("config/.prettierrc", lines("{", '  "semi": true,', '  "singleQuote": true', "}"), { kind: "text", language: "JSON" }),
    t("config/Dockerfile", lines("FROM node:22-slim", "WORKDIR /app", "COPY . .", 'CMD ["npm", "start"]'), { kind: "text", language: "Dockerfile" }),
    t("config/Makefile", lines(".PHONY: build", "build:", "\tnpm run build"), { kind: "text" }),

    // ---- code
    t("code/hello.py", lines("def greet(name: str) -> str:", '    return f"Hello, {name}!"', "", 'print(greet("world"))'), { kind: "text", language: "Python" }),
    t("code/hello.pyi", lines("def greet(name: str) -> str: ..."), { kind: "text", language: "Python" }),
    t("code/script.sh", lines("#!/usr/bin/env bash", "set -euo pipefail", 'echo "Hello from Bash"'), { kind: "text", language: "Shell" }),
    t("code/script.zsh", lines("#!/usr/bin/env zsh", 'echo "Hello from Zsh"'), { kind: "text", language: "Shell" }),
    t("code/hello.ps1", lines('Write-Host "Hello from PowerShell"'), { kind: "text", language: "PowerShell" }),
    t("code/run.bat", "@echo off\r\necho Hello from a batch file\r\n", { kind: "text", language: null, lineEnding: "crlf" }),
    t("code/main.rs", lines("fn main() {", '    println!("Hello from Rust");', "}"), { kind: "text", language: "Rust" }),
    t("code/app.ts", lines("export const greet = (name: string): string => `Hello, ${name}!`;"), { kind: "text", language: "TypeScript" }),
    t("code/App.tsx", lines("export function App() {", "  return <h1>Hello from TSX</h1>;", "}"), { kind: "text", language: "TSX" }),
    t("code/index.js", lines("export function add(a, b) {", "  return a + b;", "}"), { kind: "text", language: "JavaScript" }),
    t("code/style.scss", lines("$accent: #3b82f6;", ".button { color: $accent; &:hover { opacity: .8; } }"), { kind: "text", language: "SCSS" }),
    t("code/page.html", lines("<!doctype html>", "<html><body><h1>Hello</h1><p>A <b>bold</b> word.</p></body></html>"), { kind: "text", language: "HTML" }),
    t("code/template.hbs", lines("<ul>{{#each items}}<li>{{name}}</li>{{/each}}</ul>"), { kind: "text", language: "HTML" }),
    t("code/Component.svelte", lines("<script>let name = 'world';</script>", "<h1>Hello {name}</h1>"), { kind: "text", language: "HTML" }),
    t("code/Component.vue", lines("<template><h1>Hello Vue</h1></template>"), { kind: "text", language: "Vue" }),
    t("code/query.sql", lines("SELECT name, COUNT(*) AS total", "FROM orders", "GROUP BY name;"), { kind: "text", language: "SQL" }),
    t("code/schema.graphql", lines("type Query { hello: String }"), { kind: "text", language: null }),
    t("code/main.go", lines("package main", "", 'import "fmt"', "", 'func main() { fmt.Println("Hello from Go") }'), { kind: "text", language: "Go" }),
    t("code/Main.java", lines("public class Main {", '  public static void main(String[] args) { System.out.println("Hello from Java"); }', "}"), { kind: "text", language: "Java" }),
    t("code/Program.cs", lines("Console.WriteLine(\"Hello from C#\");"), { kind: "text", language: "C#" }),
    t("code/program.cpp", lines("#include <iostream>", 'int main() { std::cout << "Hello from C++\\n"; }'), { kind: "text", language: "C++" }),
    t("code/hello.c", lines("#include <stdio.h>", 'int main(void) { puts("Hello from C"); return 0; }'), { kind: "text", language: "C" }),
    t("code/Main.hs", lines("main :: IO ()", 'main = putStrLn "Hello from Haskell"'), { kind: "text", language: "Haskell" }),
    t("code/build.cmake", lines("cmake_minimum_required(VERSION 3.20)", "project(Hello)"), { kind: "text", language: "CMake" }),
    t("code/layout.xaml", '<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><TextBlock Text="Hello" /></Grid>\n', { kind: "text", language: "XML", format: "ok", preview: "xml", previewContains: '- `TextBlock` (`Text="Hello"`)' }),
    t("code/shader.glsl", lines("void main() { gl_FragColor = vec4(1.0); }"), { kind: "text", language: "C" }),
    t("code/main.tf", lines('resource "null_resource" "example" {}'), { kind: "text", language: null }),
    t("code/main.zig", lines('const std = @import("std");'), { kind: "text", language: null }),
    t("code/changes.diff", lines("--- a/file.txt", "+++ b/file.txt", "@@ -1 +1 @@", "-old line", "+new line"), { kind: "text", language: "diff" }),
    t("code/changes.patch", lines("--- a/file.txt", "+++ b/file.txt", "@@ -1 +1 @@", "-old line", "+new line"), { kind: "text", language: "diff" }),

    // ---- diagrams
    t("diagrams/flow.mmd", lines("graph TD", "  A[Start] --> B{Choice}", "  B -->|yes| C[Done]", "  B -->|no| A"), { kind: "text", language: null, preview: "diagram", previewContains: "```mermaid" }),
    t("diagrams/sequence.mermaid", lines("sequenceDiagram", "  participant A as Alice", "  participant B as Bob", "  A->>B: Hello"), { kind: "text", language: null, preview: "diagram", previewContains: "```mermaid" }),
    t("diagrams/architecture.puml", lines("@startuml", "Alice -> Bob: Hello", "@enduml"), { kind: "text", language: null }),
    t("diagrams/graph.dot", lines("digraph G { A -> B; B -> C; }"), { kind: "text", language: null }),

    // ---- encodings and line endings (every file holds the same English sentence with accented place names)
    t("encodings/utf8.txt", POLISH + "\n", { kind: "text", encoding: "utf-8", bom: false, lineEnding: "lf", contains: "Łódź" }),
    t("encodings/utf8-bom.txt", withBom(text(POLISH + "\n")), { kind: "text", encoding: "utf-8", bom: true, lineEnding: "lf", contains: "Łódź" }),
    t("encodings/utf16le.txt", encodeUtf16(POLISH + "\n", true, true), { kind: "text", encoding: "utf-16le", bom: true, lineEnding: "lf", contains: "Łódź" }),
    t("encodings/utf16be.txt", encodeUtf16(POLISH + "\n", false, true), { kind: "text", encoding: "utf-16be", bom: true, lineEnding: "lf", contains: "Łódź" }),
    t("encodings/windows-1250.txt", encodeSingleByte(POLISH + "\r\nSecond line.\r\n", "windows-1250"), { kind: "text", encoding: "windows-1250", bom: false, lineEnding: "crlf", contains: "Łódź" }),
    t("encodings/iso-8859-2.txt", encodeSingleByte(POLISH + "\nSecond line.\n", "iso-8859-2"), { kind: "text", encoding: "iso-8859-2", bom: false, lineEnding: "lf", contains: "Łódź" }),
    t("encodings/windows-1252.txt", encodeSingleByte("A café in Zürich serves crème brûlée — naïve but good.\n", "windows-1252"), { kind: "text", encoding: "windows-1250", bom: false, lineEnding: "lf", contains: "caf" }),
    t("encodings/line-endings-crlf.txt", "first line\r\nsecond line\r\nthird line\r\n", { kind: "text", encoding: "utf-8", lineEnding: "crlf", contains: "second line" }),
    t("encodings/line-endings-lf.txt", "first line\nsecond line\nthird line\n", { kind: "text", encoding: "utf-8", lineEnding: "lf", contains: "second line" }),
    t("encodings/line-endings-cr.txt", "first line\rsecond line\rthird line\r", { kind: "text", encoding: "utf-8", lineEnding: "cr", contains: "second line" }),
    t("encodings/line-endings-mixed.txt", "first line\r\nsecond line\nthird line\r\nfourth line\n", { kind: "text", encoding: "utf-8", lineEnding: "crlf", mixed: true, contains: "fourth line" }),

    // ---- pictures, PDF, audio
    t("media/gradient.png", png(8, 8), { kind: "image", magic: [0x89, 0x50, 0x4e, 0x47] }),
    t("media/scan.tif", tiff(), { kind: "image", magic: [0x49, 0x49, 42, 0] }),
    t("media/pixel.bmp", bmp(), { kind: "image", magic: [0x42, 0x4d] }),
    t("media/image.gif", gif(), { kind: "image", magic: [0x47, 0x49, 0x46] }),
    t("media/drawing.svg", lines('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="16" fill="#3b82f6"/></svg>'), { kind: "image", contains: "<circle" }),
    t("media/document.pdf", pdf(), { kind: "pdf", magic: [0x25, 0x50, 0x44, 0x46] }),
    t("media/tone.wav", wav(), { kind: "audio", magic: [0x52, 0x49, 0x46, 0x46] }),
    t("media/clip.webm", Buffer.from(CLIP_WEBM_BASE64, "base64"), { kind: "video", magic: [0x1a, 0x45, 0xdf, 0xa3] }),

    // ---- a small web page: the HTML preview must apply the linked stylesheet and run the linked script
    t("pages/index.html", lines("<!doctype html>", '<html lang="en">', "<head>", '  <meta charset="utf-8">', "  <title>Sample page</title>", '  <link rel="stylesheet" href="css/style.css">', "</head>", "<body>", '  <img class="logo" src="images/logo.svg" alt="Logo">', "  <h1>Sample page</h1>", '  <p id="status">The script has not run.</p>', '  <p><a href="about.html">About this page</a></p>', '  <script src="js/app.js"></script>', "</body>", "</html>"), { kind: "text", language: "HTML", page: true, pageLinks: ["css/style.css", "js/app.js", "images/logo.svg", "about.html"] }),
    t("pages/about.html", lines("<!doctype html>", '<html lang="en"><head><meta charset="utf-8"><title>About</title><link rel="stylesheet" href="css/style.css"></head>', '<body><h1>About</h1><p><a href="index.html">Back to the sample page</a></p></body></html>'), { kind: "text", language: "HTML", page: true, pageLinks: ["css/style.css", "index.html"] }),
    t("pages/css/style.css", lines("body { font-family: sans-serif; margin: 24px; background: #f8fafc; color: #0f172a; }", "h1 { color: rgb(225, 29, 72); }", ".logo { width: 48px; height: 48px; }", "#status.ready { color: rgb(22, 163, 74); font-weight: 600; }"), { kind: "text", language: "CSS" }),
    t("pages/js/app.js", lines("const status = document.getElementById('status');", "status.textContent = 'The script has run.';", "status.classList.add('ready');"), { kind: "text", language: "JavaScript" }),
    t("pages/images/logo.svg", lines('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><rect width="48" height="48" rx="10" fill="#e11d48"/><path d="M14 24l7 7 13-14" stroke="#fff" stroke-width="5" fill="none"/></svg>'), { kind: "image", contains: "<rect" }),

    // ---- documents to import
    t("documents/report.docx", await docx(), { kind: "docx", magic: [0x50, 0x4b, 3, 4], importContains: "# Sample report" }),
    t("documents/article.html", lines("<html><body><h1>Article title</h1><p>The first paragraph has <strong>strong</strong> and <em>emphasised</em> words.</p><ul><li>one</li><li>two</li></ul></body></html>"), { kind: "text", language: "HTML", importContains: "# Article title" }),

    // ---- files that must be refused or tried
    t("unsupported/random.bin", Uint8Array.from({ length: 256 }, (_, i) => (i * 37) & 255), { kind: "binary", binaryContent: true }),
    t("unsupported/archive.zip", await archive(), { kind: "binary", binaryContent: true }),
    t("unsupported/mystery.xyz", lines("A text file with an extension nobody knows.", "TypeNova tries it as text."), { kind: "unknown", contains: "tries it as text", language: null }),
    t("unsupported/disguised.txt", Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 1, 2, 3]), { kind: "text", binaryContent: true }),
  ];
}
