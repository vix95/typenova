/** Heading breadcrumb bar for the caret position. */
import { basename, isMarkdownPath } from "../filesystem/path-utils";
import { documentState } from "../documents/document-state";
import { activeTab } from "../documents/tabs";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { navigateToHeadingLine, outlineHeadings, outlineParentIndexes, outlineState } from "./outline";

export function updateHeadingBreadcrumbs() {
  const nav = document.getElementById("headingBreadcrumbs");
  const trailRoot = document.getElementById("headingBreadcrumbTrail");
  if (!nav || !trailRoot || !view) return;
  const tab = activeTab();
  const documentName = tab?.path || tab?.label || documentState.untitledLabel;
  const supportsHeadings = isMarkdownPath(documentName);
  nav.hidden = !supportsHeadings;
  if (!supportsHeadings) return;
  const en = document.documentElement.lang === "en";
  nav.setAttribute("aria-label", en ? "Current document heading path" : "Ścieżka nagłówków bieżącego dokumentu");
  const fileLabel = tab?.label || basename(documentName) || "Untitled.md";
  const currentLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const trail: typeof outlineHeadings = [];
  let emptyLabel = "";
  if (outlineState.outlineTabId !== documentState.activeTabId) {
    emptyLabel = langText("Aktualizowanie ścieżki nagłówków…", "Updating heading path…");
  } else {
    let lo = 0, hi = outlineHeadings.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (outlineHeadings[mid].line <= currentLine) lo = mid + 1; else hi = mid; }
    let index = lo - 1;
    if (index < 0) emptyLabel = langText("Poza sekcją", "Outside a section");
    else {
      while (index >= 0) { trail.push(outlineHeadings[index]); index = outlineParentIndexes[index] ?? -1; }
      trail.reverse();
    }
    if (!outlineHeadings.length) emptyLabel = langText("Brak nagłówków", "No headings yet");
  }
  const signature = JSON.stringify([documentState.activeTabId, fileLabel, en, emptyLabel, trail.map(h => h.key)]);
  if (signature === outlineState.lastHeadingBreadcrumbSignature) return;
  outlineState.lastHeadingBreadcrumbSignature = signature;
  trailRoot.replaceChildren();
  const createCrumb = (label: string, line: number, isCurrent: boolean, isDocument = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `heading-breadcrumb-item${isDocument ? " document" : ""}${isCurrent ? " current" : ""}`;
    button.textContent = label;
    button.title = isDocument ? fileLabel : `${label} · ${langText("Linia", "Line")} ${line}`;
    if (isCurrent) button.setAttribute("aria-current", "location");
    button.addEventListener("click", () => navigateToHeadingLine(line));
    return button;
  };
  trailRoot.append(createCrumb(fileLabel, 1, trail.length === 0, true));
  for (let i = 0; i < trail.length; i++) {
    const heading = trail[i];
    const separator = document.createElement("span"); separator.className = "heading-breadcrumb-separator"; separator.setAttribute("aria-hidden", "true"); trailRoot.append(separator);
    trailRoot.append(createCrumb(heading.text, heading.line, i === trail.length - 1));
  }
  if (emptyLabel) {
    const separator = document.createElement("span"); separator.className = "heading-breadcrumb-separator"; separator.setAttribute("aria-hidden", "true"); trailRoot.append(separator);
    const empty = document.createElement("span"); empty.className = "heading-breadcrumb-empty"; empty.textContent = emptyLabel; trailRoot.append(empty);
  }
  // Keep the current section readable when the full heading path exceeds the toolbar width.
  // Ancestors remain accessible by horizontally scrolling the breadcrumb trail.
  const revealCurrent = () => {
    const current = trailRoot.querySelector<HTMLElement>(".heading-breadcrumb-item.current");
    if (!current) return;
    const rootRect = trailRoot.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();
    const visibleWidth = Math.max(0, rootRect.width - 8);
    if (currentRect.width > visibleWidth) {
      trailRoot.scrollLeft += currentRect.left - rootRect.left;
    } else if (currentRect.right > rootRect.right - 4) {
      trailRoot.scrollLeft += currentRect.right - (rootRect.right - 4);
    } else if (currentRect.left < rootRect.left + 4) {
      trailRoot.scrollLeft -= (rootRect.left + 4) - currentRect.left;
    }
  };
  requestAnimationFrame(revealCurrent);
}
