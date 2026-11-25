// Updates in the real program: the status line goes back to what it showed after a check, and "What's new" opens by itself once after a version change
// (never on a fresh install, and not over another dialog). The isolated build asks the real GitHub release; with or without a network the line must come back.
import test from "node:test";
import assert from "node:assert/strict";
import { exeExists, startApp } from "./harness.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const SEEN = "typenova.whatsNewSeenVersion";
const whatsNewOpen = `!!document.getElementById('whatsNewDialog')?.open`;
const version = `document.getElementById('appVersion')?.textContent ?? ''`;

test("a fresh install does not open What's new, and remembers the version", { skip }, async () => {
  const app = await startApp();
  try {
    await app.ready();
    await app.sleep(3000);
    assert.equal(await app.evaluate(whatsNewOpen), false);
    assert.equal(await app.evaluate(`localStorage.getItem('${SEEN}')`), await app.evaluate(version));
  } finally { await app.stop(); }
});

test("after an update What's new opens once, with focus on its button, and not again at the next start", { skip }, async () => {
  let app = await startApp();
  try {
    await app.ready();
    await app.evaluate(`localStorage.setItem('${SEEN}', '0.5.100')`);
  } finally { await app.stop(); }
  app = await startApp({ reset: false });
  try {
    await app.ready();
    await app.waitFor(whatsNewOpen, { timeout: 10000, what: "What's new to open by itself" });
    const state = await app.evaluate(`(() => { const d = document.getElementById('whatsNewDialog'); return {
      focused: document.activeElement === d.querySelector('.whats-new-actions .primary'),
      items: d.querySelectorAll('.whats-new-item').length,
      seen: localStorage.getItem('${SEEN}') === document.getElementById('appVersion').textContent } })()`);
    assert.deepEqual(state, { focused: true, items: 5, seen: true });
    await app.sleep(500);
    assert.equal(await app.evaluate(`document.getElementById('typenovaTooltip').classList.contains('visible')`), false, "no tooltip repeats the button's words");
    await app.click("#whatsNewDialog .whats-new-actions .primary");
    assert.equal(await app.evaluate(whatsNewOpen), false);
  } finally { await app.stop(); }
  app = await startApp({ reset: false });
  try {
    await app.ready();
    await app.sleep(3000);
    assert.equal(await app.evaluate(whatsNewOpen), false, "it does not repeat");
  } finally { await app.stop(); }
});

test("an update from a version that did not remember (used before, no stored version) opens What's new", { skip }, async () => {
  let app = await startApp();
  try {
    await app.ready();
    assert.equal(await app.invoke("earlier_session"), false, "the first start of a fresh install");
    await app.evaluate(`localStorage.removeItem('${SEEN}'); localStorage.setItem('typenova.language', 'pl')`);
  } finally { await app.stop(); }
  app = await startApp({ reset: false });
  try {
    await app.ready();
    assert.equal(await app.invoke("earlier_session"), true, "the window was closed before, so its state file exists");
    await app.waitFor(whatsNewOpen, { timeout: 10000, what: "What's new to open by itself" });
    assert.equal(await app.text("#whatsNewTitle"), "Nowości", "in the chosen language");
  } finally { await app.stop(); }
});

test("What's new waits for another open dialog and then opens", { skip }, async () => {
  let app = await startApp();
  try { await app.ready(); await app.evaluate(`localStorage.setItem('${SEEN}', '0.5.100')`); } finally { await app.stop(); }
  app = await startApp({ reset: false });
  try {
    await app.waitFor(`!!document.getElementById('aboutDialog') && !!document.getElementById('whatsNewDialog')`, { timeout: 60000, what: "the dialogs" });
    await app.evaluate(`document.getElementById('aboutDialog').showModal()`);
    await app.sleep(3500);
    assert.equal(await app.evaluate(whatsNewOpen), false, "not over another dialog");
    await app.evaluate(`document.getElementById('aboutDialog').close()`);
    await app.waitFor(whatsNewOpen, { timeout: 5000, what: "What's new after the other dialog closed" });
  } finally { await app.stop(); }
});

test("the status line comes back after the check at the start and after a check from the menu", { skip }, async () => {
  const app = await startApp();
  try {
    await app.ready();
    const before = await app.text("#statusText");
    const checking = `/Checking for updates|Sprawdzanie aktualizacji/.test(document.getElementById('statusText').textContent)`;
    await app.waitFor(checking, { timeout: 15000, what: "the check at the start to show itself" });
    await app.waitFor(`!(${checking})`, { timeout: 30000, what: "the check at the start to end" });
    assert.equal(await app.text("#statusText"), before, "the line shows again what it showed before");
    await app.evaluate(`document.getElementById('statusText').textContent = 'Opened: note.md'`);
    await app.click("#menuCheckUpdates");
    await app.waitFor(checking, { timeout: 5000, what: "the check from the menu" });
    await app.waitFor(`!(${checking})`, { timeout: 30000, what: "the check from the menu to end" });
    await app.sleep(300);
    // Nothing newer than this build exists, so the answer is "up to date" (a toast) or, without a network, an alert; either way the line is back.
    assert.equal(await app.text("#statusText"), "Opened: note.md");
    assert.equal(await app.evaluate(`document.querySelectorAll('.update-bar:not([hidden])').length`), 0, "no bar is left running");
    assert.equal(await app.evaluate(`document.getElementById('updateCheckNow').classList.contains('is-checking')`), false);
  } finally { await app.stop(); }
});
