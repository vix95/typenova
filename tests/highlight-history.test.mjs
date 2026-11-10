import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { history, isolateHistory, redo, undo } from "@codemirror/commands";

const load = () => import("../.test-build/editor/highlight-history.js");
const item = (id, from, to, extra = {}) => ({ id, path: "/a.md", from, to, text: "x".repeat(to - from), note: "", group: "", color: "yellow", created: 1, ...extra });

/** A state with the editor's history and the highlight history extension (without its view listener), and a way to run undo and redo on it. */
async function editor(doc = "hello highlighted world") {
  const m = await load();
  let state = EditorState.create({ doc, extensions: [history(), m.highlightHistory[0]] });
  const seen = [];
  const dispatch = tr => { seen.push(tr.effects.map(effect => (effect.is(m.highlightsAdded) ? "added" : effect.is(m.highlightsRemoved) ? "removed" : effect.is(m.highlightChanged) ? "changed" : "other"))); state = tr.state; };
  const run = command => command({ state, dispatch });
  const record = effect => dispatch(state.update({ effects: effect, annotations: [m.highlightApplied.of(true), isolateHistory.of("full")] }));
  return { m, run, record, seen, get state() { return state; }, edit: changes => dispatch(state.update({ changes })) };
}

test("marking a highlight is a history event: undo removes it, redo brings it back", async () => {
  const e = await editor();
  const h = item("h1", 6, 17);
  e.record(e.m.highlightsAdded.of([h]));
  e.seen.length = 0;
  assert.equal(e.run(undo), true, "there is something to undo");
  assert.deepEqual(e.seen, [["removed"]]);
  assert.equal(e.run(undo), false, "and nothing more");
  e.seen.length = 0;
  assert.equal(e.run(redo), true);
  assert.deepEqual(e.seen, [["added"]]);
});

test("unmarking is undone by adding the highlight back, with its note and group", async () => {
  const e = await editor();
  const h = item("h1", 6, 17, { note: "keep this", group: "g" });
  e.record(e.m.highlightsRemoved.of([h]));
  let added = null;
  undo({ state: e.state, dispatch: tr => { for (const effect of tr.effects) if (effect.is(e.m.highlightsAdded)) added = effect.value; } });
  assert.deepEqual(added, [h]);
});

test("an edit of a highlight is undone to what it was", async () => {
  const e = await editor();
  const before = item("h1", 6, 17), after = { ...before, color: "green", note: "n" };
  let captured = null;
  e.record(e.m.highlightChanged.of({ before, after }));
  const { state } = e;
  undo({ state, dispatch: tr => { for (const effect of tr.effects) if (effect.is(e.m.highlightChanged)) captured = effect.value; } });
  assert.deepEqual(captured, { before: after, after: before }, "undo applies the change the other way round");
});

test("each highlight action is its own event, apart from typing", async () => {
  const e = await editor("abc");
  e.edit({ from: 3, insert: "d" });
  e.record(e.m.highlightsAdded.of([item("h1", 0, 3)]));
  e.seen.length = 0;
  e.run(undo);
  assert.deepEqual(e.seen, [["removed"]], "the first Ctrl+Z takes back only the highlight");
  assert.equal(e.state.doc.toString(), "abcd", "the typing is still there");
  e.run(undo);
  assert.equal(e.state.doc.toString(), "abc", "the second one takes back the typing");
});

test("history order is kept: an edit made after a highlight is undone before the highlight", async () => {
  const e = await editor("0123456789");
  e.record(e.m.highlightsAdded.of([item("h1", 4, 8)]));
  e.edit({ from: 0, insert: "AB" });
  e.seen.length = 0;
  e.run(undo);
  assert.deepEqual(e.seen, [[]], "the first Ctrl+Z undoes the typing only");
  assert.equal(e.state.doc.toString(), "0123456789");
  e.run(undo);
  assert.deepEqual(e.seen[1], ["removed"], "the second one takes the highlight back");
});
