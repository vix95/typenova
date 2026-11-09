/** The highlight window: colour, group and note of a highlight (or deleting it). */
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { button, el } from "./bookmark-browser";
import { addHighlightFromSelection, deleteHighlight, getHighlights, goToHighlight, highlightExcerpt, highlightsAtSelection, updateHighlight } from "./highlights";
import { groupCounts, HIGHLIGHT_COLORS, MAX_GROUP, MAX_NOTE, type HighlightColor } from "./highlights-model";
import { view } from "./editor-view";

const COLOR_NAMES: Record<HighlightColor, [string, string]> = {
  yellow: ["Żółty", "Yellow"], green: ["Zielony", "Green"], blue: ["Niebieski", "Blue"], pink: ["Różowy", "Pink"], orange: ["Pomarańczowy", "Orange"],
};

let editorDialog: HTMLDialogElement | null = null;

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const wrapper = el("label", "bookmark-field");
  wrapper.append(el("span", "", label), control);
  return wrapper;
}

/** A button with a short visible label; its tooltip and accessible name say the whole action. */
function shortButton(className: string, icon: "trash" | "arrowRight", shortLabel: string, fullLabel: string, onClick: () => void): HTMLButtonElement {
  const control = button(className, icon, shortLabel, onClick, true);
  control.dataset.tooltip = fullLabel;
  control.setAttribute("aria-label", fullLabel);
  return control;
}

const VISIBLE_GROUPS = 8;

/**
 * The groups already in use as buttons under the group field: a click puts the name into the field (in the style of the
 * program, unlike the browser's own suggestion list). With many groups only the most used are shown; "+N more" shows
 * all of them in a scrolling area, and what is typed in the field filters them.
 */
function groupChips(input: HTMLInputElement): HTMLElement {
  const wrapper = el("div", "highlight-group-chips");
  const groups = groupCounts(getHighlights());
  wrapper.hidden = groups.length === 0;
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute("aria-label", langText("Istniejące grupy", "Existing groups"));
  let expanded = false;
  // The list is filtered only by what the user types, not by the group the highlight already has or one picked from the list.
  let filtering = false;
  let fromChip = false;
  const render = () => {
    const current = input.value.trim().toLocaleLowerCase();
    const query = filtering ? current : "";
    const matching = query ? groups.filter(group => group.name.toLocaleLowerCase().includes(query)) : groups;
    const showAll = expanded || query !== "";
    const shown = showAll ? matching : matching.slice(0, VISIBLE_GROUPS);
    wrapper.hidden = groups.length === 0 || matching.length === 0;
    wrapper.classList.toggle("is-scrolling", showAll && matching.length > VISIBLE_GROUPS);
    wrapper.replaceChildren(el("span", "ai-context-label", langText("Istniejące grupy:", "Existing groups:")));
    for (const group of shown) {
      const chip = el("button", "ai-chip highlight-group-chip", group.name); chip.type = "button";
      const on = current === group.name.toLocaleLowerCase();
      chip.classList.toggle("selected", on); chip.setAttribute("aria-pressed", String(on));
      chip.dataset.tooltip = `${group.name} (${group.count})`;
      chip.addEventListener("click", () => { fromChip = true; input.value = group.name; input.dispatchEvent(new Event("input")); input.focus(); });
      wrapper.append(chip);
    }
    if (!query && matching.length > VISIBLE_GROUPS) {
      const hidden = matching.length - VISIBLE_GROUPS;
      const toggle = el("button", "ai-chip", expanded ? langText("Mniej", "Fewer") : langText(`+${hidden} więcej`, `+${hidden} more`)); toggle.type = "button";
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.addEventListener("click", () => { expanded = !expanded; render(); wrapper.querySelector<HTMLElement>("[aria-expanded]")?.focus(); });
      wrapper.append(toggle);
    }
  };
  input.addEventListener("input", () => { filtering = !fromChip; fromChip = false; render(); });
  render();
  return wrapper;
}

/** A row of colour buttons that act as a radio group. */
function colorPicker(initial: HighlightColor, onChange: (color: HighlightColor) => void): HTMLElement {
  const group = el("div", "highlight-colors");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", langText("Kolor", "Colour"));
  const buttons = new Map<HighlightColor, HTMLButtonElement>();
  const select = (color: HighlightColor) => {
    for (const [name, control] of buttons) { control.setAttribute("aria-checked", String(name === color)); control.classList.toggle("selected", name === color); control.tabIndex = name === color ? 0 : -1; }
    onChange(color);
  };
  for (const color of HIGHLIGHT_COLORS) {
    const label = langText(...COLOR_NAMES[color]);
    const control = el("button", `highlight-color tn-hl-${color}`); control.type = "button";
    control.setAttribute("role", "radio");
    control.dataset.tooltip = label; control.setAttribute("aria-label", label);
    control.addEventListener("click", () => select(color));
    control.addEventListener("keydown", event => {
      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = HIGHLIGHT_COLORS[(HIGHLIGHT_COLORS.indexOf(color) + step + HIGHLIGHT_COLORS.length) % HIGHLIGHT_COLORS.length];
      select(next); buttons.get(next)?.focus();
    });
    buttons.set(color, control);
    group.append(control);
  }
  select(initial);
  return group;
}

/** The window in which a highlight gets a colour, a group and a note, or is deleted. */
export function openHighlightEditor(id: string): void {
  const item = getHighlights().find(other => other.id === id);
  if (!item) return;
  editorDialog?.close();
  const dialog = el("dialog", "bookmark-dialog highlight-dialog");
  const content = el("div", "dialog-content bookmark-content");
  const title = el("div", "dialog-title", langText("Wyróżnienie", "Highlight")); title.id = "highlightEditorTitle";
  dialog.setAttribute("aria-labelledby", title.id);
  const quote = el("blockquote", "highlight-quote-box", highlightExcerpt(item, 400));
  const where = el("div", "bookmark-where", basename(item.path)); where.dataset.tooltip = item.path;
  let color: HighlightColor = item.color;
  const picker = colorPicker(color, next => { color = next; });
  const group = el("input", "bookmark-input"); group.type = "text"; group.maxLength = MAX_GROUP; group.value = item.group; group.spellcheck = false;
  group.placeholder = langText("Bez grupy", "No group");
  const existing = groupChips(group);
  const note = el("textarea", "bookmark-note"); note.maxLength = MAX_NOTE; note.value = item.note; note.rows = 4;
  note.placeholder = langText("Dodaj notatkę do tego wyróżnienia (opcjonalnie)", "Add a note about this highlight (optional)");

  const save = () => { updateHighlight(item.id, { color, group: group.value, note: note.value }); dialog.close(); };
  const actions = el("div", "dialog-actions bookmark-actions");
  const remove = shortButton("bookmark-delete", "trash", langText("Usuń", "Delete"), langText("Usuń wyróżnienie", "Delete highlight"), () => { void deleteHighlight(item.id, false).then(() => dialog.close()); });
  const go = shortButton("", "arrowRight", langText("Przejdź", "Go to"), langText("Przejdź do wyróżnienia", "Go to the highlight"), () => { dialog.close(); void goToHighlight(item); });
  const cancel = button("", "close", langText("Anuluj", "Cancel"), () => dialog.close(), true);
  const confirm = button("bookmark-confirm", "save", langText("Zapisz", "Save"), save, true);
  actions.append(remove, el("span", "bookmark-actions-gap"), go, cancel, confirm);

  group.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); save(); } });
  note.addEventListener("keydown", event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); } });
  content.append(title, quote, where, field(langText("Kolor", "Colour"), picker), field(langText("Grupa (opcjonalnie)", "Group (optional)"), group), existing, field(langText("Notatka", "Note"), note), actions);
  dialog.append(content);
  dialog.addEventListener("close", () => { if (editorDialog === dialog) editorDialog = null; dialog.remove(); });
  editorDialog = dialog;
  document.body.append(dialog);
  dialog.showModal();
  group.focus();
}

/** Opens the editor for the highlight at the selection (marking the selection first when it is not highlighted yet). */
export function editHighlightAtSelection(): void {
  const target = highlightsAtSelection()[0] ?? addHighlightFromSelection();
  if (target) openHighlightEditor(target.id);
  else { showToast(langText("Zaznacz fragment tekstu albo ustaw kursor w wyróżnieniu.", "Select some text or put the caret in a highlight.")); view.focus(); }
}
