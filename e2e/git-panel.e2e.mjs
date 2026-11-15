// Git in the interface, in the real program with the real git: change markers in the margin, the Git view (stage, unstage, commit), and switching and creating branches.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exeExists, startApp } from "./harness.mjs";
import { clickTreeFile, git, ignorableProblem, makeRepo } from "./helpers.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const FIVE = "one\ntwo\nthree\nfour\nfive\n";

test("markers in the margin, then stage, unstage and commit from the Git view", { skip }, async () => {
  const { work } = makeRepo("gitpanel", { "a.md": FIVE, "b.md": "b\n" });
  fs.writeFileSync(path.join(work, "a.md"), "one\nTWO\nthree\nfour\nfive\nsix\n");   // line 2 modified, line 6 added
  fs.writeFileSync(path.join(work, "c.md"), "new\n");
  const app = await startApp({ projects: [work] });
  try {
    await app.ready();
    await clickTreeFile(app, "a.md");
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.includes('TWO')`, { what: "a.md in the editor" });
    await app.waitFor(`document.querySelectorAll('.cm-git-modified').length === 1 && document.querySelectorAll('.cm-git-added').length === 1`, { what: "the markers for the changed lines" });
    // The markers follow the typing.
    await app.evaluate(`document.querySelector('.cm-content').focus()`);
    await app.key("End", "End", 35, 2);
    await app.type("\nseven");
    await app.waitFor(`document.querySelectorAll('.cm-git-added').length === 2`, { what: "a marker for the line that was typed" });

    await app.evaluate(`document.getElementById('openGitPanel').click()`);
    await app.waitFor(`document.querySelectorAll('#gitViewHost .git-file').length === 2`, { what: "the changed files in the Git view" });
    const names = () => app.evaluate(`[...document.querySelectorAll('#gitViewHost .git-section')].map(s => [...s.querySelectorAll('.git-file-base')].map(x => x.textContent).sort())`);
    assert.deepEqual(await names(), [[], ["a.md", "c.md"]], "nothing staged, two changes");
    assert.match(await app.evaluate(`document.querySelector('.git-branch-button').textContent`), /main/);

    // Stage a.md only (the row button), then unstage it, then stage it again.
    const toggleStage = file => app.evaluate(`[...document.querySelectorAll('#gitViewHost .git-file')].find(r => r.querySelector('.git-file-base').textContent === '${file}').querySelector('.git-file-action').click()`);
    await toggleStage("a.md");
    await app.waitFor(`document.querySelectorAll('#gitViewHost .git-section')[0].querySelectorAll('.git-file').length === 1`, { what: "a.md staged" });
    assert.equal(git(work, "diff", "--cached", "--name-only").trim(), "a.md");
    await toggleStage("a.md");
    await app.waitFor(`document.querySelectorAll('#gitViewHost .git-section')[0].querySelectorAll('.git-file').length === 0`, { what: "a.md unstaged" });
    assert.equal(git(work, "diff", "--cached", "--name-only").trim(), "");
    await toggleStage("a.md");
    await app.waitFor(`document.querySelectorAll('#gitViewHost .git-section')[0].querySelectorAll('.git-file').length === 1`, { what: "a.md staged again" });
    // The suggested message names the staged file; only staged files are committed. (The unsaved line "seven" is not on disk, so it is not part of it.)
    assert.equal(await app.evaluate(`document.querySelector('.git-commit-message').value`), "Update a.md");
    await app.evaluate(`document.querySelector('.git-commit-actions .primary-flat').click()`);
    await app.waitFor(`document.querySelectorAll('#gitViewHost .git-section')[0].querySelectorAll('.git-file').length === 0`, { what: "the commit to finish" });
    assert.equal(git(work, "log", "-1", "--format=%s").trim(), "Update a.md");
    assert.equal(git(work, "show", "--name-only", "--format=", "HEAD").trim(), "a.md");
    assert.match(git(work, "status", "--porcelain"), /\?\? c\.md/, "c.md is still a change");
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop({ force: true }); }
});

test("a branch is created and switched from the Git view, open documents are read again, and unsaved ones stop the switch", { skip }, async () => {
  const { work } = makeRepo("gitbranch", { "a.md": "one\ntwo\n" });
  git(work, "switch", "-q", "-c", "other");
  fs.writeFileSync(path.join(work, "a.md"), "changed on other\n");
  git(work, "commit", "-q", "-am", "Other");
  git(work, "switch", "-q", "main");
  const app = await startApp({ projects: [work] });
  try {
    await app.ready();
    await clickTreeFile(app, "a.md");
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.startsWith('one')`, { what: "a.md on main" });
    await app.evaluate(`document.getElementById('openGitPanel').click()`);
    await app.waitFor(`document.querySelector('.git-branch-button')`, { what: "the Git view" });
    await app.evaluate(`document.querySelector('.git-branch-button').click()`);
    await app.waitFor(`document.querySelectorAll('.git-chooser-choice').length >= 2`, { what: "the branches" });
    const choices = await app.evaluate(`[...document.querySelectorAll('.git-chooser-choice')].map(b => [b.querySelector('.git-chooser-name').textContent, b.disabled])`);
    assert.deepEqual(choices.map(c => c[0]).sort(), ["main", "other"]);
    assert.equal(choices.find(c => c[0] === "main")[1], true, "the branch in use cannot be chosen");
    await app.evaluate(`[...document.querySelectorAll('.git-chooser-choice')].find(b => b.querySelector('.git-chooser-name').textContent === 'other').click()`);
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.startsWith('changed on other')`, { what: "a.md read again from the other branch" });
    assert.equal(git(work, "branch", "--show-current").trim(), "other");
    await app.waitFor(`document.querySelector('.git-branch-name')?.textContent === 'other'`, { what: "the new branch in the view" });

    // A new branch: created from the current commit and switched to.
    await app.evaluate(`document.querySelector('.git-branch-button').click()`);
    await app.waitFor(`!!document.querySelector('.git-chooser .git-section-action')`, { what: "the chooser" });
    await app.evaluate(`document.querySelector('.git-chooser .git-section-action').click()`);
    await app.waitFor(`!!document.querySelector('dialog[open] .name-dialog-input')`, { what: "the name dialog" });
    await app.evaluate(`(() => { const i = document.querySelector('dialog[open] .name-dialog-input'); i.value = 'feature/new'; i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('dialog[open] .dialog-actions .primary').click(); return true; })()`);
    await app.waitFor(`document.querySelector('.git-branch-name')?.textContent === 'feature/new'`, { what: "the new branch" });
    assert.equal(git(work, "branch", "--show-current").trim(), "feature/new");

    // Unsaved text stops a switch: the files on disk would be written over it.
    await app.evaluate(`document.querySelector('.cm-content').focus()`);
    await app.type("UNSAVED");
    await app.evaluate(`document.querySelector('.git-branch-button').click()`);
    await app.waitFor(`document.querySelectorAll('.git-chooser-choice').length >= 2`, { what: "the branches again" });
    await app.evaluate(`[...document.querySelectorAll('.git-chooser-choice')].find(b => b.querySelector('.git-chooser-name').textContent === 'main').click()`);
    await app.waitFor(`!!document.querySelector('dialog[open]')`, { what: "the message about the unsaved document" });
    assert.equal(git(work, "branch", "--show-current").trim(), "feature/new", "nothing was switched");
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop({ force: true }); }
});
