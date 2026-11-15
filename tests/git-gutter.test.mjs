import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/git-ui/git-gutter-model.js");
const kinds = changes => changes.map(change => `${change.line}:${change.kind}`);

test("an unchanged text has no markers, whatever its line endings", async () => {
  const { changedLines } = await model();
  assert.deepEqual(changedLines("a\nb\nc\n", "a\nb\nc\n"), []);
  assert.deepEqual(changedLines("a\r\nb\r\n", "a\nb\n"), []);
  assert.deepEqual(changedLines("", ""), []);
});

test("added, modified and deleted lines are told apart", async () => {
  const { changedLines } = await model();
  assert.deepEqual(kinds(changedLines("a\nb\nc\n", "a\nb\nNEW\nc\n")), ["3:added"]);
  assert.deepEqual(kinds(changedLines("a\nb\nc\n", "a\nB\nc\n")), ["2:modified"]);
  assert.deepEqual(kinds(changedLines("a\nb\nc\n", "a\nc\n")), ["2:deleted"]);
  assert.deepEqual(kinds(changedLines("a\nb\nc\n", "a\nb\n")), ["2:deleted"], "lines removed at the end are marked on the last line");
  assert.deepEqual(kinds(changedLines("a\nb\nc\n", "b\nc\n")), ["1:deleted"], "removed at the start");
});

test("a replaced block is modified lines, with the extra ones added", async () => {
  const { changedLines } = await model();
  assert.deepEqual(kinds(changedLines("a\nb\nc\nd\n", "a\nX\nY\nZ\nd\n")), ["2:modified", "3:modified", "4:added"]);
  assert.deepEqual(kinds(changedLines("a\nb\nc\nd\n", "a\nX\nd\n")), ["2:modified"]);
});

test("a file that is not committed yet is added from its first line, and an emptied file is a deletion", async () => {
  const { changedLines } = await model();
  assert.deepEqual(kinds(changedLines("", "x\ny\n")), ["1:added", "2:added"]);
  assert.deepEqual(kinds(changedLines("x\ny\n", "")), ["1:deleted"]);
});

test("separate changes give separate markers", async () => {
  const { changedLines } = await model();
  const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  const current = base.replace("line 5\n", "line five\n").replace("line 20\n", "");
  assert.deepEqual(kinds(changedLines(base, current)), ["5:modified", "20:deleted"]);
});
