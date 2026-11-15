// What the end-to-end tests share: reaching a file in the project tree, and a throw-away Git repository with a remote.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { workspace, writeFiles } from "./harness.mjs";

/** Console lines that are noise, not problems. */
export const ignorableProblem = line => /ResizeObserver|favicon/.test(line);

/** Waits (in the test, not in the page) until `check()` is true: for what happens outside the program, such as a file that is written. */
export async function waitUntil(check, { timeout = 15000, what = "the condition" } = {}) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise(done => setTimeout(done, 100));
  }
}

/** The tree row of a file, as a browser expression (the path is compared with forward slashes, so it does not matter which separator the program wrote). */
const treeRow = name => `[...document.querySelectorAll('[data-file-path]')].find(row => row.dataset.filePath.replace(/\\\\/g, '/').endsWith('/${name}'))`;

/** Waits until the project tree lists the file. */
export const waitForTreeFile = (app, name) => app.waitFor(`!!(${treeRow(name)})`, { what: `${name} in the tree`, timeout: 30000 });

/** Clicks a file of the project tree once it is listed. */
export async function clickTreeFile(app, name) {
  await waitForTreeFile(app, name);
  await app.evaluate(`${treeRow(name)}.click()`);
}

/** Opens a text file from the tree and waits until the editor shows `text`. */
export async function openNote(app, name, text) {
  await clickTreeFile(app, name);
  await app.waitFor(`document.querySelector('.cm-content')?.innerText.includes(${JSON.stringify(text)})`, { what: `${name} in the editor` });
}

export const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

/**
 * A Git repository with `files` committed on `main` and pushed to a bare remote next to it.
 * Returns the working folder (named `notes`, so that a repository name shows in the program) and the remote.
 */
export function makeRepo(label, files) {
  const base = workspace(label);
  const remote = path.join(base, "remote.git");
  const work = path.join(base, "notes");
  fs.mkdirSync(remote, { recursive: true });
  git(remote, "init", "-q", "--bare", "-b", "main");
  writeFiles(base, Object.fromEntries(Object.entries(files).map(([name, text]) => [`notes/${name}`, text])));
  git(work, "init", "-q", "-b", "main");
  for (const [key, value] of [["user.email", "t@example.com"], ["user.name", "Tester"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) git(work, "config", key, value);
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "First");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-q", "-u", "origin", "main");
  return { work, remote };
}
