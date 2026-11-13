import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/filesystem/expanded-folders-model.js");

test("the open folders of other projects stay when the current project changes", async () => {
  const m = await model();
  const list = ["D:/a/src", "D:/a/docs", "D:/b/x"];
  assert.deepEqual(m.replaceUnder(list, ["D:/a"], ["D:/a/src"]), ["D:/b/x", "D:/a/src"], "docs was closed, the other project is untouched");
  assert.deepEqual(m.replaceUnder(list, ["D:/a"], []), ["D:/b/x"], "everything closed");
  assert.deepEqual(m.replaceUnder([], ["D:/a"], ["D:/a/new", "D:/elsewhere/y"]), ["D:/a/new"], "only folders inside the project are remembered");
});

test("the folders to open again are those inside the project folders, however the path is written", async () => {
  const m = await model();
  const BS = String.fromCharCode(92), windows = "d:" + BS + "A" + BS + "src";
  assert.deepEqual(m.openUnder([windows, "D:/b/x", "D:/ab/y"], ["D:/a"]), [windows], "a similar prefix is not inside");
  assert.deepEqual(m.openUnder(["D:/a/x", "D:/b/y"], ["D:/a", "D:/b"]), ["D:/a/x", "D:/b/y"]);
});

test("a stored value is read defensively and the list stays bounded", async () => {
  const m = await model();
  assert.deepEqual(m.parseExpanded(["a", 3, "", null, "b"]), ["a", "b"]);
  assert.deepEqual(m.parseExpanded("nonsense"), []);
  const many = Array.from({ length: m.MAX_REMEMBERED_FOLDERS + 50 }, (_, i) => `D:/p/f${i}`);
  const kept = m.replaceUnder([], ["D:/p"], many);
  assert.equal(kept.length, m.MAX_REMEMBERED_FOLDERS);
  assert.equal(kept.at(-1), many.at(-1), "the newest are kept");
});
