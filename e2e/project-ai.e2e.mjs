// The assistant with the project, in the real program against a local stand-in for the model (Ollama's protocol on 127.0.0.1): what is sent, citations, proposed changes applied only on approval, folder tasks.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { exeExists, readText, startApp, workspace, writeFiles } from "./harness.mjs";
import { ignorableProblem, waitForTreeFile } from "./helpers.mjs";

const skip = !exeExists() && "the end-to-end build is missing (npm run e2e:build)";
const PLAN = "# Budget\n\nThe budget is 5000 euro.\n";
const NOTES = { "plan.md": PLAN, "team.md": "# Team\n\nAnna leads the team.\n", "sub/ideas.md": "# Ideas\n\nA lighthouse tour.\n" };

/** A model that answers like Ollama (a stream of JSON lines) and keeps what it was sent. */
function mockModel() {
  const requests = [];
  const server = http.createServer((request, response) => {
    if (request.url === "/api/tags") { response.end(JSON.stringify({ models: [{ name: "mock" }] })); return; }
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      requests.push(parsed);
      const last = parsed.messages[parsed.messages.length - 1].content;
      const answer = /budget/i.test(last)
        ? 'The budget is 5000 euro [1].\n<edit file="plan.md">\n<find>\nThe budget is 5000 euro.\n</find>\n<replace>\nThe budget is 6000 euro.\n</replace>\n</edit>\nThat is the change.'
        : /Summarize the notes/.test(last) ? "Budget [1], team [2]." : "Plain answer.";
      response.setHeader("content-type", "application/x-ndjson");
      response.write(`${JSON.stringify({ message: { role: "assistant", content: answer }, done: false })}\n`);
      response.end(`${JSON.stringify({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" })}\n`);
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

/** Points the assistant at the stand-in model (as the Ollama provider, which takes an address) and opens the chat. */
const useMockModel = (app, url) => app.evaluate(`(() => { localStorage.setItem('typenova.ai.provider', 'ollama'); localStorage.setItem('typenova.ai.ollama.url', ${JSON.stringify(url)}); localStorage.setItem('typenova.ai.ollama.model', 'mock'); document.dispatchEvent(new CustomEvent('typenova:ai-settings-changed')); document.getElementById('toggleAi').click(); return true; })()`);
const ask = (app, text) => app.evaluate(`(() => { document.getElementById('aiInput').value = ${JSON.stringify(text)}; document.getElementById('aiForm').requestSubmit(); return true; })()`);
const idle = app => app.waitFor(`document.getElementById('aiMessages').getAttribute('aria-busy') === 'false'`, { what: "the answer to end", timeout: 30000 });

test("the chat answers from the project with citations, proposes a change as a difference, and sends only what matches", { skip }, async () => {
  const folder = writeFiles(workspace("projectai"), NOTES);
  const model = await mockModel();
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await waitForTreeFile(app, "plan.md");
    await useMockModel(app, model.url);
    await app.evaluate(`[...document.querySelectorAll('[data-file-path]')].find(x => x.dataset.filePath.endsWith('plan.md')).click()`);
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.includes('5000')`, { what: "plan.md in the editor" });

    // The project is not sent until the person switches it on.
    await ask(app, "What is the budget?");
    await idle(app);
    assert.ok(!model.requests[0].messages[0].content.includes("<sources>"), "without the Project switch no notes are sent");

    await app.evaluate(`document.getElementById('aiUseProject').click()`);
    assert.equal(await app.evaluate(`document.getElementById('aiUseProject').getAttribute('aria-pressed')`), "true");
    await ask(app, "What is the budget?");
    await idle(app);
    const system = model.requests[1].messages[0].content;
    assert.match(system, /<source id="1" file="plan\.md" section="Budget" line="1">/);
    assert.ok(!system.includes("Anna leads"), "a note that does not match is not sent");
    assert.ok(!system.includes("lighthouse"), "another note that does not match is not sent");
    // What was sent is listed under the message, and the citation opens its place.
    assert.match(await app.evaluate(`document.querySelector('.ai-sources-details summary').textContent`), /1 .* 1 .*/);
    assert.equal(await app.evaluate(`document.querySelectorAll('.ai-cite').length`), 1);
    // The proposed change is a difference, and nothing has changed yet.
    await app.waitFor(`!!document.querySelector('.ai-proposal .ai-diff')`, { what: "the proposed change" });
    assert.deepEqual(await app.evaluate(`[...document.querySelectorAll('.ai-diff-add, .ai-diff-del')].map(x => x.textContent)`), ["- The budget is 5000 euro.", "+ The budget is 6000 euro."]);
    assert.ok(readText(path.join(folder, "plan.md")).includes("5000"));
    // Applying puts it into the editor, not onto the disk.
    await app.evaluate(`document.querySelector('.ai-proposal-actions .primary-flat').click()`);
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.includes('6000')`, { what: "the change in the editor" });
    assert.ok(readText(path.join(folder, "plan.md")).includes("5000"), "the file on disk is unchanged until it is saved");
    assert.equal(await app.evaluate(`document.querySelector('.ai-proposal-actions')?.childElementCount ?? 0`), 0, "the card is settled");
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop({ force: true }); model.server.close(); }  // a document with an unsaved change would hold the window open with a prompt
});

test("a folder is summarized from all of its notes, with citations", { skip }, async () => {
  const folder = writeFiles(workspace("projectai-folder"), NOTES);
  const model = await mockModel();
  const app = await startApp({ projects: [folder] });
  try {
    await app.ready();
    await waitForTreeFile(app, "plan.md");
    await useMockModel(app, model.url);
    await app.evaluate(`[...document.querySelectorAll('[data-file-path]')].find(x => x.dataset.filePath.endsWith('plan.md')).click()`);
    await app.waitFor(`document.querySelector('.cm-content')?.innerText.includes('5000')`, { what: "plan.md in the editor" });
    await app.evaluate(`document.getElementById('aiSummarizeFolder').click()`);
    await idle(app);
    await app.waitFor(`document.querySelectorAll('.ai-cite').length === 2`, { what: "the citations" });
    const system = model.requests[0].messages[0].content;
    assert.ok(system.includes("Anna leads the team.") && system.includes("The budget is 5000 euro."), "every note of the folder is sent");
    assert.ok(system.includes("lighthouse"), "also the notes in its sub folders");
    assert.match(model.requests[0].messages.at(-1).content, /^Summarize the notes of the folder/);
    assert.deepEqual(app.problems.filter(line => !ignorableProblem(line)), [], "nothing in the console");
  } finally { await app.stop(); model.server.close(); }
});
