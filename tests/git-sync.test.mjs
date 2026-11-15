import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/git-ui/git-sync-model.js");
const change = (status, path) => ({ status, path });

test("a few changes are named, one verb per kind of change", async () => {
  const { defaultCommitMessage } = await model();
  assert.equal(defaultCommitMessage([change("A", "notes.md"), change("A", "ideas/assets/screen.png")]), "Add notes.md, ideas/assets/screen.png");
  assert.equal(defaultCommitMessage([change("A", "notes.md"), change("M", "cv.md")]), "Add notes.md; update cv.md");
  assert.equal(defaultCommitMessage([change("D", "old.md")]), "Remove old.md");
  assert.equal(defaultCommitMessage([]), "");
});

test("many changes, or long names, are counted instead of named", async () => {
  const { defaultCommitMessage } = await model();
  const many = [change("A", "a.md"), change("A", "b.md"), change("M", "c.md"), change("M", "d.md")];
  assert.equal(defaultCommitMessage(many), "Add 2 files, update 2 files");
  assert.equal(defaultCommitMessage([change("M", "x".repeat(80) + ".md")]), "Update 1 file");
});
