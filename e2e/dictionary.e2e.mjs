// The personal dictionary and the repository: words in the repository's .typenova/dictionary.txt are known words, the personal dictionary can be exported to it (or follow it), and outside a repository the words stay in TypeNova.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exeExists, readText, startApp, workspace, writeFiles } from "./harness.mjs";
import { git, ignorableProblem, openNote, waitUntil } from "./helpers.mjs";

const DICTIONARY = "dictionary.txt";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const marked = app => app.evaluate(`[...document.querySelectorAll('.cm-misspelled')].map(x => x.textContent).sort()`);
const repositoryDictionary = repo => (fs.existsSync(path.join(repo, ".typenova", DICTIONARY)) ? readText(path.join(repo, ".typenova", DICTIONARY)) : "");
const addWord = (app, word) => app.evaluate(`(() => { const i = document.querySelector('.spell-words-dialog .bookmark-input'); i.value = ${JSON.stringify(word)}; i.closest('form').requestSubmit(); return true; })()`);

test("repository words are known, the personal dictionary is exported to the repository, and new words can follow", { skip }, async () => {
  const base = workspace("dict");
  const repo = path.join(base, "notes");
  writeFiles(base, { "notes/note.md": "Words: qzxvkplw and zzyqxwvb and abrakadabrux and plain text.\n" });
  git(repo, "init", "-q", "-b", "main");
  // A teammate already put one word into the repository's dictionary.
  fs.mkdirSync(path.join(repo, ".typenova"));
  fs.writeFileSync(path.join(repo, ".typenova", "dictionary.txt"), "# team words\nzzyqxwvb\n");
  const app = await startApp({ projects: [repo] });
  try {
    await app.ready();
    await openNote(app, "note.md", "qzxvkplw");
    // The word from the repository's file is known; the two others are not.
    await app.waitFor(`document.querySelectorAll('.cm-misspelled').length === 2`, { what: "the spelling marks", timeout: 30000 });
    assert.deepEqual(await marked(app), ["abrakadabrux", "qzxvkplw"], "zzyqxwvb comes from the repository dictionary");

    // Add a word to the personal dictionary: it stays in TypeNova (this computer) and is known at once.
    await app.evaluate(`document.getElementById('spellOpenWords').click()`);
    await app.waitFor(`!!document.querySelector('.spell-words-dialog .spell-repo-info')?.textContent.includes('notes')`, { what: "the repository part of the dictionary window" });
    assert.match(await app.evaluate(`document.querySelector('.spell-repo-info').textContent`), /1 (words|słów)/);
    await addWord(app, "qzxvkplw");
    await app.waitFor(`document.querySelectorAll('.cm-misspelled').length === 1`, { what: "the word to be known" });
    assert.ok(JSON.parse(await app.evaluate(`localStorage.getItem('typenova.spell.words')`)).includes("qzxvkplw"), "kept in TypeNova");
    assert.ok(!repositoryDictionary(repo).includes("qzxvkplw"), "not in the repository yet");

    // Export: the file now has the team's word and the personal one, sorted, with the comment on top.
    await app.evaluate(`[...document.querySelectorAll('.spell-repo .ai-flat-button')].find(b => !b.disabled).click()`);
    await waitUntil(() => repositoryDictionary(repo).includes("qzxvkplw"), { what: "the export to reach the file" });
    const text = repositoryDictionary(repo);
    assert.ok(text.startsWith("# TypeNova dictionary"), `the file was rewritten: ${text}`);
    assert.deepEqual(text.split("\n").filter(line => line && !line.startsWith("#")), ["qzxvkplw", "zzyqxwvb"]);
    assert.match(git(repo, "status", "--porcelain"), /\.typenova\//, "the file is a change of the repository");

    // The switch: a new word also goes to the repository.
    await app.evaluate(`document.querySelector('.spell-repo-auto input').click()`);
    await addWord(app, "abrakadabrux");
    await waitUntil(() => repositoryDictionary(repo).includes("abrakadabrux"), { what: "the new word to follow into the repository" });
    await app.waitFor(`document.querySelectorAll('.cm-misspelled').length === 0`, { what: "no marks left" });
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop({ force: true }); }
});

test("outside a repository the words stay in TypeNova and nothing is written to the folder", { skip }, async () => {
  // Outside this repository (the e2e work folder lies inside it): a folder of the system temporary folder, with no Git above it.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "typenova-dict-plain-"));
  fs.writeFileSync(path.join(folder, "note.md"), "Words: qzxvkplw and plain text.\n");
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await openNote(app, "note.md", "qzxvkplw");
    await app.waitFor(`document.querySelectorAll('.cm-misspelled').length === 1`, { what: "the spelling mark", timeout: 30000 });
    await app.evaluate(`document.getElementById('spellOpenWords').click()`);
    await app.waitFor(`!!document.querySelector('.spell-words-dialog .spell-repo-info')?.textContent`, { what: "the dictionary window" });
    assert.match(await app.evaluate(`document.querySelector('.spell-repo-info').textContent`), /(not working in a Git repository|nie pracujesz w repozytorium)/i);
    assert.equal(await app.evaluate(`[...document.querySelectorAll('.spell-repo .ai-flat-button')].every(b => b.disabled)`), true, "nothing to export to");
    await addWord(app, "qzxvkplw");
    await app.waitFor(`document.querySelectorAll('.cm-misspelled').length === 0`, { what: "the word to be known" });
    assert.ok(JSON.parse(await app.evaluate(`localStorage.getItem('typenova.spell.words')`)).includes("qzxvkplw"), "kept in TypeNova");
    await app.sleep(800);
    assert.ok(!fs.existsSync(path.join(folder, ".typenova")), "no .typenova folder was created");
  } finally { await app.stop({ force: true }); fs.rmSync(folder, { recursive: true, force: true }); }
});
