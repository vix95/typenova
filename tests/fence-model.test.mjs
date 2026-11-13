import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/editor/fence-model.js");

test("the name typed after a fence is recognised only right after one", async () => {
  const m = await model();
  assert.equal(m.typedLanguage("```"), "");
  assert.equal(m.typedLanguage("```pow"), "pow");
  assert.equal(m.typedLanguage("   ~~~c++"), "c++");
  assert.equal(m.typedLanguage("````md"), "md");
  for (const other of ["text ```js", "``", "`` `js", "```js title", "- ```js", "    ```js"]) assert.equal(m.typedLanguage(other), null, other);
});

test("an opening fence is told from a closing one, and whether it already has its closing line", async () => {
  const m = await model();
  const doc = ["# T", "```bash", "ls", "```", "text", "```", "```py", "x", "```"];
  assert.deepEqual(m.fenceAt(doc, 1), { opening: true, closed: true, fence: "```" }, "an existing block");
  assert.equal(m.fenceAt(doc, 3).opening, false, "the closing line of that block");
  const fresh = ["a", "```", "b", "```js", "c", "```"];
  assert.deepEqual(m.fenceAt(fresh, 1), { opening: true, closed: false, fence: "```" }, "a new fence typed before a block: this one has no closing line yet (the next fence opens the existing block)");
  const alone = ["intro", "```"];
  assert.equal(m.fenceAt(alone, 1).closed, false);
  assert.equal(m.fenceAt(["x", "plain"], 1), null, "not a fence");
  assert.equal(m.fenceAt(["~~~", "```", "~~~"], 1).opening, false, "a backtick line inside a tilde block closes nothing");
});

test("common languages come first and the chart block is among them", async () => {
  const m = await model();
  const ids = m.FENCE_LANGUAGES.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, "no name twice");
  for (const id of ["bash", "powershell", "python", "mermaid", "chart", "json"]) assert.ok(ids.includes(id), id);
  assert.ok(m.FENCE_LANGUAGES.find(item => item.id === "bash").boost > m.FENCE_LANGUAGES.find(item => item.id === "perl").boost);
});
