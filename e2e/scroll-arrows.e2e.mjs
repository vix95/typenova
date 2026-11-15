// The scroll arrows of the editor and of the preview, in the real program: page steps, jumps to the ends, disabled at the ends.
import test from "node:test";
import assert from "node:assert/strict";
import { exeExists, startApp, workspace, writeFiles } from "./harness.mjs";
import { clickTreeFile, ignorableProblem } from "./helpers.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const LONG = "# Long note\n\n" + Array.from({ length: 300 }, (_, index) => `Paragraph ${index + 1} of the long note, long enough to be a line of its own.\n`).join("\n");

/** The arrows of one pane: its scroller and its container. */
const PANES = {
  editor: { scroller: `document.querySelector('.cm-editor .cm-scroller')`, arrows: `document.querySelector('.cm-editor > .scroll-arrows')` },
  preview: { scroller: `document.getElementById('preview')`, arrows: `document.querySelector('#previewPane > .scroll-arrows')` },
};
const press = (app, pane, direction, shift = false) =>
  app.evaluate(`${PANES[pane].arrows}.querySelector('[data-direction="${direction}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: ${shift} }))`);
const state = (app, pane) => app.evaluate(`(() => { const s = ${PANES[pane].scroller}, a = ${PANES[pane].arrows}; return { top: s.scrollTop, max: s.scrollHeight - s.clientHeight, hidden: a.hidden, upOff: a.querySelector('[data-direction="up"]').disabled, downOff: a.querySelector('[data-direction="down"]').disabled }; })()`);

test("the editor and the preview scroll a page with the arrows, and to the ends with Shift", { skip }, async () => {
  const folder = writeFiles(workspace("arrows"), { "long.md": LONG });
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await clickTreeFile(app, "long.md");
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.startsWith('# Long note')`, { what: "the note in the editor" });
    await app.waitFor(`document.getElementById('preview').scrollHeight > document.getElementById('preview').clientHeight + 200`, { what: "the preview to be drawn", timeout: 30000 });
    for (const pane of ["editor", "preview"]) {
      await app.waitFor(`!${PANES[pane].arrows}.hidden`, { what: `the ${pane} arrows to appear` });
      // The panes follow each other (scroll synchronisation): let what the other pane did settle before starting from the top.
      await app.sleep(800);
      await app.evaluate(`${PANES[pane].scroller}.scrollTop = 0`);
      await app.waitFor(`${PANES[pane].scroller}.scrollTop < 3 && ${PANES[pane].arrows}.querySelector('[data-direction="up"]').disabled`, { what: `the ${pane} at its start` });
      let now = await state(app, pane);
      assert.equal(now.upOff, true, `${pane}: up is disabled at the start`);
      assert.equal(now.downOff, false, `${pane}: down is available`);
      await press(app, pane, "down");
      await app.waitFor(`${PANES[pane].scroller}.scrollTop > 100`, { what: `the ${pane} to scroll a page` });
      await app.sleep(600);
      now = await state(app, pane);
      assert.equal(now.upOff, false, `${pane}: up is available after a step down`);
      await press(app, pane, "down", true);
      await app.waitFor(`(() => { const s = ${PANES[pane].scroller}; return s.scrollTop >= s.scrollHeight - s.clientHeight - 3; })()`, { what: `the ${pane} to reach its end` });
      await app.sleep(300);
      now = await state(app, pane);
      assert.equal(now.downOff, true, `${pane}: down is disabled at the end`);
      await press(app, pane, "up", true);
      await app.waitFor(`${PANES[pane].scroller}.scrollTop < 3`, { what: `the ${pane} to return to the start` });
    }
    const labels = await app.evaluate(`[...document.querySelectorAll('.scroll-arrow')].map(b => b.getAttribute('aria-label') + '|' + b.dataset.tooltip)`);
    assert.ok(labels.length >= 4 && labels.every(label => /^[^|]+\|[^|]+$/.test(label)), "every arrow has an accessible name and a tooltip");
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop(); }
});
