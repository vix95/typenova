/** Responsive overflow handling of the formatting toolbar. */
// Adaptively move toolbar commands into the three-dot menu instead of letting them overlap.
const formattingToolbar = document.querySelector<HTMLElement>(".formatbar");
const formattingOverflow = formattingToolbar?.querySelector<HTMLDetailsElement>("details.toolbar-overflow") || null;
const formattingOverflowMenu = formattingOverflow?.querySelector<HTMLElement>(".toolbar-overflow-menu") || null;
const movableToolbarButtons: HTMLElement[] = [];
const toolbarSlots = new Map<HTMLElement, Comment>();
let toolbarLayoutQueued = false;
function layoutToolbarActions() {
  toolbarLayoutQueued = false;
  if (!formattingToolbar || !formattingOverflow || !formattingOverflowMenu) return;
  for (const button of movableToolbarButtons) { const slot = toolbarSlots.get(button); if (slot?.parentNode && button.parentElement !== formattingToolbar) slot.parentNode.insertBefore(button, slot); button.removeAttribute("data-overflow-label"); }
  formattingOverflow.hidden = false;
  let overflowed = formattingToolbar.scrollWidth > formattingToolbar.clientWidth + 2;
  const labels: Record<string, [string, string]> = {
    "Bold": ["Pogrubienie", "Bold"], "Italic": ["Kursywa", "Italic"], "Strikethrough": ["Przekreślenie", "Strikethrough"],
    "Heading 1": ["Nagłówek 1", "Heading 1"], "Heading 2": ["Nagłówek 2", "Heading 2"], "Heading 3": ["Nagłówek 3", "Heading 3"],
    "Heading 4": ["Nagłówek 4", "Heading 4"], "Heading 5": ["Nagłówek 5", "Heading 5"], "Heading 6": ["Nagłówek 6", "Heading 6"],
    "Bulleted list": ["Lista punktowana", "Bulleted list"], "Numbered list": ["Lista numerowana", "Numbered list"], "Block quote": ["Cytat", "Block quote"],
    "Inline code": ["Kod inline", "Inline code"], "Insert link": ["Wstaw link", "Insert link"], "Insert image": ["Wstaw obraz", "Insert image"],
    "Insert table": ["Wstaw tabelę", "Insert table"], "Horizontal rule": ["Linia pozioma", "Horizontal rule"], "Task list": ["Lista zadań", "Task list"],
    "Math / LaTeX": ["Matematyka / LaTeX", "Math / LaTeX"], "Insert Mermaid diagram": ["Wstaw diagram Mermaid", "Insert Mermaid diagram"]
  };
  for (let i = movableToolbarButtons.length - 1; overflowed && i >= 0; i--) {
    const button = movableToolbarButtons[i]; if (button.parentElement !== formattingToolbar) continue;
    const source = button.getAttribute("aria-label") || button.title || button.textContent?.trim() || "Action";
    const clean = source.replace(/\s*\([^)]*\)\s*$/, '');
    const pair = labels[clean] || labels[source];
    button.dataset.overflowLabel = pair ? pair[document.documentElement.lang === "en" ? 1 : 0] : source;
    formattingOverflowMenu.append(button);
    overflowed = formattingToolbar.scrollWidth > formattingToolbar.clientWidth + 2;
  }
  formattingOverflow.hidden = false; // Keep utility commands in More even when no formatting controls overflow.
}
export function scheduleToolbarLayout() { if (toolbarLayoutQueued) return; toolbarLayoutQueued = true; requestAnimationFrame(layoutToolbarActions); }

export function initToolbarLayout(): void {
  if (formattingToolbar && formattingOverflow && formattingOverflowMenu) {
    for (const node of Array.from(formattingToolbar.children)) {
      if (!(node instanceof HTMLElement) || !node.matches('button[data-wrap],button[data-prefix],#insertImage,#insertTable,#insertRule,#insertMermaid')) continue;
      const slot = document.createComment("toolbar-action-slot"); node.before(slot); toolbarSlots.set(node, slot); movableToolbarButtons.push(node);
    }
  }
  if (formattingToolbar) { if (typeof ResizeObserver !== "undefined") new ResizeObserver(scheduleToolbarLayout).observe(formattingToolbar); window.addEventListener("resize", scheduleToolbarLayout); scheduleToolbarLayout(); }
}
