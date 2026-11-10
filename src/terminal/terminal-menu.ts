/** A small popup menu for the terminal panel (the tab menu and the new-terminal list): opens under a button or at the pointer, closes on a click elsewhere or Escape. */
import { ICONS, type IconName } from "../ui/icons";

export interface MenuEntry {
  label: string;
  icon?: IconName;
  run?: () => void;
  disabled?: boolean;
  /** A line above this entry. */
  separator?: boolean;
  /** Shown at the right (a shortcut, or a note such as "default"). */
  hint?: string;
  checked?: boolean;
}

let current: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

export function closeTerminalMenu(): void {
  cleanup?.(); cleanup = null;
  current?.remove(); current = null;
}

/** Opens a menu at a point of the window (or under an element). Returns after the menu is shown. */
export function openTerminalMenu(entries: readonly MenuEntry[], at: { x: number; y: number } | HTMLElement, label: string): void {
  closeTerminalMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu terminal-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  const buttons: HTMLButtonElement[] = [];
  for (const entry of entries) {
    if (entry.separator) menu.append(document.createElement("hr"));
    const item = document.createElement("button");
    item.type = "button"; item.setAttribute("role", entry.checked === undefined ? "menuitem" : "menuitemradio");
    if (entry.checked !== undefined) item.setAttribute("aria-checked", String(entry.checked));
    item.disabled = !!entry.disabled;
    item.innerHTML = entry.icon ? ICONS[entry.icon] : ICONS.blank;
    const text = document.createElement("span"); text.className = "terminal-menu-label"; text.textContent = entry.label; item.append(text);
    if (entry.checked) item.insertAdjacentHTML("beforeend", ICONS.check);
    if (entry.hint) { const hint = document.createElement("kbd"); hint.textContent = entry.hint; item.append(hint); }
    item.addEventListener("click", () => { closeTerminalMenu(); entry.run?.(); });
    buttons.push(item);
    menu.append(item);
  }
  document.body.append(menu);
  const box = at instanceof HTMLElement ? at.getBoundingClientRect() : null;
  const x = box ? box.left : at instanceof HTMLElement ? 0 : at.x;
  const y = box ? box.bottom + 2 : at instanceof HTMLElement ? 0 : at.y;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
  const below = y + menu.offsetHeight > window.innerHeight - 4;
  // A menu that opens from a button near the bottom edge opens upward.
  menu.style.top = `${Math.max(4, below ? (box ? box.top - menu.offsetHeight - 2 : window.innerHeight - menu.offsetHeight - 4) : y)}px`;
  current = menu;
  const enabled = buttons.filter(item => !item.disabled);
  enabled[0]?.focus();
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeTerminalMenu(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    enabled[(index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length]?.focus();
  };
  const onOutside = (event: MouseEvent) => { if (!menu.contains(event.target as Node)) closeTerminalMenu(); };
  document.addEventListener("keydown", onKey, true);
  window.setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  window.addEventListener("blur", closeTerminalMenu);
  cleanup = () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("mousedown", onOutside, true); window.removeEventListener("blur", closeTerminalMenu); };
}
