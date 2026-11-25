/** The small right-click menu of the Git window: a list of actions with their icons, opened where the pointer is, inside the window (a modal dialog has its own layer above the page). */

export interface MenuItem { label: string; icon?: string; run: () => void | Promise<void>; danger?: boolean; disabled?: boolean }
export type MenuEntry = MenuItem | "-";

let open: HTMLElement | null = null;

export function closeGitMenu(): void { open?.remove(); open = null; }

/** Shows the menu at (`x`, `y`) in `host`; it closes with a click anywhere, with Escape, or when something is chosen. */
export function showGitMenu(host: HTMLElement, x: number, y: number, entries: readonly MenuEntry[]): void {
  closeGitMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu git-menu"; menu.setAttribute("role", "menu");
  for (const entry of entries) {
    if (entry === "-") { menu.append(document.createElement("hr")); continue; }
    const button = document.createElement("button");
    button.type = "button"; button.role = "menuitem"; button.disabled = !!entry.disabled;
    if (entry.danger) button.classList.add("danger");
    button.innerHTML = `<span class="git-menu-icon">${entry.icon ?? ""}</span><span class="git-menu-label"></span>`;
    (button.querySelector(".git-menu-label") as HTMLElement).textContent = entry.label;
    button.addEventListener("click", () => { closeGitMenu(); void entry.run(); });
    menu.append(button);
  }
  host.append(menu);
  open = menu;
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  const away = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key !== "Escape") return;
    if (event instanceof PointerEvent && menu.contains(event.target as Node)) return;
    if (event instanceof KeyboardEvent) { event.preventDefault(); event.stopPropagation(); }
    closeGitMenu();
    document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", away, true);
  };
  document.addEventListener("pointerdown", away, true);
  document.addEventListener("keydown", away, true);
}
