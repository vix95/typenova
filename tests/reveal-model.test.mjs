import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/project/reveal-model.js");

test("the folders above a file are listed outermost first, in the separator of the project folder", async () => {
  const { foldersBetween } = await model();
  assert.deepEqual(foldersBetween("C:\\work\\repo", "C:\\work\\repo\\docs\\notes\\a.md"), ["C:\\work\\repo\\docs", "C:\\work\\repo\\docs\\notes"]);
  assert.deepEqual(foldersBetween("/home/me/repo", "/home/me/repo/docs/a.md"), ["/home/me/repo/docs"]);
  assert.deepEqual(foldersBetween("C:\\work\\repo\\", "C:\\work\\repo\\docs\\a.md"), ["C:\\work\\repo\\docs"], "a trailing separator of the root does not matter");
});

test("a file directly in the project folder, or outside it, has no folders to open", async () => {
  const { foldersBetween } = await model();
  assert.deepEqual(foldersBetween("C:\\work\\repo", "C:\\work\\repo\\a.md"), []);
  assert.deepEqual(foldersBetween("C:\\work\\repo", "C:\\other\\docs\\a.md"), []);
  assert.deepEqual(foldersBetween("C:\\work\\repo", "C:\\work\\repository\\docs\\a.md"), [], "a folder whose name only starts the same is not inside");
});

test("the case of the file's folders is kept, while the comparison ignores it on Windows", async () => {
  const { foldersBetween } = await model();
  assert.deepEqual(foldersBetween("c:\\Work\\Repo", "C:/work/repo/Docs/Notes/a.md"), ["c:\\Work\\Repo\\Docs", "c:\\Work\\Repo\\Docs\\Notes"]);
});
