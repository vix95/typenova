import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import texmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js/lib/common";

type RenderBlock = {
  key: string;
  hash: string;
  type: string;
  startLine: number;
  endLine: number;
  estimatedHeight: number;
  sourceLength: number;
  isHeavy: boolean;
};
type NotebookOutput = { output_type?: string; name?: string; text?: string | string[]; data?: Record<string, unknown>; ename?: string; evalue?: string; traceback?: string[] };
type NotebookCell = { cell_type: string; source: string | string[]; execution_count?: number | null; outputs?: NotebookOutput[] };
type CachedBlock = RenderBlock & { tokenStart: number; tokenEnd: number; startOffset: number; endOffset: number; notebookCellIndex?: number };
type Request = {
  id: number;
  action: "update" | "render" | "all";
  text?: string;
  revision?: number;
  indexes?: number[];
  forceIndexes?: number[];
  visibleFromLine?: number;
  visibleToLine?: number;
  mode?: "markdown" | "plain" | "notebook";
  language?: "pl" | "en";
};

let fastMode = false;
let cachedMode: "markdown" | "plain" | "notebook" = "markdown";
let cachedText = "";
let cachedNotebookCells: NotebookCell[] = [];
let cachedNotebookLanguage = "python";
let cachedUiLanguage: "pl" | "en" = "pl";
const uiText = (pl: string, en: string) => cachedUiLanguage === "en" ? en : pl;
const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: true,
  breaks: false,
  highlight(code: string, language: string): string {
    if (language === "mermaid") return `<pre><code class="language-mermaid">${md.utils.escapeHtml(code)}</code></pre>`;
    // Syntax highlighting can multiply memory usage in huge documents. Preserve
    // code formatting, but skip expensive tokenization for very large blocks.
    if (fastMode && code.length > 8_000) return `<pre><code>${md.utils.escapeHtml(code)}</code></pre>`;
    if (language && hljs.getLanguage(language)) {
      try { return `<pre><code class="hljs language-${md.utils.escapeHtml(language)}">${hljs.highlight(code, { language, ignoreIllegals: true }).value}</code></pre>`; }
      catch { /* fall through to escaped code */ }
    }
    return `<pre><code>${md.utils.escapeHtml(code)}</code></pre>`;
  }
}).use(anchor, { permalink: false })
  .use(taskLists, { enabled: true, label: true })
  .use(texmath, { engine: katex, delimiters: "dollars", katexOptions: { throwOnError: false, strict: "ignore", trust: false } });

let cachedTokens: any[] = [];
let cachedEnv: Record<string, any> = {};
let cachedBlocks: CachedBlock[] = [];
let cachedHeadings: { level: number; text: string; line: number }[] = [];
let cachedStats = { words: 0, chars: 0, bytes: 0, fastMode: false };
let cachedRevision = -1;

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
function hashRange(text: string, from: number, to: number): string {
  let hash = 2166136261;
  for (let i = from; i < to; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
function countWords(text: string): number {
  const re = /[\p{L}\p{N}_'-]+/gu;
  let count = 0;
  while (re.exec(text)) count++;
  return count;
}
function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) offsets.push(i + 1);
  return offsets;
}
function heightEstimate(type: string, lineCount: number): number {
  if (type === "fence" || type === "code_block") return Math.max(58, 38 + lineCount * 21);
  if (type === "table_open") return Math.max(64, 42 + lineCount * 34);
  if (type === "heading_open") return 58;
  if (type === "hr") return 42;
  return Math.max(52, 22 + lineCount * 25);
}
function getHeadingText(inline: any): string {
  const raw = String(inline?.content || "");
  return raw.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_~]/g, "").trim() || "(bez tytułu)";
}
function sourceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(part => typeof part === "string" ? part : String(part ?? "")).join("");
  return "";
}
function lineAtOffset(offsets: number[], offset: number): number {
  let low = 0, high = offsets.length;
  while (low < high) { const mid = (low + high) >>> 1; if ((offsets[mid] ?? 0) <= offset) low = mid + 1; else high = mid; }
  return Math.max(1, low);
}
function escape(value: unknown): string { return md.utils.escapeHtml(String(value ?? "")); }
function truncateOutput(value: string, limit = 40_000): { text: string; truncated: boolean } {
  return value.length > limit ? { text: value.slice(0, limit), truncated: true } : { text: value, truncated: false };
}
function renderNotebookOutput(output: NotebookOutput): string {
  if (output.output_type === "stream") {
    const payload = truncateOutput(sourceText(output.text));
    return `<pre class="notebook-output-text"><code>${escape(payload.text)}</code></pre>${payload.truncated ? `<div class="notebook-output-note">${uiText("Wynik skrócono, aby zachować płynność.", "Output shortened to keep the notebook responsive.")}</div>` : ""}`;
  }
  if (output.output_type === "error") {
    const traceback = Array.isArray(output.traceback) ? output.traceback.join("\n").replace(/\x1b\[[0-9;]*m/g, "") : "";
    const full = [String(output.ename || "Error"), String(output.evalue || ""), traceback].filter(Boolean).join("\n");
    const payload = truncateOutput(full, 30_000);
    return `<div class="notebook-error-output"><pre>${escape(payload.text)}</pre>${payload.truncated ? `<div class="notebook-output-note">${uiText("Skrócono traceback.", "Traceback shortened.")}</div>` : ""}</div>`;
  }
  const data = output.data && typeof output.data === "object" ? output.data : {};
  // Display raster notebook outputs safely. Do not inject text/html or SVG output from
  // a notebook into the application DOM; both can contain active content.
  for (const mime of ["image/png", "image/jpeg", "image/gif"] as const) {
    const raw = sourceText((data as Record<string, unknown>)[mime]).replace(/\s+/g, "");
    if (raw && raw.length <= 2_000_000 && /^[A-Za-z0-9+/=]+$/.test(raw)) {
      return `<div class="notebook-output-image"><img loading="lazy" decoding="async" alt="${uiText("Wynik notebooka", "Notebook output")}" src="data:${mime};base64,${raw}"></div>`;
    }
  }
  const markdownOutput = sourceText((data as Record<string, unknown>)["text/markdown"]);
  if (markdownOutput) return `<div class="notebook-output-markdown markdown-body">${md.render(truncateOutput(markdownOutput, 30_000).text)}</div>`;
  const plain = sourceText((data as Record<string, unknown>)["text/plain"]);
  if (plain) {
    const payload = truncateOutput(plain);
    return `<pre class="notebook-output-text"><code>${escape(payload.text)}</code></pre>${payload.truncated ? `<div class="notebook-output-note">${uiText("Wynik skrócono, aby zachować płynność.", "Output shortened to keep the notebook responsive.")}</div>` : ""}`;
  }
  return `<div class="notebook-output-note">${uiText("Ten format wyniku nie jest obsługiwany w podglądzie.", "This output format is not available in the preview.")}</div>`;
}
function renderNotebookCell(index: number): string {
  const cell = cachedNotebookCells[index];
  if (!cell) return `<div class="notebook-invalid">Notebook cell unavailable.</div>`;
  const source = sourceText(cell.source);
  const maxCellCharacters = fastMode ? 80_000 : 240_000;
  const previewSource = source.length > maxCellCharacters ? source.slice(0, maxCellCharacters) : source;
  const truncatedNote = source.length > maxCellCharacters
    ? `<div class="notebook-output-note">${uiText("Podgląd tej dużej komórki został skrócony dla płynności. Pełna treść pozostaje w źródle notebooka.", "This large cell is truncated in preview to keep the UI responsive. The full content remains in the notebook source.")}</div>`
    : "";
  if (cell.cell_type === "markdown") {
    return `<article class="notebook-cell notebook-markdown-cell"><div class="notebook-cell-prompt">MD</div><div class="notebook-cell-panel"><div class="notebook-cell-toolbar"><span>${uiText("Markdown", "Markdown")}</span></div><div class="notebook-markdown-content markdown-body">${md.render(previewSource)}</div>${truncatedNote}</div></article>`;
  }
  if (cell.cell_type === "raw") {
    return `<article class="notebook-cell notebook-raw-cell"><div class="notebook-cell-prompt">RAW</div><div class="notebook-cell-panel"><div class="notebook-cell-toolbar"><span>${uiText("Komórka surowa", "Raw cell")}</span></div><pre class="notebook-code"><code>${escape(previewSource)}</code></pre>${truncatedNote}</div></article>`;
  }
  const count = Number.isInteger(cell.execution_count) ? `[${cell.execution_count}]:` : "[ ]:";
  const language = /^[a-z0-9_+#.-]{1,32}$/i.test(cachedNotebookLanguage) ? cachedNotebookLanguage.toLowerCase() : "python";
  let codeHtml = escape(previewSource);
  if (!fastMode && previewSource.length <= 24_000 && hljs.getLanguage(language)) {
    try { codeHtml = hljs.highlight(previewSource, { language, ignoreIllegals: true }).value; } catch { /* Plain escaped source remains readable. */ }
  }
  const outputs = Array.isArray(cell.outputs) ? cell.outputs.slice(0, 24).map(renderNotebookOutput).join("") : "";
  const excess = Array.isArray(cell.outputs) && cell.outputs.length > 24 ? `<div class="notebook-output-note">${cell.outputs.length - 24} ${uiText("kolejnych wyników ukryto.", "additional outputs hidden.")}</div>` : "";
  const outputHtml = outputs || excess ? `<div class="notebook-output-row"><div class="notebook-cell-prompt notebook-output-prompt">Out</div><div class="notebook-output-stack">${outputs}${excess}</div></div>` : "";
  return `<article class="notebook-cell notebook-code-cell"><div class="notebook-cell-prompt">${count}</div><div class="notebook-cell-panel"><div class="notebook-cell-toolbar"><span class="notebook-language-pill">${escape(language)}</span><span class="notebook-cell-kind">${uiText("Kod", "Code")}</span></div><pre class="notebook-code"><code class="hljs language-${escape(language)}">${codeHtml}</code></pre>${truncatedNote}${outputHtml}</div></article>`;
}
function parseNotebookDocument(text: string) {
  cachedNotebookCells = [];
  cachedTokens = [];
  let parsed: { cells?: unknown; metadata?: { kernelspec?: { language?: string; name?: string }; language_info?: { name?: string } } };
  try { parsed = JSON.parse(text); }
  catch (error) {
    const hash = hashText(text);
    cachedBlocks = [{ key: `notebook-error:${hash}`, hash, type: "notebook_error", startLine: 1, endLine: Math.max(1, lineOffsets(text).length), estimatedHeight: 120, sourceLength: text.length, isHeavy: false, tokenStart: 0, tokenEnd: 0, startOffset: 0, endOffset: text.length, notebookCellIndex: -1 }];
    cachedStats = { words: countWords(text), chars: text.length, bytes: utf8Length(text), fastMode };
    cachedNotebookLanguage = "python";
    (cachedBlocks[0] as CachedBlock & { errorText?: string }).errorText = String(error);
    return;
  }
  if (!parsed || !Array.isArray(parsed.cells)) {
    const hash = hashText(text);
    cachedBlocks = [{ key: `notebook-error:${hash}`, hash, type: "notebook_error", startLine: 1, endLine: Math.max(1, lineOffsets(text).length), estimatedHeight: 120, sourceLength: text.length, isHeavy: false, tokenStart: 0, tokenEnd: 0, startOffset: 0, endOffset: text.length, notebookCellIndex: -1 }];
    cachedStats = { words: countWords(text), chars: text.length, bytes: utf8Length(text), fastMode };
    (cachedBlocks[0] as CachedBlock & { errorText?: string }).errorText = "Expected a cells array in the notebook JSON.";
    return;
  }
  md.set({ linkify: false, typographer: !fastMode });
  cachedNotebookLanguage = String(parsed.metadata?.language_info?.name || parsed.metadata?.kernelspec?.language || parsed.metadata?.kernelspec?.name || "python").toLowerCase();
  if (cachedNotebookLanguage === "python3" || cachedNotebookLanguage === "ipython") cachedNotebookLanguage = "python";
  if (cachedNotebookLanguage === "javascript" || cachedNotebookLanguage === "nodejs") cachedNotebookLanguage = "javascript";
  cachedNotebookCells = parsed.cells.filter((cell): cell is NotebookCell => !!cell && typeof cell === "object" && ["code", "markdown", "raw"].includes(String((cell as NotebookCell).cell_type)));
  const offsets = lineOffsets(text);
  if (cachedNotebookCells.length === 0) {
    const hash = hashText("empty-notebook");
    cachedBlocks = [{ key: `notebook-empty:${hash}`, hash, type: "notebook_empty", startLine: 1, endLine: Math.max(1, offsets.length), estimatedHeight: 100, sourceLength: 0, isHeavy: false, tokenStart: 0, tokenEnd: 0, startOffset: 0, endOffset: text.length, notebookCellIndex: -1 }];
    cachedStats = { words: 0, chars: text.length, bytes: utf8Length(text), fastMode };
    return;
  }
  // Ignore escaped occurrences inside source strings and outputs, otherwise text
  // mentioning `"cell_type": "code"` could be mistaken for a real cell boundary.
  const markers = Array.from(text.matchAll(/(?<!\\)"cell_type"\s*:\s*"(?:markdown|code|raw)"/g));
  const provisional: CachedBlock[] = [];
  for (let index = 0; index < cachedNotebookCells.length; index++) {
    const cell = cachedNotebookCells[index];
    const marker = markers[index];
    const startOffset = marker?.index ?? (index ? provisional[index - 1].endOffset : 0);
    const endOffset = markers[index + 1]?.index ?? text.length;
    const startLine = lineAtOffset(offsets, startOffset);
    const endLine = Math.max(startLine, lineAtOffset(offsets, Math.max(startOffset, endOffset - 1)));
    const source = sourceText(cell.source);
    const hash = hashText(`${cell.cell_type}:${source}:${Array.isArray(cell.outputs) ? cell.outputs.length : 0}`);
    const sourceLines = Math.max(1, source.split("\n").length);
    const outputTextLength = Array.isArray(cell.outputs) ? cell.outputs.reduce((sum, output) => sum + sourceText(output.text).length + sourceText(output.data?.["text/plain"]).length, 0) : 0;
    const estimatedHeight = cell.cell_type === "markdown"
      ? Math.max(74, Math.min(2400, 58 + sourceLines * 24))
      : Math.max(76, Math.min(2800, 72 + sourceLines * 20 + Math.min(1800, outputTextLength / 45)));
    provisional.push({
      key: `notebook:${index}:${hash}`, hash, type: `notebook_${cell.cell_type}`,
      startLine, endLine, estimatedHeight, sourceLength: source.length + outputTextLength,
      isHeavy: source.length > 1_000_000 || outputTextLength > 1_000_000,
      tokenStart: 0, tokenEnd: 0, startOffset, endOffset, notebookCellIndex: index
    });
    if (cell.cell_type === "markdown") {
      const rows = source.split(/\r?\n/);
      for (let line = 0; line < rows.length; line++) {
        const match = rows[line].match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (match) cachedHeadings.push({ level: match[1].length, text: match[2].replace(/[`*_~]/g, "").trim(), line: startLine + line });
      }
    }
  }
  cachedBlocks = provisional;
  cachedStats = { words: countWords(cachedNotebookCells.map(cell => sourceText(cell.source)).join("\n")), chars: text.length, bytes: utf8Length(text), fastMode };
}

function parseDocument(text: string, mode: "markdown" | "plain" | "notebook" = "markdown") {
  cachedText = text;
  cachedMode = mode;
  fastMode = text.length >= 512_000;
  cachedEnv = {};
  cachedHeadings = [];
  const provisional: CachedBlock[] = [];
  if (mode === "notebook") {
    parseNotebookDocument(text);
    return;
  }
  if (mode === "plain") {
    cachedTokens = [];
    const offsets = lineOffsets(text);
    const linesPerBlock = text.length >= 2_000_000 ? 45 : 80;
    let occurrence = 0;
    for (let line = 0; line < offsets.length; line += linesPerBlock) {
      const nextLine = Math.min(offsets.length, line + linesPerBlock);
      const startOffset = offsets[line] ?? 0;
      const endOffset = nextLine < offsets.length ? (offsets[nextLine] ?? text.length) : text.length;
      const sourceLength = Math.max(0, endOffset - startOffset);
      const hash = hashRange(text, startOffset, endOffset);
      provisional.push({
        key: `plain:${hash}:${occurrence++}`, hash, type: "plain_code",
        startLine: line + 1, endLine: Math.max(line + 1, nextLine),
        estimatedHeight: Math.max(42, (nextLine - line) * 21), sourceLength,
        isHeavy: sourceLength > 512_000, tokenStart: 0, tokenEnd: 0,
        startOffset, endOffset
      });
    }
    cachedBlocks = provisional;
    cachedStats = { words: countWords(text), chars: text.length, bytes: utf8Length(text), fastMode };
    return;
  }
  md.set({ linkify: false, typographer: !fastMode });
  cachedTokens = md.parse(text, cachedEnv);
  const refDefinitions = text.match(/^[ \t]{0,3}\[[^\]]+\]:.*$/gm) || [];
  const refsHash = refDefinitions.length ? hashText(refDefinitions.join("\n")) : "no-refs";
  const headingLines = text.match(/^[ \t]{0,3}#{1,6}[ \t]+.*$|^[^\n]+\n[ \t]{0,3}(?:=+|-+)[ \t]*$/gm) || [];
  const headingsHash = headingLines.length ? hashText(headingLines.join("\n")) : "no-headings";
  const offsets = lineOffsets(text);
  const occurrences = new Map<string, number>();

  for (let i = 0; i < cachedTokens.length;) {
    const token = cachedTokens[i];
    let end = i;
    if (token.level === 0 && token.nesting === 1) {
      const closingType = token.type.replace(/_open$/, "_close");
      for (let j = i + 1; j < cachedTokens.length; j++) {
        const candidate = cachedTokens[j];
        if (candidate.type === closingType && candidate.level === 0 && candidate.nesting === -1) { end = j; break; }
      }
    }
    const map = token.map as [number, number] | null;
    const start0 = map?.[0] ?? (provisional.length ? provisional[provisional.length - 1].endLine : 0);
    const end0 = map?.[1] ?? start0 + 1;
    const startOffset = offsets[Math.min(start0, offsets.length - 1)] ?? text.length;
    const endOffset = end0 >= offsets.length ? text.length : (offsets[Math.max(start0, end0)] ?? text.length);
    const hash = hashRange(text, startOffset, Math.max(startOffset, endOffset));
    const headingContext = token.type === "heading_open" ? `:${headingsHash}` : "";
    const occurrenceKey = `${fastMode ? "fast" : "full"}:${refsHash}${headingContext}:${token.type}:${hash}`;
    const occurrence = occurrences.get(occurrenceKey) || 0;
    occurrences.set(occurrenceKey, occurrence + 1);
    provisional.push({
      key: `${occurrenceKey}:${occurrence}`,
      hash,
      type: token.type,
      startLine: start0 + 1,
      endLine: Math.max(start0 + 1, end0),
      estimatedHeight: heightEstimate(token.type, Math.max(1, end0 - start0)),
      sourceLength: Math.max(0, endOffset - startOffset),
      isHeavy: (token.type === "fence" || token.type === "code_block") ? endOffset - startOffset > 64_000 : endOffset - startOffset > 256_000,
      tokenStart: i,
      tokenEnd: end + 1,
      startOffset,
      endOffset
    });

    if (token.type === "heading_open" && token.level === 0) {
      const inline = cachedTokens[i + 1]?.type === "inline" ? cachedTokens[i + 1] : null;
      cachedHeadings.push({ level: Number(String(token.tag || "h1").slice(1)) || 1, text: getHeadingText(inline), line: start0 + 1 });
    }
    i = end + 1;
  }
  cachedBlocks = provisional;
  cachedStats = { words: countWords(text), chars: text.length, bytes: utf8Length(text), fastMode };
}
function renderBlock(index: number, force = false) {
  const block = cachedBlocks[index];
  if (!block) return null;
  if (block.type === "notebook_error") {
    const message = (block as CachedBlock & { errorText?: string }).errorText || uiText("Plik nie jest poprawnym notebookiem Jupyter.", "This is not a valid Jupyter Notebook file.");
    return { index, key: block.key, hash: block.hash, html: `<div class="notebook-invalid"><strong>${uiText("Nie można odczytać notebooka", "Could not read notebook")}</strong><p>${escape(message)}</p></div>` };
  }
  if (block.type === "notebook_empty") {
    return { index, key: block.key, hash: block.hash, html: `<div class="notebook-empty"><strong>${uiText("Pusty notebook", "Empty notebook")}</strong><p>${uiText("Ten plik nie zawiera komórek.", "This notebook contains no cells.")}</p></div>` };
  }
  if (block.isHeavy && !force && cachedMode !== "notebook") {
    const size = block.sourceLength >= 1_048_576 ? `${(block.sourceLength / 1_048_576).toFixed(1)} MB` : `${Math.round(block.sourceLength / 1024)} KB`;
    return { index, key: block.key, hash: block.hash, html: `<div class="large-block-placeholder"><p>Duży blok (${size}) pominięty w podglądzie, aby zachować płynność.</p><button type="button" data-render-large data-index="${index}">Renderuj ten blok</button></div>` };
  }
  if (cachedMode === "plain") {
    const source = cachedText.slice(block.startOffset, block.endOffset);
    const html = `<pre class="source-preview"><code>${md.utils.escapeHtml(source)}</code></pre>`;
    return { index, key: block.key, hash: block.hash, html };
  }
  if (cachedMode === "notebook") {
    return { index, key: block.key, hash: block.hash, html: renderNotebookCell(block.notebookCellIndex ?? index) };
  }
  const tokens = cachedTokens.slice(block.tokenStart, block.tokenEnd);
  const html = md.renderer.render(tokens, md.options, cachedEnv);
  return { index, key: block.key, hash: block.hash, html };
}
function renderIndexes(indexes: number[], forceIndexes: number[] = []) {
  const seen = new Set<number>();
  const forced = new Set(forceIndexes);
  const rendered = [];
  for (const index of indexes) {
    if (!Number.isInteger(index) || index < 0 || index >= cachedBlocks.length || seen.has(index)) continue;
    seen.add(index);
    const result = renderBlock(index, forced.has(index));
    if (result) rendered.push(result);
  }
  return rendered;
}
function indexesForLines(fromLine: number, toLine: number) {
  const result: number[] = [];
  for (let i = 0; i < cachedBlocks.length; i++) {
    const b = cachedBlocks[i];
    if (b.endLine >= fromLine && b.startLine <= toLine) result.push(i);
  }
  return result;
}
self.onmessage = (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    cachedUiLanguage = req.language === "en" ? "en" : "pl";
    if (req.action === "update") {
      if (typeof req.text !== "string") throw new Error("Brak treści dokumentu.");
      const parseStart = performance.now();
      parseDocument(req.text, req.mode === "plain" ? "plain" : req.mode === "notebook" ? "notebook" : "markdown");
      const parseMs = performance.now() - parseStart;
      cachedRevision = req.revision ?? cachedRevision + 1;
      // A notebook can be minified JSON (all cells then appear on source line 1).
      // Seed only a small set of cell renders; the UI virtualizer requests the rest
      // according to the visible notebook viewport.
      const indexes = req.mode === "notebook"
        ? Array.from({ length: Math.min(16, cachedBlocks.length) }, (_, index) => index)
        : indexesForLines(req.visibleFromLine ?? 1, req.visibleToLine ?? 100);
      const renderStart = performance.now();
      const rendered = renderIndexes(indexes);
      const renderMs = performance.now() - renderStart;
      self.postMessage({ id: req.id, action: req.action, revision: cachedRevision, parseMs, renderMs, blocks: cachedBlocks.map(({ key, hash, type, startLine, endLine, estimatedHeight, sourceLength, isHeavy }) => ({ key, hash, type, startLine, endLine, estimatedHeight, sourceLength, isHeavy })), headings: cachedHeadings, stats: cachedStats, rendered });
    } else if (req.action === "render") {
      if (req.revision !== cachedRevision) throw new Error("Nieaktualna wersja dokumentu.");
      const renderStart = performance.now(); const rendered = renderIndexes(req.indexes || [], req.forceIndexes || []);
      self.postMessage({ id: req.id, action: req.action, revision: cachedRevision, renderMs: performance.now() - renderStart, rendered });
    } else if (req.action === "all") {
      if (typeof req.text === "string") parseDocument(req.text, req.mode === "notebook" ? "notebook" : req.mode === "plain" ? "plain" : "markdown");
      const html = cachedBlocks.map((_, index) => renderBlock(index, true)?.html || "").join("");
      self.postMessage({ id: req.id, action: req.action, revision: req.revision, html });
    }
  } catch (error) {
    self.postMessage({ id: req.id, action: req.action, revision: req.revision, error: String(error) });
  }
};
