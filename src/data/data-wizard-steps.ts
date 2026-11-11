/** The three steps of the chart wizard as DOM builders: choose a goal, complete a sentence, put the chart into a note. */
import { langText } from "../i18n/language";
import { ICONS, type IconName } from "../ui/icons";
import { showToast } from "../ui/toast";
import { copyTextToClipboard } from "../preview/code-blocks";
import { type Aggregate, type ChartKind, type ChartSpec, type DateStep } from "./chart-spec";
import { activeNote, chartBlockFor, noteTargets } from "./chart-embed";
import { columnsFor, defaultSpec, measures, sentenceOf, type KindFit } from "./chart-wizard-model";
import type { DataProfile } from "./data-profile";
import { el, labelButton, sentenceText } from "./data-view-dom";

/** What the steps need from the wizard that owns them. */
export interface WizardContext {
  profile: DataProfile;
  path: string;
  fits: KindFit[];
  spec: () => ChartSpec;
  /** Applies a change of one or two fields and redraws. */
  change: (next: Partial<ChartSpec>) => void;
  /** Takes a whole new spec (a different goal), moves to the next step and redraws. */
  choose: (next: ChartSpec) => void;
  insertIntoNote: (spec: ChartSpec, noteId?: string) => void;
}

const KIND_ICON: Record<ChartKind, IconName> = { bar: "chartBar", line: "chartLine", histogram: "chartHistogram", scatter: "chartScatter" };
const GOAL: Record<ChartKind, { title: () => string; example: () => string }> = {
  bar: { title: () => langText("Porównaj grupy", "Compare groups"), example: () => langText("np. sprzedaż w każdym kraju", "e.g. sales in each country") },
  line: { title: () => langText("Zobacz zmianę w czasie", "See change over time"), example: () => langText("np. przychód miesiąc po miesiącu", "e.g. revenue month by month") },
  histogram: { title: () => langText("Zobacz rozkład wartości", "See how values are spread"), example: () => langText("np. jakie kwoty zamówień są typowe", "e.g. which order amounts are typical") },
  scatter: { title: () => langText("Sprawdź zależność dwóch liczb", "Check how two numbers relate"), example: () => langText("np. cena a liczba sprzedanych sztuk", "e.g. price against units sold") },
};
const AGG_WORD: Record<Aggregate, () => string> = {
  count: () => langText("liczbę wierszy", "the number of rows"), sum: () => langText("sumę", "the total"), mean: () => langText("średnią", "the average"),
  min: () => langText("najmniejszą wartość", "the lowest value"), max: () => langText("największą wartość", "the highest value"),
};
const STEP_WORD: Record<DateStep, () => string> = { auto: () => langText("automatycznie", "automatically"), day: () => langText("dniach", "days"), month: () => langText("miesiącach", "months"), year: () => langText("latach", "years") };

function select<T extends string>(label: string, options: ReadonlyArray<{ value: T; label: string }>, value: T, onChange: (value: T) => void): HTMLSelectElement {
  const node = el("select", "data-select");
  node.setAttribute("aria-label", label);
  for (const option of options) { const item = el("option", "", option.label); item.value = option.value; node.append(item); }
  node.value = value;
  node.addEventListener("change", () => onChange(node.value as T));
  return node;
}

function numberInput(label: string, value: number, min: number, max: number, onChange: (value: number) => void): HTMLInputElement {
  const input = el("input", "data-number");
  input.type = "number"; input.min = String(min); input.max = String(max); input.value = String(value); input.setAttribute("aria-label", label);
  input.addEventListener("change", () => { const parsed = Math.round(Number(input.value)); if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed))); });
  return input;
}

const fitNote = (fit: KindFit): string => fit.fit === "good" ? langText("Polecany dla tego pliku", "Recommended for this file")
  : fit.fit === "missing" ? (fit.need === "two-numbers" ? langText("Potrzebne dwie kolumny z liczbami", "Needs two columns with numbers") : langText("Potrzebna kolumna z liczbami", "Needs a column with numbers"))
  : langText("Możliwy, choć nie najlepszy", "Possible, though not the best fit");

export function goalStep(ctx: WizardContext): HTMLElement {
  const { profile, path, fits } = ctx, spec = ctx.spec();
  const box = el("div", "data-step-body");
  box.append(el("h3", "data-step-title", langText("Co chcesz zobaczyć?", "What do you want to see?")));
  for (const fit of fits) {
    const card = el("button", "data-goal");
    card.type = "button"; card.insertAdjacentHTML("afterbegin", ICONS[KIND_ICON[fit.kind]]);
    const text = el("span", "data-goal-text");
    text.append(el("b", "", GOAL[fit.kind].title()), el("span", "", GOAL[fit.kind].example()), el("span", `data-goal-fit is-${fit.fit}`, fitNote(fit)));
    card.append(text);
    const selected = spec.type === fit.kind;
    card.classList.toggle("is-active", selected); card.setAttribute("aria-pressed", String(selected));
    card.addEventListener("click", () => {
      const next = fit.kind === spec.type ? spec : defaultSpec(profile, fit.kind, path);
      if (!next) { showToast(fitNote(fit)); return; }
      ctx.choose({ ...next, title: spec.title });
    });
    box.append(card);
  }
  return box;
}

export function sentence(ctx: WizardContext): HTMLElement {
  const { profile } = ctx, spec = ctx.spec(), change = ctx.change;
  const line = el("p", "data-sentence");
  const columns = (role: "x" | "y") => columnsFor(profile, spec.type, role).map(column => ({ value: column.name, label: column.name }));
  const add = (...parts: Array<string | HTMLElement>): void => { line.append(...parts); };
  if (spec.type === "histogram") add(langText("Pokaż, jak rozłożone są wartości kolumny ", "Show how the values of "), select("X", columns("x"), spec.x, x => change({ x })), langText("", " are spread"));
  else if (spec.type === "scatter") add(langText("Pokaż ", "Show "), select("Y", columns("y"), spec.y ?? "", y => change({ y })), langText(" w zależności od ", " against "), select("X", columns("x"), spec.x, x => change({ x })));
  else {
    const aggs = (["sum", "mean", "min", "max", "count"] as const).map(agg => ({ value: agg, label: AGG_WORD[agg]() }));
    add(langText("Pokaż ", "Show "), select(langText("Co policzyć", "What to count"), aggs, spec.agg, agg => change({ agg, y: agg === "count" ? spec.y : spec.y ?? measures(profile)[0]?.name })));
    if (spec.agg !== "count") add(langText(" z kolumny ", " of "), select(langText("Kolumna z liczbami", "Column with numbers"), measures(profile).map(column => ({ value: column.name, label: column.name })), spec.y ?? "", y => change({ y })));
    add(spec.type === "line" ? langText(" w czasie, według ", " over time, by ") : langText(" dla każdej wartości z kolumny ", " for each value of "), select("X", columns("x"), spec.x, x => change({ x })));
  }
  return line;
}

export function contentStep(ctx: WizardContext): HTMLElement {
  const spec = ctx.spec(), change = ctx.change;
  const box = el("div", "data-step-body");
  box.append(el("h3", "data-step-title", langText("Co ma pokazać wykres?", "What should the chart show?")), sentence(ctx));
  const extra = el("div", "data-extra");
  if (spec.type === "bar") extra.append(el("label", "data-field", langText("Ile grup pokazać", "How many groups to show")), numberInput(langText("Ile grup", "Number of groups"), spec.top, 1, 50, top => change({ top })));
  if (spec.type === "histogram") extra.append(el("label", "data-field", langText("Liczba przedziałów", "Number of bins")), numberInput(langText("Liczba przedziałów", "Number of bins"), spec.bins, 3, 100, bins => change({ bins })));
  if (spec.type === "line") extra.append(el("label", "data-field", langText("Grupuj daty w", "Group dates by")), select(langText("Krok dat", "Date step"), (["auto", "day", "month", "year"] as const).map(value => ({ value, label: STEP_WORD[value]() })), spec.step, value => change({ step: value })));
  if (extra.childElementCount) box.append(extra);
  return box;
}

/** The note the block goes to (kept while the wizard is open). */
let chosenNote = "";

/** Which note receives the block, and what will happen there: a list of the saved Markdown notes open in tabs. */
function noteChoice(box: HTMLElement): void {
  const targets = noteTargets();
  if (!targets.some(target => target.id === chosenNote)) chosenNote = targets[0]?.id ?? "";
  if (!targets.length) {
    box.append(el("p", "data-note", langText("Nie masz otwartej zapisanej notatki Markdown, więc nie ma dokąd wstawić. Otwórz notatkę w edytorze (lub zapisz bieżącą) i wróć tutaj — albo skopiuj blok.", "No saved Markdown note is open, so there is nowhere to insert. Open a note in the editor (or save the current one) and come back — or copy the block.")));
    return;
  }
  const label = el("label", "data-field", langText("Wstaw do notatki", "Insert into note"));
  const pick = select(langText("Notatka docelowa", "Target note"), targets.map(target => ({ value: target.id, label: target.active ? langText(`${target.name} (aktywna)`, `${target.name} (active)`) : target.name })), chosenNote, value => { chosenNote = value; });
  box.append(label, pick, el("p", "data-note", langText("Blok pojawi się w miejscu kursora w tej notatce i zostanie zaznaczony, żeby było widać, gdzie trafił. Wykres zawsze pokazuje aktualne dane z pliku.", "The block appears at the cursor in that note and is selected, so that you can see where it went. The chart always shows the current data of the file.")));
}

export function insertStep(ctx: WizardContext): HTMLElement {
  const spec = ctx.spec(), change = ctx.change;
  const box = el("div", "data-step-body");
  const title = el("input", "data-text");
  title.type = "text"; title.value = spec.title ?? ""; title.placeholder = sentenceText(sentenceOf(spec)); title.setAttribute("aria-label", langText("Tytuł wykresu", "Chart title"));
  title.addEventListener("change", () => change({ title: title.value.trim() || undefined }));
  const field = el("label", "data-field", langText("Tytuł (opcjonalnie)", "Title (optional)"));
  box.append(el("h3", "data-step-title", langText("Gotowe — wstaw do notatki", "Done — put it into a note")), field, title);
  noteChoice(box);
  const actions = el("div", "data-actions");
  actions.append(
    labelButton("insertText", langText("Wstaw do notatki", "Insert into note"), langText("Wstaw ten wykres do edytowanej notatki jako blok „chart”", "Insert this chart into the note being edited as a “chart” block"), () => ctx.insertIntoNote(spec, chosenNote || undefined)),
    labelButton("copy", langText("Kopiuj blok", "Copy block"), langText("Skopiuj blok „chart” do schowka", "Copy the “chart” block to the clipboard"), () => {
      void copyTextToClipboard(chartBlockFor(ctx.path, spec)).then(ok => showToast(!ok ? langText("Nie udało się skopiować", "Could not copy")
        : activeNote() ? langText("Skopiowano blok wykresu", "Chart block copied")
          : langText("Skopiowano blok. Po wklejeniu popraw ścieżkę pliku tak, by była względem notatki.", "Block copied. After pasting, fix the file path so that it is relative to the note.")));
    }));
  box.append(actions);
  return box;
}

