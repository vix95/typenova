import test from "node:test";
import assert from "node:assert/strict";
import { buildSectionNodes, buildSectionGraphModel, preferredSectionRelationKind } from "../.test-build/graph/section-model.js";
import { normalizePath, normalizeLocalImagePath } from "../.test-build/filesystem/path-utils.js";
import { deduplicateSessionPaths, sameSessionPath, normalizeSessionPath } from "../.test-build/documents/session.js";
import { isRecord, isStringArray, readPreferenceJson } from "../.test-build/settings/storage.js";
import { normalizedFsPath, parentPath, pathIsInside, remapPathPrefix, uniqueTreeDestination, copyTreeEntry } from "../.test-build/filesystem/project-tree-operations.js";
import { buildProjectFilterTree } from "../.test-build/filesystem/project-filter-tree.js";
import { createProjectTreeState } from "../.test-build/filesystem/project-tree-state.js";
import { createProjectTreeController } from "../.test-build/filesystem/project-tree-controller.js";

test("fenced code blocks only close with matching marker and length", async () => {
  const [file] = await buildSectionNodes([{path:"a.md",name:"a.md",text:"```js\n~~~\n# false heading\n```\n# Real heading"}]);
  assert.equal(file.title, "Real heading");
});

test("explicit wikilink file target resolves to that file's heading", async () => {
  const sections = await buildSectionNodes([
    {path:"source.md",name:"source.md",text:"# Source\n[[target.md#Common]]"},
    {path:"target.md",name:"target.md",text:"# Target\n## Common"}
  ]);
  const source = sections.find(x=>x.title==="Source");
  const target = sections.find(x=>x.title==="Common");
  assert.ok(source.links.includes(target.id));
});

test("relative file targets prefer the source directory when filenames repeat", async () => {
  const sections = await buildSectionNodes([
    {path:"notes/source.md",name:"source.md",text:"# Source\n[[target.md#Right]]"},
    {path:"notes/target.md",name:"target.md",text:"# Right"},
    {path:"archive/target.md",name:"target.md",text:"# Wrong"}
  ]);
  const source = sections.find(x=>x.title==="Source");
  const right = sections.find(x=>x.title==="Right");
  assert.ok(source.links.includes(right.id));
  assert.equal(source.links.length,1);
});

test("file-only wikilink resolves to first heading in target file", async () => {
  const sections = await buildSectionNodes([
    {path:"source.md",name:"source.md",text:"# Source\n[[target.md]]"},
    {path:"target.md",name:"target.md",text:"# Target\n## Child"}
  ]);
  assert.ok(sections.find(x=>x.title==="Source").links.includes(sections.find(x=>x.title==="Target").id));
});

test("code fences do not create wikilink relations", async () => {
  const sections = await buildSectionNodes([
    {path:"source.md",name:"source.md",text:"# Source\n```md\n[[target.md#Target]]\n```"},
    {path:"target.md",name:"target.md",text:"# Target"}
  ]);
  assert.equal(sections.find(x=>x.title==="Source").links.length,0);
});

test("parent-child relation keeps tree semantics", async () => {
  const sections = await buildSectionNodes([{path:"a.md",name:"a.md",text:"# Root\n## Child"}]);
  const model = buildSectionGraphModel(sections);
  const edge = model.relations.find(x=>new Set([x.sourceId,x.targetId]).size===2);
  assert.equal(edge.kind,"tree");
});

test("UNC paths preserve network root", () => {
  assert.equal(normalizePath(String.raw`\\server\share\folder\..\file.md`),String.raw`\\server\share\file.md`);
  assert.equal(normalizeLocalImagePath(String.raw`\\server\share\image.png`),String.raw`\\server\share\image.png`);
});

test("POSIX session paths remain case-sensitive", () => {
  assert.deepEqual(deduplicateSessionPaths(["/tmp/Doc.md","/tmp/doc.md"]),["/tmp/Doc.md","/tmp/doc.md"]);
  assert.equal(sameSessionPath("/tmp/Doc.md","/tmp/doc.md"),false);
});

test("Windows session paths remain case-insensitive", () => {
  assert.equal(sameSessionPath("C:\\\\Docs\\\\A.md","c:\\\\docs\\\\a.md"),true);
});


test("UNC session paths preserve their network root and cannot collide with POSIX paths", () => {
  assert.equal(normalizeSessionPath(String.raw`\\Server\Share\Folder`), "//server/share/folder");
  assert.notEqual(normalizeSessionPath(String.raw`\\server\share`), normalizeSessionPath("/server/share"));
  assert.equal(sameSessionPath(String.raw`\\Server\Share\A.md`, String.raw`\\server\share\a.md`), true);
});

test("JSON preference reader falls back for malformed JSON and unexpected shapes", () => {
  const original = globalThis.localStorage;
  const values = new Map([["broken", "{"], ["wrong-shape", "{\"items\":[]}"], ["valid", "[\"a\",\"b\"]"]]);
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null };
  try {
    assert.deepEqual(readPreferenceJson("broken", isStringArray, ["fallback"]), ["fallback"]);
    assert.deepEqual(readPreferenceJson("wrong-shape", isStringArray, []), []);
    assert.deepEqual(readPreferenceJson("valid", isStringArray, []), ["a", "b"]);
    assert.equal(isRecord([]), false);
    assert.equal(isRecord({ ok: true }), true);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test("relation precedence is centralized and stable across renderers", () => {
  assert.equal(preferredSectionRelationKind("section", "tree"), "tree");
  assert.equal(preferredSectionRelationKind("link", "section"), "link");
  assert.equal(preferredSectionRelationKind("tree", "link"), "tree");
});


test("project tree path identity preserves POSIX case and folds Windows identity", () => {
  assert.notEqual(normalizedFsPath("/Work/Doc.md"), normalizedFsPath("/work/doc.md"));
  assert.equal(normalizedFsPath("C:\\Work\\Doc.md"), normalizedFsPath("c:/work/doc.md"));
  assert.notEqual(normalizedFsPath(String.raw`\\server\share`), normalizedFsPath("/server/share"));
  assert.equal(pathIsInside("/Work", "/Work/Docs/a.md"), true);
  assert.equal(pathIsInside("/Work", "/Workspace/a.md"), false);
  assert.equal(pathIsInside("C:\\Work", "c:/work/docs/a.md"), true);
  assert.equal(parentPath("C:\\"), "C:/");
});

test("project tree path remapping preserves descendant suffix and unrelated paths", () => {
  assert.equal(remapPathPrefix("/Work/old/note.md", "/Work/old", "/Work/new"), "/Work/new/note.md");
  assert.equal(remapPathPrefix("/Work/oldish/note.md", "/Work/old", "/Work/new"), "/Work/oldish/note.md");
  assert.equal(remapPathPrefix("C:\\Work\\Old\\note.md", "c:/work/old", "D:\\Moved"), "D:\\Moved\\note.md");
});

test("tree destination names avoid collisions while preserving extensions", async () => {
  const occupied = new Set(["/dest/note.md", "/dest/note (copy).md"]);
  const fs = { join: async (...parts) => parts.join("/"), exists: async (path) => occupied.has(path) };
  assert.equal(await uniqueTreeDestination("/dest", "note.md", false, fs, "copy"), "/dest/note (copy 2).md");
  assert.equal(await uniqueTreeDestination("/dest", "folder", true, fs, "copy"), "/dest/folder");
});

test("directory copy rolls back partial destination after a child failure", async () => {
  const dirs = new Set();
  const files = new Set(["/source/a.md"]);
  const fs = {
    join: async (...parts) => parts.join("/"),
    exists: async (path) => dirs.has(path) || files.has(path),
    readDir: async (path) => path === "/source" ? [{ name: "a.md" }, { name: "denied.md" }] : [],
    mkdir: async (path) => { dirs.add(path); },
    copyFile: async (source, destination) => { if (source.endsWith("denied.md")) throw new Error("permission denied"); files.add(destination); },
    remove: async (path) => { dirs.delete(path); for (const file of [...files]) if (file.startsWith(path + "/")) files.delete(file); }
  };
  await assert.rejects(copyTreeEntry("/source", "/dest", true, fs, "exists"), /permission denied/);
  assert.equal(dirs.has("/dest"), false);
  assert.equal(files.has("/dest/a.md"), false);
});


test("project filter tree groups nested files and records descendant paths", () => {
  const tree = buildProjectFilterTree([
    { path: "/work/zeta/b.md", name: "b.md" },
    { path: "/work/alpha/a.md", name: "a.md" },
    { path: "/work/root.md", name: "root.md" },
  ], "/work", "work", "en");
  assert.deepEqual(tree.children.map(node => node.name), ["alpha", "zeta", "root.md"]);
  assert.deepEqual(tree.children[0].filePaths, ["/work/alpha/a.md"]);
  assert.deepEqual(tree.filePaths, ["/work/zeta/b.md", "/work/alpha/a.md", "/work/root.md"]);
});

test("project filter tree preserves case-distinct POSIX directories", () => {
  const tree = buildProjectFilterTree([
    { path: "/work/Notes/a.md", name: "a.md" },
    { path: "/work/notes/b.md", name: "b.md" },
  ], "/work", "work");
  assert.equal(tree.children.length, 2);
  assert.notEqual(tree.children[0].path, tree.children[1].path);
});

test("project filter tree folds case for Windows directory identity", () => {
  const tree = buildProjectFilterTree([
    { path: "C:\\Work\\Notes\\a.md", name: "a.md" },
    { path: "c:\\work\\notes\\b.md", name: "b.md" },
  ], "C:\\Work", "Work");
  assert.equal(tree.children.length, 1);
  assert.deepEqual(tree.children[0].filePaths, ["C:\\Work\\Notes\\a.md", "c:\\work\\notes\\b.md"]);
});

test("project filter tree supports POSIX filesystem root", () => {
  const tree = buildProjectFilterTree([{ path: "/docs/a.md", name: "a.md" }], "/", "root");
  assert.equal(tree.children[0].name, "docs");
  assert.equal(tree.children[0].path, "docs");
});


test("project tree state instances do not share mutable explorer state", () => {
  const first = createProjectTreeState();
  const second = createProjectTreeState();
  first.expandedFolders.add("notes");
  first.clipboard = { path: "/work/a.md", operation: "cut", isDirectory: false };
  first.keyboardActive = true;
  assert.equal(second.expandedFolders.size, 0);
  assert.equal(second.clipboard, null);
  assert.equal(second.keyboardActive, false);
});


function createControllerHarness(overrides = {}) {
  const state = createProjectTreeState();
  const files = new Set(["/project/sub/note.md"]);
  const directories = new Set(["/project", "/project/sub", "/project/dest"]);
  const fs = {
    join: async (...parts) => parts.map((part, index) => index ? part.replace(/^[/\\]+/, "") : part.replace(/[/\\]+$/, "")).join("/"),
    exists: async (path) => files.has(path) || directories.has(path),
    readDir: async () => [],
    mkdir: async (path) => { directories.add(path); },
    copyFile: async (source, destination) => {
      if (!files.has(source)) throw new Error(`missing source: ${source}`);
      files.add(destination);
    },
    remove: async (path, options) => {
      if (overrides.remove) return overrides.remove(path, options, { files, directories });
      files.delete(path);
      directories.delete(path);
      for (const file of [...files]) if (file.startsWith(`${path}/`)) files.delete(file);
      for (const directory of [...directories]) if (directory.startsWith(`${path}/`)) directories.delete(directory);
    },
    rename: async (source, destination) => {
      if (overrides.rename) return overrides.rename(source, destination, { files, directories });
      if (files.has(source)) { files.delete(source); files.add(destination); return; }
      if (directories.has(source)) { directories.delete(source); directories.add(destination); return; }
      throw new Error(`missing source: ${source}`);
    },
  };
  const moved = [];
  const controller = createProjectTreeController({
    state,
    fs,
    getProjectRoot: () => "/project",
    getCopyLabel: () => "copy",
    getAlreadyExistsMessage: () => "destination exists",
    getProjectRequiredMessage: () => "open project first",
    getOutsideProjectMessage: () => "outside project",
    getProjectRootMutationMessage: () => "cannot remove project root",
    getDescendantMoveMessage: () => "cannot move into descendant",
    onPathMoved: (from, to) => moved.push([from, to]),
  });
  return { state, fs, files, directories, moved, controller };
}

test("project-tree controller coordinates a successful move and remaps ephemeral state", async () => {
  const { state, files, moved, controller } = createControllerHarness();
  state.expandedFolders.add("/project/sub");
  state.lastTarget = { path: "/project/sub/note.md", isDirectory: false, isRoot: false };
  state.contextTarget = { path: "/project/sub/note.md", isDirectory: false, isRoot: false };
  state.clipboard = { path: "/project/sub/note.md", operation: "cut", isDirectory: false };
  const result = await controller.moveOrCopy("/project/sub/note.md", "/project/dest", "cut", false);
  assert.deepEqual(result, { status: "moved", source: "/project/sub/note.md", destination: "/project/dest/note.md" });
  assert.equal(files.has("/project/sub/note.md"), false);
  assert.equal(files.has("/project/dest/note.md"), true);
  assert.equal(state.lastTarget.path, "/project/dest/note.md");
  assert.equal(state.contextTarget.path, "/project/dest/note.md");
  assert.equal(state.clipboard, null);
  assert.deepEqual(moved, [["/project/sub/note.md", "/project/dest/note.md"]]);
  assert.equal(state.expandedFolders.has("/project/dest"), true);
});

test("project-tree controller uses copy/remove fallback when rename fails", async () => {
  const { files, controller } = createControllerHarness({
    rename: async () => { throw new Error("cross-device rename"); },
  });
  const result = await controller.moveOrCopy("/project/sub/note.md", "/project/dest", "cut", false);
  assert.equal(result.status, "moved");
  assert.equal(files.has("/project/sub/note.md"), false);
  assert.equal(files.has("/project/dest/note.md"), true);
});

test("project-tree controller rolls back fallback destination if source deletion fails", async () => {
  const { files, controller } = createControllerHarness({
    rename: async () => { throw new Error("cross-device rename"); },
    remove: async (path, _options, store) => {
      if (path === "/project/sub/note.md") throw new Error("source locked");
      store.files.delete(path);
      store.directories.delete(path);
    },
  });
  await assert.rejects(controller.moveOrCopy("/project/sub/note.md", "/project/dest", "cut", false), /source locked/);
  assert.equal(files.has("/project/sub/note.md"), true);
  assert.equal(files.has("/project/dest/note.md"), false);
});

test("project-tree controller prevents moving a directory into itself or a descendant", async () => {
  const { controller } = createControllerHarness();
  await assert.rejects(controller.moveOrCopy("/project/sub", "/project/sub/child", "cut", true), /cannot move into descendant/);
});

test("project-tree controller clears deleted-path references only after filesystem removal succeeds", async () => {
  const { state, controller } = createControllerHarness({
    remove: async (path) => { if (path === "/project/sub") throw new Error("access denied"); },
  });
  state.clipboard = { path: "/project/sub/note.md", operation: "copy", isDirectory: false };
  state.expandedFolders.add("/project/sub");
  state.contextTarget = { path: "/project/sub/note.md", isDirectory: false, isRoot: false };
  await assert.rejects(controller.remove("/project/sub", true), /access denied/);
  assert.notEqual(state.clipboard, null);
  assert.equal(state.expandedFolders.has("/project/sub"), true);
  // With a successful filesystem remove, every stale reference is discarded.
  const successful = createControllerHarness();
  successful.state.clipboard = { path: "/project/sub/note.md", operation: "copy", isDirectory: false };
  successful.state.expandedFolders.add("/project/sub");
  successful.state.contextTarget = { path: "/project/sub/note.md", isDirectory: false, isRoot: false };
  await successful.controller.remove("/project/sub", true);
  assert.equal(successful.state.clipboard, null);
  assert.equal(successful.state.expandedFolders.has("/project/sub"), false);
  assert.equal(successful.state.contextTarget, null);
});

test("project-tree controller does not delete a destination created by a competing operation", async () => {
  const { files, controller } = createControllerHarness({
    rename: async (_source, destination, store) => {
      store.files.add(destination);
      throw new Error("destination appeared during rename");
    },
  });
  await assert.rejects(controller.moveOrCopy("/project/sub/note.md", "/project/dest", "cut", false), /destination exists/);
  assert.equal(files.has("/project/sub/note.md"), true);
  assert.equal(files.has("/project/dest/note.md"), true);
});

test("project-tree controller resets transient state without resetting installed DOM listeners", () => {
  const { state, controller } = createControllerHarness();
  state.clipboard = { path: "/project/sub/note.md", operation: "cut", isDirectory: false };
  state.keyboardActive = true;
  state.lastTarget = { path: "/project/sub/note.md", isDirectory: false, isRoot: false };
  state.contextTarget = { path: "/project/sub/note.md", isDirectory: false, isRoot: false };
  state.expandedFolders.add("/project/sub");
  state.dragDropInstalled = true;
  controller.resetTransientState();
  assert.equal(state.clipboard, null);
  assert.equal(state.keyboardActive, false);
  assert.equal(state.lastTarget, null);
  assert.equal(state.contextTarget, null);
  assert.equal(state.expandedFolders.size, 0);
  assert.equal(state.dragDropInstalled, true);
});

test("project-tree controller rejects source or destination paths outside the open project", async () => {
  const { controller } = createControllerHarness();
  await assert.rejects(controller.moveOrCopy("/outside/note.md", "/project/dest", "copy", false), /outside project/);
  await assert.rejects(controller.moveOrCopy("/project/sub/note.md", "/outside", "copy", false), /outside project/);
});

test("project-tree controller refuses to remove the project root or paths outside it", async () => {
  const { controller } = createControllerHarness();
  await assert.rejects(controller.remove("/project", true), /cannot remove project root/);
  await assert.rejects(controller.remove("/outside/note.md", false), /outside project/);
});

test("saved view positions survive a session round trip and malformed ones are dropped", async () => {
  const { serializeOpenSession, parseOpenSession, findViewPosition } = await import("../.test-build/documents/session.js");
  const positions = { "c:/notes/a.md": { editorLine: 42, preview: { line: 40, fraction: 0.25 } } };
  const parsed = parseOpenSession(serializeOpenSession(["C:/Notes/a.md"], "C:/Notes/a.md", positions));
  assert.deepEqual(findViewPosition(parsed.positions, "C:/NOTES/A.md"), positions["c:/notes/a.md"]);
  const dirty = parseOpenSession(JSON.stringify({ paths: ["a.md"], activePath: null, positions: {
    "a.md": { editorLine: 0, preview: null }, "b.md": { editorLine: "7" }, "c.md": { editorLine: 5, preview: { line: 3, fraction: 9 } }
  } }));
  assert.equal(findViewPosition(dirty.positions, "a.md"), null);
  assert.equal(findViewPosition(dirty.positions, "b.md"), null);
  assert.deepEqual(findViewPosition(dirty.positions, "c.md"), { editorLine: 5, preview: { line: 3, fraction: 1 } });
  assert.deepEqual(parseOpenSession(JSON.stringify({ paths: ["a.md"] })).positions, {});
});

test("tab reordering keeps the other tabs in order and clamps the slot", async () => {
  const { moveItem, insertionIndex } = await import("../.test-build/documents/tab-order.js");
  const tabs = ["a", "b", "c", "d"];
  assert.deepEqual(moveItem(tabs, (t) => t === "a", 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(tabs, (t) => t === "d", 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(tabs, (t) => t === "b", 1), tabs);
  assert.deepEqual(moveItem(tabs, (t) => t === "a", 99), ["b", "c", "d", "a"]);
  assert.deepEqual(moveItem(tabs, (t) => t === "zzz", 1), tabs);
  assert.notEqual(moveItem(tabs, (t) => t === "a", 0), tabs);
  assert.equal(insertionIndex([50, 150, 250], 160), 2);
  assert.equal(insertionIndex([50, 150, 250], 10), 0);
  assert.equal(insertionIndex([], 100), 0);
});

test("project roots: adding refuses duplicates and overlapping folders, lookups pick the owning root", async () => {
  const { addProjectRoot, removeProjectRoot, rootContaining, isProjectRoot, parseStoredProjectRoots } = await import("../.test-build/filesystem/project-roots.js");
  const roots = ["C:/work/docs", "C:/work/code"];
  assert.equal(addProjectRoot(roots, "c:/WORK/docs/").status, "duplicate");
  assert.deepEqual(addProjectRoot(roots, "C:/work/docs/sub"), { status: "inside", roots, existing: "C:/work/docs" });
  assert.equal(addProjectRoot(["C:/work/docs/sub"], "C:/work/docs").status, "contains");
  assert.deepEqual(addProjectRoot(roots, "D:/notes"), { status: "added", roots: [...roots, "D:/notes"] });
  assert.equal(rootContaining(roots, "C:/work/code/src/a.ts"), "C:/work/code");
  assert.equal(rootContaining(roots, "C:/work/other/a.ts"), null);
  assert.equal(rootContaining(roots, "C:/work/docs-old/a.md"), null);
  assert.equal(isProjectRoot(roots, "C:/WORK/CODE"), true);
  assert.deepEqual(removeProjectRoot(roots, "c:/work/docs"), ["C:/work/code"]);
  assert.deepEqual(parseStoredProjectRoots(JSON.stringify(["a", "a", "b", 3]), "legacy"), ["a", "b"]);
  assert.deepEqual(parseStoredProjectRoots(null, "legacy"), ["legacy"]);
  assert.deepEqual(parseStoredProjectRoots("not json", null), []);
});

test("project tree controller allows moving between open folders but not outside them, and never removes a root", async () => {
  const { createProjectTreeController } = await import("../.test-build/filesystem/project-tree-controller.js");
  const { createProjectTreeState } = await import("../.test-build/filesystem/project-tree-state.js");
  const calls = [];
  const fs = {
    join: async (...p) => p.join("/"), exists: async () => false, readDir: async () => [], mkdir: async () => {},
    copyFile: async () => {}, remove: async (p) => { calls.push(["remove", p]); }, rename: async (a, b) => { calls.push(["rename", a, b]); },
  };
  const roots = ["C:/a", "C:/b"];
  const controller = createProjectTreeController({
    state: createProjectTreeState(), fs, getProjectRoot: () => roots[0], getProjectRoots: () => roots,
    getCopyLabel: () => "copy", getAlreadyExistsMessage: () => "exists", getProjectRequiredMessage: () => "required",
    getOutsideProjectMessage: () => "outside", getProjectRootMutationMessage: () => "root", getDescendantMoveMessage: () => "descendant",
  });
  const moved = await controller.moveOrCopy("C:/a/x.md", "C:/b/sub", "cut", false);
  assert.equal(moved.status, "moved");
  assert.deepEqual(calls[0], ["rename", "C:/a/x.md", "C:/b/sub/x.md"]);
  await assert.rejects(controller.moveOrCopy("C:/a/x.md", "C:/elsewhere", "cut", false), /outside/);
  await assert.rejects(controller.remove("C:/b", true), /root/);
  await assert.rejects(controller.remove("C:/elsewhere/y.md", false), /outside/);
  await controller.remove("C:/b/y.md", false);
  assert.deepEqual(calls.at(-1), ["remove", "C:/b/y.md"]);
});

test("hidden sections: ranges cover the section and its sub-sections, nested ones are merged", async () => {
  const { hiddenRangesFor, keysInsideRanges, removeHiddenLines, parseSectionConfig, serializeSectionConfig, sectionConfigPath, sectionKey } = await import("../.test-build/documents/section-ranges.js");
  const h = (level, text, line, occurrence = 0) => ({ level, text, line, key: sectionKey(level, text, occurrence) });
  const headings = [h(1, "Doc", 1), h(2, "A", 3), h(3, "A1", 5), h(2, "B", 9), h(3, "B1", 11), h(1, "End", 14)];
  assert.deepEqual(hiddenRangesFor(headings, new Set(["2:A:0"]), 20), [{ key: "2:A:0", title: "A", startLine: 3, endLine: 8 }]);
  assert.deepEqual(hiddenRangesFor(headings, new Set(["2:B:0"]), 20), [{ key: "2:B:0", title: "B", startLine: 9, endLine: 13 }]);
  assert.deepEqual(hiddenRangesFor(headings, new Set(["1:End:0"]), 20), [{ key: "1:End:0", title: "End", startLine: 14, endLine: 20 }]);
  const nested = hiddenRangesFor(headings, new Set(["2:A:0", "3:A1:0"]), 20);
  assert.equal(nested.length, 1);
  assert.equal(hiddenRangesFor(headings, new Set(["9:none:0"]), 20).length, 0);
  assert.deepEqual([...keysInsideRanges(headings, nested)].sort(), ["2:A:0", "3:A1:0"]);
  const text = Array.from({ length: 16 }, (_, i) => "L" + (i + 1)).join("\n");
  assert.deepEqual(removeHiddenLines(text, hiddenRangesFor(headings, new Set(["2:A:0"]), 16)).split("\n").slice(0, 4), ["L1", "L2", "L9", "L10"]);
  assert.equal(removeHiddenLines(text, []), text);
  const config = serializeSectionConfig("Notes.md", ["2:A: b:c:0", "3:A1:1"]);
  assert.deepEqual(parseSectionConfig(config).sort(), ["2:A: b:c:0", "3:A1:1"].sort());
  assert.deepEqual(parseSectionConfig("not json"), []);
  assert.deepEqual(parseSectionConfig(JSON.stringify({ hiddenSections: [{ level: "x", title: 3 }, { level: 2, title: "ok", occurrence: 0 }] })), ["2:ok:0"]);
  assert.equal(sectionConfigPath("C:/p/Notes.md"), "C:/p/Notes.md.config.json");
});

test("file names made from a description replace spaces and special characters with hyphens", async () => {
  const { slugifyForFileName } = await import("../.test-build/filesystem/file-names.js");
  assert.equal(slugifyForFileName("Pasek nawigacji"), "pasek-nawigacji");
  assert.equal(slugifyForFileName("Zażółć gęślą jaźń!"), "zazolc-gesla-jazn");
  assert.equal(slugifyForFileName("  A / B: C?? (v2) -- final  "), "a-b-c-v2-final");
  assert.equal(slugifyForFileName("Ünïcödé & Straße"), "unicode-strasse");
  assert.equal(slugifyForFileName("***"), "");
  assert.equal(slugifyForFileName(""), "");
  assert.ok(slugifyForFileName("x".repeat(200)).length <= 80);
  assert.ok(!slugifyForFileName("a".repeat(79) + " b").endsWith("-"));
});

test("showing only one section hides everything around it and keeps the choice in the config file", async () => {
  const { focusRangesFor, hiddenRangesFor, parseFocusedSection, serializeSectionConfig } = await import("../.test-build/documents/section-ranges.js");
  const headings = [
    { level: 1, text: "A", line: 1, key: "1:A:0" }, { level: 2, text: "A1", line: 3, key: "2:A1:0" },
    { level: 2, text: "A2", line: 6, key: "2:A2:0" }, { level: 3, text: "A2x", line: 8, key: "3:A2x:0" }, { level: 1, text: "B", line: 10, key: "1:B:0" },
  ];
  const hidden = hiddenRangesFor(headings, new Set(["3:A2x:0", "2:A1:0"]), 12);
  assert.deepEqual(focusRangesFor(headings, "2:A2:0", hidden, 12).map(r => [r.startLine, r.endLine]), [[1, 5], [8, 9], [10, 12]]);
  assert.deepEqual(focusRangesFor(headings, "1:A:0", hidden, 12).map(r => [r.startLine, r.endLine]), [[3, 5], [8, 9], [10, 12]]);
  assert.deepEqual(focusRangesFor(headings, "2:A1:0", hidden, 12).map(r => [r.startLine, r.endLine]), [[1, 2], [6, 12]]);
  assert.equal(focusRangesFor(headings, "2:Gone:0", hidden, 12), null);
  const text = serializeSectionConfig("a.md", ["3:A2x:0"], "2:A2:0");
  assert.equal(parseFocusedSection(text), "2:A2:0");
  assert.equal(parseFocusedSection(serializeSectionConfig("a.md", [])), null);
});
