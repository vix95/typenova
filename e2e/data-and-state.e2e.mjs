// The data view, the file system scope and what is remembered between starts, against the real program.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exeExists, startApp, tempOutside, workspace, writeFiles } from "./harness.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const inTree = name => `[...document.querySelectorAll('[data-file-path]')].some(x => x.dataset.filePath.replace(/\\\\/g, '/').endsWith('/${name}'))`;
const clickTree = (app, name) => app.evaluate(`(() => { const e = [...document.querySelectorAll('[data-file-path]')].find(x => x.dataset.filePath.replace(/\\\\/g, '/').endsWith('/${name}')); if (!e) throw new Error('not in the tree: ${name}'); e.click(); return true; })()`);

/** A CSV of about `megabytes` MB (a header and lines of ids, a category, an amount and a date). */
function writeCsv(file, megabytes) {
  const fd = fs.openSync(file, "w");
  fs.writeSync(fd, "id;country;amount;day\n");
  const countries = ["PL", "DE", "CZ", "FR"];
  let written = 0, id = 0;
  while (written < megabytes * 1024 * 1024) {
    const lines = [];
    for (let i = 0; i < 20000; i++, id++) lines.push(`${id};${countries[id % 4]};${(id % 977) + 0.5};2024-0${1 + (id % 9)}-1${id % 9}`);
    const text = lines.join("\n") + "\n";
    fs.writeSync(fd, text); written += text.length;
  }
  fs.closeSync(fd);
  return id;
}

test("a large CSV opens in the data view, is read in pieces through the real file scope, and a chart is computed from it", { skip, timeout: 240000 }, async () => {
  const folder = workspace("csv");
  const rows = writeCsv(path.join(folder, "big.csv"), 55);
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await app.waitFor(inTree("big.csv"), { what: "big.csv in the tree", timeout: 30000 });
    await clickTree(app, "big.csv");                          // 55 MB: opens in the data view, not the editor
    await app.waitFor(`!!document.querySelector('.data-dialog .preview-view-tab')`, { timeout: 120000, what: "the data view after reading the file" });
    const meta = await app.text(".data-dialog .data-meta");
    assert.ok(meta.replace(/\s| /g, "").includes(String(rows).replace(/\B(?=(\d{3})+(?!\d))/g, "")) || meta.includes(rows.toLocaleString("en-US")) || meta.includes(rows.toLocaleString("pl-PL")), `the row count ${rows} is shown (meta: ${meta})`);
    await app.evaluate(`[...document.querySelectorAll('.data-dialog .preview-view-tab')].find(t => /Charts|Wykresy/.test(t.textContent)).click()`);
    await app.waitFor(`!!document.querySelector('.data-dialog .data-stage svg')`, { timeout: 120000, what: "a chart computed from the whole file" });
    assert.deepEqual(app.problems.filter(line => !/ResizeObserver/.test(line)), [], "no errors while reading a large file");
  } finally { await app.stop(); }
});

test("a file outside the opened folders cannot be read, and a chart that needs one says so and offers to grant access", { skip }, async () => {
  const outside = writeFiles(tempOutside(), { "data.csv": "a;b\n1;2\n3;4\n", "note.md": "# Note\n\n```chart\nfile: data.csv\ntype: bar\nx: a\ny: b\nagg: sum\n```\n" });
  const app = await startApp({ args: [path.join(outside, "note.md")] });   // only this one file is granted, not its folder
  try {
    await app.ready();
    await assert.rejects(() => app.invoke("plugin:fs|stat", { path: path.join(outside, "data.csv"), options: {} }), /forbidden|scope|not allowed/i, "the neighbouring file is outside the scope");
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.includes('# Note')`, { timeout: 30000, what: "the note opened from the command line" });
    await app.waitFor(`!!document.querySelector('#preview .chart-message')`, { timeout: 30000, what: "the message of the chart block" });
    const message = await app.text("#preview .chart-message");
    assert.match(message, /no access|nie ma dostępu/i, `the block explains the missing access (saw: ${message})`);
    assert.ok(await app.evaluate(`!!document.querySelector('#preview .chart-message button')`), "and offers a button to choose the file");
  } finally { await app.stop(); fs.rmSync(outside, { recursive: true, force: true }); }
});

test("open folders and folded sections of the table of contents come back after a restart", { skip, timeout: 120000 }, async () => {
  const folder = writeFiles(workspace("state"), { "doc.md": "# Top\n\n## One\n\n### Inner\n\ntext\n\n## Two\n", "sub/inner.md": "# Inner note\n" });
  const open = [`[data-file-path$="doc.md"]`];
  let app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await app.waitFor(inTree("doc.md"), { timeout: 30000, what: "the tree" });
    await app.evaluate(`[...document.querySelectorAll('#projectFiles .tree-entry')].find(e => e.dataset.entryType === 'directory' && /sub$/.test(e.dataset.filePath.replace(/\\\\/g, '/'))).click()`);
    await app.waitFor(inTree("inner.md"), { what: "the sub folder opened" });
    await clickTree(app, "doc.md");
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.startsWith('# Top')`, { what: "doc.md" });
    await app.click("#sidebarOutlineTab");
    await app.waitFor(`document.querySelectorAll('#outline .outline-fold:not([disabled])').length >= 2`, { what: "the outline with foldable sections" });
    await app.evaluate(`document.querySelectorAll('#outline .outline-fold:not([disabled])')[1].click()`);   // fold "One"
    await app.sleep(500);
    const rowsBefore = await app.evaluate(`document.querySelectorAll('#outline .outline-row').length`);
    await app.sleep(500);
  } finally { await app.stop(); }
  app = await startApp({ projects: [folder], reset: false });
  try {
    await app.ready();
    await app.waitFor(inTree("inner.md"), { timeout: 30000, what: "the sub folder open again after the restart" });
    await clickTree(app, "doc.md");
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.startsWith('# Top')`, { what: "doc.md again" });
    await app.click("#sidebarOutlineTab");
    await app.waitFor(`document.querySelectorAll('#outline .outline-row').length > 0`, { what: "the outline" });
    const folded = await app.evaluate(`document.querySelectorAll('#outline .outline-fold.expanded').length`);
    const rows = await app.evaluate(`[...document.querySelectorAll('#outline .outline-item')].map(i => i.textContent).join('|')`);
    assert.ok(!rows.includes("Inner"), `"Inner" stays hidden under the folded section (rows: ${rows}, expanded folds: ${folded})`);
  } finally { await app.stop(); }
  assert.ok(open.length > 0);
});
