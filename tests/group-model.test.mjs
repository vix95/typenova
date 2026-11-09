import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/documents/group-model.js");

const sum = list => list.reduce((a, b) => a + b, 0);

test("a group is split on the side a tab is dropped", async () => {
  const m = await model();
  const one = m.leaf("a");
  const right = m.splitLayout(one, "a", "right", "b");
  assert.deepEqual(m.groupIds(right), ["a", "b"]);
  assert.equal(right.dir, "row");
  const left = m.splitLayout(one, "a", "left", "b");
  assert.deepEqual(m.groupIds(left), ["b", "a"]);
  const below = m.splitLayout(right, "b", "bottom", "c");
  assert.deepEqual(m.groupIds(below), ["a", "b", "c"]);
  assert.equal(below.kind, "split");
  assert.equal(below.children[1].kind, "split", "the right column is split in two, one above the other");
  assert.equal(below.children[1].dir, "column");
});

test("a split along the same direction shares the room of the target instead of nesting", async () => {
  const m = await model();
  let layout = m.splitLayout(m.leaf("a"), "a", "right", "b");
  layout = m.splitLayout(layout, "b", "right", "c");
  assert.equal(layout.children.length, 3);
  assert.deepEqual(m.groupIds(layout), ["a", "b", "c"]);
  assert.ok(Math.abs(sum(layout.weights) - 1) < 1e-9);
  assert.ok(Math.abs(layout.weights[0] - 0.5) < 1e-9 && Math.abs(layout.weights[1] - 0.25) < 1e-9, "only the target gave room");
});

test("removing a group collapses what is left", async () => {
  const m = await model();
  let layout = m.splitLayout(m.leaf("a"), "a", "right", "b");
  layout = m.splitLayout(layout, "b", "bottom", "c");
  assert.deepEqual(m.groupIds(m.removeFromLayout(layout, "c")), ["a", "b"]);
  assert.equal(m.removeFromLayout(layout, "c").kind, "split");
  assert.equal(m.removeFromLayout(layout, "c").children[1].kind, "group", "the column of one group is just the group");
  assert.deepEqual(m.removeFromLayout(m.splitLayout(m.leaf("a"), "a", "right", "b"), "b"), m.leaf("a"));
  assert.equal(m.removeFromLayout(m.leaf("a"), "a"), null);
  const flat = m.removeFromLayout(m.splitLayout(m.splitLayout(m.leaf("a"), "a", "right", "b"), "b", "bottom", "c"), "a");
  assert.equal(flat.dir, "column", "what remains is a column of two");
  assert.deepEqual(m.groupIds(flat), ["b", "c"]);
});

test("a nested split of the same direction is merged when its sibling goes", async () => {
  const m = await model();
  const layout = { kind: "split", dir: "row", weights: [0.5, 0.5], children: [m.leaf("a"), { kind: "split", dir: "column", weights: [0.5, 0.5], children: [m.leaf("b"), { kind: "split", dir: "row", weights: [0.5, 0.5], children: [m.leaf("c"), m.leaf("d")] }] }] };
  const after = m.removeFromLayout(layout, "b");
  assert.deepEqual(m.groupIds(after), ["a", "c", "d"]);
  assert.equal(after.dir, "row");
  assert.equal(after.children.length, 3, "the rows were merged into one");
  assert.ok(Math.abs(sum(after.weights) - 1) < 1e-9);
});

test("the next and the previous group wrap around", async () => {
  const m = await model();
  const layout = m.splitLayout(m.splitLayout(m.leaf("a"), "a", "right", "b"), "b", "right", "c");
  assert.equal(m.neighborOf(layout, "a", 1), "b");
  assert.equal(m.neighborOf(layout, "c", 1), "a");
  assert.equal(m.neighborOf(layout, "a", -1), "c");
  assert.equal(m.neighborOf(m.leaf("a"), "a", 1), null);
});

test("where a dropped tab lands depends on the nearest edge", async () => {
  const m = await model();
  assert.equal(m.dropZone(400, 300, 200, 150), "center");
  assert.equal(m.dropZone(400, 300, 20, 150), "left");
  assert.equal(m.dropZone(400, 300, 390, 150), "right");
  assert.equal(m.dropZone(400, 300, 200, 10), "top");
  assert.equal(m.dropZone(400, 300, 200, 290), "bottom");
  assert.equal(m.dropZone(400, 300, 30, 20), "top", "in a corner the nearer edge wins");
  assert.equal(m.dropZone(0, 0, 0, 0), "center");
  assert.deepEqual(m.zoneRect("right"), { left: 0.5, top: 0, width: 0.5, height: 1 });
  assert.deepEqual(m.zoneRect("center"), { left: 0, top: 0, width: 1, height: 1 });
});

test("a divider moves but never squeezes a neighbour below its minimum", async () => {
  const m = await model();
  const moved = m.resizeWeights([0.5, 0.5], 0, 0.1);
  assert.ok(Math.abs(moved[0] - 0.6) < 1e-9 && Math.abs(moved[1] - 0.4) < 1e-9);
  const squeezed = m.resizeWeights([0.5, 0.5], 0, 0.9);
  assert.ok(Math.abs(squeezed[1] - m.MIN_SHARE) < 1e-9);
  assert.ok(Math.abs(sum(squeezed) - 1) < 1e-9);
  assert.deepEqual(m.resizeWeights([0.5, 0.5], 1, 0.1), [0.5, 0.5], "there is no divider after the last one");
});

test("weights are brought to shares that sum to one", async () => {
  const m = await model();
  assert.ok(Math.abs(sum(m.normalizeWeights([2, 1, 1])) - 1) < 1e-9);
  assert.deepEqual(m.normalizeWeights([0, 0]), [0.5, 0.5]);
  assert.deepEqual(m.normalizeWeights([NaN, -1]), [0.5, 0.5]);
  assert.deepEqual(m.normalizeWeights([]), []);
});

test("a group takes the neighbouring tab when its tab goes, and none when it was the last", async () => {
  const m = await model();
  assert.equal(m.replacementTab(["a", "c"], 2), "c", "the last one was removed: the one before it");
  assert.equal(m.replacementTab(["a", "c"], 1), "c", "the one that took its place");
  assert.equal(m.replacementTab(["a", "c"], 0), "a");
  assert.equal(m.replacementTab(["b", "c", "d"], 1), "c");
  assert.equal(m.replacementTab([], 0), "");
});

test("stored groups are read back, and anything odd is refused", async () => {
  const m = await model();
  const layout = m.splitLayout(m.leaf("g1"), "g1", "right", "g2");
  const stored = { version: 1, layout, focus: "g2", groups: { g1: { paths: ["a.md", "b.md"], active: "b.md" }, g2: { paths: ["c.md"], active: "c.md" } } };
  const back = m.parseGroups(m.serializeGroups(stored));
  assert.deepEqual(back.groups, stored.groups);
  assert.equal(back.focus, "g2");
  assert.deepEqual(m.groupIds(back.layout), ["g1", "g2"]);
  assert.equal(m.parseGroups(""), null);
  assert.equal(m.parseGroups("nope"), null);
  assert.equal(m.parseGroups(JSON.stringify({ ...stored, version: 2 })), null);
  assert.equal(m.parseGroups(JSON.stringify({ ...stored, groups: { g1: stored.groups.g1 } })), null, "a group of the layout is missing");
  assert.equal(m.parseGroups(JSON.stringify({ ...stored, layout: m.leaf("g1") })), null, "one group is not a split");
  assert.equal(m.parseGroups(JSON.stringify({ ...stored, focus: "zzz" })).focus, "g1", "an unknown focus falls back to the first group");
});

test("only open files are restored and groups left empty disappear", async () => {
  const m = await model();
  const layout = m.splitLayout(m.splitLayout(m.leaf("g1"), "g1", "right", "g2"), "g2", "bottom", "g3");
  const stored = { version: 1, layout, focus: "g3", groups: { g1: { paths: ["a.md"], active: "a.md" }, g2: { paths: ["b.md", "x.md"], active: "x.md" }, g3: { paths: ["gone.md"], active: "gone.md" } } };
  const open = new Set(["a.md", "b.md"]);
  const pruned = m.pruneStored(stored, path => open.has(path));
  assert.deepEqual(m.groupIds(pruned.layout), ["g1", "g2"]);
  assert.deepEqual(pruned.groups.g2, { paths: ["b.md"], active: "b.md" }, "an active tab that is gone gives way to the first one");
  assert.equal(pruned.focus, "g1", "the focused group is gone");
  assert.equal(m.pruneStored(stored, path => path === "a.md"), null, "one group left is no split");
  assert.equal(m.pruneStored(stored, () => false), null);
});
