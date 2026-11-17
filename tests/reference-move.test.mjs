import test from "node:test";
import assert from "node:assert/strict";
import { planReferenceMove } from "../.test-build/filesystem/reference-move.js";

const apply = (text, edits) => [...edits].sort((a, b) => b.from - a.from).reduce((out, edit) => out.slice(0, edit.from) + edit.insert + out.slice(edit.to), text);
const run = (text, doc, move, newDoc = doc) => apply(text, planReferenceMove(text, doc, newDoc, move));

const DOC = "D:\\notes\\doc.md";

test("an image moved to another folder is found by its new path", () => {
  const move = { from: "D:\\notes\\assets\\pic.png", to: "D:\\notes\\media\\img\\pic.png" };
  assert.equal(run("![x](assets/pic.png)", DOC, move), "![x](media/img/pic.png)");
  assert.equal(run("![x](./assets/pic.png)", DOC, move), "![x](./media/img/pic.png)");
  assert.equal(run("[a](assets/pic.png \"title\")", DOC, move), "[a](media/img/pic.png \"title\")");
  assert.equal(run("![x](assets/pic.png#frag)", DOC, move), "![x](media/img/pic.png#frag)");
});

test("a renamed file keeps its folder", () => {
  const move = { from: "D:\\notes\\assets\\pic.png", to: "D:\\notes\\assets\\photo.png" };
  assert.equal(run("![x](assets/pic.png)", DOC, move), "![x](assets/photo.png)");
});

test("the references of a document in another folder are made relative to it", () => {
  const move = { from: "D:\\notes\\assets\\pic.png", to: "D:\\notes\\media\\pic.png" };
  assert.equal(run("![x](../assets/pic.png)", "D:\\notes\\sub\\doc.md", move), "![x](../media/pic.png)");
  assert.equal(run("![x](assets/pic.png)", "D:\\notes\\doc.md", { from: "D:\\notes\\assets\\pic.png", to: "D:\\other\\pic.png" }), "![x](../other/pic.png)");
});

test("a folder that moves takes the references into it along", () => {
  const move = { from: "D:\\notes\\assets", to: "D:\\notes\\archive\\assets" };
  assert.equal(run("![a](assets/one.png) and [b](assets/deep/two.png)", DOC, move), "![a](archive/assets/one.png) and [b](archive/assets/deep/two.png)");
});

test("a document that is moved keeps pointing at the same files", () => {
  // doc.md moves from notes/ to notes/sub/: its links to a file that stays are written again from the new place.
  const move = { from: "D:\\notes\\doc.md", to: "D:\\notes\\sub\\doc.md" };
  assert.equal(run("![x](assets/pic.png) [n](other.md)", "D:\\notes\\doc.md", move, "D:\\notes\\sub\\doc.md"), "![x](../assets/pic.png) [n](../other.md)");
  // a folder moved together with its document: references inside it do not change
  const folder = { from: "D:\\notes\\a", to: "D:\\notes\\b\\a" };
  assert.equal(run("![x](img/p.png) ![y](../top.png)", "D:\\notes\\a\\doc.md", folder, "D:\\notes\\b\\a\\doc.md"), "![x](img/p.png) ![y](../../top.png)");
});

test("addresses written with percent codes, angle brackets and spaces stay valid", () => {
  const move = { from: "D:\\notes\\assets\\my pic.png", to: "D:\\notes\\media\\my pic.png" };
  assert.equal(run("![x](assets/my%20pic.png)", DOC, move), "![x](media/my%20pic.png)");
  assert.equal(run("![x](<assets/my pic.png>)", DOC, move), "![x](<media/my pic.png>)");
});

test("references that are not files of the project are left alone", () => {
  const move = { from: "D:\\notes\\assets\\pic.png", to: "D:\\notes\\media\\pic.png" };
  const text = "[w](https://example.com/assets/pic.png) [m](mailto:a@b.c) [h](#assets/pic.png) ![d](data:image/png;base64,AAAA) [other](assets/else.png)";
  assert.equal(run(text, DOC, move), text);
});

test("code is not touched, definitions and html are", () => {
  const move = { from: "D:\\notes\\assets\\pic.png", to: "D:\\notes\\media\\pic.png" };
  const text = "`![x](assets/pic.png)`\n\n```md\n![x](assets/pic.png)\n```\n\n[ref]: assets/pic.png\n<img src=\"assets/pic.png\">\n";
  assert.equal(run(text, DOC, move), "`![x](assets/pic.png)`\n\n```md\n![x](assets/pic.png)\n```\n\n[ref]: media/pic.png\n<img src=\"media/pic.png\">\n");
});

test("nothing to do gives no edits", () => {
  const move = { from: "D:\\notes\\assets\\pic.png", to: "D:\\notes\\media\\pic.png" };
  assert.deepEqual(planReferenceMove("no links here", DOC, DOC, move), []);
  assert.deepEqual(planReferenceMove("![x](assets/else.png)", DOC, DOC, move), []);
});
