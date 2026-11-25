/** A window that looks into a SQLite database file: its tables and views on the left, the rows of the chosen one (or of a query written here) on the right, a page at a time. Read only: the host opens the file read only and refuses anything that writes. */
import { invoke } from "@tauri-apps/api/core";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

interface TableInfo { name: string; kind: "table" | "view"; rows: number | null }
interface QueryResult { columns: string[]; rows: (string | null)[][]; more: boolean }

const PAGE_ROWS = 100;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

/** The statement that shows a whole table or view. */
const selectAll = (name: string): string => `SELECT * FROM "${name.replace(/"/g, '""')}"`;

function grid(result: QueryResult): HTMLTableElement {
  const table = el("table", "sqlite-grid");
  const head = el("thead"), headRow = el("tr");
  for (const name of result.columns) headRow.append(el("th", "", name));
  head.append(headRow);
  const body = el("tbody");
  for (const row of result.rows) {
    const line = el("tr");
    for (const value of row) {
      const cell = el("td", value === null ? "sqlite-null" : "", value ?? "NULL");
      if (value !== null && value.length > 80) cell.title = value.slice(0, 600);
      line.append(cell);
    }
    body.append(line);
  }
  table.append(head, body);
  return table;
}

/** Opens the database file `path` in its window. */
export async function openSqliteFile(path: string): Promise<void> {
  const dialog = el("dialog", "sqlite-dialog"); dialog.setAttribute("aria-label", basename(path));
  const content = el("div", "dialog-content sqlite-content");
  const title = el("div", "dialog-title", basename(path)); title.title = path;
  const side = el("div", "sqlite-tables"); side.setAttribute("role", "list");
  const sql = el("textarea", "sqlite-sql"); sql.rows = 2; sql.spellcheck = false; sql.setAttribute("aria-label", langText("Zapytanie SQL (tylko odczyt)", "SQL query (read only)"));
  const run = el("button", "primary", langText("Uruchom", "Run")); run.type = "button"; run.title = "Ctrl+Enter";
  const previous = el("button", "git-small-btn", langText("Wstecz", "Previous")); previous.type = "button";
  const next = el("button", "git-small-btn", langText("Dalej", "Next")); next.type = "button";
  const status = el("span", "sqlite-status");
  const bar = el("div", "sqlite-bar"); bar.append(run, previous, next, status);
  const results = el("div", "sqlite-results");
  const main = el("div", "sqlite-main"); main.append(sql, bar, results);
  const body = el("div", "sqlite-body"); body.append(side, main);
  const close = el("button", "", langText("Zamknij", "Close")); close.type = "button";
  const actions = el("div", "dialog-actions"); actions.append(close);
  content.append(title, body, actions); dialog.append(content); document.body.append(dialog);

  let offset = 0, shown = "";
  const show = async (statement: string, from: number): Promise<void> => {
    status.textContent = langText("Czytanie…", "Reading…"); status.classList.remove("sqlite-error");
    try {
      const result = await invoke<QueryResult>("sqlite_query", { path, sql: statement, offset: from, limit: PAGE_ROWS });
      shown = statement; offset = from;
      results.replaceChildren(result.columns.length ? grid(result) : el("p", "sqlite-empty", langText("Zapytanie nie zwróciło kolumn.", "The query returned no columns.")));
      results.scrollTop = 0;
      status.textContent = result.rows.length ? langText(`Wiersze ${from + 1}–${from + result.rows.length}`, `Rows ${from + 1}–${from + result.rows.length}`) : langText("Brak wierszy", "No rows");
      previous.disabled = from === 0; next.disabled = !result.more;
    } catch (error) {
      status.textContent = String(error); status.classList.add("sqlite-error");
    }
  };
  const runQuery = (): void => { const text = sql.value.trim(); if (text) void show(text, 0); };

  run.addEventListener("click", runQuery);
  sql.addEventListener("keydown", event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); runQuery(); } });
  previous.addEventListener("click", () => void show(shown, Math.max(0, offset - PAGE_ROWS)));
  next.addEventListener("click", () => void show(shown, offset + PAGE_ROWS));
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());

  let tables: TableInfo[];
  try { tables = await invoke<TableInfo[]>("sqlite_tables", { path }); }
  catch (error) { dialog.remove(); showToast(`${langText("Nie udało się otworzyć bazy danych", "Could not open the database")}: ${String(error)}`); return; }
  for (const table of tables) {
    const row = el("button", "sqlite-table"); row.type = "button"; row.setAttribute("role", "listitem");
    row.append(el("span", "sqlite-table-name", table.name), el("span", "sqlite-table-count", table.kind === "view" ? langText("widok", "view") : table.rows === null ? "" : String(table.rows)));
    row.addEventListener("click", () => {
      side.querySelectorAll(".sqlite-table.selected").forEach(other => other.classList.remove("selected")); row.classList.add("selected");
      sql.value = selectAll(table.name); void show(sql.value, 0);
    });
    side.append(row);
  }
  if (!tables.length) side.append(el("p", "sqlite-empty", langText("Baza nie ma tabel.", "The database has no tables.")));
  dialog.showModal();
  (side.querySelector(".sqlite-table") as HTMLButtonElement | null)?.click();
  if (!tables.length) sql.focus();
}
