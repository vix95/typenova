// The integrated terminal against the real program: a real shell in a real pseudo terminal, restarting a stuck terminal, and a flood of input that must not stop the window.
import test from "node:test";
import assert from "node:assert/strict";
import { exeExists, startApp, workspace, writeFiles } from "./harness.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
// A Tauri channel travels as the string "__CHANNEL__:<id>" of a callback registered in the window.
const CHANNEL = `('__CHANNEL__:' + window.__TAURI_INTERNALS__.transformCallback(() => {}))`;
const spawnOf = (id, shell) => `window.__TAURI_INTERNALS__.invoke('terminal_spawn', { id: ${JSON.stringify(id)}, shell: ${JSON.stringify(shell.path)}, args: ${JSON.stringify(shell.args)}, cwd: null, cols: 80, rows: 24, onEvent: ${CHANNEL} })`;

test("a shell started from the terminal panel runs a command and shows its output", { skip }, async () => {
  const folder = writeFiles(workspace("term"), { "note.md": "# T\n" });
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await app.key("`", "Backquote", 192, 2);                  // Ctrl+`
    await app.waitFor(`!document.getElementById('terminalPanel').hidden`, { what: "the terminal panel" });
    await app.waitFor(`document.querySelectorAll('#terminalTabs .terminal-tab').length > 0`, { what: "a terminal tab" });
    await app.waitFor(`document.querySelector('#terminalBody .xterm-helper-textarea')`, { what: "the screen of the shell" });
    await app.sleep(2500);                                    // the shell prints its prompt
    await app.evaluate(`document.querySelector('#terminalBody .xterm-helper-textarea').focus()`);
    await app.type("echo e2e-terminal-marker-42");
    await app.key("Enter", "Enter", 13);
    await app.waitFor(`/e2e-terminal-marker-42[\\s\\S]*e2e-terminal-marker-42/.test([...document.querySelectorAll('#terminalBody .xterm-rows')].map(r => r.innerText).join('\\n'))`, { timeout: 15000, what: "the command and its output on the screen" });
  } finally { await app.stop(); }
});

test("a terminal that is started again under the same id replaces the old one instead of failing", { skip }, async () => {
  const app = await startApp();
  try {
    await app.ready();
    const shells = await app.invoke("terminal_shells");
    assert.ok(shells.shells.length > 0, "the computer has a shell");
    const shell = shells.shells[0];
    await app.evaluate(spawnOf("e2e-one", shell));
    await app.evaluate(spawnOf("e2e-one", shell));            // used to fail with "this terminal is already running"
    await app.invoke("terminal_write", { id: "e2e-one", data: "echo ok\r" });
    await app.invoke("terminal_kill", { id: "e2e-one" });
    await assert.rejects(() => app.invoke("terminal_write", { id: "e2e-one", data: "x" }), /no such terminal/);
  } finally { await app.stop(); }
});

test("the window stays responsive while a terminal is flooded with input", { skip }, async () => {
  const app = await startApp();
  try {
    await app.ready();
    const shell = (await app.invoke("terminal_shells")).shells[0];
    await app.evaluate(spawnOf("e2e-flood", shell));
    // Many large writes at once; the window must keep answering meanwhile.
    const flood = app.evaluate(`Promise.allSettled(Array.from({ length: 60 }, () => window.__TAURI_INTERNALS__.invoke('terminal_write', { id: 'e2e-flood', data: 'x'.repeat(200000) }))).then(r => r.length)`);
    const started = Date.now();
    for (let i = 0; i < 10; i++) await app.evaluate(`document.title`);
    assert.ok(Date.now() - started < 3000, `ten round trips to the window took ${Date.now() - started} ms while writes were pending`);
    await Promise.race([flood, app.sleep(20000)]);
    await app.invoke("terminal_kill", { id: "e2e-flood" });
  } finally { await app.stop(); }
});
