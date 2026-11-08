// Checks every file of examples/file-types against what samples.mjs says TypeNova must do with it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSamples } from "../examples/file-types/samples.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "file-types");
const samples = await buildSamples();
const disk = path => new Uint8Array(readFileSync(join(root, path)));

test("the files on disk are exactly what samples.mjs generates", () => {
  for (const sample of samples) assert.deepEqual(disk(sample.path), new Uint8Array(sample.content), `${sample.path} is stale: run node examples/file-types/generate-samples.mjs`);
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.map(entry => entry.path), samples.map(sample => sample.path));
});

test("every sample is recognised and handled as its manifest entry says", async () => {
  const { fileKind } = await import("../.test-build/filesystem/file-types.js");
  const { highlightFilename } = await import("../.test-build/filesystem/language-map.js");
  const { decodeBytes, looksBinary } = await import("../.test-build/filesystem/text-codec.js");
  const { formatterFor } = await import("../.test-build/editor/format-document.js");
  const { previewSourceFor } = await import("../.test-build/preview/preview-source.js");
  const { languages } = await import("@codemirror/language-data");
  const { LanguageDescription } = await import("@codemirror/language");
  const languageOf = path => { const name = highlightFilename(path); return name ? LanguageDescription.matchFilename(languages, name)?.name ?? null : null; };

  for (const { path, expect } of samples) {
    const bytes = disk(path);
    assert.equal(fileKind(path), expect.kind, `${path}: kind`);
    if (expect.magic) assert.deepEqual([...bytes.slice(0, expect.magic.length)], expect.magic, `${path}: magic bytes`);
    if (expect.binaryContent !== undefined) assert.equal(looksBinary(bytes), expect.binaryContent, `${path}: looksBinary`);
    if ("language" in expect && expect.kind === "text") assert.equal(languageOf(path), expect.language, `${path}: language`);
    if (expect.kind !== "markdown" && expect.kind !== "text") continue;
    if (looksBinary(bytes)) continue;
    const decoded = decodeBytes(bytes);
    if (expect.encoding) assert.equal(decoded.encoding, expect.encoding, `${path}: encoding`);
    if (expect.bom !== undefined) assert.equal(decoded.bom, expect.bom, `${path}: bom`);
    if (expect.lineEnding) assert.equal(decoded.lineEnding, expect.lineEnding, `${path}: line ending`);
    if (expect.mixed !== undefined) assert.equal(decoded.mixedLineEndings, expect.mixed, `${path}: mixed line endings`);
    if (expect.contains) assert.ok(decoded.text.includes(expect.contains), `${path}: contains ${expect.contains}`);
    if (expect.format) {
      const formatter = formatterFor(path);
      assert.ok(formatter, `${path}: has a formatter`);
      const result = formatter.format(decoded.text);
      assert.equal(result.ok, expect.format === "ok", `${path}: format result`);
      if (expect.formatted) assert.ok(result.text.includes(expect.formatted), `${path}: formatted text`);
    }
    if (expect.preview) {
      const source = previewSourceFor(expect.preview, path.split(".").pop(), decoded.text, () => "");
      assert.ok(source.includes(expect.previewContains), `${path}: preview contains ${expect.previewContains}`);
    }
  }
});

test("the sample page links the files its preview must load", () => {
  const html = new TextDecoder().decode(disk("pages/index.html"));
  const pages = samples.filter(sample => sample.expect.page);
  assert.ok(pages.length >= 2);
  for (const link of samples.find(sample => sample.path === "pages/index.html").expect.pageLinks) {
    assert.ok(html.includes(link), `index.html links ${link}`);
    assert.ok(samples.some(sample => sample.path === `pages/${link}`), `${link} exists in the set`);
  }
});

test("the Word and HTML samples convert to the Markdown their manifest promises", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const mammoth = require("mammoth"), Turndown = require("turndown");
  const toMarkdown = html => new Turndown({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" }).turndown(html);
  for (const { path, expect } of samples.filter(sample => sample.expect.importContains)) {
    const html = path.endsWith(".docx") ? (await mammoth.convertToHtml({ buffer: Buffer.from(disk(path)) })).value : new TextDecoder().decode(disk(path));
    assert.ok(toMarkdown(html).includes(expect.importContains), `${path}: imports as Markdown containing ${expect.importContains}`);
  }
});
