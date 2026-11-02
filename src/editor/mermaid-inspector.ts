/** Edits a flowchart by clicking its preview: select a node or link, then rename it, change its shape or style, connect, add or delete. */
import { langText } from "../i18n/language";
import { releaseCustomSelects, themeSelect } from "../ui/custom-select";
import { addLink, addNode, describeNode, listEdges, removeEdge, removeNode, updateEdge, updateNode, type FlowEdge } from "./flowchart-edit";
import { flowchartNodeIds } from "./formula-block";
import { LINK_STYLES, NODE_SHAPES } from "./mermaid-templates";

export interface InspectorHost { getSource(): string; setSource(text: string): void }
export interface Inspector {
  element: HTMLElement;
  /** Called with the element that was clicked in the preview (null for the empty background). */
  pick(target: Element | null): void;
  /** Re-marks the selection after the preview was drawn again. */
  refresh(preview: HTMLElement): void;
  /** Leaves "connect to…" mode; true when it was active. */
  cancelLink(): boolean;
  setActive(active: boolean): void;
}

type Selection = { kind: "node"; id: string } | { kind: "edge"; edge: FlowEdge } | null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};
const action = (label: string, onClick: () => void, danger = false) => {
  const button = el("button", `mermaid-inspector-btn${danger ? " danger" : ""}`, label); button.type = "button"; button.addEventListener("click", onClick); return button;
};

/** Adds a wide invisible copy next to every link line so thin lines are easy to hit. */
function decorate(preview: HTMLElement): void {
  preview.querySelectorAll("path.edge-hit").forEach(node => node.remove());
  preview.querySelectorAll<SVGPathElement>("path.flowchart-link").forEach(path => {
    const hit = path.cloneNode(false) as SVGPathElement;
    for (const name of ["id", "marker-end", "marker-start", "style", "class"]) hit.removeAttribute(name);
    hit.setAttribute("class", "edge-hit"); hit.setAttribute("data-edge", path.id);
    path.after(hit);
  });
}

function nodeIdOf(element: Element): string | null {
  const group = element.closest("g.node");
  if (!group) return null;
  // Mermaid prefixes the element ids with the id given to render(), so the node id is what sits between "flowchart-" and the counter.
  return group.getAttribute("data-id") || /flowchart-(.+)-\d+$/.exec(group.id)?.[1] || null;
}

/** `prefix-L_A_B_0` and `L_A_B_0` both name the first link from A to B. */
const edgeKey = (id: string) => /(?:^|-)(L_.+_\d+)$/.exec(id)?.[1] ?? id;

function edgeIdOf(element: Element): string | null {
  const raw = element.closest("[data-edge]")?.getAttribute("data-edge")
    || element.closest("path.flowchart-link")?.id
    || element.closest("g.edgeLabel")?.querySelector("[data-id]")?.getAttribute("data-id");
  return raw ? edgeKey(raw) : null;
}

export function createInspector(host: InspectorHost): Inspector {
  const element = el("div", "mermaid-inspector"); element.hidden = true;
  let selection: Selection = null, linkFrom: string | null = null, preview: HTMLElement | null = null;

  const apply = (source: string) => host.setSource(source);
  const edges = () => listEdges(host.getSource());
  const findEdge = (id: string) => edges().find(edge => `L_${edge.from}_${edge.to}_${edge.index}` === id) ?? null;

  const mark = () => {
    if (!preview) return;
    preview.querySelectorAll(".is-selected").forEach(node => node.classList.remove("is-selected"));
    preview.classList.toggle("linking", linkFrom !== null);
    if (selection?.kind === "node") {
      for (const group of preview.querySelectorAll("g.node")) if (nodeIdOf(group) === selection.id) group.classList.add("is-selected");
    } else if (selection?.kind === "edge") {
      const { from, to, index } = selection.edge;
      preview.querySelector(`path.flowchart-link[id$="L_${from}_${to}_${index}"]`)?.classList.add("is-selected");
    }
  };

  const nodePanel = (id: string) => {
    const info = describeNode(host.getSource(), id);
    if (!info) { select(null); return; }
    const title = el("div", "mermaid-inspector-title", `${langText("Węzeł", "Node")} ${id}`);
    const text = el("input"); text.type = "text"; text.value = info.text; text.setAttribute("aria-label", langText("Tekst węzła", "Node text"));
    text.addEventListener("input", () => apply(updateNode(host.getSource(), id, { text: text.value })));
    const shape = el("select"); shape.setAttribute("aria-label", langText("Kształt węzła", "Node shape"));
    NODE_SHAPES.forEach((item, index) => { const option = el("option", "", langText(item.pl, item.en)); option.value = String(index); shape.append(option); });
    shape.value = String(info.shape);
    shape.addEventListener("change", () => apply(updateNode(host.getSource(), id, { shape: Number(shape.value) })));
    const row = el("div", "mermaid-inspector-row"); row.append(text, shape);
    const buttons = el("div", "mermaid-inspector-row");
    buttons.append(
      action(langText("Dodaj kolejny węzeł", "Add next node"), () => {
        const added = addNode(host.getSource(), flowchartNodeIds(host.getSource()), id, info.shape, langText("Nowy węzeł", "New node"));
        apply(added.source); select({ kind: "node", id: added.id });
      }),
      action(langText("Połącz z…", "Connect to…"), () => { linkFrom = id; render(); mark(); }),
      action(langText("Usuń węzeł", "Delete node"), () => { apply(removeNode(host.getSource(), id)); select(null); }, true),
    );
    element.replaceChildren(title, row, buttons);
    text.focus(); text.select();
  };

  const edgePanel = (edge: FlowEdge) => {
    const title = el("div", "mermaid-inspector-title", `${langText("Połączenie", "Link")} ${edge.from} → ${edge.to}`);
    const label = el("input"); label.type = "text"; label.value = edge.label; label.placeholder = langText("Etykieta (opcjonalnie)", "Label (optional)"); label.setAttribute("aria-label", label.placeholder);
    label.addEventListener("input", () => apply(updateEdge(host.getSource(), edge.from, edge.to, edge.index, { label: label.value })));
    const style = el("select"); style.setAttribute("aria-label", langText("Rodzaj połączenia", "Link style"));
    LINK_STYLES.forEach((item, index) => { const option = el("option", "", langText(item.pl, item.en)); option.value = String(index); style.append(option); });
    style.value = String(Math.max(0, LINK_STYLES.findIndex(item => item.arrow === edge.arrow)));
    style.addEventListener("change", () => apply(updateEdge(host.getSource(), edge.from, edge.to, edge.index, { arrow: LINK_STYLES[Number(style.value)].arrow })));
    const row = el("div", "mermaid-inspector-row"); row.append(label, style, action(langText("Usuń połączenie", "Delete link"), () => { apply(removeEdge(host.getSource(), edge.from, edge.to, edge.index)); select(null); }, true));
    element.replaceChildren(title, row);
    label.focus();
  };

  const renderPanel = () => {
    if (linkFrom) { element.replaceChildren(el("div", "mermaid-inspector-title", langText(`Kliknij węzeł, z którym połączyć ${linkFrom} (Esc – anuluj)`, `Click the node to connect ${linkFrom} to (Esc to cancel)`))); return; }
    if (!selection) { element.replaceChildren(el("div", "mermaid-inspector-hint", langText("Kliknij węzeł lub linię w podglądzie, aby go edytować: zmienić tekst i kształt, dodać kolejny węzeł, połączyć albo usunąć.", "Click a node or a line in the preview to edit it: change its text and shape, add the next node, connect or delete."))); return; }
    if (selection.kind === "node") nodePanel(selection.id); else edgePanel(selection.edge);
  };
  // The panel is rebuilt on every change; its selects get the themed dropdown each time.
  const render = () => {
    releaseCustomSelects(element); renderPanel();
    element.querySelectorAll("select").forEach(themeSelect);
  };
  function select(next: Selection) { selection = next; linkFrom = null; render(); mark(); }
  render();

  return {
    element,
    pick(target) {
      const node = target && nodeIdOf(target);
      if (linkFrom) {
        if (node && node !== linkFrom) { const from = linkFrom; apply(addLink(host.getSource(), from, node)); select({ kind: "node", id: node }); }
        return;
      }
      if (node) { select({ kind: "node", id: node }); return; }
      const edgeId = target && edgeIdOf(target), edge = edgeId ? findEdge(edgeId) : null;
      select(edge ? { kind: "edge", edge } : null);
    },
    refresh(root) {
      preview = root; decorate(root);
      if (selection?.kind === "node" && !describeNode(host.getSource(), selection.id)) select(null); else mark();
    },
    cancelLink() { if (!linkFrom) return false; linkFrom = null; render(); mark(); return true; },
    setActive(active) { element.hidden = !active; if (!active) { selection = null; linkFrom = null; render(); } },
  };
}
