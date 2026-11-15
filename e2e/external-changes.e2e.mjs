// Changes made to the files from outside the program (a pull, an agent, another editor): the tree, the open documents and the Git view follow, and nothing the person typed is lost.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exeExists, readText, startApp, workspace, writeFiles } from "./harness.mjs";
import { git, ignorableProblem, makeRepo, openNote, waitForTreeFile } from "./helpers.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const editorText = app => app.evaluate(`document.querySelector('.cm-content').innerText`);
const unsavedMark = app => app.evaluate(`document.getElementById('dirtyIndicator').textContent.trim()`);

test("a document without unsaved changes follows its file, and new and deleted files show in the tree", { skip }, async () => {
  const folder = writeFiles(workspace("external"), { "a.md": "# Alpha\n\noriginal\n", "b.md": "# Beta\n" });
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await openNote(app, "a.md", "original");
    fs.writeFileSync(path.join(folder, "a.md"), "# Alpha\n\nchanged by an agent\n");
    await app.waitFor(`document.querySelector('.cm-content').innerText.includes('changed by an agent')`, { what: "the document to follow its file", timeout: 15000 });
    assert.equal(await unsavedMark(app), "", "the update is not an unsaved change of the person");

    fs.writeFileSync(path.join(folder, "new.md"), "# New\n");
    await waitForTreeFile(app, "new.md");
    fs.rmSync(path.join(folder, "b.md"));
    await app.waitFor(`![...document.querySelectorAll('[data-file-path]')].some(row => row.dataset.filePath.endsWith('b.md'))`, { what: "the deleted file to leave the tree", timeout: 15000 });
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop({ force: true }); }
});

test("unsaved changes are never overwritten, and saving asks before it overwrites the file", { skip }, async () => {
  const folder = writeFiles(workspace("external-conflict"), { "a.md": "line one\n" });
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await openNote(app, "a.md", "line one");
    await app.evaluate(`document.querySelector('.cm-content').focus()`);
    await app.key("End", "End", 35, 2);
    await app.type("MINE");
    await app.waitFor(`document.getElementById('dirtyIndicator').textContent.trim() !== ''`, { what: "the unsaved mark" });
    fs.writeFileSync(path.join(folder, "a.md"), "line one\nTHEIRS\n");
    await app.waitFor(`document.getElementById('appToast')?.classList.contains('visible') && /disk|dysku/.test(document.getElementById('appToast').textContent)`, { what: "the message about the changed file", timeout: 15000 });
    assert.ok((await editorText(app)).includes("MINE") && !(await editorText(app)).includes("THEIRS"), "the person's text is untouched");

    await app.key("s", "KeyS", 83, 2);
    await app.waitFor(`!!document.querySelector('dialog[open]')`, { what: "the question before overwriting" });
    assert.ok(readText(path.join(folder, "a.md")).includes("THEIRS"), "nothing is written while the question is open");
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop({ force: true }); }
});

test("switching branches outside the program updates the open document and the Git view", { skip }, async () => {
  const { work } = makeRepo("external-git", { "a.md": "on main\n" });
  git(work, "switch", "-q", "-c", "other");
  fs.writeFileSync(path.join(work, "a.md"), "on other\n");
  git(work, "commit", "-q", "-am", "Other");
  git(work, "switch", "-q", "main");
  const app = await startApp({ projects: [work] });
  try {
    await app.ready();
    await openNote(app, "a.md", "on main");
    await app.evaluate(`document.getElementById('openGitPanel').click()`);
    await app.waitFor(`document.querySelector('.git-branch-name')?.textContent === 'main'`, { what: "the Git view on main" });

    git(work, "switch", "-q", "other");
    await app.waitFor(`document.querySelector('.cm-content').innerText.includes('on other')`, { what: "the open document to follow the branch", timeout: 15000 });
    await app.waitFor(`document.querySelector('.git-branch-name')?.textContent === 'other'`, { what: "the Git view to show the new branch", timeout: 15000 });
    assert.equal(await unsavedMark(app), "");
  } finally { await app.stop({ force: true }); }
});
