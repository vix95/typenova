/** A row of buttons that does not fit (the icons of the Project heading, the views of the sidebar) moves, from the end, into a "More" menu under a three-dot button, and comes back when there is room; buttons that are `alwaysInMenu` live there all the time. The buttons themselves are moved (not copied), so their handlers and ids keep working. */
import { $ } from "../app/dom";
import { langText } from "../i18n/language";

const MENU_GAP_PX = 4;
const EDGE_PX = 8;

export interface OverflowOptions {
  /** The element that holds the buttons (they are its direct children). */
  actions: HTMLElement;
  /** The element whose width is the room there is. */
  room: HTMLElement;
  moreId: string;
  /** The three-dot button is put before this child (at the end when null). */
  before?: Element | null;
  labelPl: string;
  labelEn: string;
  alwaysInMenu?: (button: HTMLElement) => boolean;
}

export function installProjectActionsOverflow(): void {
  const actions = $("openProject").parentElement as HTMLElement;
  const room = actions.closest<HTMLElement>(".sidebar-section-heading");
  if (!room) return;
  const inMenu = new Set(["expandAllFolders", "collapseAllFolders", "openGitHistory", "openBookmarks", "openHighlights"]);
  installOverflow({ actions, room, moreId: "projectActionsMore", labelPl: "Więcej akcji projektu", labelEn: "More project actions", alwaysInMenu: button => inMenu.has(button.id) });
}

export function installOverflow(options: OverflowOptions): void {
  const { actions, room: heading, moreId } = options;
  const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>(":scope > button:not(.sidebar-collapse)"));
  const slots = new Map<HTMLElement, Comment>();
  for (const item of buttons) { const slot = document.createComment("project-action-slot"); item.before(slot); slots.set(item, slot); }

  const more = document.createElement("button");
  more.type = "button"; more.id = moreId; more.className = "project-actions-more";
  more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false"); more.hidden = true;
  more.innerHTML = '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/></svg>';
  if (options.before) actions.insertBefore(more, options.before); else actions.append(more);
  const menu = document.createElement("div");
  menu.className = "project-actions-menu"; menu.dataset.for = moreId; menu.hidden = true; menu.setAttribute("role", "group");
  document.body.append(menu);

  const labelOf = (item: HTMLElement): string => (item.getAttribute("aria-label") || item.dataset.tooltip || item.title || item.textContent?.trim() || "").replace(/\s*\([^)]*\)\s*$/, "");
  const close = (focusButton = false): void => { menu.hidden = true; more.setAttribute("aria-expanded", "false"); if (focusButton) more.focus(); };
  const labels = (): void => {
    const text = langText(options.labelPl, options.labelEn);
    more.dataset.tooltip = text; more.setAttribute("aria-label", text); menu.setAttribute("aria-label", text);
    for (const item of buttons) if (item.parentElement === menu) item.dataset.menuLabel = labelOf(item);
  };

  const layout = (): void => {
    if (!heading.clientWidth) return;
    for (const item of buttons) { const slot = slots.get(item); if (slot?.parentNode && item.parentElement !== actions) { slot.parentNode.insertBefore(item, slot); delete item.dataset.menuLabel; } }
    // Everything in the bar when it fits without the three-dot button; the button takes room of its own only when something has to move.
    more.hidden = true;
    const fits = (): boolean => heading.scrollWidth <= heading.clientWidth + 1;
    if (fits() && !buttons.some(item => options.alwaysInMenu?.(item))) { close(); labels(); return; }
    more.hidden = false;
    let moved = false;
    for (let index = buttons.length - 1; index >= 0; index--) {
      if (!options.alwaysInMenu?.(buttons[index]) && fits()) continue;
      menu.prepend(buttons[index]); moved = true;
    }
    more.hidden = !moved;
    if (!moved) close();
    labels();
  };

  const open = (): void => {
    const rect = more.getBoundingClientRect();
    menu.hidden = false;
    const width = menu.getBoundingClientRect().width;
    menu.style.top = `${Math.round(rect.bottom + MENU_GAP_PX)}px`;
    menu.style.left = `${Math.round(Math.max(EDGE_PX, Math.min(rect.right - width, window.innerWidth - width - EDGE_PX)))}px`;
    more.setAttribute("aria-expanded", "true");
    menu.querySelector<HTMLElement>("button")?.focus();
  };

  more.addEventListener("click", () => (menu.hidden ? open() : close()));
  menu.addEventListener("click", () => close());
  document.addEventListener("pointerdown", event => { if (!menu.hidden && !menu.contains(event.target as Node) && !more.contains(event.target as Node)) close(); });
  menu.addEventListener("keydown", event => {
    const items = Array.from(menu.querySelectorAll<HTMLElement>("button"));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (event.key === "Tab") close();
  });
  window.addEventListener("resize", () => close());
  document.addEventListener("typenova:language-changed", labels);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(layout).observe(heading);
  layout();
}
