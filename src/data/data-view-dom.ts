/** Small DOM helpers shared by the parts of the data viewer, and the localized words of charts. */
import { langText } from "../i18n/language";
import { ICONS, type IconName } from "../ui/icons";
import type { ChartData } from "./chart-job";
import type { ChartTexts } from "./chart-svg";
import type { ColumnType } from "./column-stats";
import type { Sentence } from "./chart-wizard-model";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A flat icon button with a localized tooltip and accessible name (never a text character as the icon). */
export function iconButton(icon: IconName, label: string, onClick: () => void, className = "data-tool"): HTMLButtonElement {
  const button = el("button", className);
  button.type = "button";
  button.innerHTML = ICONS[icon];
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

/** An icon with a visible text label. */
export function labelButton(icon: IconName, label: string, tooltip: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", "data-tool data-tool-labelled");
  button.type = "button";
  button.insertAdjacentHTML("afterbegin", ICONS[icon]);
  button.append(el("span", "", label));
  button.dataset.tooltip = tooltip;
  button.setAttribute("aria-label", tooltip);
  button.addEventListener("click", onClick);
  return button;
}

export const fmtInt = (value: number): string => value.toLocaleString(langText("pl-PL", "en-US"));
export const fmtPercent = (part: number, whole: number): string => (whole ? `${(Math.round((part / whole) * 1000) / 10).toLocaleString(langText("pl-PL", "en-US"))}%` : "–");

export function typeLabel(type: ColumnType): string {
  switch (type) {
    case "number": return langText("liczba", "number");
    case "date": return langText("data", "date");
    case "boolean": return langText("tak/nie", "yes/no");
    case "category": return langText("kategoria", "category");
    case "text": return langText("tekst", "text");
    default: return langText("pusta", "empty");
  }
}

export const KIND_LABEL: Record<ChartData["kind"], () => string> = {
  bar: () => langText("słupkowy", "bar"),
  line: () => langText("liniowy", "line"),
  histogram: () => langText("histogram", "histogram"),
  scatter: () => langText("punktowy", "scatter"),
};

/** Words of chart drawings in the language of the interface: the text for “nothing to draw” and the description read by screen readers. */
export function chartTexts(): ChartTexts {
  return {
    empty: langText("Brak danych do narysowania wykresu.", "There is no data to draw this chart."),
    describe: data => langText(
      `Wykres ${KIND_LABEL[data.kind]()}: ${data.yLabel || data.xLabel} według ${data.xLabel}, ${fmtInt(data.rows)} wierszy`,
      `${KIND_LABEL[data.kind]()} chart: ${data.yLabel || data.xLabel} by ${data.xLabel}, ${fmtInt(data.rows)} rows`,
    ),
  };
}

/** The footnotes under a chart: what was left out and what comes from a sample. */
export function chartNotes(data: ChartData): string[] {
  const notes: string[] = [];
  if (data.skipped) notes.push(langText(`Pominięto ${fmtInt(data.skipped)} wierszy bez wartości lub z wartością innego rodzaju.`, `${fmtInt(data.skipped)} rows without a value, or with a value of another kind, were left out.`));
  if (data.hidden) notes.push(data.other
    ? langText(`Kategorie poza pierwszymi (${fmtInt(data.hidden)}) są zsumowane w słupku „…”.`, `The other ${fmtInt(data.hidden)} categories are summed in the “…” bar.`)
    : langText(`Pokazano najlepsze kategorie; pominięto ${fmtInt(data.hidden)}.`, `The top categories are shown; ${fmtInt(data.hidden)} are left out.`));
  if (data.sampled) notes.push(langText("Wykres powstał z próbki wierszy (rozkład jest przybliżony).", "The chart is drawn from a sample of the rows (the distribution is approximate)."));
  if (data.capped) notes.push(langText("Wartości jest zbyt wiele, by zliczyć wszystkie; późniejsze nowe wartości pominięto.", "There are too many distinct values to count them all; later new values were left out."));
  return notes;
}

/** The sentence that says what a chart shows ("Total “amount” for each “country”"), in the language of the interface. */
export function sentenceText(sentence: Sentence): string {
  switch (sentence.kind) {
    case "rows": return langText(`Liczba wierszy dla każdej wartości „${sentence.x}”`, `Number of rows for each “${sentence.x}”`);
    case "count-over": return langText(`Liczba wierszy w czasie („${sentence.x}”)`, `Number of rows over time (“${sentence.x}”)`);
    case "spread": return langText(`Rozkład wartości „${sentence.x}”`, `How “${sentence.x}” is distributed`);
    case "pair": return langText(`„${sentence.y}” względem „${sentence.x}”`, `“${sentence.y}” against “${sentence.x}”`);
    default: {
      const word = { sum: langText("Suma", "Total"), mean: langText("Średnia", "Average"), min: langText("Najmniejsza wartość", "Lowest value"), max: langText("Największa wartość", "Highest value") }[sentence.agg];
      return sentence.over
        ? langText(`${word}: „${sentence.y}” w czasie („${sentence.x}”)`, `${word}: “${sentence.y}” over time (“${sentence.x}”)`)
        : langText(`${word}: „${sentence.y}” dla każdej wartości „${sentence.x}”`, `${word}: “${sentence.y}” for each “${sentence.x}”`);
    }
  }
}
