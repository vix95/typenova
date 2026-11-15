// Small pieces of the workspace: the tree follows the open document (and a setting turns that off), the status bar counts spelling mistakes, the tree's context menu adds a folder, and the strip of open documents can be hidden.
import test from "node:test";
import assert from "node:assert/strict";
import { exeExists, startApp, workspace, writeFiles } from "./harness.mjs";
import { clickTreeFile, ignorableProblem, openNote } from "./helpers.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const NESTED = { "top.md": "# Top\n", "docs/deep/inner.md": "# Inner\n\nqzxvkplw is not a word.\n" };

/** The tree row of a file: null when the tree does not show it, else whether it is the selected one. */
const rowState = (app, name) => app.evaluate(`(() => {
  const row = [...document.querySelectorAll('#projectFiles [data-file-path]')].find(x => x.dataset.filePath.replace(/\\\\/g, '/').endsWith('/${name}'));
  return row ? { selected: row.classList.contains('active') } : null;
})()`);
const click = (app, id) => app.evaluate(`document.getElementById('${id}').click()`);
const clickTab = (app, label) => app.evaluate(`[...document.querySelectorAll('.editor-tab')].find(tab => tab.textContent.includes('${label}')).click()`);

/** Opens both files, closes every folder of the tree, and switches to the other document and back: the way to make the tree show a document it has hidden. */
async function hideThenReturnTo(app, name, other) {
  await click(app, "collapseAllFolders");
  await app.waitFor(`![...document.querySelectorAll('#projectFiles [data-file-path]')].some(x => x.dataset.filePath.endsWith('${name}'))`, { what: "the folders to close" });
  await clickTab(app, other);
  await clickTab(app, name);
}

test("the tree opens the folders of the document in use and selects it, unless the setting is off", { skip }, async () => {
  const app = await startApp({ projects: [writeFiles(workspace("follow"), NESTED)] });
  try {
    await app.ready();
    await openNote(app, "top.md", "Top");
    await click(app, "expandAllFolders");
    await openNote(app, "inner.md", "Inner");

    await hideThenReturnTo(app, "inner.md", "top.md");
    await app.waitFor(`!!document.querySelector('#projectFiles [data-file-path$="inner.md"].active')`, { what: "the tree to open the folders and select inner.md" });
    assert.deepEqual(await rowState(app, "inner.md"), { selected: true });

    // The setting is on by default, and turning it off leaves the tree alone.
    await app.evaluate(`(() => { const box = document.getElementById('treeFollowToggle'); const wasOn = box.checked; box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); return wasOn; })()`);
    await hideThenReturnTo(app, "inner.md", "top.md");
    await app.sleep(1000);
    assert.equal(await rowState(app, "inner.md"), null, "the tree stays as it is");
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop({ force: true }); }
});

test("the setting that makes the tree follow the document is on by default", { skip }, async () => {
  const app = await startApp({ projects: [writeFiles(workspace("follow-default"), NESTED)] });
  try {
    await app.ready();
    assert.equal(await app.evaluate(`document.getElementById('treeFollowToggle').checked`), true);
  } finally { await app.stop({ force: true }); }
});

test("the status bar counts the spelling mistakes of the document", { skip }, async () => {
  const app = await startApp({ projects: [writeFiles(workspace("spell-count"), NESTED)] });
  try {
    await app.ready();
    await click(app, "expandAllFolders");
    await clickTreeFile(app, "inner.md");
    await app.waitFor(`/: 1$/.test(document.getElementById('spellStatus').textContent)`, { what: "the count of one mistake", timeout: 30000 });
    assert.equal(await app.evaluate(`document.getElementById('spellStatus').disabled`), false, "a click goes to the next mistake");
    await clickTreeFile(app, "top.md");
    await app.waitFor(`/: 0$/.test(document.getElementById('spellStatus').textContent)`, { what: "no mistakes in the other document", timeout: 30000 });
    assert.equal(await app.evaluate(`document.getElementById('spellStatus').disabled`), true);
  } finally { await app.stop({ force: true }); }
});

test("the context menu of the tree offers to add a folder to the workspace", { skip }, async () => {
  const app = await startApp({ projects: [writeFiles(workspace("add-folder"), NESTED)] });
  try {
    await app.ready();
    await clickTreeFile(app, "top.md");
    await app.evaluate(`document.getElementById('projectFiles').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 400 }))`);
    await app.waitFor(`!!document.querySelector('[data-tree-context="add-folder"]')`, { what: "the entry in the context menu" });
    assert.match(await app.evaluate(`document.querySelector('[data-tree-context="add-folder"]').textContent`), /Add folder to workspace|Dodaj folder do obszaru roboczego/);
  } finally { await app.stop({ force: true }); }
});

test("a button turns the left panel into a list of only the open documents, and back", { skip }, async () => {
  const app = await startApp({ projects: [writeFiles(workspace("open-documents"), NESTED)] });
  const visible = id => app.evaluate(`!document.getElementById('${id}').hidden`);
  try {
    await app.ready();
    await openNote(app, "top.md", "Top");
    await click(app, "sidebarOpenTab");
    assert.equal(await visible("openDocumentsView"), true);
    assert.equal(await visible("filesView"), false);
    assert.equal(await app.evaluate(`document.getElementById('sidebarOpenTab').getAttribute('aria-selected')`), "true");
    const names = await app.evaluate(`[...document.querySelectorAll('.open-document-name')].map(el => el.textContent)`);
    assert.ok(names.includes("top.md"), `the open document is listed: ${names}`);
    assert.equal(await app.evaluate(`document.querySelectorAll('.open-document.active').length`), 1);
    await click(app, "sidebarOpenTab");
    assert.equal(await visible("filesView"), true);
    assert.equal(await visible("openDocumentsView"), false);
  } finally { await app.stop({ force: true }); }
});

test("the views of the panel that do not fit are in a menu, and the tabs view has a name", { skip }, async () => {
  const app = await startApp({ projects: [writeFiles(workspace("tabs-row"), NESTED)] });
  try {
    await app.ready();
    await app.evaluate(`document.querySelector('.layout').style.setProperty('--outline-width', '190px')`);
    await app.waitFor(`!document.getElementById('sidebarTabsMore').hidden`, { what: "the More button of the views" });
    await app.waitFor(`(() => { const bar = document.querySelector('.sidebar-tabs'); return ![...bar.querySelectorAll(':scope > button')].some(b => !b.hidden && b.getBoundingClientRect().right > bar.getBoundingClientRect().right + 1); })()`, { what: "the views to fit the row" });
    const row = await app.evaluate(`(() => { const bar = document.querySelector('.sidebar-tabs'), box = bar.getBoundingClientRect(); return { cut: [...bar.querySelectorAll(':scope > button')].some(b => !b.hidden && b.getBoundingClientRect().right > box.right + 1), menu: [...document.querySelectorAll('.project-actions-menu .sidebar-tab')].map(b => b.dataset.menuLabel), height: box.height }; })()`);
    assert.equal(row.cut, false, "no view is cut off");
    assert.ok(row.menu.some(label => /Tabs|Karty/.test(label)), `the tabs view is in the menu: ${row.menu}`);
    assert.ok(row.height < 60, "the row stays one line");
  } finally { await app.stop({ force: true }); }
});

test("closing the project asks first, and the AI switch hides everything that leads to the assistant", { skip }, async () => {
  const app = await startApp({ projects: [writeFiles(workspace("close-ai"), NESTED)] });
  try {
    await app.ready();
    await app.evaluate(`document.getElementById('closeProject').click()`);
    await app.waitFor(`!!document.querySelector('dialog[open]')`, { what: "the question" });
    await app.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => /Anuluj|Cancel/.test(b.textContent)).click()`);
    assert.equal(await app.evaluate(`!document.getElementById('projectTree').hidden`), true, "cancelled: the project stays");
    const visible = id => app.evaluate(`getComputedStyle(document.getElementById('${id}')).display !== 'none'`);
    assert.equal(await visible("toggleAi"), true);
    await app.evaluate(`(() => { const box = document.getElementById('aiEnabledToggle'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await visible("toggleAi"), false, "the AI button is hidden");
    assert.equal(await app.evaluate(`getComputedStyle(document.getElementById('aiOpenOptions').closest('.ai-feature')).display !== 'none'`), false, "the AI options are hidden");
  } finally { await app.stop({ force: true }); }
});
