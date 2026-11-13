// Moving around the notes against the real program: the backlinks of the note in use.
import test from "node:test";
import assert from "node:assert/strict";
import { exeExists, startApp, workspace, writeFiles } from "./harness.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const NOTES = {
  "target.md": "# Target\n\n## Setup\n\ntext\n",
  "a.md": "# A\n\nSee [[Setup]] for the steps, and [[target.md#Setup|the setup]] again.\n",
  "b.md": "# B\n\nA plain link to [[Target]].\n",
  "c.md": "# C\n\n[[Nothing here]] and a note about setup that is not a link.\n",
};
const inTree = name => `[...document.querySelectorAll('[data-file-path]')].some(x => x.dataset.filePath.replace(/\\\\/g, '/').endsWith('/${name}'))`;
const clickTree = (app, name) => app.evaluate(`(() => { const e = [...document.querySelectorAll('[data-file-path]')].find(x => x.dataset.filePath.replace(/\\\\/g, '/').endsWith('/${name}')); if (!e) throw new Error('not in the tree: ${name}'); e.click(); return true; })()`);
const files = app => app.evaluate(`[...document.querySelectorAll('#backlinks .backlink-file')].map(f => f.querySelector('.backlink-file-name').textContent + ':' + f.querySelectorAll('.backlink-hit').length).join(',')`);

test("the backlinks of a note list the notes that link to it, with their lines, and a click opens the note there", { skip, timeout: 120000 }, async () => {
  const folder = writeFiles(workspace("backlinks"), NOTES);
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await app.waitFor(inTree("target.md"), { timeout: 30000, what: "the project tree" });
    await clickTree(app, "target.md");
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.startsWith('# Target')`, { what: "target.md" });
    await app.click("#sidebarOutlineTab");
    await app.waitFor(`!document.getElementById('backlinks').hidden && document.querySelectorAll('#backlinks .backlink-hit').length > 0`, { timeout: 30000, what: "the backlinks of target.md" });
    assert.equal(await files(app), "a:2,b:1", "a.md links twice (by title and by file#section), b.md once; c.md only mentions the word");
    assert.equal(await app.text("#backlinksCount"), "3");
    // A click opens the linking note.
    await app.evaluate(`document.querySelector('#backlinks .backlink-hit').click()`);
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.startsWith('# A')`, { what: "a.md opened from the backlink" });
    // The panel is about the note in use: now the note a.md, which nothing links to.
    await app.waitFor(`document.querySelector('#backlinks .backlink-hit') === null || document.querySelector('#backlinks .muted')`, { timeout: 15000, what: "the backlinks of a.md (none)" });
    assert.equal(await app.text("#backlinksCount"), "0");
    assert.deepEqual(app.problems.filter(line => !/ResizeObserver/.test(line)), []);
  } finally { await app.stop(); }
});
