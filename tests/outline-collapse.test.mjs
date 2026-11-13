import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/outline/outline-collapse.js");

test("every document remembers its own folded sections", async () => {
  const m = await model();
  let store = {};
  store = m.withCollapsed(store, "d:/a.md", ["2:Intro:0", "3:Setup:0"]);
  store = m.withCollapsed(store, "d:/b.md", ["2:Other:0"]);
  assert.deepEqual([...m.collapsedFor(store, "d:/a.md")], ["2:Intro:0", "3:Setup:0"], "going to another document and back keeps the state");
  assert.deepEqual([...m.collapsedFor(store, "d:/b.md")], ["2:Other:0"]);
  assert.equal(m.collapsedFor(store, "d:/new.md").size, 0, "a document never folded starts expanded");
});

test("a document with nothing folded is not stored, and the store stays bounded", async () => {
  const m = await model();
  let store = m.withCollapsed({}, "a", ["x"]);
  store = m.withCollapsed(store, "a", []);
  assert.deepEqual(store, {});
  store = {};
  for (let i = 0; i < m.MAX_REMEMBERED_DOCUMENTS + 20; i++) store = m.withCollapsed(store, `doc${i}`, ["k"]);
  assert.equal(Object.keys(store).length, m.MAX_REMEMBERED_DOCUMENTS);
  assert.ok(!("doc0" in store) && "doc319" in store, "the oldest are forgotten first");
  store = m.withCollapsed(store, "doc100", ["k", "j"]);
  assert.equal(Object.keys(store).at(-1), "doc100", "the one just changed is the newest");
});

test("keys of headings that no longer exist are dropped, but never while there are no headings", async () => {
  const m = await model();
  assert.deepEqual([...m.liveKeys(new Set(["a", "b"]), new Set(["b", "c"]))], ["b"]);
  assert.deepEqual([...m.liveKeys(new Set(["a", "b"]), new Set())], ["a", "b"], "an empty outline (text still being read) wipes nothing");
});

test("a stored value is accepted only when it has the shape of the store", async () => {
  const m = await model();
  assert.equal(m.isCollapseStore({ "a": ["x"] }), true);
  assert.equal(m.isCollapseStore({}), true);
  for (const bad of [null, [], "x", { a: "x" }, { a: [1] }]) assert.equal(m.isCollapseStore(bad), false);
});
