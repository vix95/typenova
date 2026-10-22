/** Section selection and opening a section in the editor. */
import { readTextFile } from "@tauri-apps/plugin-fs";
import { EditorView } from "@codemirror/view";
import { $ } from "../app/dom";
import { previousSidebarTab, setSidebarTab } from "../app/sidebar";
import { documentState } from "../documents/document-state";
import { openTextInTab } from "../documents/file-actions";
import { switchToTab } from "../documents/tabs";
import { view } from "../editor/editor-view";
import type { GraphCanvasSurface } from "./flat-canvas-renderer";
import { renderGraph } from "./graph-renderer";
import { graphUi, type GraphSection } from "./graph-state";
import { mountGraphPreviewRenderer } from "./preview-host";
import { applyGraphPreviewHeight, applyGraphPreviewWidth, syncGraphPreviewResizer } from "./preview-resizer";
import { updateGraphRelatedPanel } from "./related-panel";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";

export function selectGraphSection(section: GraphSection) {
  graphUi.selectedGraphSection = section;
  graphUi.graphRelatedPanelDismissed = false;
  updateGraphRelatedPanel(section);
  const panel = $("brainPreview") as HTMLElement;
  const previewWasHidden = panel.hidden;
  $("brainGraphBreadcrumbRow").hidden = false;
  graphUi.graphAutoFitNextRender = previewWasHidden; graphUi.graphAnimateNextRender = false; panel.hidden = false;
  $("brainPreviewResizer").hidden = false; applyGraphPreviewWidth(); applyGraphPreviewHeight(); syncGraphPreviewResizer(); $("brainView").classList.add("has-preview");
  $("brainPreviewTitle").textContent = section.title;
  $("brainPreviewMeta").textContent = `${section.file} · ${langText("linia", "line")} ${section.line}`;
  const breadcrumbs = $("brainPreviewBreadcrumbs") as HTMLElement;
  breadcrumbs.replaceChildren();
  const ancestry: GraphSection[] = [];
  let cursor: GraphSection | undefined = section;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id); ancestry.unshift(cursor);
    const parentId: string | null = cursor.parent;
    cursor = parentId ? graphUi.graphSections.find(item => item.id === parentId) : undefined;
  }
  ancestry.forEach((item, index) => {
    if (index) { const separator = document.createElement("span"); separator.className = "brain-preview-breadcrumb-separator"; separator.setAttribute("aria-hidden", "true"); breadcrumbs.append(separator); }
    if (index === ancestry.length - 1) { const current = document.createElement("span"); current.className = "brain-preview-breadcrumb-current"; current.textContent = item.title; current.setAttribute("aria-current", "page"); breadcrumbs.append(current); }
    else { const crumb = document.createElement("button"); crumb.type = "button"; crumb.className = "brain-preview-breadcrumb-link"; crumb.textContent = item.title; crumb.title = item.title; crumb.addEventListener("click", () => selectGraphSection(item)); breadcrumbs.append(crumb); }
  });
  try { mountGraphPreviewRenderer(section); }
  catch (error) { const body = $("brainPreviewBody") as HTMLElement; body.textContent = section.content; console.error("Graph preview rendering failed", error); }
  requestAnimationFrame(() => {
    const graphSvg = $("brainGraph").querySelector(".brain-svg") as (SVGSVGElement & { __typenovaSelectSection?: (sectionId: string, fitToViewport: boolean) => void }) | null;
    const graphCanvas = $("brainGraph").querySelector(".brain-canvas") as GraphCanvasSurface | null;
    const renderer = graphCanvas || graphSvg;
    if (renderer?.__typenovaSelectSection) renderer.__typenovaSelectSection(section.id, previewWasHidden);
    else renderGraph();
  });
}
export async function openGraphSection(section: GraphSection) { try { if (document.body.classList.contains("graph-mode")) setSidebarTab(previousSidebarTab); const existing = documentState.tabs.find(t => t.path && t.path.replace(/\\/g, "/").toLowerCase() === section.path.replace(/\\/g, "/").toLowerCase()); if (existing) switchToTab(existing.id); else openTextInTab(section.path, await readTextFile(section.path)); const pos = view.state.doc.line(Math.min(section.line, view.state.doc.lines)).from; view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) }); view.focus(); } catch (e) { showToast(`${langText("Nie można otworzyć sekcji", "Could not open section")}: ${String(e)}`); } }
