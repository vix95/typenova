/** The Charts tab as a wizard: 1 what to see, 2 what it shows (a sentence with choices), 3 put it into a note. The chart is drawn live next to the steps; the whole file is read again for each change. */
import { langText } from "../i18n/language";
import { renderChartSvg } from "./chart-svg";
import type { ChartSpec } from "./chart-spec";
import { defaultSpec, kindFits, sentenceOf, withChoice } from "./chart-wizard-model";
import type { DataProfile } from "./data-profile";
import { DataRunAborted, runChart } from "./data-source";
import { chartNotes, chartTexts, el, fmtInt, labelButton, sentenceText } from "./data-view-dom";
import { contentStep, goalStep, insertStep, type WizardContext } from "./data-wizard-steps";

export interface ChartsHost {
  /** Puts the block into the note being edited (the viewer closes). */
  insertIntoNote: (spec: ChartSpec, noteId?: string) => void;
}
export interface ChartsTab {
  element: HTMLElement;
  setSpec: (spec: ChartSpec, step?: number) => void;
  /** Stops a running read of the file. */
  dispose: () => void;
}

export function buildCharts(profile: DataProfile, path: string, initial: ChartSpec | null, host: ChartsHost): ChartsTab {
  const element = el("div", "data-panel-body data-wizard");
  const side = el("div", "data-wizard-side"), stage = el("div", "data-stage"), status = el("div", "data-status");
  const main = el("div", "data-wizard-main"); main.append(stage, status);
  element.append(side, main);
  const fits = kindFits(profile);
  let spec: ChartSpec = initial ?? defaultSpec(profile, "bar", path) ?? { file: path, type: "bar", x: profile.columns[0]?.name ?? "", agg: "count", top: 12, bins: 24, step: "auto" };
  let step = 1, controller: AbortController | null = null, timer = 0;

  async function run(): Promise<void> {
    controller?.abort();
    const mine = controller = new AbortController();
    stage.setAttribute("aria-busy", "true");
    status.textContent = langText("Czytanie pliku…", "Reading the file…");
    try {
      const result = await runChart(path, spec, { signal: mine.signal, onProgress: (read, size, rows) => {
        if (!mine.signal.aborted) status.textContent = langText(`Czytanie pliku… ${Math.round((read / Math.max(1, size)) * 100)}% · ${fmtInt(rows)} wierszy`, `Reading the file… ${Math.round((read / Math.max(1, size)) * 100)}% · ${fmtInt(rows)} rows`);
      } });
      if (mine.signal.aborted) return;
      if (result.kind !== "chart" || result.error) { stage.replaceChildren(el("p", "data-error", langText("Tego wykresu nie da się policzyć z wybranych kolumn.", "This chart cannot be computed from the chosen columns."))); status.replaceChildren(); return; }
      const holder = el("div", "data-chart-holder");
      holder.append(el("h3", "data-chart-title", spec.title || sentenceText(sentenceOf(spec))));
      holder.insertAdjacentHTML("beforeend", renderChartSvg(result.data, chartTexts(), 720));
      stage.replaceChildren(holder);
      status.replaceChildren(...chartNotes(result.data).map(note => el("p", "data-note", note)));
    } catch (error) {
      if (error instanceof DataRunAborted || mine.signal.aborted) return;
      stage.replaceChildren(el("p", "data-error", langText(`Nie udało się policzyć wykresu: ${String((error as Error)?.message ?? error)}`, `Could not compute the chart: ${String((error as Error)?.message ?? error)}`)));
    } finally { if (controller === mine) stage.removeAttribute("aria-busy"); }
  }

  const context: WizardContext = {
    profile, path, fits, insertIntoNote: host.insertIntoNote,
    spec: () => spec,
    change: next => { spec = withChoice(spec, next, profile); render(); schedule(); },
    choose: next => { spec = next; goTo(2); schedule(); },
  };
  const schedule = (): void => { window.clearTimeout(timer); timer = window.setTimeout(() => { void run(); }, 250); };
  const goTo = (target: number): void => { step = Math.min(3, Math.max(1, target)); render(); };

  const stepTitle = (): HTMLElement => el("p", "data-step-count", langText(`Krok ${step} z 3`, `Step ${step} of 3`));

  function render(): void {
    const nav = el("div", "data-wizard-nav");
    const back = labelButton("chevronLeft", langText("Wstecz", "Back"), langText("Poprzedni krok", "Previous step"), () => goTo(step - 1));
    const next = labelButton("chevronRight", langText("Dalej", "Next"), langText("Następny krok", "Next step"), () => goTo(step + 1));
    back.hidden = step === 1; next.hidden = step === 3;
    nav.append(back, next);
    side.replaceChildren(stepTitle(), step === 1 ? goalStep(context) : step === 2 ? contentStep(context) : insertStep(context), nav);
  }

  render();
  if (spec.x) schedule();
  return {
    element,
    setSpec(next, to = 2) { spec = next; step = to; render(); schedule(); },
    dispose() { window.clearTimeout(timer); controller?.abort(); },
  };
}
