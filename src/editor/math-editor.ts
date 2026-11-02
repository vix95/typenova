/** Math editor dialog: a visual formula field (MathLive) kept in step with its LaTeX source and a KaTeX preview, with a symbol palette. */
import katex from "katex";
import { langText } from "../i18n/language";
import { view } from "./editor-view";
import { findFormulaAt, formulaMarkdown, latexFromMarkdown } from "./formula-block";
import { FORMULA_TEMPLATES, PALETTE_GROUPS, type PaletteItem } from "./formula-palette";
import { MATHLIVE_PL } from "./math-editor-strings";
import { $ } from "../app/dom";
import { releaseCustomSelects, themeSelect } from "../ui/custom-select";
import { showToast } from "../ui/toast";

interface FormulaRequest { latex: string; display: boolean; editing: boolean }
interface FormulaChoice { latex: string; display: boolean }

/** Minimal view of the MathLive element: only what this dialog uses. */
interface MathFieldElement extends HTMLElement {
  value: string;
  getValue(format?: string): string;
  insert(latex: string, options?: { format?: string; focus?: boolean; selectionMode?: string }): boolean;
  mathVirtualKeyboardPolicy: string;
  menuItems: ReadonlyArray<unknown>;
  executeCommand(command: string): boolean;
}

let mathliveReady: Promise<typeof import("mathlive")> | null = null;
/** Loads MathLive the first time the editor opens; its fonts are the KaTeX ones the app already ships. The language follows the app each time. */
async function loadMathlive(): Promise<void> {
  if (!mathliveReady) {
    mathliveReady = import("mathlive").then(module => {
      module.MathfieldElement.fontsDirectory = null;
      module.MathfieldElement.soundsDirectory = null;
      module.MathfieldElement.strings = { pl: MATHLIVE_PL };
      return module;
    });
  }
  (await mathliveReady).MathfieldElement.locale = langText("pl", "en");
}

/** MathLive draws frames and strike-throughs (`\boxed`, `\cancel`) in a fixed black (`#000000`), invisible on a dark theme; they are switched to the text colour. */
function followTextColor(field: MathFieldElement): void {
  const root = field.shadowRoot;
  if (!root) return;
  const BLACK = /#000000|#000(?![0-9a-f])|\bblack\b|rgb\(0,\s*0,\s*0\)/gi;
  const fix = () => root.querySelectorAll<HTMLElement>('[style*="solid"]').forEach(node => {
    const current = node.getAttribute("style") ?? "", next = current.replace(BLACK, "currentcolor");
    if (next !== current) node.setAttribute("style", next);
  });
  new MutationObserver(fix).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
  fix();
}

function renderLatex(target: HTMLElement, latex: string, display: boolean): string | null {
  try {
    katex.render(latex || "\\;", target, { displayMode: display, throwOnError: true, strict: "ignore", trust: false });
    return null;
  } catch (error) { return String(error instanceof Error ? error.message : error).replace(/^KaTeX parse error:\s*/, ""); }
}

function paletteButton(item: PaletteItem, onPick: (item: PaletteItem) => void): HTMLButtonElement {
  const button = document.createElement("button"); button.type = "button"; button.className = "formula-key";
  katex.render(item.show, button, { throwOnError: false, strict: "ignore", trust: false });
  const label = item.tip ? langText(item.tip[0], item.tip[1]) : item.show;
  button.setAttribute("aria-label", label); button.title = label;
  button.addEventListener("click", () => onPick(item));
  return button;
}

/** Buttons under the field for editing a matrix the caret is in: rows and columns to add or delete. */
function buildMatrixTools(field: MathFieldElement, onChange: () => void): HTMLElement {
  const bar = document.createElement("div"); bar.className = "formula-matrix-tools"; bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", langText("Edycja macierzy", "Matrix editing"));
  const caption = document.createElement("span"); caption.className = "formula-label"; caption.textContent = langText("Macierz:", "Matrix:");
  bar.append(caption);
  const tools: Array<[string, string, string, string]> = [
    ["addRowAfter", "Dodaj wiersz pod", "Add row below", "Dodaj wiersz pod bieżącym (kursor w macierzy)"],
    ["addRowBefore", "Dodaj wiersz nad", "Add row above", "Dodaj wiersz nad bieżącym"],
    ["addColumnAfter", "Dodaj kolumnę z prawej", "Add column right", "Dodaj kolumnę po prawej stronie bieżącej"],
    ["addColumnBefore", "Dodaj kolumnę z lewej", "Add column left", "Dodaj kolumnę po lewej stronie bieżącej"],
    ["removeRow", "Usuń wiersz", "Delete row", "Usuń bieżący wiersz"],
    ["removeColumn", "Usuń kolumnę", "Delete column", "Usuń bieżącą kolumnę"],
  ];
  for (const [command, pl, en, tip] of tools) {
    const button = document.createElement("button"); button.type = "button"; button.className = "formula-tool"; button.textContent = langText(pl, en);
    button.title = langText(tip, command.startsWith("add") ? (en + " (caret in a matrix)") : en);
    button.addEventListener("click", () => { field.executeCommand(command); field.focus(); onChange(); });
    bar.append(button);
  }
  return bar;
}

/** Tabs of symbol groups above a grid of keys; clicking a key calls `onPick` with its item. */
function buildPalette(onPick: (item: PaletteItem) => void): HTMLElement {
  const box = document.createElement("div"); box.className = "formula-palette";
  const tabs = document.createElement("div"); tabs.className = "formula-tabs"; tabs.setAttribute("role", "tablist");
  const grid = document.createElement("div"); grid.className = "formula-keys"; grid.setAttribute("role", "tabpanel");
  const select = (index: number) => {
    tabs.querySelectorAll("button").forEach((tab, tabIndex) => { tab.setAttribute("aria-selected", String(tabIndex === index)); tab.classList.toggle("selected", tabIndex === index); });
    grid.replaceChildren(...PALETTE_GROUPS[index].items.map(item => paletteButton(item, onPick)));
  };
  PALETTE_GROUPS.forEach((group, index) => {
    const tab = document.createElement("button"); tab.type = "button"; tab.role = "tab"; tab.textContent = langText(group.pl, group.en);
    tab.addEventListener("click", () => select(index)); tabs.append(tab);
  });
  box.append(tabs, grid); select(0);
  return box;
}

function buildTemplateSelect(onPick: (latex: string) => void): HTMLSelectElement {
  const select = document.createElement("select"); select.className = "formula-templates"; select.setAttribute("aria-label", langText("Gotowe wzory", "Ready-made formulas"));
  const head = document.createElement("option"); head.value = ""; head.textContent = langText("Gotowe wzory…", "Ready-made formulas…"); select.append(head);
  FORMULA_TEMPLATES.forEach((template, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = langText(template.pl, template.en); select.append(option); });
  select.addEventListener("change", () => { if (select.value) onPick(FORMULA_TEMPLATES[Number(select.value)].latex); select.value = ""; });
  return select;
}

function buildModeSwitch(display: boolean, onChange: (display: boolean) => void): HTMLElement {
  const group = document.createElement("div"); group.className = "formula-mode"; group.setAttribute("role", "group"); group.setAttribute("aria-label", langText("Tryb wzoru", "Formula mode"));
  const make = (value: boolean, label: string) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.dataset.display = String(value);
    button.addEventListener("click", () => { onChange(value); sync(value); }); return button;
  };
  const buttons = [make(true, langText("Osobna linia ($$)", "Own line ($$)")), make(false, langText("W zdaniu ($)", "Inside text ($)"))];
  const sync = (current: boolean) => buttons.forEach(button => { const on = (button.dataset.display === "true") === current; button.setAttribute("aria-pressed", String(on)); button.classList.toggle("selected", on); });
  sync(display); group.append(...buttons);
  return group;
}

/** Shows the dialog; resolves with the formula to write, or null when cancelled. */
async function askFormula(request: FormulaRequest): Promise<FormulaChoice | null> {
  await loadMathlive();
  return new Promise(resolve => {
    let display = request.display;
    const dialog = document.createElement("dialog"); dialog.className = "formula-dialog"; dialog.setAttribute("aria-labelledby", "formulaTitle");
    const content = document.createElement("div"); content.className = "dialog-content formula-content";
    const title = document.createElement("div"); title.className = "dialog-title"; title.id = "formulaTitle";
    title.textContent = request.editing ? langText("Edytuj wzór", "Edit formula") : langText("Edytor wzorów", "Formula editor");

    const field = document.createElement("math-field") as MathFieldElement;
    field.className = "formula-field"; field.mathVirtualKeyboardPolicy = "manual"; field.setAttribute("aria-label", langText("Pole wzoru", "Formula field"));
    field.value = request.latex;
    const source = document.createElement("textarea"); source.className = "formula-source"; source.spellcheck = false; source.rows = 3; source.value = request.latex;
    source.setAttribute("aria-label", langText("Kod LaTeX", "LaTeX code"));
    const preview = document.createElement("div"); preview.className = "formula-preview"; preview.setAttribute("aria-live", "polite");
    const problem = document.createElement("div"); problem.className = "formula-error"; problem.setAttribute("role", "alert"); problem.hidden = true;

    const refresh = () => {
      const message = renderLatex(preview, source.value, display);
      problem.hidden = !message; problem.textContent = message ?? "";
      insert.disabled = !source.value.trim() || !!message;
    };
    const setLatex = (latex: string) => { field.value = latex; source.value = latex; refresh(); };
    field.addEventListener("input", () => { source.value = field.getValue("latex-without-placeholders"); refresh(); });
    source.addEventListener("input", () => { field.value = source.value; refresh(); });
    const pick = (item: PaletteItem) => {
      field.insert(item.insert ?? item.show, { format: "latex", focus: true, selectionMode: "placeholder" });
      source.value = field.getValue("latex-without-placeholders"); refresh();
    };

    const toolbar = document.createElement("div"); toolbar.className = "formula-toolbar";
    toolbar.append(buildModeSwitch(display, value => { display = value; refresh(); }), buildTemplateSelect(setLatex));
    const edit = document.createElement("div"); edit.className = "formula-edit";
    const sourceLabel = document.createElement("div"); sourceLabel.className = "formula-label"; sourceLabel.textContent = langText("Kod LaTeX (edycja dwukierunkowa)", "LaTeX code (two-way)");
    const previewLabel = document.createElement("div"); previewLabel.className = "formula-label"; previewLabel.textContent = langText("Podgląd w dokumencie", "Preview in the document");
    const matrixTools = buildMatrixTools(field, () => { source.value = field.getValue("latex-without-placeholders"); refresh(); });
    edit.append(toolbar, field, matrixTools, sourceLabel, source, previewLabel, preview, problem);
    const columns = document.createElement("div"); columns.className = "formula-columns"; columns.append(buildPalette(pick), edit);

    const actions = document.createElement("div"); actions.className = "dialog-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = langText("Anuluj", "Cancel");
    const insert = document.createElement("button"); insert.type = "button"; insert.className = "primary"; insert.textContent = request.editing ? langText("Zapisz", "Update") : langText("Wstaw", "Insert");
    actions.append(cancel, insert);
    const hint = document.createElement("div"); hint.className = "dialog-hint";
    hint.textContent = langText("Pisz wzór prosto w polu (np. x^2, /, sqrt) albo klikaj symbole po lewej. Ctrl+Enter wstawia wzór do dokumentu.", "Type the formula straight into the field (e.g. x^2, /, sqrt) or click the symbols on the left. Ctrl+Enter puts the formula into the document.");
    insert.title = "Ctrl+Enter";
    content.append(title, hint, columns, actions); dialog.append(content); document.body.append(dialog);
    dialog.querySelectorAll("select").forEach(themeSelect);
    followTextColor(field);
    field.menuItems = []; // MathLive's own menu is not used: everything it offered is on the palette (and it needs clipboard access)

    let settled = false;
    const finish = (choice: FormulaChoice | null) => { if (settled) return; settled = true; dialog.close(); releaseCustomSelects(dialog); dialog.remove(); resolve(choice); };
    cancel.addEventListener("click", () => finish(null));
    insert.addEventListener("click", () => finish({ latex: source.value.trim(), display }));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    // In MathLive Esc switches the field to raw LaTeX editing; here it closes the dialog like everywhere else.
    field.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); finish(null); } }, true);
    dialog.addEventListener("keydown", event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !insert.disabled) { event.preventDefault(); insert.click(); } });
    refresh(); dialog.showModal(); field.focus();
  });
}

/** Writes the formula into the document, on its own lines when it is a block. */
function writeFormula(from: number, to: number, choice: FormulaChoice): void {
  const doc = view.state.doc;
  let insert = formulaMarkdown(choice.latex, choice.display);
  if (choice.display) {
    if (from > doc.lineAt(from).from) insert = "\n" + insert;
    if (to < doc.lineAt(to).to) insert += "\n";
  }
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true }); view.focus();
}

/** Opens the editor for the formula at the caret, for the selected text, or for a new formula. */
export async function openMathEditor(): Promise<void> {
  const { from, to } = view.state.selection.main;
  const found = findFormulaAt(view.state.doc.toString(), from, to);
  const selected = from === to ? "" : view.state.sliceDoc(from, to);
  const request: FormulaRequest = found ? { latex: latexFromMarkdown(found.latex), display: found.display, editing: true } : { latex: selected.trim(), display: true, editing: false };
  try {
    const choice = await askFormula(request);
    if (!choice) { view.focus(); return; }
    if (found) writeFormula(found.from, found.to, choice); else writeFormula(from, to, choice);
  } catch (error) {
    showToast(`${langText("Nie udało się otworzyć edytora wzorów", "Could not open the formula editor")}: ${String(error)}`);
  }
}

export function initMathEditor(): void {
  $("insertMath").addEventListener("click", () => void openMathEditor());
}
