// The editor against the real program: boot, opening a project from the command line, editing and saving to the real file system, switching tabs.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { exeExists, readText, startApp, workspace, writeFiles } from "./harness.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const NOTES = { "alpha.md": "# Alpha\n\nfirst note\n", "beta.md": "# Beta\n\nsecond note\n", "gamma.md": "# Gamma\n\nthird note\n" };

/** Clicks a file of the project tree (the path is written with / or the Windows separator). */
const open = (app, name) => app.evaluate(`(() => { const e = [...document.querySelectorAll('[data-file-path]')].find(x => x.dataset.filePath.replace(/\\\\/g, '/').endsWith('/${name}')); if (!e) throw new Error('not in the tree: ${name}'); e.click(); return true; })()`);
const inTree = (app, name) => `[...document.querySelectorAll('[data-file-path]')].some(x => x.dataset.filePath.replace(/\\\\/g, '/').endsWith('/${name}'))`;
const editorText = app => app.evaluate(`document.querySelector('.cm-content')?.innerText ?? ''`);
const ignorable = line => /ResizeObserver loop|favicon/.test(line);

test("the program starts, is called TypeNova and raises no errors", { skip }, async () => {
  const app = await startApp();
  try {
    await app.ready();
    assert.equal(await app.evaluate(`document.title`), "TypeNova");
    await app.sleep(1500);
    assert.deepEqual(app.problems.filter(line => !ignorable(line)), [], "nothing in the console while starting");
    assert.deepEqual(await app.invoke("take_launch_paths"), [], "no files were handed over");
  } finally { await app.stop(); }
});

test("an opened project folder lists its notes, and they can be edited and saved on disk", { skip }, async () => {
  const folder = writeFiles(workspace("edit"), NOTES);
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await app.waitFor(inTree(app, "alpha.md"), { what: "the project tree to list alpha.md", timeout: 30000 });
    await open(app, "alpha.md");
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.startsWith('# Alpha')`, { what: "alpha.md in the editor" });
    await app.evaluate(`document.querySelector('.cm-content').focus()`);
    await app.key("End", "End", 35, 2);                      // Ctrl+End
    await app.type("EDITED-BY-E2E");
    await app.key("s", "KeyS", 83, 2);                       // Ctrl+S
    await app.sleep(800);
    assert.ok(readText(path.join(folder, "alpha.md")).includes("EDITED-BY-E2E"), "the text reached the file");
    assert.equal(readText(path.join(folder, "beta.md")), NOTES["beta.md"], "other files are untouched");
  } finally { await app.stop(); }
});

test("quick switching between tabs always leaves the editor showing the document of the active tab", { skip }, async () => {
  const folder = writeFiles(workspace("tabs"), NOTES);
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await app.waitFor(inTree(app, "gamma.md"), { what: "the tree", timeout: 30000 });
    for (const name of ["alpha.md", "beta.md", "gamma.md"]) { await open(app, name); await app.sleep(400); }
    const titles = { "alpha.md": "# Alpha", "beta.md": "# Beta", "gamma.md": "# Gamma" };
    const names = Object.keys(titles);
    for (let round = 0; round < 40; round++) {
      await open(app, names[(round * 7) % 3]);
      if (round % 5 === 0) await app.sleep(30);
    }
    await app.sleep(800);
    // Whatever the last click was, the tab marked active and the text in the editor must agree.
    const active = await app.evaluate(`(document.querySelector('.editor-tab.active, .editor-tab[aria-selected="true"]')?.innerText ?? '').trim()`);
    const text = await editorText(app);
    const expected = names.find(name => active.includes(name.replace(".md", "")));
    assert.ok(expected, `an active tab is marked (saw "${active}")`);
    assert.ok(text.startsWith(titles[expected]), `the editor shows ${expected} (saw "${text.slice(0, 20)}")`);
    // And a save writes into the file of that tab only.
    await app.evaluate(`document.querySelector('.cm-content').focus()`);
    await app.type("SWITCH-CHECK");
    await app.key("s", "KeyS", 83, 2);
    await app.sleep(800);
    for (const name of names) assert.equal(readText(path.join(folder, name)).includes("SWITCH-CHECK"), name === expected, `${name} ${name === expected ? "has" : "does not have"} the saved text`);
  } finally { await app.stop(); }
});
