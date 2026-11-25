import test from "node:test";
import assert from "node:assert/strict";
import { ADDED, DELETED, SAME, diffKinds } from "../.test-build/git-ui/line-diff.js";
import { changedLines } from "../.test-build/git-ui/git-gutter-model.js";

/** The length of the longest common subsequence, the slow and plain way: what the number of differing lines must be measured against. */
function lcs(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  return table[0][0];
}

/** What the edit script turns `before` into. */
function replay(before, after, kinds) {
  const out = []; let i = 0, j = 0;
  for (const kind of kinds) {
    if (kind === SAME) { assert.equal(before[i], after[j], "a SAME step is a line both have"); out.push(before[i]); i++; j++; }
    else if (kind === DELETED) i++;
    else { out.push(after[j]); j++; }
  }
  assert.equal(i, before.length); assert.equal(j, after.length);
  return out;
}

test("the edit script is correct and as short as it can be", () => {
  let seed = 12345;
  const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let round = 0; round < 300; round++) {
    const alphabet = 1 + Math.floor(random() * 5);
    const make = () => Array.from({ length: Math.floor(random() * 14) }, () => "line" + Math.floor(random() * alphabet));
    const before = make(), after = make();
    const kinds = diffKinds(before, after);
    assert.ok(kinds, "small texts are always compared");
    assert.deepEqual(replay(before, after, kinds), after);
    const edits = [...kinds].filter(kind => kind !== SAME).length;
    assert.equal(edits, before.length + after.length - 2 * lcs(before, after), "no longer than the shortest script");
  }
});

test("texts that differ in too many lines are given up", () => {
  const before = Array.from({ length: 50 }, (_, i) => "a" + i), after = Array.from({ length: 50 }, (_, i) => "b" + i);
  assert.equal(diffKinds(before, after, 20), null);
  assert.ok(diffKinds(before, after, 100));
});

test("a large file with edits far apart is compared at once, with the right markers", () => {
  const lines = Array.from({ length: 200000 }, (_, i) => `line number ${i} of the file`);
  const changed = lines.slice();
  changed[10] = "edited near the start";
  changed.splice(100000, 0, "inserted in the middle");
  changed.splice(199000, 1);
  const started = performance.now();
  const marks = changedLines(lines.join("\n") + "\n", changed.join("\n") + "\n");
  const took = performance.now() - started;
  assert.deepEqual(marks.filter(mark => mark.kind !== "deleted").map(mark => [mark.line, mark.kind]), [[11, "modified"], [100001, "added"]]);
  assert.equal(marks.filter(mark => mark.kind === "deleted").length, 1);
  assert.ok(took < 2000, `took ${Math.round(took)} ms`);
});
