/** Related-sections panel, hover emphasis and section tooltip excerpts. */
import { $ } from "../app/dom";
import { graphUi, type GraphSection } from "./graph-state";
import { selectGraphSection } from "./selection";
import { langText } from "../i18n/language";
import { hideAppTooltip } from "../ui/tooltip";

export function graphSectionTooltipExcerpt(section: GraphSection, wordLimit = 100) {
  let text = section.content || "";
  text = text.replace(/^\s{0,3}#{1,6}\s+[^\r\n]*(?:\r?\n|$)/, " ");
  text = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ");
  text = text.replace(/<!--([\s\S]*?)-->/g, " ");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, " $1 ");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, " $1 ");
  text = text.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, alias) => ` ${alias || target} `);
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, " ");
  text = text.replace(/[ *_~`]/g, " ").replace(/\s+/g, " ").trim();
  return text.split(/\s+/).filter(Boolean).slice(0, wordLimit).join(" ");
}
function setHoveredRelatedSection(sectionId: string | null) {
  graphUi.hoveredRelatedSectionId = sectionId;
  if (graphUi.graphEmphasisHandler) graphUi.graphEmphasisHandler(sectionId);
  else if (!sectionId) hideAppTooltip();
}
export function updateGraphRelatedPanel(section: GraphSection | null) {
  // Rebuilding the list invalidates any row that might have been hovered/focused.
  setHoveredRelatedSection(null);
  const panel = $("brainRelatedPanel") as HTMLElement | null;
  const list = $("brainRelatedList") as HTMLElement | null;
  const summary = $("brainRelatedSummary") as HTMLElement | null;
  const graphView = $("brainView") as HTMLElement | null;
  if (!panel || !list || !summary || !graphView) return;
  if (!section || graphUi.graphRelatedPanelDismissed) {
    panel.hidden = true;
    graphView.classList.remove("has-related");
    list.replaceChildren();
    return;
  }
  const query = (($('brainFilter') as HTMLInputElement | null)?.value || "").trim().toLocaleLowerCase();
  const visible = graphUi.graphSections.filter(item =>
    (graphUi.graphSelectedFiles === null || graphUi.graphSelectedFiles.has(item.path)) &&
    (!query || item.title.toLocaleLowerCase().includes(query) || item.file.toLocaleLowerCase().includes(query) || item.path.toLocaleLowerCase().includes(query))
  );
  const visibleIds = new Set(visible.map(item => item.id));
  const byId = new Map(graphUi.graphSections.map(item => [item.id, item] as const));
  const candidates = new Map<string, { section: GraphSection; relation: string; priority: number }>();
  const add = (candidate: GraphSection | undefined, relationPl: string, relationEn: string, priority: number) => {
    if (!candidate || candidate.id === section.id || !visibleIds.has(candidate.id)) return;
    const old = candidates.get(candidate.id);
    if (!old || priority < old.priority) candidates.set(candidate.id, { section: candidate, relation: langText(relationPl, relationEn), priority });
  };
  if (section.parent) add(byId.get(section.parent), "Nadrzędna sekcja", "Parent section", 0);
  for (const candidate of graphUi.graphSections) if (candidate.parent === section.id) add(candidate, "Podsekcja", "Child section", 1);
  const sameFile = graphUi.graphSections.filter(candidate => candidate.path === section.path).sort((a, b) => a.line - b.line);
  const sameIndex = sameFile.findIndex(candidate => candidate.id === section.id);
  if (sameIndex > 0) add(sameFile[sameIndex - 1], "Poprzednia sekcja", "Previous section", 2);
  if (sameIndex >= 0 && sameIndex + 1 < sameFile.length) add(sameFile[sameIndex + 1], "Następna sekcja", "Next section", 2);
  for (const candidate of graphUi.graphSections) if (candidate.parent === section.parent && candidate.path === section.path) add(candidate, "Ta sama gałąź", "Same branch", 3);
  for (const id of section.links) add(byId.get(id), "Link z tej sekcji", "Linked from this section", 4);
  for (const candidate of graphUi.graphSections) if (candidate.links.includes(section.id)) add(candidate, "Linkuje tutaj", "Links here", 5);
  const items = [...candidates.values()].sort((a, b) => a.priority - b.priority || a.section.file.localeCompare(b.section.file, document.documentElement.lang || "pl") || a.section.line - b.section.line || a.section.title.localeCompare(b.section.title, document.documentElement.lang || "pl"));
  panel.hidden = false;
  graphView.classList.add("has-related");
  const total = items.length;
  summary.textContent = langText(`${total} powiązanych sekcji`, `${total} related sections`);
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div"); empty.className = "brain-related-empty";
    empty.textContent = langText("Brak powiązanych sekcji widocznych przy bieżących filtrach.", "No related sections are visible with the current filters.");
    list.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of items.slice(0, 120)) {
    const entry = document.createElement("div"); entry.className = "brain-related-entry"; entry.setAttribute("role", "listitem");
    const button = document.createElement("button"); button.type = "button"; button.className = "brain-related-item";
    const excerpt = graphSectionTooltipExcerpt(item.section, 100);
    const tooltipLabel = `${item.section.title} · ${item.section.file} · ${langText("linia", "line")} ${item.section.line}${excerpt ? ` — ${excerpt}` : ""}`;
    button.dataset.tooltip = tooltipLabel;
    if (excerpt) button.dataset.tooltipKind = "section-preview";
    button.setAttribute("aria-label", langText(`Sekcja ${item.section.title}, ${item.relation}, plik ${item.section.file}, linia ${item.section.line}`, `Section ${item.section.title}, ${item.relation}, file ${item.section.file}, line ${item.section.line}`));
    const title = document.createElement("span"); title.className = "brain-related-item-title"; title.textContent = item.section.title;
    const meta = document.createElement("span"); meta.className = "brain-related-item-meta"; meta.textContent = `${item.section.file} · ${item.section.line}`;
    const relation = document.createElement("span"); relation.className = "brain-related-item-relation"; relation.textContent = item.relation;
    button.append(title, meta, relation);
    button.addEventListener("click", () => { const target = byId.get(item.section.id); if (target) selectGraphSection(target); });
    button.addEventListener("pointerenter", () => setHoveredRelatedSection(item.section.id));
    button.addEventListener("pointerleave", () => { if (graphUi.hoveredRelatedSectionId === item.section.id) setHoveredRelatedSection(null); });
    button.addEventListener("focus", () => setHoveredRelatedSection(item.section.id));
    button.addEventListener("blur", () => { if (graphUi.hoveredRelatedSectionId === item.section.id) setHoveredRelatedSection(null); });
    entry.append(button); fragment.append(entry);
  }
  if (items.length > 120) { const note = document.createElement("div"); note.className = "brain-related-overflow"; note.textContent = langText(`Pokazano 120 z ${items.length} relacji.`, `Showing 120 of ${items.length} relationships.`); fragment.append(note); }
  list.append(fragment);
}
