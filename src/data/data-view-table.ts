/** The Table tab: the first rows of the file as they are in it (read only). */
import { langText } from "../i18n/language";
import type { DataProfile } from "./data-profile";
import { PREVIEW_ROWS } from "./data-profile";
import { el, fmtInt } from "./data-view-dom";

export function buildTable(profile: DataProfile): HTMLElement {
  const panel = el("div", "data-panel-body");
  const rows = profile.preview;
  const header = profile.hasHeader ? rows[0] : null;
  const body = profile.hasHeader ? rows.slice(1) : rows;
  const table = el("table", "data-table");
  const head = el("tr");
  head.append(el("th", "data-row-number", "#"));
  const names = profile.columns.map(column => column.name);
  names.forEach((name, index) => { const cell = el("th", "", header?.[index]?.trim() || name); cell.title = name; head.append(cell); });
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
  const tbody = el("tbody");
  const shown = Math.min(body.length, PREVIEW_ROWS);
  for (let index = 0; index < shown; index++) {
    const row = el("tr");
    row.append(el("td", "data-row-number", String(index + 1)));
    for (let column = 0; column < names.length; column++) {
      const value = body[index][column] ?? "";
      const cell = el("td", /^[+-]?\d/.test(value) && !Number.isNaN(Number(value.replace(",", "."))) ? "is-number" : "", value);
      if (value === "") cell.classList.add("is-empty");
      row.append(cell);
    }
    tbody.append(row);
  }
  table.append(tbody);
  const scroll = el("div", "data-table-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", langText("Pierwsze wiersze pliku", "First rows of the file"));
  scroll.append(table);
  panel.append(scroll, el("p", "data-note", profile.rows > shown
    ? langText(`Pokazano pierwsze ${fmtInt(shown)} z ${fmtInt(profile.rows)} wierszy. Podgląd jest tylko do odczytu; statystyki i wykresy obejmują cały plik.`, `The first ${fmtInt(shown)} of ${fmtInt(profile.rows)} rows are shown. The view is read only; statistics and charts cover the whole file.`)
    : langText(`${fmtInt(profile.rows)} wierszy. Podgląd jest tylko do odczytu.`, `${fmtInt(profile.rows)} rows. The view is read only.`)));
  return panel;
}
