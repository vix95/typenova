import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/editor/highlights-model.js");
const config = () => import("../.test-build/documents/doc-config-model.js");
const make = (m, list, from, to, text, id, path = "C:\\docs\\a.md", color = "yellow") => m.addHighlight(list, { path, from, to, text, color, id, now: 1 });

test("a highlight is added for a passage that does not overlap another one", async () => {
  const m = await model();
  let list = make(m, [], 5, 12, "passage", "a");
  list = make(m, list, 20, 30, "other text", "b");
  assert.equal(list.length, 2);
  assert.equal(make(m, list, 10, 15, "overlap", "c").length, 2, "an overlapping passage is not added");
  assert.equal(make(m, list, 12, 18, "touching", "d").length, 3, "a passage that only touches another is added");
  assert.equal(make(m, [], 3, 3, "", "e").length, 0, "an empty passage is not added");
  assert.equal(make(m, [], 1, 9, "x", "f", "C:/docs/A.md").length, 1);
});

test("highlights touching a selection or a caret are found", async () => {
  const m = await model();
  const list = make(m, make(m, [], 5, 12, "passage", "a"), 20, 30, "other text", "b");
  const ids = (from, to) => m.highlightsTouching(list, "C:/docs/a.md", from, to).map(h => h.id);
  assert.deepEqual(ids(8, 8), ["a"], "a caret inside");
  assert.deepEqual(ids(12, 12), ["a"], "a caret at the end");
  assert.deepEqual(ids(13, 19), []);
  assert.deepEqual(ids(0, 25), ["a", "b"], "a selection over two highlights");
});

test("note, group and colour are edited and limited; text moves with edits", async () => {
  const m = await model();
  let list = make(m, [], 5, 12, "passage", "a");
  list = m.editHighlight(list, "a", { note: "  think about it  ", group: " Important ", color: "green" });
  assert.deepEqual([list[0].note, list[0].group, list[0].color], ["think about it", "Important", "green"]);
  list = m.editHighlight(list, "a", { color: "purple" });
  assert.equal(list[0].color, "green", "an unknown colour is ignored");
  list = m.editHighlight(list, "a", { note: "x".repeat(m.MAX_NOTE + 10), group: "g".repeat(200) });
  assert.equal(list[0].note.length, m.MAX_NOTE);
  assert.equal(list[0].group.length, m.MAX_GROUP);
  list = m.moveHighlight(list, "a", { from: 9, to: 16, text: "passage" });
  assert.deepEqual([list[0].from, list[0].to], [9, 16]);
});

test("next and previous highlight continue into other files and wrap around", async () => {
  const m = await model();
  let list = [];
  for (const [path, from, id] of [["/p/b.md", 5, "b5"], ["/p/a.md", 50, "a50"], ["/p/a.md", 10, "a10"], ["/p/c.md", 1, "c1"]]) list = make(m, list, from, from + 3, "abc", id, path);
  const next = (path, position, dir) => m.neighbourHighlight(list, { path, position }, dir)?.id;
  assert.equal(next("/p/a.md", 10, 1), "a50");
  assert.equal(next("/p/a.md", 50, 1), "b5");
  assert.equal(next("/p/c.md", 1, 1), "a10", "after the last one comes the first");
  assert.equal(next("/p/b.md", 5, -1), "a50");
  assert.equal(next("/p/a.md", 10, -1), "c1", "before the first comes the last");
  assert.equal(next("/p/a.md", 20, 1), "a50", "the caret does not have to be on a highlight");
  assert.equal(next(null, 0, 1), "a10");
  assert.equal(m.neighbourHighlight([], { path: "/p/a.md", position: 0 }, 1), undefined);
});

test("highlights are grouped by file or by group, found by words, and written as Markdown", async () => {
  const m = await model();
  let list = make(m, [], 5, 12, "alpha text", "a", "/p/a.md");
  list = make(m, list, 20, 30, "beta text", "b", "/p/b.md");
  list = make(m, list, 40, 50, "gamma text", "c", "/p/a.md");
  list = m.editHighlight(list, "a", { group: "Important", note: "check this" });
  list = m.editHighlight(list, "c", { group: "Important" });
  const labels = { noGroup: "No group", fileName: p => p.split("/").pop(), title: "Highlights" };
  assert.deepEqual(m.groupHighlights(list, "file", labels).map(s => [s.label, s.items.map(h => h.id)]), [["a.md", ["a", "c"]], ["b.md", ["b"]]]);
  assert.deepEqual(m.groupHighlights(list, "group", labels).map(s => [s.label, s.items.map(h => h.id)]), [["Important", ["a", "c"]], ["No group", ["b"]]], "highlights without a group come last");
  assert.deepEqual(m.groupNames(list), ["Important"]);
  assert.deepEqual(m.filterHighlights(list, "check alpha").map(h => h.id), ["a"], "the note and the text are searched");
  assert.equal(m.filterHighlights(list, "").length, 3);
  const md = m.highlightsToMarkdown(list, "file", labels);
  assert.match(md, /^# Highlights\n\n## a\.md\n\n> alpha text\n\ncheck this\n\n> gamma text\n\n## b\.md\n\n> beta text\n$/);
});

test("a highlight finds its text again when the file changed while it was closed", async () => {
  const m = await model();
  const item = { from: 6, to: 11, text: "world" };
  assert.deepEqual(m.relocateHighlight(item, "hello world!"), { from: 6, to: 11 }, "unchanged text stays where it is");
  assert.deepEqual(m.relocateHighlight(item, "intro: hello world!"), { from: 13, to: 18 }, "text inserted above moves it down");
  assert.deepEqual(m.relocateHighlight(item, "hi world"), { from: 3, to: 8 }, "text removed above moves it up");
  assert.deepEqual(m.relocateHighlight(item, "world and world"), { from: 10, to: 15 }, "the nearest of two equal passages (4 away, not 6)");
  assert.equal(m.relocateHighlight(item, "nothing here"), null, "gone text is not found");
});

test("the preview text of a passage drops Markdown markers", async () => {
  const m = await model();
  assert.equal(m.plainText("**bold** and *italic* and `code`"), "bold and italic and code");
  assert.equal(m.plainText("see [the docs](https://x.y/z) now"), "see the docs now");
  assert.equal(m.plainText("## Heading\n\ntext\n- item one\n- item two"), "Heading text item one item two");
  assert.equal(m.plainText("snake_case_name stays"), "snake_case_name stays", "underscores inside a word stay");
  assert.equal(m.plainText("a  \n  b"), "a b");
});

test("highlights are renamed with their file, and stored ones are read defensively", async () => {
  const m = await model();
  let list = make(m, [], 5, 12, "passage", "a", "C:\\proj\\notes\\a.md");
  list = make(m, list, 5, 12, "passage", "b", "C:\\proj\\notes2\\c.md");
  assert.deepEqual(m.renamePath(list, "C:\\proj\\notes", "C:\\proj\\archive").map(h => h.path), ["C:\\proj\\archive\\a.md", "C:\\proj\\notes2\\c.md"]);
  assert.equal(m.removeFile(list, "c:/proj/notes2/C.md").length, 1);
  const good = { id: "a", path: "/p/a.md", from: 1, to: 4, text: "abc", note: "", group: "", color: "yellow", created: 1 };
  assert.deepEqual(m.parseStoredHighlights(null), []);
  assert.deepEqual(m.parseStoredHighlights("not json"), []);
  const parsed = m.parseStoredHighlights(JSON.stringify([good, { ...good }, { ...good, id: "b", to: 1 }, { ...good, id: "c", color: "red" }, null, { ...good, id: "d", text: "" }, { ...good, id: "e", note: "n" }]));
  assert.deepEqual(parsed.map(h => h.id), ["a", "e"], "duplicates and malformed entries are dropped");
  const entries = m.highlightEntries(list);
  assert.ok(entries.every(e => !("path" in e)), "entries carry no path");
  const back = m.parseHighlightList(entries, "/other/a.md");
  assert.deepEqual(back.map(h => [h.path, h.id]), [["/other/a.md", "a"], ["/other/a.md", "b"]]);
  assert.equal(m.sameHighlightContent(list, back.map(h => ({ ...h, path: "x" }))), true);
  let counter = 0;
  const merged = m.replaceFileHighlights(list.slice(0, 1), "/q/z.md", [{ ...list[0], path: "/q/z.md" }], () => `new-${++counter}`);
  assert.deepEqual(merged.map(h => h.id), ["a", "new-1"], "an id used by another file is renewed");
});

test("the config file keeps every part of the settings of a document and never loses unknown ones", async () => {
  const c = await config();
  assert.equal(c.docConfigPath("/p/a.md"), "/p/a.md.config.json");
  assert.deepEqual(c.parseDocConfig(null), {});
  assert.deepEqual(c.parseDocConfig("  "), {});
  assert.equal(c.parseDocConfig("[1]"), null, "a list is not a config file");
  assert.equal(c.parseDocConfig("not json"), null);
  const base = c.parseDocConfig('{"version":1,"document":"a.md","hiddenSections":[{"level":2,"title":"T","occurrence":0}],"future":{"x":1}}');
  const withBookmarks = c.withDocConfigParts(base, { bookmarks: [{ id: "b" }] });
  assert.deepEqual(Object.keys(JSON.parse(c.serializeDocConfig("a.md", withBookmarks))), ["version", "document", "hiddenSections", "bookmarks", "future"], "known parts first, others kept");
  const cleared = c.withDocConfigParts(withBookmarks, { hiddenSections: [], bookmarks: undefined });
  assert.equal("hiddenSections" in cleared, false);
  assert.equal(c.isEmptyDocConfig(cleared), false, "an unknown part still counts as content");
  assert.equal(c.isEmptyDocConfig(c.withDocConfigParts({ version: 1, document: "a.md" }, { highlights: [] })), true);
});
