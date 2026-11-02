import test from "node:test";
import assert from "node:assert/strict";

test("text history undoes and redoes, merging fast typing into one step", async () => {
  const { createTextHistory } = await import("../.test-build/editor/text-history.js");
  const history = createTextHistory("a", 300, 700);
  history.record("ab", true, 1000);
  history.record("abc", true, 1200); // merged with the previous typing step
  assert.equal(history.undo(), "a");
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), "abc");
  history.record("abcd", false, 5000);
  assert.equal(history.undo(), "abc");
  history.record("x", false, 6000); // a new change drops what could have been redone
  assert.equal(history.canRedo(), false);
  assert.equal(history.undo(), "abc");
  const limited = createTextHistory("0", 3, 0);
  for (let step = 1; step <= 6; step++) limited.record(String(step), false, step);
  let reached = "6";
  for (let value = limited.undo(); value !== null; value = limited.undo()) reached = value;
  assert.equal(reached, "4"); // only the last three values (4, 5, 6) are kept
});

test("clicked labels are matched to their line and lines move, duplicate and delete with their block", async () => {
  const le = await import("../.test-build/editor/line-edit.js");
  const pie = ["pie showData", "  title Czas", '  "Praca" : 8', '  "Sen" : 7'];
  const found = le.matchLines(pie, "Praca [8]");
  assert.deepEqual([found.indices, found.found], [[2], "Praca"]);
  assert.equal(le.matchLines(pie, "Nie ma"), null);
  const repeated = ["sequenceDiagram", "  participant U as Anna", "  U->>S: Anna pyta", "  S-->>U: odpowiedź"];
  assert.deepEqual(le.matchLines(repeated, "Anna", 1).indices, [1, 2]);
  assert.equal(le.matchLines(repeated, "Anna", 1).current, 1);
  assert.equal(le.replaceInLine("  A->>B: Hej", "Hej", "Cześć"), "  A->>B: Cześć");

  const klass = ["classDiagram", "  class A {", "    +x", "  }", "  A <|-- B"];
  assert.deepEqual(le.blockRange(klass, 1, "class"), [1, 3]);
  assert.deepEqual(le.deleteRange(klass, [1, 3]), ["classDiagram", "  A <|-- B"]);
  const seq = ["sequenceDiagram", "  loop Co minutę", "    A->>B: Ping", "    alt ok", "      B-->>A: tak", "    end", "  end", "  A->>B: Koniec"];
  assert.deepEqual(le.blockRange(seq, 1, "sequence"), [1, 6]);
  assert.deepEqual(le.blockRange(seq, 3, "sequence"), [3, 5]);
  const mind = ["mindmap", "  root", "    A", "      A1", "    B"];
  assert.deepEqual(le.blockRange(mind, 2, "mindmap"), [2, 3]);
  assert.deepEqual(le.duplicateRange(mind, [4, 4]).slice(-2), ["    B", "    B"]);
  const down = le.moveRange(mind, [2, 3], 1);
  assert.deepEqual([down.lines.slice(2), down.start], [["    B", "    A", "      A1"], 3]);
  assert.equal(le.moveRange(mind, [1, 1], -1), null);
  assert.equal(le.moveRange(mind, [4, 4], 1), null);
});
