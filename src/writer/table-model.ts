/** A Markdown (GFM) table as data: read from its text, changed cell by cell, row by row, and written back. Pure, no DOM: the Writer mode draws it as a table whose cells can be edited, and writes every change back into the document through this. */

export type Align = "left" | "center" | "right" | "none";

export interface TableModel {
  /** The header cells; the number of columns. */
  header: string[];
  align: Align[];
  rows: string[][];
}

/** The cells of one line of a table: pipes at the ends are not cells, `\|` is a pipe inside a cell. */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
}

function alignOf(cell: string): Align {
  const text = cell.trim();
  const left = text.startsWith(":"), right = text.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : "none";
}

const sized = (cells: readonly string[], count: number): string[] => Array.from({ length: count }, (_, index) => cells[index] ?? "");

/** The table in `text` (a header, a delimiter row, and rows), or null when it is not one. */
export function parseTable(text: string): TableModel | null {
  const lines = text.split("\n").filter(line => line.trim() !== "");
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const delimiter = splitRow(lines[1]);
  if (!delimiter.length || !delimiter.every(cell => /^:?-+:?$/.test(cell.trim()))) return null;
  const columns = header.length;
  return { header, align: sized(delimiter, columns).map(cell => (cell ? alignOf(cell) : "none")), rows: lines.slice(2).map(line => sized(splitRow(line), columns)) };
}

const escapeCell = (cell: string): string => cell.replace(/\r?\n/g, " ").replace(/\\?\|/g, "\\|");
const delimiterCell = (align: Align): string => (align === "center" ? ":---:" : align === "right" ? "---:" : align === "left" ? ":---" : "---");
const line = (cells: readonly string[]): string => `| ${cells.map(escapeCell).join(" | ")} |`;

/** The table as Markdown, one line per row. */
export function tableToMarkdown(model: TableModel): string {
  return [line(model.header), line(model.align.map(delimiterCell)), ...model.rows.map(row => line(row))].join("\n");
}

export function setCell(model: TableModel, row: number, column: number, value: string): TableModel {
  if (row < 0) return { ...model, header: model.header.map((cell, index) => (index === column ? value : cell)) };
  return { ...model, rows: model.rows.map((cells, index) => (index === row ? cells.map((cell, at) => (at === column ? value : cell)) : cells)) };
}

/** A row of empty cells after row `row` (-1: after the header, so at the top of the body). */
export function addRow(model: TableModel, row: number): TableModel {
  const rows = model.rows.slice();
  rows.splice(row + 1, 0, model.header.map(() => ""));
  return { ...model, rows };
}

/** A body row is removed; the header stays (a table always has one). */
export function removeRow(model: TableModel, row: number): TableModel {
  return row < 0 ? model : { ...model, rows: model.rows.filter((_, index) => index !== row) };
}

/** An empty column after column `column`. */
export function addColumn(model: TableModel, column: number): TableModel {
  const put = <T,>(cells: readonly T[], value: T): T[] => { const next = cells.slice(); next.splice(column + 1, 0, value); return next; };
  return { header: put(model.header, ""), align: put(model.align, "none" as Align), rows: model.rows.map(cells => put(cells, "")) };
}

/** A column is removed; a table keeps at least one. */
export function removeColumn(model: TableModel, column: number): TableModel {
  if (model.header.length < 2) return model;
  const drop = <T,>(cells: readonly T[]): T[] => cells.filter((_, index) => index !== column);
  return { header: drop(model.header), align: drop(model.align), rows: model.rows.map(drop) };
}
