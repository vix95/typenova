// "Hide TypeNova's files" (on by default): the project tree leaves out the config file beside a document, the project config and the dictionary folder,
// keeps look-alike files of the person, shows everything once the setting is off, and the files stay on disk either way.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exeExists, startApp, workspace, writeFiles } from "./harness.mjs";
import { waitForTreeFile, waitUntil } from "./helpers.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const treeNames = `[...document.querySelectorAll('#projectFiles [data-file-path]')].map(row => row.dataset.filePath.replace(/\\\\/g, '/').split('/').pop())`;

test("TypeNova's own files are hidden in the project tree by default and shown when the setting is off", { skip }, async () => {
  const folder = writeFiles(workspace("own-files"), {
    "notes.md": "# Notes\n",
    "notes.md.config.json": "{}\n",
    "typenova.config.json": "{}\n",
    ".typenova/dictionary.txt": "Kowalski\n",
    "app.settings.config.json": "{}\n",
    "README.md": "# Readme\n",
  });
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await waitForTreeFile(app, "README.md");
    await app.sleep(500);
    const hidden = new Set(await app.evaluate(treeNames));
    for (const name of ["notes.md", "README.md", "app.settings.config.json"]) assert.ok(hidden.has(name), `${name} is listed`);
    for (const name of ["notes.md.config.json", "typenova.config.json", ".typenova"]) assert.ok(!hidden.has(name), `${name} is hidden`);
    assert.equal(await app.evaluate(`document.getElementById('hideOwnFilesToggle').checked`), true, "the setting is on by default");

    await app.evaluate(`(() => { const t = document.getElementById('hideOwnFilesToggle'); t.checked = false; t.dispatchEvent(new Event('change')); })()`);
    await waitForTreeFile(app, "notes.md.config.json");
    const shown = new Set(await app.evaluate(treeNames));
    for (const name of ["notes.md.config.json", "typenova.config.json", ".typenova"]) assert.ok(shown.has(name), `${name} is shown when the setting is off`);

    await app.evaluate(`(() => { const t = document.getElementById('hideOwnFilesToggle'); t.checked = true; t.dispatchEvent(new Event('change')); })()`);
    await app.waitFor(`!${treeNames}.includes('notes.md.config.json')`, { what: "the files to be hidden again" });
    assert.equal(await app.evaluate(`localStorage.getItem('typenova.hideOwnFiles')`), "true");
    for (const name of ["notes.md.config.json", "typenova.config.json", ".typenova/dictionary.txt"]) assert.ok(fs.existsSync(path.join(folder, name)), `${name} stays on disk`);
  } finally { await app.stop({ force: true }); }
});

/** Opens the context menu of a tree row and chooses one of its actions. */
async function treeAction(app, name, action) {
  await app.evaluate(`(() => { const row = [...document.querySelectorAll('#projectFiles [data-file-path]')].find(r => r.dataset.filePath.replace(/\\\\/g, '/').endsWith('/${name}')); const box = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 20, clientY: box.top + 5 })); })()`);
  await app.waitFor(`!!document.querySelector('[data-tree-context="${action}"]:not(:disabled)')`, { what: `${action} in the context menu of ${name}` });
  await app.click(`[data-tree-context="${action}"]`);
}

test("a hidden config file follows its document when it is moved and duplicated in the tree", { skip }, async () => {
  const folder = writeFiles(workspace("own-files-move"), {
    "notes.md": "# Notes\n\n## Secret\n",
    "notes.md.config.json": "{\n  \"hiddenSections\": []\n}\n",
    "archive/keep.md": "# Keep\n",
  });
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await waitForTreeFile(app, "notes.md");
    await treeAction(app, "notes.md", "duplicate");
    await waitUntil(() => fs.readdirSync(folder).some(name => /^notes \(.+\)\.md$/.test(name)), { what: "the duplicate on disk" });
    const duplicate = fs.readdirSync(folder).find(name => /^notes \(.+\)\.md$/.test(name));
    assert.ok(duplicate && fs.existsSync(path.join(folder, `${duplicate}.config.json`)), "the duplicate has its config file");
    await treeAction(app, "notes.md", "cut");
    await treeAction(app, "archive", "paste");
    await waitForTreeFile(app, "archive/notes.md");
    assert.ok(fs.existsSync(path.join(folder, "archive", "notes.md.config.json")), "the config file moved with the document");
    assert.ok(!fs.existsSync(path.join(folder, "notes.md.config.json")), "nothing is left behind");
    assert.equal(fs.readFileSync(path.join(folder, "archive", "notes.md.config.json"), "utf8"), "{\n  \"hiddenSections\": []\n}\n");
  } finally { await app.stop({ force: true }); }
});
