// The program as the installer put it on the computer (release build, from the install folder): started with TYPENOVA_E2E_EXE=<path to the installed typenova.exe>.
// Used by installer-check.ps1; skipped when the variable is not set. A release build has no test hooks, so files (not folders) are handed over on the command line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readText, startApp, workspace, writeFiles } from "./harness.mjs";

const exe = process.env.TYPENOVA_E2E_EXE;
const skip = !exe && "set TYPENOVA_E2E_EXE to the installed program (see installer-check.ps1)";

test("the installed program starts, raises no errors, and edits and saves a file handed over on the command line", { skip }, async () => {
  const folder = writeFiles(workspace("installed"), { "note.md": "# Installed\n\ntext\n" });
  const file = path.join(folder, "note.md");
  const app = await startApp({ exe, args: [file], reset: false });
  try {
    await app.ready();
    assert.equal(await app.evaluate(`document.title`), "TypeNova");
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.startsWith('# Installed')`, { timeout: 30000, what: "the note opened from the command line" });
    await app.evaluate(`document.querySelector('.cm-content').focus()`);
    await app.key("End", "End", 35, 2);
    await app.type("SAVED-BY-INSTALLED-BUILD");
    await app.key("s", "KeyS", 83, 2);
    await app.sleep(800);
    assert.ok(readText(file).includes("SAVED-BY-INSTALLED-BUILD"), "the text reached the file");
    // What the program keeps for itself exists now, so that the uninstaller has something to clean.
    await app.evaluate(`localStorage.setItem('typenova.installedCheck', '1')`);
    assert.deepEqual(app.problems.filter(line => !/ResizeObserver|favicon/.test(line)), [], "nothing in the console");
  } finally { await app.stop(); }
  // The disposable WebView caches (thousands of small files) are removed when the program ends; what the user may care about stays.
  const profile = path.join(process.env.LOCALAPPDATA, "pl.itvix.typenova.e2e", "EBWebView");
  for (let i = 0; i < 50 && fs.existsSync(path.join(profile, "Default", "Code Cache")); i++) await new Promise(done => setTimeout(done, 100));
  assert.ok(!fs.existsSync(path.join(profile, "Default", "Code Cache")), "the code cache is gone after the program ended");
  assert.ok(fs.existsSync(path.join(profile, "Default", "Local Storage")), "local storage is kept");
});
