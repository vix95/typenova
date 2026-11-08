import test from "node:test";
import assert from "node:assert/strict";

test("CSV and TSV are parsed and shown as a Markdown table", async () => {
  const p = await import("../.test-build/preview/preview-source.js");
  assert.deepEqual(p.parseDelimited('a,b,c\n1,"x, y",3\r\n"he said ""hi""","line\nbreak",', ","), [["a", "b", "c"], ["1", "x, y", "3"], ['he said "hi"', "line\nbreak", ""]]);
  assert.equal(p.detectDelimiter("name;qty\nkiwi;3\napple;5", "csv"), ";");
  assert.equal(p.detectDelimiter("a,b\n1,2", "csv"), ",");
  assert.equal(p.detectDelimiter("a\tb\n1\t2", "csv"), "\t");
  assert.equal(p.detectDelimiter("anything", "tsv"), "\t");
  const note = { truncated: (shown, total) => `cut ${shown}/${total}` };
  assert.equal(p.csvToMarkdown("Name;Note\nA;x|y\nB;two\nlines\n", "csv", note), "| Name | Note |\n| --- | --- |\n| A | x\\|y |\n| B | two |\n| lines |  |");
  assert.equal(p.csvToMarkdown("", "csv", note), "");
  const many = "h\n" + Array.from({ length: 2500 }, (_, i) => String(i)).join("\n");
  const table = p.csvToMarkdown(many, "csv", note);
  assert.ok(table.endsWith("\n\ncut 2000/2500"));
  assert.equal(table.split("\n").length, 2000 + 2 + 2);
});

test("Mermaid files are wrapped in a fence the content cannot close", async () => {
  const p = await import("../.test-build/preview/preview-source.js");
  assert.equal(p.mermaidToMarkdown("graph TD\n  A-->B"), "```mermaid\ngraph TD\n  A-->B\n```");
  assert.equal(p.mermaidToMarkdown("A[```]"), "````mermaid\nA[```]\n````");
  assert.equal(p.previewSourceFor("diagram", "mmd", "pie\n \"a\" : 1", () => ""), "```mermaid\npie\n \"a\" : 1\n```");
});
