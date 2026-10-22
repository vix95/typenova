/** Themed dropdown that mirrors native `<select>` elements. */
type TypeNovaSelectControl = {
  select: HTMLSelectElement;
  trigger: HTMLButtonElement;
  valueLabel: HTMLSpanElement;
  menu: HTMLDivElement;
  options: HTMLButtonElement[];
  activeIndex: number;
  refreshOptions: () => void;
  syncValue: () => void;
  open: (keyboard?: boolean) => void;
  close: (restoreFocus?: boolean) => void;
  position: () => void;
};
const typeNovaSelectControls = new Map<HTMLSelectElement, TypeNovaSelectControl>();
export function syncCustomSelectControl(select: HTMLSelectElement | null | undefined): void {
  if (!select) return;
  typeNovaSelectControls.get(select)?.syncValue();
}
export function syncAllCustomSelectControls(): void {
  for (const control of typeNovaSelectControls.values()) control.refreshOptions();
}
// Themed custom dropdowns keep native select values/change handlers, but render the
// option list ourselves because WebView/OS-native option popups ignore app theme colors.
function closeOtherSelects(except?: HTMLSelectElement): void {
  for (const [nativeSelect, control] of typeNovaSelectControls) {
    if (nativeSelect !== except) control.close(false);
  }
}

/** Indices of the options a user can currently pick. */
const enabledOptionIndices = (control: TypeNovaSelectControl): number[] =>
  control.options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);

const isOptionDisabled = (option: HTMLOptionElement): boolean =>
  option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);

function createChevronIcon(className: string, pathData: string): SVGSVGElement {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.classList.add(className);
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  icon.appendChild(path);
  return icon;
}

/** Wraps the native select and creates the trigger button and the (detached-from-the-field) listbox. */
function buildSelectDom(select: HTMLSelectElement, parent: HTMLElement): { trigger: HTMLButtonElement; valueLabel: HTMLSpanElement; menu: HTMLDivElement; linkedLabel: HTMLLabelElement | undefined } {
  const wrapper = document.createElement("div");
  wrapper.className = "tn-select";
  wrapper.dataset.selectId = select.id;
  parent.insertBefore(wrapper, select);
  wrapper.appendChild(select);
  select.dataset.tnCustomSelect = "true";
  select.classList.add("tn-native-select");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  const shouldAutofocus = select.hasAttribute("autofocus");
  select.removeAttribute("autofocus");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = `${select.id}CustomTrigger`;
  trigger.className = "tn-select-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `${select.id}CustomListbox`);
  trigger.setAttribute("aria-autocomplete", "none");
  if (shouldAutofocus) trigger.setAttribute("autofocus", "");

  const valueLabel = document.createElement("span");
  valueLabel.className = "tn-select-value";
  trigger.append(valueLabel, createChevronIcon("tn-select-chevron", "m7 10 5 5 5-5"));

  const menu = document.createElement("div");
  menu.id = `${select.id}CustomListbox`;
  menu.className = "tn-select-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  // A modal's own top layer must contain its popup; otherwise it would render behind <dialog>.
  const portal = select.closest("dialog") || document.body;
  portal.appendChild(menu);

  const linkedLabel = Array.from(document.querySelectorAll<HTMLLabelElement>("label[for]")).find(label => label.htmlFor === select.id);
  if (linkedLabel) {
    if (!linkedLabel.id) linkedLabel.id = `${select.id}FieldLabel`;
    linkedLabel.htmlFor = trigger.id;
    trigger.setAttribute("aria-labelledby", linkedLabel.id);
    menu.setAttribute("aria-labelledby", linkedLabel.id);
  } else {
    const accessibleName = select.getAttribute("aria-label") || select.name || select.id;
    trigger.setAttribute("aria-label", accessibleName);
    menu.setAttribute("aria-label", accessibleName);
  }

  // Keep the trigger in the form field; the native select remains available to app code but hidden.
  wrapper.insertBefore(trigger, select);
  return { trigger, valueLabel, menu, linkedLabel };
}

function updateOptionStates(control: TypeNovaSelectControl): void {
  const { select } = control;
  control.options.forEach((optionButton, index) => {
    const option = select.options[index];
    const selected = !!option && index === select.selectedIndex;
    optionButton.setAttribute("aria-selected", String(selected));
    optionButton.classList.toggle("is-selected", selected);
    optionButton.disabled = !option || isOptionDisabled(option);
  });
}

function syncSelectValue(control: TypeNovaSelectControl): void {
  const { select, trigger, valueLabel } = control;
  const selected = select.selectedOptions[0];
  valueLabel.textContent = selected ? (selected.label || selected.textContent || "").trim() : "";
  trigger.disabled = select.disabled || select.options.length === 0;
  trigger.setAttribute("aria-disabled", String(trigger.disabled));
  control.activeIndex = Math.max(0, select.selectedIndex);
  updateOptionStates(control);
}

/** Keyboard handling on one option button: arrows, Home/End, Escape, Tab and type-ahead. */
function handleOptionKeydown(control: TypeNovaSelectControl, optionButton: HTMLButtonElement, event: KeyboardEvent): void {
  const { select, trigger } = control;
  const enabledIndices = control.options.map((candidate, i) => candidate.disabled ? -1 : i).filter(i => i >= 0);
  const currentIndex = Number(optionButton.dataset.optionIndex);
  let targetIndex: number | undefined;
  if (event.key === "ArrowDown") targetIndex = enabledIndices.find(i => i > currentIndex) ?? enabledIndices[0];
  else if (event.key === "ArrowUp") targetIndex = [...enabledIndices].reverse().find(i => i < currentIndex) ?? enabledIndices[enabledIndices.length - 1];
  else if (event.key === "Home") targetIndex = enabledIndices[0];
  else if (event.key === "End") targetIndex = enabledIndices[enabledIndices.length - 1];
  else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); control.close(true); return; }
  else if (event.key === "Tab") {
    event.preventDefault(); control.close(false);
    const focusables = Array.from((select.closest("dialog") || document).querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
      .filter(el => el.tabIndex >= 0 && !el.hidden && !el.closest("[hidden]") && el !== select);
    const triggerIndex = focusables.indexOf(trigger);
    const next = focusables[triggerIndex + (event.shiftKey ? -1 : 1)];
    next?.focus();
    return;
  }
  else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    typeahead += event.key.toLocaleLowerCase();
    if (typeaheadTimer) window.clearTimeout(typeaheadTimer);
    typeaheadTimer = window.setTimeout(() => { typeahead = ""; typeaheadTimer = 0; }, 650);
    const from = enabledIndices.findIndex(i => i > currentIndex);
    const ordered = from < 0 ? enabledIndices : [...enabledIndices.slice(from), ...enabledIndices.slice(0, from)];
    targetIndex = ordered.find(i => ((select.options[i]?.label || select.options[i]?.textContent || "").trim().toLocaleLowerCase()).startsWith(typeahead));
  }
  if (targetIndex !== undefined && targetIndex >= 0) {
    event.preventDefault();
    control.activeIndex = targetIndex;
    control.options[targetIndex]?.focus();
  }
}

function createOptionButton(control: TypeNovaSelectControl, option: HTMLOptionElement, index: number): HTMLButtonElement {
  const { select } = control;
  const optionButton = document.createElement("button");
  optionButton.type = "button";
  optionButton.className = "tn-select-option";
  optionButton.id = `${select.id}CustomOption${index}`;
  optionButton.setAttribute("role", "option");
  optionButton.dataset.optionIndex = String(index);
  const label = document.createElement("span");
  label.className = "tn-select-option-label";
  label.textContent = (option.label || option.textContent || "").trim();
  optionButton.append(label, createChevronIcon("tn-select-option-check", "m5 12 4 4L19 6"));
  optionButton.disabled = isOptionDisabled(option);
  optionButton.addEventListener("click", () => {
    if (optionButton.disabled) return;
    const changed = select.selectedIndex !== index || select.value !== option.value;
    select.selectedIndex = index;
    control.syncValue();
    control.close(true);
    if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  optionButton.addEventListener("keydown", event => handleOptionKeydown(control, optionButton, event));
  return optionButton;
}

function refreshSelectOptions(control: TypeNovaSelectControl): void {
  control.menu.replaceChildren();
  control.options = Array.from(control.select.options).map((option, index) => {
    const optionButton = createOptionButton(control, option, index);
    control.menu.appendChild(optionButton);
    return optionButton;
  });
  control.syncValue();
}

/** Places the listbox below the trigger, or above it when there is not enough room, clamped to the viewport. */
function positionSelectMenu(control: TypeNovaSelectControl): void {
  const { trigger, menu } = control;
  if (menu.hidden) return;
  const rect = trigger.getBoundingClientRect();
  const padding = 8;
  const below = Math.max(0, window.innerHeight - rect.bottom - padding - 6);
  const above = Math.max(0, rect.top - padding - 6);
  const naturalHeight = Math.min(280, Math.max(1, menu.scrollHeight));
  const openAbove = below < Math.min(naturalHeight, 190) && above > below;
  const available = openAbove ? above : below;
  const maxHeight = Math.max(76, Math.min(280, available || 76));
  menu.style.maxHeight = `${maxHeight}px`;
  menu.style.width = `${Math.max(120, Math.min(rect.width, window.innerWidth - 16))}px`;
  const width = menu.getBoundingClientRect().width;
  const left = Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding));
  const height = Math.min(menu.scrollHeight, maxHeight);
  let top = openAbove ? rect.top - height - 6 : rect.bottom + 6;
  top = Math.max(padding, Math.min(top, window.innerHeight - height - padding));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openSelectMenu(control: TypeNovaSelectControl, keyboard = false): void {
  const { select, trigger, menu } = control;
  if (trigger.disabled || !menu.hidden) return;
  closeOtherSelects(select);
  control.refreshOptions();
  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  control.position();
  if (keyboard) {
    const selectedIndex = select.selectedIndex;
    const initial = control.options[selectedIndex] && !control.options[selectedIndex].disabled
      ? selectedIndex : control.options.findIndex(option => !option.disabled);
    control.activeIndex = initial;
    if (initial >= 0) control.options[initial]?.focus();
  }
}

function closeSelectMenu(control: TypeNovaSelectControl, restoreFocus = false): void {
  const { trigger, menu } = control;
  if (menu.hidden) return;
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger.focus();
}

/** Keyboard handling on the trigger button: open, move, pick and close. */
function handleTriggerKeydown(control: TypeNovaSelectControl, event: KeyboardEvent): void {
  const { menu } = control;
  if (event.key === "Tab" && !menu.hidden) { control.close(false); return; }
  if (["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    if (menu.hidden) {
      control.open(true);
      if (menu.hidden) return;
      if (event.key === "ArrowUp" || event.key === "End" || event.key === "Home") {
        const enabled = enabledOptionIndices(control);
        const target = event.key === "Home" ? enabled[0] : enabled[enabled.length - 1];
        if (target !== undefined) { control.activeIndex = target; control.options[target]?.focus(); }
      }
    } else if (event.key === "Enter" || event.key === " ") {
      control.options[control.activeIndex]?.click();
    } else {
      const enabled = enabledOptionIndices(control);
      const target = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled[enabled.length - 1]
        : event.key === "ArrowDown" ? (enabled.find(index => index > control.activeIndex) ?? enabled[0])
          : ([...enabled].reverse().find(index => index < control.activeIndex) ?? enabled[enabled.length - 1]);
      if (target !== undefined) { control.activeIndex = target; control.options[target]?.focus(); }
    }
  } else if (event.key === "Escape" && !menu.hidden) {
    event.preventDefault(); event.stopPropagation(); control.close(true);
  }
}

/** Replaces one native select with the themed trigger + listbox pair and registers its control. */
function enhanceSelect(select: HTMLSelectElement, parent: HTMLElement): void {
  const { trigger, valueLabel, menu, linkedLabel } = buildSelectDom(select, parent);
  const control: TypeNovaSelectControl = {
    select, trigger, valueLabel, menu, options: [], activeIndex: Math.max(0, select.selectedIndex),
    refreshOptions: () => { }, syncValue: () => { }, open: () => { }, close: () => { }, position: () => { }
  };
  control.syncValue = () => syncSelectValue(control);
  control.refreshOptions = () => refreshSelectOptions(control);
  control.position = () => positionSelectMenu(control);
  control.open = (keyboard = false) => openSelectMenu(control, keyboard);
  control.close = (restoreFocus = false) => closeSelectMenu(control, restoreFocus);

  trigger.addEventListener("click", () => {
    if (menu.hidden) control.open(false);
    else control.close(false);
  });
  trigger.addEventListener("keydown", event => handleTriggerKeydown(control, event));
  select.addEventListener("change", () => control.syncValue());
  if (linkedLabel) linkedLabel.addEventListener("click", event => { event.preventDefault(); trigger.focus(); });
  typeNovaSelectControls.set(select, control);
  control.refreshOptions();
}

function initializeTypeNovaSelects(): void {
  for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
    if (!select.id || select.dataset.tnCustomSelect === "true") continue;
    const parent = select.parentElement;
    if (!parent) continue;
    enhanceSelect(select, parent);
  }

  document.addEventListener("pointerdown", event => {
    const target = event.target as Node | null;
    for (const [nativeSelect, control] of typeNovaSelectControls) {
      const wrapper = nativeSelect.closest<HTMLElement>(".tn-select");
      if (!control.menu.hidden && target && !control.menu.contains(target) && !wrapper?.contains(target)) control.close(false);
    }
  });
  document.addEventListener("scroll", event => {
    const scrollTarget = event.target as Node | null;
    for (const control of typeNovaSelectControls.values()) {
      if (!control.menu.hidden && scrollTarget && !control.menu.contains(scrollTarget)) control.close(false);
    }
  }, true);
  window.addEventListener("resize", () => {
    for (const control of typeNovaSelectControls.values()) if (!control.menu.hidden) control.close(false);
  }, { passive: true });
}
let typeahead = "";
let typeaheadTimer = 0;

export function initCustomSelects(): void {
  initializeTypeNovaSelects();
  syncAllCustomSelectControls();
}
