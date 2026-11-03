import test from "node:test";
import assert from "node:assert/strict";

test("the commit graph keeps a straight line for linear history and splits and joins lanes for branches", async () => {
  const { layoutGraph } = await import("../.test-build/git-ui/git-graph.js");
  const linear = layoutGraph([{ hash: "c", parents: ["b"] }, { hash: "b", parents: ["a"] }, { hash: "a", parents: [] }]);
  assert.deepEqual(linear.rows.map(row => row.lane), [0, 0, 0]);
  assert.deepEqual(linear.state, []);
  assert.deepEqual(linear.rows[0].parentLanes, [0]);
  assert.deepEqual(linear.rows[1].joins, [0]);

  // m merges f (feature) into main: m -> (a, f), f -> a, a is the root; listed newest first.
  const merged = layoutGraph([
    { hash: "m", parents: ["a", "f"] },
    { hash: "f", parents: ["a"] },
    { hash: "a", parents: [] },
  ]);
  assert.deepEqual(merged.rows[0].parentLanes, [0, 1]);
  assert.equal(merged.rows[1].lane, 1);
  assert.deepEqual(merged.rows[1].passes, [0]);
  assert.deepEqual(merged.rows[1].parentLanes, [0]); // the feature's line leans back into the lane waiting for a
  assert.deepEqual(merged.rows[2].joins, [0]);
  assert.deepEqual(merged.state, []);
  assert.equal(merged.rows[0].width, 2);

  // a page boundary: the open lanes carry over into the next page
  const first = layoutGraph([{ hash: "c", parents: ["b"] }, { hash: "x", parents: ["b"] }]);
  assert.deepEqual(first.state, ["b", "b"].slice(0, 1).concat(first.state.slice(1)));
  const second = layoutGraph([{ hash: "b", parents: [] }], first.state);
  assert.deepEqual(second.rows[0].joins.length >= 1, true);
});

test("labels, dates and diffs of the Git panel", async () => {
  const g = await import("../.test-build/git-ui/git-graph.js");
  const labels = g.classifyRefs(["HEAD -> main", "origin/main", "tag: v1", "feature"], new Set(["origin/main"]));
  assert.deepEqual(labels.map(label => [label.kind, label.label, label.current]), [["branch", "main", true], ["remote", "origin/main", false], ["tag", "v1", false], ["branch", "feature", false]]);
  assert.equal(g.classifyRefs(["HEAD"], new Set())[0].kind, "head");
  assert.equal(g.shortHash("0123456789abcdef"), "0123456");
  const now = Date.parse("2025-06-10T12:00:00Z");
  assert.equal(g.relativeTime("2025-06-10T09:00:00Z", now, "en"), "3 hours ago");
  assert.equal(g.relativeTime("2025-06-07T12:00:00Z", now, "en"), "3 days ago");
  assert.equal(g.relativeTime("not a date", now, "en"), "not a date");
  const lines = g.diffLines("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n context\n-old\n+new\n");
  assert.deepEqual(lines.map(line => line.kind), ["meta", "meta", "meta", "hunk", "context", "del", "add"]);
});
