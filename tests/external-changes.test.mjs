import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/project/external-changes-model.js");

test("the kind of a watcher event is read from its type", async () => {
  const { kindOf } = await model();
  assert.equal(kindOf({ create: { kind: "file" } }), "create");
  assert.equal(kindOf({ remove: { kind: "folder" } }), "remove");
  assert.equal(kindOf({ modify: { kind: "data" } }), "modify");
  assert.equal(kindOf({ modify: { kind: "rename" } }), "rename");
  assert.equal(kindOf({ access: { kind: "read" } }), "access");
  assert.equal(kindOf("any"), "modify");
  assert.equal(kindOf(undefined), "modify");
});

test("inside .git only the state of the repository counts, and node_modules never does", async () => {
  const { classifyPath } = await model();
  assert.equal(classifyPath("C:\\work\\repo\\notes\\a.md"), "content");
  assert.equal(classifyPath("/work/repo/.gitignore"), "content", "a file named like .git is an ordinary file");
  for (const state of ["HEAD", "index", "refs/heads/main", "packed-refs", "MERGE_HEAD", "rebase-merge/head-name"]) assert.equal(classifyPath(`/work/repo/.git/${state}`), "git-state", state);
  for (const noise of ["objects/ab/cdef", "logs/HEAD", "index.lock", "hooks/pre-commit", "COMMIT_EDITMSG"]) assert.equal(classifyPath(`/work/repo/.git/${noise}`), "ignore", noise);
  assert.equal(classifyPath("/work/repo/web/node_modules/pkg/index.js"), "ignore");
  assert.equal(classifyPath("C:\\work\\repo\\.git"), "git-state", "the .git entry itself");
});

test("a batch of events says which paths changed, whether the tree changed shape and whether the repository moved", async () => {
  const { summarize } = await model();
  const modified = summarize([{ kind: "modify", paths: ["/r/a.md"] }, { kind: "modify", paths: ["/r/a.md", "/r/b.md"] }, { kind: "access", paths: ["/r/c.md"] }]);
  assert.deepEqual([...modified.paths].sort(), ["/r/a.md", "/r/b.md"]);
  assert.deepEqual([modified.structure, modified.gitState], [false, false]);
  const pulled = summarize([{ kind: "create", paths: ["/r/new.md"] }, { kind: "remove", paths: ["/r/old.md"] }, { kind: "modify", paths: ["/r/.git/HEAD", "/r/.git/objects/x"] }]);
  assert.deepEqual([...pulled.paths].sort(), ["/r/new.md", "/r/old.md"]);
  assert.deepEqual([pulled.structure, pulled.gitState], [true, true]);
  assert.deepEqual(summarize([]), { paths: new Set(), structure: false, gitState: false });
});

test("the smallest edit between two texts is what differs between their common start and end", async () => {
  const { minimalChange } = await model();
  assert.equal(minimalChange("same", "same"), null);
  assert.deepEqual(minimalChange("one two three", "one 2 three"), { from: 4, to: 7, insert: "2" });
  assert.deepEqual(minimalChange("abc", "abXc"), { from: 2, to: 2, insert: "X" });
  assert.deepEqual(minimalChange("abXc", "abc"), { from: 2, to: 3, insert: "" });
  assert.deepEqual(minimalChange("", "new"), { from: 0, to: 0, insert: "new" });
  assert.deepEqual(minimalChange("old", ""), { from: 0, to: 3, insert: "" });
  assert.deepEqual(minimalChange("aaa", "aaaa"), { from: 3, to: 3, insert: "a" }, "an insertion in a run of equal characters");
});

test("an edit never splits a character made of two code units", async () => {
  const { minimalChange } = await model();
  const before = "x\u{1F600}y", after = "x\u{1F601}y";
  const change = minimalChange(before, after);
  assert.deepEqual(change, { from: 1, to: 3, insert: "\u{1F601}" });
  assert.equal(before.slice(0, change.from) + change.insert + before.slice(change.to), after);
});
