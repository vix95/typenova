import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../.test-build/writer/writer-model.js");

test("the syntax of an element is shown while the selection touches it, edges included", async () => {
  const { touches } = await model();
  assert.equal(touches([{ from: 5, to: 5 }], 5, 10), true, "caret at the start");
  assert.equal(touches([{ from: 10, to: 10 }], 5, 10), true, "caret at the end");
  assert.equal(touches([{ from: 11, to: 11 }], 5, 10), false);
  assert.equal(touches([{ from: 0, to: 20 }], 5, 10), true, "a selection around it");
  assert.equal(touches([{ from: 0, to: 1 }, { from: 6, to: 6 }], 5, 10), true, "any of several selections");
  assert.equal(touches([], 5, 10), false);
});

test("task markers flip between open and done", async () => {
  const { toggledTask, isTaskDone } = await model();
  assert.equal(toggledTask("[ ]"), "[x]");
  assert.equal(toggledTask("[x]"), "[ ]");
  assert.equal(toggledTask("[X]"), "[ ]");
  assert.equal(toggledTask("[-]"), null);
  assert.deepEqual([isTaskDone("[x]"), isTaskDone("[ ]")], [true, false]);
});

test("a code block is labelled with the first word of its info string", async () => {
  const { languageLabel } = await model();
  assert.equal(languageLabel("js title=x"), "js");
  assert.equal(languageLabel("  python "), "python");
  assert.equal(languageLabel(""), "");
});

test("links are told apart: web, file, anchor", async () => {
  const { classifyLink } = await model();
  assert.deepEqual(classifyLink("https://example.com/a"), { kind: "external", url: "https://example.com/a" });
  assert.deepEqual(classifyLink("mailto:a@b.c"), { kind: "external", url: "mailto:a@b.c" });
  assert.deepEqual(classifyLink("notes/a%20b.md#part"), { kind: "file", path: "notes/a b.md" });
  assert.deepEqual(classifyLink("<../x.md>"), { kind: "file", path: "../x.md" });
  assert.deepEqual(classifyLink("#intro"), { kind: "anchor", id: "intro" });
  assert.deepEqual(classifyLink("C:\\docs\\x.md"), { kind: "file", path: "C:\\docs\\x.md" });
  assert.deepEqual(classifyLink("javascript:alert(1)"), { kind: "none" });
  assert.deepEqual(classifyLink(""), { kind: "none" });
});

import { inlineMath, mathBlock } from "../.test-build/writer/writer-model.js";

test("a display formula paragraph gives its TeX, anything else gives null", () => {
  assert.equal(mathBlock("$$\n\\frac13\n$$"), "\\frac13");
  assert.equal(mathBlock("$$ x^2 $$"), "x^2");
  assert.equal(mathBlock("text $$x$$"), null);
  assert.equal(mathBlock("$$a$$ and $$b$$"), null);
  assert.equal(mathBlock("$$$$"), null);
});

test("inline formulas follow the rules of the preview", () => {
  assert.deepEqual(inlineMath("Euler: $e^{i\\pi}+1=0$ done").map(item => item.latex), ["e^{i\\pi}+1=0"]);
  assert.deepEqual(inlineMath("costs $5 and $6").map(item => item.latex), []);
  assert.deepEqual(inlineMath("a $ b $ c"), []);
  assert.deepEqual(inlineMath("escaped \\$x\\$ here"), []);
  const [first, second] = inlineMath("$a$ then $$b$$");
  assert.deepEqual([first.latex, first.display, second.latex, second.display], ["a", false, "b", true]);
});
