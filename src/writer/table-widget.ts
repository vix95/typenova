/** A table of the Writer mode that is edited in place: drawn as a table (cells with their Markdown formatting), and a cell that has the focus shows its Markdown to be typed in. Every change is written back into the document as the Markdown of the whole table. Rows and columns are added and removed in the table that is on screen (it is not drawn again), so that the focus stays where it is. */
import { EditorView, WidgetType } from "@codemirror/view";
import type MarkdownIt from "markdown-it";
import { langText } from "../i18n/language";
import { createMarkdownRenderer } from "../preview/markdown-renderer";
import { ICONS } from "../ui/icons";
import { addColumn, addRow, parseTable, removeColumn, removeRow, setCell, tableToMarkdown, type TableModel } from "./table-model";

let renderer: MarkdownIt | null = null;
/** The inline Markdown of a cell as HTML (bold, code, links, formulas); raw HTML is never let through. */
const inlineHtml = (markdown: string): string => (renderer ??= createMarkdownRenderer()).renderInline(markdown);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; return node;
};

/**
 * Which table on screen shows which Markdown. Writing a change into the document makes the editor build a new widget for the new text; it keeps the table that is
 * on screen (and the focus in it) when that widget stands for the same table, and that is known by the Markdown the table has shown: this lists it.
 */
const showing = new Map<string, EditableTableWidget>();

/** Where a cell is: a body row (-1 is the header) and a column. */
interface Place { row: number; column: number }

const placeOf = (cell: HTMLTableCellElement): Place => ({ row: (cell.parentElement as HTMLTableRowElement).rowIndex - 1, column: cell.cellIndex });

export class EditableTableWidget extends WidgetType {
  /** The Markdown this table has shown, to be found in `showing`. */
  private readonly shown = new Set<string>();
  private current: string;
  private model: TableModel | null;
  private host: HTMLElement | null = null;
  private table: HTMLTableElement | null = null;
  private view: EditorView | null = null;
  private place: Place = { row: 0, column: 0 };

  constructor(private readonly source: string) {
    super();
    this.current = source;
    this.model = parseTable(source);
  }

  /** The same table: it has the same Markdown, or it is the table on screen that has shown both texts (one of them was typed into it). */
  eq(other: WidgetType): boolean {
    if (!(other instanceof EditableTableWidget)) return false;
    if (other.source === this.source) return true;
    const mine = showing.get(this.source);
    return !!mine && mine === showing.get(other.source);
  }

  private claim(markdown: string): void { this.shown.add(markdown); showing.set(markdown, this); }

  get estimatedHeight(): number { return (this.model ? this.model.rows.length + 1 : 3) * 34 + 40; }
  /** The cells take the keyboard and the mouse: the editor does not handle what happens inside the table. */
  ignoreEvent(): boolean { return true; }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    this.claim(this.source);
    const host = el("div", "cm-writer-table cm-writer-table-edit");
    this.host = host;
    const wrap = el("div", "cm-writer-table-scroll");
    const model = this.model;
    if (model) {
      const table = el("table");
      this.table = table;
      const head = el("thead"), headRow = el("tr");
      model.header.forEach((cell, column) => headRow.append(this.cell("th", cell, model.align[column])));
      head.append(headRow);
      const body = el("tbody");
      for (const cells of model.rows) body.append(this.row(cells, model));
      table.append(head, body);
      wrap.append(table);
    } else wrap.textContent = this.source;
    host.append(wrap, this.toolbar());
    return host;
  }

  destroy(): void {
    for (const markdown of this.shown) if (showing.get(markdown) === this) showing.delete(markdown);
    this.shown.clear();
    this.host = null; this.table = null; this.view = null;
  }

  private row(cells: readonly string[], model: TableModel): HTMLTableRowElement {
    const tr = el("tr");
    cells.forEach((cell, column) => tr.append(this.cell("td", cell, model.align[column])));
    return tr;
  }

  private cell(tag: "th" | "td", markdown: string, align: string): HTMLTableCellElement {
    const cell = el(tag);
    cell.contentEditable = "true"; cell.spellcheck = true; cell.dataset.markdown = markdown;
    if (align !== "none") cell.style.textAlign = align;
    cell.innerHTML = inlineHtml(markdown);
    // The cell shows its Markdown while it is typed in, and the formatting again when it is left.
    cell.addEventListener("focus", () => { this.place = placeOf(cell); cell.textContent = cell.dataset.markdown ?? ""; });
    cell.addEventListener("blur", () => { cell.innerHTML = inlineHtml(cell.dataset.markdown ?? ""); });
    cell.addEventListener("input", () => {
      const value = (cell.textContent ?? "").replace(/\n/g, " ");
      cell.dataset.markdown = value;
      const { row, column } = placeOf(cell);
      this.change(model => setCell(model, row, column, value));
    });
    cell.addEventListener("keydown", event => this.key(event, cell));
    cell.addEventListener("paste", event => {
      // Only text goes into a cell, as one line.
      event.preventDefault();
      document.execCommand("insertText", false, (event.clipboardData?.getData("text/plain") ?? "").replace(/\s*\n\s*/g, " "));
    });
    return cell;
  }

  private focusCell(row: number, column: number): void {
    const target = this.table?.rows[row + 1]?.cells[column];
    if (!target) return;
    target.focus();
  }

  private key(event: KeyboardEvent, cell: HTMLTableCellElement): void {
    const model = this.model;
    if (!model || event.ctrlKey || event.metaKey || event.altKey) return;
    const { row, column } = placeOf(cell);
    const last = model.header.length - 1;
    if (event.key === "Tab") {
      event.preventDefault();
      const next = event.shiftKey ? { row: column === 0 ? row - 1 : row, column: column === 0 ? last : column - 1 } : { row: column === last ? row + 1 : row, column: column === last ? 0 : column + 1 };
      if (next.row < -1) return;
      if (next.row >= model.rows.length) this.insertRow(model.rows.length - 1);
      this.focusCell(next.row, next.column);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (row + 1 >= model.rows.length) { if (event.shiftKey) return; this.insertRow(model.rows.length - 1); }
      this.focusCell(row + 1, column);
    } else if (event.key === "Escape") { cell.blur(); this.view?.focus(); }
  }

  /** Applies `edit` to the table and writes the Markdown of the result into the document, in the place of the block. */
  private change(edit: (model: TableModel) => TableModel): void {
    const view = this.view, host = this.host;
    if (!view || !host || !this.model) return;
    const next = edit(this.model);
    const markdown = tableToMarkdown(next);
    const from = view.posAtDOM(host);
    this.claim(markdown);
    this.model = next;
    view.dispatch({ changes: { from, to: from + this.current.length, insert: markdown }, userEvent: "input.table" });
    this.current = markdown;
  }

  /** A row of empty cells after body row `row` (-1: at the top of the body). */
  private insertRow(row: number): void {
    const body = this.table?.tBodies[0];
    if (!body || !this.model) return;
    this.change(model => addRow(model, row));
    body.insertBefore(this.row(this.model.rows[row + 1], this.model), body.rows[row + 1] ?? null);
  }

  private insertColumn(column: number): void {
    const table = this.table;
    if (!table || !this.model) return;
    this.change(model => addColumn(model, column));
    for (const tr of Array.from(table.rows)) tr.insertBefore(this.cell(tr.parentElement?.tagName === "THEAD" ? "th" : "td", "", "none"), tr.cells[column + 1] ?? null);
  }

  /** Moves the focus off a part that is about to go, to the cell nearby. */
  private leave(row: number, column: number): void { this.focusCell(Math.max(-1, row), column); }

  private deleteRow(row: number): void {
    const table = this.table;
    if (!table || !this.model || row < 0) return;
    const wasHere = table.contains(document.activeElement) && placeOf(document.activeElement as HTMLTableCellElement).row === row;
    const column = this.place.column;
    this.change(model => removeRow(model, row));
    table.rows[row + 1]?.remove();
    if (wasHere) this.leave(Math.min(row, this.model.rows.length - 1), column);
  }

  private deleteColumn(column: number): void {
    const table = this.table;
    if (!table || !this.model || this.model.header.length < 2) return;
    const active = document.activeElement;
    const focused = table.contains(active) ? placeOf(active as HTMLTableCellElement) : null;
    this.change(model => removeColumn(model, column));
    for (const tr of Array.from(table.rows)) tr.cells[column]?.remove();
    if (focused && focused.column === column) this.leave(focused.row, Math.min(column, this.model.header.length - 1));
  }

  /** The cell the buttons act on: the one with the focus, else the last one that had it. */
  private here(): Place {
    const active = document.activeElement;
    return this.table?.contains(active) && (active instanceof HTMLTableCellElement) ? placeOf(active) : this.place;
  }

  private toolbar(): HTMLElement {
    const bar = el("div", "cm-writer-table-tools");
    const button = (icon: string, label: string, run: () => void): void => {
      const node = el("button"); node.type = "button"; node.innerHTML = icon; node.dataset.tooltip = label; node.setAttribute("aria-label", label);
      node.addEventListener("mousedown", event => event.preventDefault());
      node.addEventListener("click", run);
      bar.append(node);
    };
    const rowLabel = langText("wiersz", "row"), columnLabel = langText("kolumnę", "column");
    button(`${ICONS.plus}<span>${rowLabel}</span>`, langText("Dodaj wiersz pod bieżącym", "Add a row below the current one"), () => this.insertRow(this.here().row));
    button(`${ICONS.plus}<span>${columnLabel}</span>`, langText("Dodaj kolumnę po prawej od bieżącej", "Add a column right of the current one"), () => this.insertColumn(this.here().column));
    button(`${ICONS.minus}<span>${rowLabel}</span>`, langText("Usuń bieżący wiersz", "Delete the current row"), () => this.deleteRow(this.here().row));
    button(`${ICONS.minus}<span>${columnLabel}</span>`, langText("Usuń bieżącą kolumnę", "Delete the current column"), () => this.deleteColumn(this.here().column));
    button(ICONS.edit, langText("Edytuj jako Markdown", "Edit as Markdown"), () => {
      const view = this.view, host = this.host;
      if (!view || !host) return;
      view.dispatch({ selection: { anchor: view.posAtDOM(host) } });
      view.focus();
    });
    return bar;
  }
}
