// The "New file" dialog of the project tree: its name field selects the name without the extension, so typing a name keeps `.md`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exeExists, startApp, workspace, writeFiles } from "./harness.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";

test("a new file is proposed as Untitled.md with only 'Untitled' selected, and typing a name keeps the extension", { skip }, async () => {
  const folder = writeFiles(workspace("newfile"), { "alpha.md": "# Alpha\n" });
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await app.waitFor(`[...document.querySelectorAll('[data-file-path]')].some(x => x.dataset.filePath.endsWith('alpha.md'))`, { what: "the tree", timeout: 30000 });
    // The context menu of the folder row (the root folder of the project).
    await app.evaluate(`(() => { const row = document.querySelector('[data-file-path]'); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 200 })); return true; })()`);
    await app.waitFor(`[...document.querySelectorAll('button')].some(b => /Nowy plik|New file/.test(b.textContent) && b.offsetParent)`, { what: "the New file command" });
    await app.evaluate(`[...document.querySelectorAll('button')].find(b => /Nowy plik|New file/.test(b.textContent) && b.offsetParent).click()`);
    await app.waitFor(`document.getElementById('newProjectFileDialog').open`, { what: "the dialog" });
    await app.sleep(300);
    const selection = await app.evaluate(`(() => { const i = document.getElementById('newProjectFileInput') || document.querySelector('#newProjectFileDialog input'); return { value: i.value, start: i.selectionStart, end: i.selectionEnd, focused: document.activeElement === i }; })()`);
    assert.deepEqual(selection, { value: "Untitled.md", start: 0, end: "Untitled".length, focused: true });
    await app.type("ideas");
    assert.equal(await app.evaluate(`document.querySelector('#newProjectFileDialog input').value`), "ideas.md");
    await app.evaluate(`document.getElementById("newProjectFileCreate").click()`);
    await app.waitFor(`!document.getElementById('newProjectFileDialog').open`, { what: "the dialog to close" });
    assert.ok(fs.existsSync(path.join(folder, "ideas.md")), "the file was created with its extension");
  } finally { await app.stop(); }
});
