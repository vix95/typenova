import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/ai/ai-model.js");

test("only offered models are accepted, anything else becomes the default", async () => {
  const m = await model();
  assert.equal(m.validModel("claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(m.validModel("gpt-4"), m.DEFAULT_AI_MODEL);
  assert.equal(m.validModel(null), m.DEFAULT_AI_MODEL);
  assert.equal(m.DEFAULT_AI_MODEL, "claude-opus-5-5");
});

test("context is clipped on the side away from the selection", async () => {
  const m = await model();
  assert.equal(m.clipContext("abcdef", 4, "tail"), "cdef");
  assert.equal(m.clipContext("abcdef", 4, "head"), "abcd");
  assert.equal(m.clipContext("abc", 4, "head"), "abc");
});

test("the edit request holds the selection, the text around it and the instruction", async () => {
  const m = await model();
  const withSelection = m.buildEditRequest({ instruction: "  shorten it ", selection: "long sentence", before: "A\n", after: "\nB", documentName: "n.md" });
  assert.match(withSelection, /<selected_text>\nlong sentence\n<\/selected_text>/);
  assert.match(withSelection, /<document_before>\nA\n\n<\/document_before>/);
  assert.match(withSelection, /Instruction: shorten it$/);
  const empty = m.buildEditRequest({ instruction: "write a title", selection: "", before: "", after: "", documentName: "" });
  assert.match(empty, /Nothing is selected/);
  assert.match(empty, /Document: Untitled/);
});

test("the replacement is read from the tags, also while the answer is still arriving", async () => {
  const m = await model();
  assert.equal(m.extractReplacement("<replacement>\nHello\nWorld\n</replacement>"), "Hello\nWorld");
  assert.equal(m.extractReplacement("Sure!\n<replacement>New text</replacement>\nDone."), "New text");
  assert.equal(m.extractReplacement("<replacement>Partial te"), "Partial te", "an unfinished answer shows what has arrived");
  assert.equal(m.extractReplacement("```md\n# Title\n```"), "# Title", "an answer without tags loses a wrapping code fence");
  assert.equal(m.extractReplacement("  plain  "), "plain");
  assert.equal(m.extractReplacement("<replacement>  keep indent</replacement>"), "  keep indent");
});

test("the chat gets the document and the selection, and a conversation that starts with the user", async () => {
  const m = await model();
  const system = m.buildChatSystem({ documentName: "a.md", documentText: "# A", selection: "sel" });
  assert.match(system, /<document>\n# A\n<\/document>/);
  assert.match(system, /<selection>\nsel\n<\/selection>/);
  assert.doesNotMatch(m.buildChatSystem({ documentName: "", documentText: "x", selection: "" }), /<selection>/);
  const turns = [{ role: "assistant", text: "hi" }, { role: "user", text: "q" }, { role: "assistant", text: "  " }, { role: "assistant", text: "a" }];
  assert.deepEqual(m.toApiMessages(turns), [{ role: "user", content: "q" }, { role: "assistant", content: "a" }]);
  const many = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i}` }));
  const api = m.toApiMessages(many);
  assert.ok(api.length <= m.CHAT_MAX_TURNS);
  assert.equal(api[0].role, "user");
});

test("the line diff marks removed, added and unchanged lines", async () => {
  const m = await model();
  const diff = m.lineDiff("a\nb\nc", "a\nB\nc\nd");
  assert.deepEqual(diff.map(l => `${l.kind}:${l.text}`), ["same:a", "del:b", "add:B", "same:c", "add:d"]);
  assert.equal(m.hasChanges(diff), true);
  assert.equal(m.hasChanges(m.lineDiff("x\ny", "x\ny")), false);
  assert.deepEqual(m.lineDiff("", "new").map(l => l.kind), ["add"]);
  assert.deepEqual(m.lineDiff("old", "").map(l => l.kind), ["del"]);
});

test("an answer is split into prose and code blocks, also while it is still being written", async () => {
  const m = await model();
  const parts = m.splitCodeBlocks("Here you go:\n\n```md\n# Title\n\ntext\n```\n\nHope it helps.");
  assert.deepEqual(parts, [
    { kind: "text", text: "Here you go:" },
    { kind: "code", text: "# Title\n\ntext", language: "md" },
    { kind: "text", text: "Hope it helps." },
  ]);
  assert.deepEqual(m.splitCodeBlocks("Start\n```\nunfinished"), [{ kind: "text", text: "Start" }, { kind: "code", text: "unfinished", language: "" }]);
  assert.deepEqual(m.splitCodeBlocks("just prose"), [{ kind: "text", text: "just prose" }]);
  assert.deepEqual(m.splitCodeBlocks(""), []);
});
