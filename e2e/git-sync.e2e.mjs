// "Commit and push" in the real program: the changes of the repository the open document belongs to are committed and pushed to its remote, on the real file system and with the real git.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exeExists, startApp, workspace, writeFiles } from "./harness.mjs";
import { clickTreeFile, git, ignorableProblem } from "./helpers.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";

test("the button commits new and changed files of the repository and pushes them", { skip }, async () => {
  const base = workspace("gitsync");
  const remote = path.join(base, "remote.git"), work = path.join(base, "CV-prep");
  fs.mkdirSync(remote, { recursive: true });
  git(remote, "init", "-q", "--bare", "-b", "main");
  writeFiles(base, { "CV-prep/first.md": "# First\n" });
  git(work, "init", "-q", "-b", "main");
  for (const [key, value] of [["user.email", "t@example.com"], ["user.name", "Tester"], ["commit.gpgsign", "false"]]) git(work, "config", key, value);
  git(work, "add", "."); git(work, "commit", "-q", "-m", "First");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-q", "-u", "origin", "main");
  // What happened since: a new note, a new screenshot in a sub folder, a changed file.
  fs.writeFileSync(path.join(work, "notes.md"), "# Notes\n");
  fs.mkdirSync(path.join(work, "ideas", "assets"), { recursive: true });
  fs.writeFileSync(path.join(work, "ideas", "assets", "screen.png"), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(work, "first.md"), "# First\n\nchanged\n");

  const app = await startApp({ projects: [work] });
  try {
    await app.ready();
    await clickTreeFile(app, "first.md");
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.includes('First')`, { what: "first.md in the editor" });
    await app.evaluate(`document.getElementById('gitSyncButton').click()`);
    await app.waitFor(`!!document.querySelector('.git-sync-dialog[open] .git-sync-file')`, { what: "the dialog with the changes" });
    const listed = await app.evaluate(`[...document.querySelectorAll('.git-sync-path')].map(x => x.textContent).sort()`);
    assert.deepEqual(listed, ["first.md", "ideas/assets/screen.png", "notes.md"]);
    assert.match(await app.evaluate(`document.getElementById('gitSyncMessage').value`), /^Add .*; update first\.md$|files/);
    assert.match(await app.evaluate(`document.querySelector('.git-sync-target').textContent`), /CV-prep · main → origin\/main/);
    await app.evaluate(`document.querySelector('.git-sync-dialog .primary').click()`);
    await app.waitFor(`!document.querySelector('.git-sync-dialog')`, { what: "the dialog to close after the push", timeout: 60000 });
    assert.equal(git(work, "status", "--porcelain").trim(), "", "nothing is left uncommitted");
    assert.equal(git(remote, "log", "-1", "--format=%s", "main").trim(), git(work, "log", "-1", "--format=%s").trim(), "the remote has the new commit");
    assert.ok(git(remote, "ls-tree", "-r", "--name-only", "main").includes("ideas/assets/screen.png"), "the screenshot reached the remote");
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop(); }
});
