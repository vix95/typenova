/** The Profile tab: totals and one card per column with its type, statistics and distribution. */
import { langText } from "../i18n/language";
import { ICONS } from "../ui/icons";
import type { ColumnProfile } from "./column-stats";
import type { DataProfile } from "./data-profile";
import { compact } from "./chart-svg";
import { el, fmtInt, fmtPercent, typeLabel } from "./data-view-dom";
import { formatNumber } from "./value-parse";

/** A small bar distribution as SVG; the bars follow the theme through CSS classes. */
function miniBars(counts: readonly number[], labels: readonly string[]): SVGElement {
  const width = 240, height = 48, peak = Math.max(...counts, 1), slot = width / counts.length;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "data-mini");
  svg.setAttribute("aria-hidden", "true");
  counts.forEach((count, index) => {
    const barHeight = count ? Math.max(2, (count / peak) * (height - 2)) : 0;
    const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bar.setAttribute("class", "dv-bar");
    bar.setAttribute("x", String(index * slot + 0.5)); bar.setAttribute("y", String(height - barHeight));
    bar.setAttribute("width", String(Math.max(1, slot - 1.5))); bar.setAttribute("height", String(barHeight));
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${labels[index]}: ${fmtInt(count)}`;
    bar.append(title); svg.append(bar);
  });
  return svg;
}

const stat = (label: string, value: string): HTMLElement => { const row = el("div", "data-stat"); row.append(el("span", "", label), el("b", "", value)); return row; };

function numberDetails(column: ColumnProfile, card: HTMLElement): void {
  const summary = column.number!;
  const { histogram } = summary;
  const step = (histogram.to - histogram.from) / histogram.counts.length;
  card.append(miniBars(histogram.counts, histogram.counts.map((_, index) => `${compact(histogram.from + step * index)} – ${compact(histogram.from + step * (index + 1))}`)));
  const grid = el("div", "data-stats");
  grid.append(
    stat("min", formatNumber(summary.min)), stat(langText("mediana", "median"), formatNumber(summary.median)),
    stat(langText("średnia", "mean"), formatNumber(summary.mean)), stat("max", formatNumber(summary.max)),
    stat("Q1 – Q3", `${formatNumber(summary.q1)} – ${formatNumber(summary.q3)}`), stat(langText("odch. std.", "std. dev."), formatNumber(summary.std)),
  );
  card.append(grid);
  if (summary.sampled) card.append(el("p", "data-note", langText("Mediana, kwartyle i histogram z próbki 20 000 wartości.", "Median, quartiles and histogram come from a sample of 20,000 values.")));
}

function categoryDetails(column: ColumnProfile, card: HTMLElement): void {
  if (!column.top.length) {
    card.append(el("p", "data-note", langText(`Ponad ${fmtInt(column.distinct)} różnych wartości.`, `More than ${fmtInt(column.distinct)} distinct values.`)));
    return;
  }
  const peak = column.top[0].count, list = el("div", "data-top");
  for (const item of column.top.slice(0, 6)) {
    const row = el("div", "data-top-row");
    const bar = el("span", "data-top-bar"); bar.style.width = `${Math.max(2, (item.count / peak) * 100)}%`;
    const label = el("span", "data-top-label", item.value || langText("(pusta)", "(empty)")); label.title = item.value;
    row.append(label, bar, el("span", "data-top-count", fmtInt(item.count)));
    list.append(row);
  }
  card.append(list);
}

function dateDetails(column: ColumnProfile, card: HTMLElement): void {
  const summary = column.date!;
  const counts = summary.buckets.map(bucket => bucket.count);
  if (counts.length > 1) card.append(miniBars(counts, summary.buckets.map(bucket => bucket.label)));
  const grid = el("div", "data-stats");
  grid.append(stat(langText("od", "from"), summary.min), stat(langText("do", "to"), summary.max));
  card.append(grid);
}

function card(column: ColumnProfile, rows: number, onChart: ((column: ColumnProfile) => void) | null): HTMLElement {
  const box = el("article", "data-card");
  const head = el("div", "data-card-head");
  const name = el("b", "data-card-name", column.name); name.title = column.name;
  head.append(name, el("span", `data-type is-${column.type}`, typeLabel(column.type)));
  if (onChart && column.type !== "empty") {
    const chart = el("button", "data-tool");
    chart.type = "button"; chart.innerHTML = ICONS.chartBar;
    const label = langText(`Narysuj wykres kolumny „${column.name}”`, `Draw a chart of the column “${column.name}”`);
    chart.dataset.tooltip = label; chart.setAttribute("aria-label", label);
    chart.addEventListener("click", () => onChart(column));
    head.append(chart);
  }
  box.append(head);
  if (column.number) numberDetails(column, box);
  else if (column.date) dateDetails(column, box);
  else if (column.type !== "empty") categoryDetails(column, box);
  const facts = el("div", "data-facts");
  facts.append(
    el("span", "", langText(`brakujące: ${fmtInt(column.missing)} (${fmtPercent(column.missing, rows)})`, `missing: ${fmtInt(column.missing)} (${fmtPercent(column.missing, rows)})`)),
    el("span", "", langText(`unikalne: ${column.distinctExact ? "" : "> "}${fmtInt(column.distinct)}`, `distinct: ${column.distinctExact ? "" : "> "}${fmtInt(column.distinct)}`)),
  );
  if (column.mismatched) facts.append(el("span", "is-warning", langText(`niepasujące do typu: ${fmtInt(column.mismatched)}`, `not fitting the type: ${fmtInt(column.mismatched)}`)));
  box.append(facts);
  return box;
}

function tiles(profile: DataProfile): HTMLElement {
  const cells = profile.rows * profile.columns.length, missing = profile.columns.reduce((sum, column) => sum + column.missing, 0);
  const wrap = el("div", "data-tiles");
  const tile = (value: string, label: string) => { const node = el("div", "data-tile"); node.append(el("b", "", value), el("span", "", label)); wrap.append(node); };
  tile(fmtInt(profile.rows), langText("wierszy", "rows"));
  tile(fmtInt(profile.columns.length + profile.skippedColumns), langText("kolumn", "columns"));
  tile(fmtPercent(missing, cells), langText("brakujących wartości", "missing values"));
  tile(fmtInt(profile.ragged), langText("wierszy o innej liczbie kolumn", "rows with another number of columns"));
  return wrap;
}

/** `onChart` adds a button to each card that opens a chart of the column; null leaves the buttons out (the Preview pane has none). */
/** One line of figures for a column (used under its chart in the Preview pane): the range and typical values of a number, the missing cells, the distinct values. */
export function statsLine(column: ColumnProfile, rows: number): string {
  const parts: string[] = [];
  const number = column.number;
  if (number) parts.push(`min ${formatNumber(number.min)}`, `${langText("mediana", "median")} ${formatNumber(number.median)}`, `${langText("średnia", "mean")} ${formatNumber(number.mean)}`, `max ${formatNumber(number.max)}`);
  else if (column.date) parts.push(`${column.date.min} → ${column.date.max}`);
  parts.push(langText(`brakujące: ${fmtInt(column.missing)} (${fmtPercent(column.missing, rows)})`, `missing: ${fmtInt(column.missing)} (${fmtPercent(column.missing, rows)})`));
  if (!number && !column.date) parts.push(langText(`unikalne: ${column.distinctExact ? "" : "> "}${fmtInt(column.distinct)}`, `distinct: ${column.distinctExact ? "" : "> "}${fmtInt(column.distinct)}`));
  return parts.join(" · ");
}

/** `filter` limits the cards to some columns (the Preview pane shows a chart for the others). */
export function buildProfile(profile: DataProfile, onChart: ((column: ColumnProfile) => void) | null, filter: (column: ColumnProfile) => boolean = () => true): HTMLElement {
  const panel = el("div", "data-panel-body");
  panel.append(tiles(profile));
  if (!profile.hasHeader) panel.append(el("p", "data-note", langText("Plik nie ma nagłówka; kolumny są ponumerowane.", "The file has no header row; the columns are numbered.")));
  if (profile.skippedColumns) panel.append(el("p", "data-note", langText(`Przeanalizowano pierwsze ${profile.columns.length} kolumn; pominięto ${fmtInt(profile.skippedColumns)}.`, `The first ${profile.columns.length} columns were analysed; ${fmtInt(profile.skippedColumns)} were left out.`)));
  const grid = el("div", "data-cards");
  for (const column of profile.columns) if (filter(column)) grid.append(card(column, profile.rows, onChart));
  if (grid.childElementCount) panel.append(grid);
  return panel;
}
