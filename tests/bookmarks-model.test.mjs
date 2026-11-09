import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/editor/bookmarks-model.js");
const place = (path, line, extra = {}) => ({ path, line, column: 0, excerpt: `line ${line}`, id: `id-${path}-${line}`, now: 1, ...extra });

test("a bookmark is added once per line and gets a running number for its generated name", async () => {
  const m = await model();
  let list = m.addBookmark([], place("C:\\docs\\a.md", 3));
  list = m.addBookmark(list, place("C:\\docs\\a.md", 9));
  list = m.addBookmark(list, place("C:/docs/A.md", 3, { id: "duplicate" }));
  assert.equal(list.length, 2, "the same line of the same file (other spelling of the path) is not bookmarked twice");
  assert.deepEqual(list.map(b => b.seq), [1, 2]);
  assert.equal(m.bookmarkTitle(list[0], "Bookmark"), "Bookmark #1");
  assert.equal(m.bookmarkTitle(list[1], "Zakładka"), "Zakładka #2");
  // removing a bookmark does not hand its number to the next one
  list = m.removeBookmark(list, list[0].id);
  list = m.addBookmark(list, place("C:\\docs\\b.md", 1));
  assert.equal(list.at(-1).seq, 3);
});

test("a name and a note are trimmed and limited, and an empty name goes back to the generated one", async () => {
  const m = await model();
  let list = m.addBookmark([], place("/p/a.md", 1));
  const id = list[0].id;
  list = m.editBookmark(list, id, { name: "  Intro  ", note: `  ${"x".repeat(m.MAX_NOTE + 50)}  ` });
  assert.equal(list[0].name, "Intro");
  assert.equal(list[0].note.length, m.MAX_NOTE);
  assert.equal(m.bookmarkTitle(list[0], "Bookmark"), "Intro");
  list = m.editBookmark(list, id, { name: "   " });
  assert.equal(m.bookmarkTitle(list[0], "Bookmark"), "Bookmark #1");
  assert.equal(list[0].note.length, m.MAX_NOTE, "a change of the name leaves the note alone");
});

test("the number of bookmarks is limited", async () => {
  const m = await model();
  let list = [];
  for (let i = 1; i <= m.MAX_BOOKMARKS + 5; i++) list = m.addBookmark(list, place("/p/a.md", i));
  assert.equal(list.length, m.MAX_BOOKMARKS);
});

test("a bookmark finds its line again when the file changed while it was closed", async () => {
  const m = await model();
  const lines = ["# Title", "", "intro", "target line", "tail"];
  const read = n => lines[n - 1];
  const bookmark = { line: 4, excerpt: m.excerptOf("  target   line ") };
  assert.equal(m.relocateLine(bookmark, lines.length, read), 4, "unchanged text stays where it is");
  const shifted = ["new first line", "new second line", ...lines];
  assert.equal(m.relocateLine(bookmark, shifted.length, n => shifted[n - 1]), 6, "lines inserted above move the bookmark down");
  const removed = lines.filter(line => line !== "intro");
  assert.equal(m.relocateLine(bookmark, removed.length, n => removed[n - 1]), 3, "lines removed above move it up");
  const gone = ["only", "three", "lines"];
  assert.equal(m.relocateLine({ line: 40, excerpt: "missing" }, gone.length, n => gone[n - 1]), 3, "when the text is gone the stored line is kept inside the file");
  assert.equal(m.relocateLine({ line: 2, excerpt: "" }, 1, () => ""), 1);
});

test("next and previous bookmark continue into other files and wrap around", async () => {
  const m = await model();
  let list = [];
  for (const [path, line] of [["/p/b.md", 5], ["/p/a.md", 10], ["/p/a.md", 2], ["/p/c.md", 1]]) list = m.addBookmark(list, place(path, line));
  const at = (path, line) => ({ path, line });
  const where = b => `${b.path}:${b.line}`;
  assert.equal(where(m.neighbourBookmark(list, at("/p/a.md", 2), 1)), "/p/a.md:10");
  assert.equal(where(m.neighbourBookmark(list, at("/p/a.md", 10), 1)), "/p/b.md:5", "after the last bookmark of a file comes the next file");
  assert.equal(where(m.neighbourBookmark(list, at("/p/c.md", 1), 1)), "/p/a.md:2", "after the last bookmark of all comes the first");
  assert.equal(where(m.neighbourBookmark(list, at("/p/b.md", 5), -1)), "/p/a.md:10");
  assert.equal(where(m.neighbourBookmark(list, at("/p/a.md", 2), -1)), "/p/c.md:1", "before the first comes the last");
  assert.equal(where(m.neighbourBookmark(list, at("/p/a.md", 5), 1)), "/p/a.md:10", "the caret does not have to be on a bookmark");
  assert.equal(m.neighbourBookmark([], at("/p/a.md", 1), 1), undefined);
  assert.equal(where(m.neighbourBookmark(list, { path: null, line: 1 }, 1)), "/p/a.md:2", "an unsaved document starts from the beginning");
});

test("bookmarks follow a renamed file or folder", async () => {
  const m = await model();
  let list = m.addBookmark([], place("C:\\proj\\notes\\a.md", 1));
  list = m.addBookmark(list, place("C:\\proj\\notes\\sub\\b.md", 1));
  list = m.addBookmark(list, place("C:\\proj\\notes2\\c.md", 1));
  const renamedFile = m.renamePath(list, "C:\\proj\\notes\\a.md", "C:\\proj\\notes\\z.md");
  assert.deepEqual(renamedFile.map(b => b.path), ["C:\\proj\\notes\\z.md", "C:\\proj\\notes\\sub\\b.md", "C:\\proj\\notes2\\c.md"]);
  const renamedFolder = m.renamePath(list, "C:\\proj\\notes", "C:\\proj\\archive");
  assert.deepEqual(renamedFolder.map(b => b.path), ["C:\\proj\\archive\\a.md", "C:\\proj\\archive\\sub\\b.md", "C:\\proj\\notes2\\c.md"], "a folder with a similar name is not touched");
  assert.equal(m.removeFile(list, "c:/proj/notes2/C.md").length, 2);
});

test("a bookmark moves with its text as the file is edited", async () => {
  const m = await model();
  let list = m.addBookmark([], place("/p/a.md", 4));
  list = m.moveBookmark(list, list[0].id, { line: 7, column: 3, excerpt: "moved" });
  assert.deepEqual([list[0].line, list[0].column, list[0].excerpt], [7, 3, "moved"]);
  assert.equal(m.bookmarkAtLine(list, "/p/a.md", 7).id, list[0].id);
  assert.equal(m.bookmarkAtLine(list, "/p/a.md", 4), undefined);
});

test("bookmarks are found by name, note, file or text", async () => {
  const m = await model();
  let list = m.addBookmark([], place("/p/guide.md", 1, { excerpt: "install the tool" }));
  list = m.addBookmark(list, place("/p/api.md", 2, { excerpt: "endpoints" }));
  list = m.editBookmark(list, list[1].id, { name: "Endpoints", note: "check auth header" });
  const found = query => m.filterBookmarks(list, query, "Bookmark").map(b => b.path);
  assert.deepEqual(found(""), ["/p/guide.md", "/p/api.md"]);
  assert.deepEqual(found("auth"), ["/p/api.md"]);
  assert.deepEqual(found("GUIDE install"), ["/p/guide.md"]);
  assert.deepEqual(found("bookmark #1"), ["/p/guide.md"], "the generated name can be searched too");
  assert.deepEqual(found("nothing here"), []);
});

test("stored bookmarks are read defensively", async () => {
  const m = await model();
  const good = { id: "a", path: "/p/a.md", line: 2, column: 0, excerpt: "x", name: "N", note: "n", seq: 1, created: 5 };
  assert.deepEqual(m.parseStoredBookmarks(null), []);
  assert.deepEqual(m.parseStoredBookmarks("not json"), []);
  assert.deepEqual(m.parseStoredBookmarks('{"a":1}'), []);
  const parsed = m.parseStoredBookmarks(JSON.stringify([good, { ...good }, { ...good, id: "b", line: 0 }, { ...good, id: "c", path: "" }, null, 5, { ...good, id: "d", seq: "1" }, { ...good, id: "e", name: "x".repeat(500) }]));
  assert.deepEqual(parsed.map(b => b.id), ["a", "e"], "duplicates and malformed entries are dropped");
  assert.equal(parsed[1].name.length, m.MAX_NAME);
});

test("a bookmarks file holds no path and is read back into the document it lies next to", async () => {
  const m = await model();
  assert.equal(m.bookmarkFilePath("C:\notes\a.md"), "C:\notes\a.md.bookmarks.json");
  let list = m.addBookmark([], place("C:\notes\a.md", 9, { id: "b9" }));
  list = m.addBookmark(list, place("C:\notes\a.md", 2, { id: "b2" }));
  list = m.editBookmark(list, "b2", { name: "Intro", note: "check" });
  const text = m.serializeBookmarkFile("a.md", list);
  assert.ok(!text.includes("notes"), "the file does not mention the folder");
  assert.deepEqual(JSON.parse(text).bookmarks.map(b => b.line), [2, 9], "bookmarks are listed in the order of the document");
  const moved = m.parseBookmarkFile(text, "/other/place/a.md");
  assert.deepEqual(moved.map(b => [b.path, b.line, b.name, b.note]), [["/other/place/a.md", 2, "Intro", "check"], ["/other/place/a.md", 9, "", ""]]);
  assert.equal(m.sameBookmarkContent(list, moved), true, "the same bookmarks in another folder are the same content");
  assert.equal(m.sameBookmarkContent(list, m.editBookmark(moved, "b2", { note: "changed" })), false);
});

test("a file that is not a bookmarks file is told apart from an empty one", async () => {
  const m = await model();
  assert.equal(m.parseBookmarkFile("", "/p/a.md"), null);
  assert.equal(m.parseBookmarkFile("not json", "/p/a.md"), null);
  assert.equal(m.parseBookmarkFile('{"hiddenSections":[]}', "/p/a.md"), null, "the hidden sections config is not a bookmarks file");
  assert.deepEqual(m.parseBookmarkFile('{"version":1,"bookmarks":[]}', "/p/a.md"), []);
  assert.deepEqual(m.parseBookmarkFile('{"bookmarks":[null,5,{"id":"x"}]}', "/p/a.md"), [], "malformed entries are dropped");
});

test("reading a bookmarks file replaces the document's bookmarks and renews ids used by another document", async () => {
  const m = await model();
  let list = m.addBookmark([], place("/p/a.md", 1, { id: "shared" }));
  list = m.addBookmark(list, place("/p/b.md", 5, { id: "old" }));
  const copy = m.parseBookmarkFile(m.serializeBookmarkFile("b.md", [{ ...list[0], path: "/p/b.md" }]), "/p/b.md");
  let counter = 0;
  const merged = m.replaceFileBookmarks(list, "/p/b.md", copy, () => `new-${++counter}`);
  assert.deepEqual(merged.map(b => [b.path, b.line, b.id]), [["/p/a.md", 1, "shared"], ["/p/b.md", 1, "new-1"]], "b.md now holds what its file said; the copied id was renewed");
  const emptied = m.replaceFileBookmarks(list, "/p/b.md", [], () => "x");
  assert.deepEqual(emptied.map(b => b.path), ["/p/a.md"], "an empty file clears the document's bookmarks");
});
