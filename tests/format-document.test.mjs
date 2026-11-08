import test from "node:test";
import assert from "node:assert/strict";

test("JSON, JSON Lines, YAML and TOML are formatted or validated with the place of the error", async () => {
  const { formatterFor } = await import("../.test-build/editor/format-document.js");
  const json = formatterFor("a.json");
  assert.equal(json.kind, "JSON");
  assert.deepEqual(json.format('{"a":1,"b":[1,2],"c":{"d":null}}\n'), { ok: true, text: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ],\n  "c": {\n    "d": null\n  }\n}\n' });
  const bad = json.format('{\n  "a": 1,\n  "b": }\n');
  assert.equal(bad.ok, false);
  assert.ok(bad.message.length > 0);
  assert.equal(formatterFor("x.ipynb").kind, "JSON");
  const lines = formatterFor("a.jsonl").format('{"a": 1}\n\n{ "b" :  2 }');
  assert.deepEqual(lines, { ok: true, text: '{"a":1}\n\n{"b":2}' });
  const brokenLines = formatterFor("a.ndjson").format('{"a":1}\n{oops}');
  assert.equal(brokenLines.ok, false); assert.equal(brokenLines.line, 2);
  const yaml = formatterFor("a.yml").format("# comment\nkey:   value\nlist:\n    - a\n    -   b\n");
  assert.equal(yaml.ok, true);
  assert.equal(yaml.text, "# comment\nkey: value\nlist:\n  - a\n  - b\n");
  const badYaml = formatterFor("a.yaml").format("a: [1, 2\nb: 3\n");
  assert.equal(badYaml.ok, false); assert.ok(badYaml.line >= 1);
  assert.deepEqual(formatterFor("a.toml").format('title = "x"\n[a]\nb = 1\n'), { ok: true, text: 'title = "x"\n[a]\nb = 1\n', note: "valid" });
  assert.equal(formatterFor("a.toml").format("a = \n").ok, false);
  assert.equal(formatterFor("main.rs"), null);
});

test("XML is re-indented and its tags are checked; Markdown tables are aligned", async () => {
  const { formatterFor, formatMarkdownTables } = await import("../.test-build/editor/format-document.js");
  const xml = formatterFor("a.xml").format('<?xml version="1.0"?><root><a x="1">text</a><b><c/></b><!-- note --></root>');
  assert.deepEqual(xml, { ok: true, text: '<?xml version="1.0"?>\n<root>\n  <a x="1">text</a>\n  <b>\n    <c/>\n  </b>\n  <!-- note -->\n</root>' });
  const mismatch = formatterFor("a.xml").format("<a>\n<b>\n</a>");
  assert.equal(mismatch.ok, false); assert.equal(mismatch.line, 3);
  assert.equal(formatterFor("a.xml").format("<a><b></b>").ok, false);
  const table = "| Name | Qty |\n|---|--:|\n| apple | 3 |\n| kiwi | 12 |\n";
  assert.equal(formatMarkdownTables(table), "| Name  | Qty |\n| ----- | --: |\n| apple |   3 |\n| kiwi  |  12 |\n");
  const fenced = "```\n| a | b |\n|-|-|\n```\n";
  assert.equal(formatMarkdownTables(fenced), fenced);
  assert.equal(formatMarkdownTables("no table | here\njust text"), "no table | here\njust text");
});
