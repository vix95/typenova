// End-to-end harness: starts the real TypeNova program (the Rust host, the real file system scope, real shells) and drives its window through the
// WebView2 debugging port. It needs the isolated build made by `npm run e2e:build` (another identifier, so it never touches a running TypeNova).
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXE = path.join(ROOT, "src-tauri", "target-e2e", "debug", "typenova.exe");
/** The identifier of the isolated build: its settings and WebView data live in folders of this name only. */
const IDENTIFIER = "pl.itvix.typenova.e2e";
export const WORK = path.join(ROOT, ".e2e-work");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const exeExists = () => fs.existsSync(EXE);

/** Forgets what the isolated build stored (its WebView profile, its settings); never touches anything of the real application. */
export function resetAppData() {
  for (const base of [process.env.LOCALAPPDATA, process.env.APPDATA]) {
    if (!base) continue;
    const folder = path.join(base, IDENTIFIER);
    if (!folder.endsWith(".e2e")) throw new Error("refusing to delete " + folder);
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 30, retryDelay: 300 });   // the WebView of the previous run may still be letting go of its files
  }
}

/** A fresh folder for a test's files (under .e2e-work, which is ignored by Git). */
export function workspace(name) {
  const folder = path.join(WORK, `${name}-${Date.now()}`);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

let nextPort = 9700 + Math.floor(Math.random() * 200);

async function findTarget(port, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find(target => target.type === "page" && /tauri\.localhost|localhost/.test(target.url));
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error("the TypeNova window did not appear on the debugging port");
}

/**
 * Starts the program with `args` (files or folders, like a double click) and returns a handle to its window.
 * `reset` forgets stored settings first; pass false to see what a second start restores.
 */
export async function startApp({ args = [], reset = true, projects = [], exe = EXE } = {}) {
  if (!fs.existsSync(exe)) throw new Error(exe === EXE ? "the end-to-end build is missing: run `npm run e2e:build`" : `no program at ${exe}`);
  if (reset) resetAppData();
  const port = nextPort++;
  const child = spawn(exe, args, { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, ...(projects.length ? { TYPENOVA_E2E_FOLDERS: projects.join(path.delimiter) } : {}) }, stdio: "ignore", detached: false });
  const target = await findTarget(port);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("cannot connect to the window")); });
  let id = 0;
  const pending = new Map(), problems = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }
    else if (message.method === "Runtime.exceptionThrown") problems.push("exception: " + (message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text));
    else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") problems.push("console.error: " + message.params.args.map(arg => arg.value ?? arg.description).join(" "));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const mine = ++id; pending.set(mine, { resolve, reject }); socket.send(JSON.stringify({ id: mine, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");

  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const app = {
    port, problems, evaluate, send, sleep,
    /** Waits until `expression` (run in the window) gives something truthy; returns it. */
    async waitFor(expression, { timeout = 20000, what = expression } = {}) {
      const deadline = Date.now() + timeout;
      let last;
      while (Date.now() < deadline) { try { last = await evaluate(expression); if (last) return last; } catch { /* the page is changing */ } await sleep(150); }
      throw new Error(`timed out waiting for: ${what}`);
    },
    click: selector => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('no element ' + ${JSON.stringify(selector)}); e.click(); return true; })()`),
    text: selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? null`),
    /** Presses a key with the real input pipeline (modifiers: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift). */
    async key(key, code, vk, modifiers = 0) { for (const type of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(120); },
    type: text => send("Input.insertText", { text }),
    /** Calls a Tauri command of the Rust host. */
    // A rejected command is turned into an Error carrying its message (a rejected promise would reach us only as "Uncaught (in promise)").
    async invoke(command, args = {}) {
      const answer = await evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)}).then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error) }))`);
      if (!answer.ok) throw new Error(answer.error);
      return answer.value;
    },
    /** Boot finished: the interface is usable. */
    ready: () => app.waitFor(`document.body && !document.body.classList.contains('booting') && !!document.getElementById('layout')`, { timeout: 60000, what: "the interface to start" }),
    /**
     * Closes the program the way a user does (the window is asked to close, so that settings kept in the WebView are written to disk), and ends it by force only if it does not go.
     * A forced end loses what the WebView had not written yet, which is what a test of "after a restart" must not do.
     */
    async stop({ force = false } = {}) {
      try { socket.close(); } catch { /* closed */ }
      const alive = () => { try { process.kill(child.pid, 0); return true; } catch { return false; } };
      if (!force) {
        try { execSync(`powershell -NoProfile -Command "(Get-Process -Id ${child.pid}).CloseMainWindow() | Out-Null"`, { stdio: "ignore" }); } catch { /* gone */ }
        for (let waited = 0; alive() && waited < 15000; waited += 250) await sleep(250);
      }
      if (alive()) { try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } }
      await sleep(500);
    },
  };
  // Project folders: granted by the host (see grant_e2e_folders) and remembered like the folders of a previous session; the page is loaded again so that its restore sees them.
  if (projects.length) {
    await app.waitFor(`document.readyState === 'complete' && !!window.__TAURI_INTERNALS__`, { timeout: 60000, what: "the first load" });
    await evaluate(`localStorage.setItem('typenova.projectRoots', ${JSON.stringify(JSON.stringify(projects))})`);
    await send("Page.reload");
    await sleep(1500);
  }
  return app;
}

/** Files for a test: `files` maps relative paths to text. */
export function writeFiles(folder, files) {
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(folder, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return folder;
}

export const readText = file => fs.readFileSync(file, "utf8");
export const tempOutside = () => fs.mkdtempSync(path.join(os.tmpdir(), "typenova-e2e-outside-"));
