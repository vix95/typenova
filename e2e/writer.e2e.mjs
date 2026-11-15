// The Writer mode in the real program: Markdown rendered in the editor itself, the syntax of the element under the caret shown, checkboxes that work, and typing that stays fast in a long document.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exeExists, startApp, workspace, writeFiles } from "./harness.mjs";
import { ignorableProblem, waitForTreeFile } from "./helpers.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const NOTE = [
  "# Title here", "", "Some **bold** and *italic* and `code` text with a [link](https://example.com/page).", "",
  "- first item", "- second item", "", "- [ ] open task", "- [x] done task", "", "> a quote", "",
  "```js", "const a = 1;", "```", "", "---", "", "![diagram](pic.png)", "", "last line", "",
].join("\n");

const view = `document.querySelector('.cm-content').cmTile.view`;
const text = (app, selector) => app.evaluate(`[...document.querySelectorAll('${selector}')].map(x => x.textContent)`);
const caretAt = (app, needle) => app.evaluate(`(() => { const v = ${view}; const at = v.state.doc.toString().indexOf(${JSON.stringify(needle)}); v.dispatch({ selection: { anchor: at + 1 } }); return at; })()`);

test("the rendered text hides its syntax, shows it under the caret, and its checkboxes work", { skip }, async () => {
  const folder = writeFiles(workspace("writer"), { "note.md": NOTE });
  // A real (tiny) image next to the note.
  fs.writeFileSync(path.join(folder, "pic.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await waitForTreeFile(app, "note.md");
    await app.evaluate(`[...document.querySelectorAll('[data-file-path]')].find(x => x.dataset.filePath.endsWith('note.md')).click()`);
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.includes('Title here')`, { what: "the note in the editor" });
    await app.evaluate(`document.getElementById('toggleWriter').click()`);
    await app.waitFor(`document.body.classList.contains('writer-mode') && document.querySelectorAll('.cm-writer-h1').length === 1`, { what: "the Writer mode" });
    assert.equal(await app.evaluate(`getComputedStyle(document.getElementById('previewPane')).display`), "none", "no preview pane beside the editor");
    await caretAt(app, "last line");

    // Rendered: no syntax characters, but the styles.
    const body = await app.evaluate(`document.querySelector('.cm-content').innerText`);
    for (const syntax of ["# Title", "**bold**", "`code`", "](https", "- first", "- [ ]", "> a quote", "```js", "---", "![diagram]"]) assert.ok(!body.includes(syntax), `the syntax ${syntax} is hidden`);
    for (const kept of ["Title here", "bold", "italic", "code", "link", "first item", "open task", "a quote", "const a = 1;"]) assert.ok(body.includes(kept), `${kept} is shown`);
    assert.equal(await app.evaluate(`document.querySelectorAll('.cm-writer-strong').length`), 1);
    assert.equal(await app.evaluate(`document.querySelectorAll('.cm-writer-em').length`), 1);
    assert.equal(await app.evaluate(`document.querySelectorAll('.cm-writer-link').length`), 1);
    assert.equal(await app.evaluate(`document.querySelectorAll('.cm-writer-bullet').length`), 2);
    assert.equal(await app.evaluate(`document.querySelectorAll('.cm-writer-checkbox').length`), 2);
    assert.equal(await app.evaluate(`document.querySelectorAll('.cm-writer-quote').length`), 1);
    assert.equal(await app.evaluate(`document.querySelectorAll('.cm-writer-rule').length`), 1);
    assert.deepEqual(await text(app, ".cm-writer-language"), ["js"], "the code block is labelled with its language");
    await app.waitFor(`document.querySelectorAll('.cm-writer-image img').length === 1`, { what: "the image" });
    await app.waitFor(`(document.querySelector('.cm-writer-image img')?.src ?? '').startsWith('http://asset.localhost')`, { what: "the image to be served" });

    // The caret in an element shows its syntax; leaving it hides it again.
    await caretAt(app, "# Title");
    assert.ok((await app.evaluate(`document.querySelector('.cm-writer-h1').textContent`)).startsWith("# Title"), "the # shows while the caret is in the heading");
    await caretAt(app, "bold");
    assert.ok((await app.evaluate(`document.querySelector('.cm-line:has(.cm-writer-strong)').textContent`)).includes("**bold**"), "the ** show while the caret is in the bold text");
    await caretAt(app, "last line");
    assert.ok(!(await app.evaluate(`document.querySelector('.cm-writer-h1').textContent`)).includes("#"), "hidden again");

    // A checkbox toggles the text of the document.
    await app.evaluate(`document.querySelector('.cm-writer-checkbox').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
    await app.waitFor(`${view}.state.doc.toString().includes('- [x] open task')`, { what: "the task to be marked done" });
    assert.equal(await app.evaluate(`document.querySelectorAll('.cm-writer-task-done').length`), 2);

    // Typing in rendered text is typing in the source: the characters land in the document, and the source mode (Ctrl+/) gives the plain text back.
    await caretAt(app, "last line");
    await app.evaluate(`document.querySelector('.cm-content').focus()`);
    await app.key("End", "End", 35);
    await app.type(" and more");
    await app.waitFor(`${view}.state.doc.toString().includes('last line and more')`, { what: "the typed text" });
    await app.key("/", "Slash", 191, 2);
    await app.waitFor(`!document.body.classList.contains('writer-mode')`, { what: "Ctrl+/ to leave the Writer mode" });
    assert.ok((await app.evaluate(`document.querySelector('.cm-content').innerText`)).includes("**bold**"), "the source shows again");
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop({ force: true }); }
});

test("typing, moving the caret and scrolling cost the Writer mode no more than the source mode, in a long document", { skip }, async () => {
  const lines = [];
  for (let block = 0; block < 4000; block++) lines.push(`## Section ${block}`, "", `Paragraph ${block} with **bold**, *italic*, \`code\` and a [link](https://example.com/${block}).`, "", `- item ${block}`, `- [ ] task ${block}`, "");
  const folder = writeFiles(workspace("writer-fast"), { "long.md": lines.join("\n") });
  const app = await startApp({ projects: [folder] });
  // What a keystroke, a caret move and a scroll step cost in the middle of 28 000 lines: the change, the decorations, the layout of the lines on screen.
  const measure = `(async () => {
    const v = ${view};
    v.dispatch({ selection: { anchor: v.state.doc.line(14000).from }, scrollIntoView: true });
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const stats = list => { const sorted = [...list].sort((a, b) => a - b); return { mean: list.reduce((a, b) => a + b, 0) / list.length, p95: sorted[Math.floor(sorted.length * 0.95)] }; };
    const typed = [], moved = [], scrolled = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      v.dispatch({ changes: { from: v.state.selection.main.head, insert: 'x' }, selection: { anchor: v.state.selection.main.head + 1 }, userEvent: 'input.type' });
      typed.push(performance.now() - start);
      await new Promise(done => requestAnimationFrame(done));
    }
    for (let i = 0; i < 40; i++) {
      const start = performance.now();
      v.dispatch({ selection: { anchor: v.state.doc.line(14000 + i * 3).from + 2 } });
      moved.push(performance.now() - start);
      await new Promise(done => requestAnimationFrame(done));
    }
    for (let i = 0; i < 40; i++) {
      const start = performance.now();
      v.scrollDOM.scrollTop += 900;
      await new Promise(done => requestAnimationFrame(done));
      scrolled.push(performance.now() - start);
    }
    return { lines: v.state.doc.lines, typed: stats(typed), moved: stats(moved), scrolled: stats(scrolled) };
  })()`;
  try {
    await app.ready();
    await waitForTreeFile(app, "long.md");
    await app.evaluate(`[...document.querySelectorAll('[data-file-path]')].find(x => x.dataset.filePath.endsWith('long.md')).click()`);
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.includes('Section 0')`, { what: "the long note", timeout: 60000 });
    const source = await app.evaluate(measure);
    await app.evaluate(`document.getElementById('toggleWriter').click()`);
    await app.waitFor(`document.querySelectorAll('.cm-writer-h2').length > 3`, { what: "the rendered text", timeout: 30000 });
    const writer = await app.evaluate(measure);
    console.log("source mode (ms):", JSON.stringify(source));
    console.log("writer mode (ms):", JSON.stringify(writer));
    assert.ok(source.lines > 27000);
    // The same editor does the work in both modes; the Writer mode may add only a little (the decorations of what is on screen).
    for (const kind of ["typed", "moved", "scrolled"]) {
      assert.ok(writer[kind].mean <= source[kind].mean + 5, `${kind}: the Writer mode costs ${writer[kind].mean.toFixed(1)} ms, the source mode ${source[kind].mean.toFixed(1)} ms`);
    }
    assert.ok(writer.moved.p95 < 16, `moving the caret costs ${writer.moved.p95.toFixed(1)} ms at p95`);
    assert.ok(writer.typed.p95 < 33, `a keystroke costs ${writer.typed.p95.toFixed(1)} ms at p95 (two frames)`);
  } finally { await app.stop({ force: true }); }
});
