import test from "node:test";
import assert from "node:assert/strict";

test("JSON becomes a tree, arrays of objects become tables", async () => {
  const { structuredToMarkdown: md } = await import("../.test-build/preview/structured-preview.js");
  assert.equal(md("json", '{"a":1,"b":{"c":"x|y","d":[]},"e":[1,null]}'), [
    "- `a`: `1`", "- `b` (2)", "  - `c`: `\"x|y\"`", "  - `d`: `[]`", "- `e` (2)", "  - `0`: `1`", "  - `1`: `null`",
  ].join("\n"));
  assert.equal(md("json", '[{"id":1,"v":"a|b"},{"id":2}]'), "| `id` | `v` |\n| --- | --- |\n| `1` | `a\\|b` |\n| `2` |  |");
  const nested = md("json", '{"users":[{"n":1},{"n":2}]}');
  assert.ok(nested.startsWith("- `users` (2) — `users`"));
  assert.ok(nested.includes("**`users`**\n\n| `n` |"));
  assert.equal(md("json", "42"), "`42`");
  assert.equal(md("json", "  "), "");
  assert.match(md("json", "{bad"), /^> Cannot show the structure: /);
  assert.equal(md("json", '{"k":"a`b"}'), '- `k`: ``"a`b"``');
});

test("XML and XAML become an element tree with attributes and text", async () => {
  const { structuredToMarkdown: md, parseXmlTree } = await import("../.test-build/preview/structured-preview.js");
  const xaml = '<?xml version="1.0"?><!-- c --><Grid xmlns="http://x" Margin="4"><TextBlock Text="Hi &amp; bye"/><Button>OK <![CDATA[<b>]]></Button></Grid>';
  assert.equal(md("xml", xaml), [
    '- `Grid` (`xmlns="http://x"`, `Margin="4"`)', '  - `TextBlock` (`Text="Hi & bye"`)', '  - `Button` — `OK <b>`',
  ].join("\n"));
  assert.throws(() => parseXmlTree("<a><b></a>"), /does not match/);
  assert.throws(() => parseXmlTree("<a>"), /not closed/);
  assert.throws(() => parseXmlTree("<a/><b/>"), /more than one root/);
  assert.throws(() => parseXmlTree("text"), /no root/);
  assert.match(md("xml", "<a><b></a>"), /^> Cannot show the structure: /);
});

test("huge inputs are cut with a note and the previewed extensions are known", async () => {
  const p = await import("../.test-build/preview/structured-preview.js");
  const big = JSON.stringify({ list: Array.from({ length: 6000 }, (_, i) => i) });
  assert.ok(p.structuredToMarkdown("json", big).endsWith("Only the first 5000 items are shown."));
  assert.ok(p.XML_PREVIEW_EXTENSIONS.has("xaml") && p.JSON_PREVIEW_EXTENSIONS.has("json"));
  assert.ok(!p.XML_PREVIEW_EXTENSIONS.has("svg") && !p.XML_PREVIEW_EXTENSIONS.has("xhtml"));
});

test("a canvas board becomes a Mermaid flowchart", async () => {
  const { canvasToMarkdown } = await import("../.test-build/preview/structured-preview.js");
  const board = { nodes: [{ id: "a", type: "text", text: 'Say "hi"\nnow' }, { id: "b", type: "file", file: "n/todo.md" }, { id: "c", type: "link", url: "https://x.y" }, { id: "g", type: "group", label: "Team" }], edges: [{ fromNode: "a", toNode: "b", label: "see" }, { fromNode: "a", toNode: "zz" }] };
  assert.equal(canvasToMarkdown(JSON.stringify(board)), ["```mermaid", "flowchart LR", '  n0["Say #quot;hi#quot; now"]', '  n1(["n/todo.md"])', '  n2{{"https://x.y"}}', '  n3[/"Team"/]', '  n0 -->|"see"| n1', "```"].join("\n"));
  assert.ok(canvasToMarkdown('{"other":1}').startsWith("- `other`"));
  assert.match(canvasToMarkdown("{bad"), /^> Cannot show/);
});

test("the tree model of JSON and XML has keys, kinds, values and counts", async () => {
  const { structuredTree } = await import("../.test-build/preview/structured-preview.js");
  const json = structuredTree("json", '{"a":1,"b":[true,null],"c":"x"}');
  assert.equal(json.error, "");
  assert.deepEqual(json.root.children.map(node => [node.key, node.kind, node.value, node.meta]), [["a", "number", "1", ""], ["b", "array", "", "[2]"], ["c", "string", '"x"', ""]]);
  assert.deepEqual(json.root.children[1].children.map(node => [node.key, node.kind, node.value]), [["0", "boolean", "true"], ["1", "null", "null"]]);
  const xml = structuredTree("xml", '<a id="1"><b>t</b><c/></a>');
  assert.equal(xml.root.meta, 'id="1"');
  assert.deepEqual(xml.root.children.map(node => [node.key, node.value]), [["b", "t"], ["c", ""]]);
  assert.match(structuredTree("json", "{bad").error, /JSON/);
  assert.match(structuredTree("xml", "<a><b></a>").error, /does not match/);
  assert.equal(structuredTree("json", " ").root, null);
  const big = structuredTree("json", JSON.stringify(Array.from({ length: 6000 }, (_, i) => i)));
  assert.equal(big.cut, true);
  assert.equal(big.root.children.length, 4999);
});
