// A toast shown while a modal dialog is open must be visible, not hidden behind the dialog (the dialog is in the top layer, above everything else).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exeExists, startApp, workspace, writeFiles } from "./harness.mjs";
import { clickTreeFile } from "./helpers.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("the toast of the image viewer's copy button is on top of the viewer", { skip }, async () => {
  const folder = writeFiles(workspace("toast"), { "note.md": "# Note\n" });
  fs.writeFileSync(path.join(folder, "pic.png"), PIXEL);
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await clickTreeFile(app, "pic.png");
    await app.waitFor(`!!document.querySelector('dialog[open]')`, { what: "the image viewer" });
    await app.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => /Copy|Kopiuj/.test(b.dataset.tooltip ?? b.getAttribute('aria-label') ?? '')).click()`);
    await app.waitFor(`document.getElementById('appToast')?.classList.contains('visible')`, { what: "the toast" });
    await app.sleep(300);
    // The toast is a popover, which the browser draws above the modal dialog and its backdrop (a page element outside the dialog is not even reachable by a hit test then, so the layer is what is checked).
    const state = await app.evaluate(`(() => {
      const toast = document.getElementById('appToast'), box = toast.getBoundingClientRect();
      return { popoverOpen: toast.matches(':popover-open'), dialogOpen: !!document.querySelector('dialog[open]'), opaque: getComputedStyle(toast).opacity === '1', onScreen: box.right <= innerWidth && box.bottom <= innerHeight && box.left >= 0 && box.top >= 0 };
    })()`);
    assert.deepEqual(state, { popoverOpen: true, dialogOpen: true, opaque: true, onScreen: true });
  } finally { await app.stop({ force: true }); }
});
