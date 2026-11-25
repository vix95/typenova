import test from "node:test";
import assert from "node:assert/strict";
import { addColumn, addRow, parseTable, removeColumn, removeRow, setCell, splitRow, tableToMarkdown } from "../.test-build/writer/table-model.js";

const SAMPLE = "| Rodzaj | Prompt | Muzyka |\n| --- | :---: | ---: |\n| A | long text, with commas | One |\n| B | x \\| y | Two |";

test("a row is split into cells; escaped pipes stay in their cell", () => {
  assert.deepEqual(splitRow("| a | b | c |"), ["a", "b", "c"]);
  assert.deepEqual(splitRow("a|b"), ["a", "b"]);
  assert.deepEqual(splitRow("| x \\| y | z |"), ["x | y", "z"]);
  assert.deepEqual(splitRow("| a |  |"), ["a", ""]);
});

test("a table is read with its alignment and written back unchanged", () => {
  const model = parseTable(SAMPLE);
  assert.deepEqual(model.header, ["Rodzaj", "Prompt", "Muzyka"]);
  assert.deepEqual(model.align, ["none", "center", "right"]);
  assert.deepEqual(model.rows[1], ["B", "x | y", "Two"]);
  assert.equal(tableToMarkdown(model).replace(":---:", ":---:"), "| Rodzaj | Prompt | Muzyka |\n| --- | :---: | ---: |\n| A | long text, with commas | One |\n| B | x \\| y | Two |");
});

test("what is not a table is not read as one", () => {
  assert.equal(parseTable("just text"), null);
  assert.equal(parseTable("| a | b |\n| nope | nope |"), null);
});

test("a short row is filled up to the header", () => {
  const model = parseTable("| a | b | c |\n|---|---|---|\n| 1 |");
  assert.deepEqual(model.rows[0], ["1", "", ""]);
});

test("cells, rows and columns are changed", () => {
  let model = parseTable(SAMPLE);
  model = setCell(model, 0, 1, "new");
  assert.equal(model.rows[0][1], "new");
  model = setCell(model, -1, 0, "Kind");
  assert.equal(model.header[0], "Kind");
  model = addRow(model, 0);
  assert.deepEqual(model.rows.map(row => row[0]), ["A", "", "B"]);
  model = addRow(model, -1);
  assert.equal(model.rows[0][0], "");
  model = removeRow(model, 0);
  assert.equal(model.rows.length, 3);
  model = addColumn(model, 0);
  assert.deepEqual(model.header, ["Kind", "", "Prompt", "Muzyka"]);
  assert.deepEqual(model.align, ["none", "none", "center", "right"]);
  model = removeColumn(model, 1);
  assert.deepEqual(model.header, ["Kind", "Prompt", "Muzyka"]);
  assert.equal(removeColumn(parseTable("| a |\n|---|"), 0).header.length, 1, "a table keeps one column");
  assert.equal(removeRow(model, -1), model, "the header is not a row that can go");
});

test("a pipe typed in a cell is written escaped, and a line break is not written", () => {
  const model = setCell(parseTable("| a |\n|---|\n| 1 |"), 0, 0, "x | y\nz");
  assert.equal(tableToMarkdown(model), "| a |\n| --- |\n| x \\| y z |");
});
