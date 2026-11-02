/** Edits any Mermaid diagram from its preview: a click on a label finds the line of the code it comes from, to change its text, edit the line, move, duplicate or delete it. */
import { langText } from "../i18n/language";
import { blockRange, deleteRange, duplicateRange, matchLines, moveRange, normalizeText, replaceInLine, type LineMatch } from "./line-edit";
import { mermaidKind } from "./formula-block";
import type { Inspector, InspectorHost } from "./mermaid-inspector";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};
const action = (label: string, onClick: () => void, danger = false) => {
  const button = el("button", `mermaid-inspector-btn${danger ? " danger" : ""}`, label); button.type = "button"; button.addEventListener("click", onClick); return button;
};

export function createLineInspector(host: InspectorHost): Inspector {
  const element = el("div", "mermaid-inspector"); element.hidden = true;
  let preview: HTMLElement | null = null, match: LineMatch | null = null, label = "", picked: Element | null = null;

  const lines = () => host.getSource().split("\n");
  const kind = () => mermaidKind(host.getSource());
  const apply = (next: string[]) => host.setSource(next.join("\n"));
  const unmark = () => { picked?.classList.remove("is-picked"); picked = null; };

  const hint = () => element.replaceChildren(el("div", "mermaid-inspector-hint", langText("Kliknij tekst w podglądzie, aby edytować jego linię kodu: zmienić tekst, poprawić całą linię, przesunąć ją, powielić albo usunąć.", "Click a text in the preview to edit its line of code: change the text, fix the whole line, move it, duplicate it or delete it.")));

  const panel = () => {
    if (!match) { hint(); return; }
    const index = match.indices[match.current], all = lines(), line = all[index] ?? "";
    const indent = /^\s*/.exec(line)![0];
    const title = el("div", "mermaid-inspector-title", `${langText("Linia", "Line")} ${index + 1}`);
    const head = el("div", "mermaid-inspector-row"); head.append(title);
    if (match.indices.length > 1) {
      const step = (delta: number) => () => { if (!match) return; match.current = (match.current + delta + match.indices.length) % match.indices.length; label = match.found; panel(); };
      head.append(action("◀", step(-1)), el("span", "mermaid-inspector-hint", `${match.current + 1} ${langText("z", "of")} ${match.indices.length}`), action("▶", step(1)));
      head.children[1].setAttribute("aria-label", langText("Poprzednie dopasowanie", "Previous match")); head.children[3].setAttribute("aria-label", langText("Następne dopasowanie", "Next match"));
    }
    const text = el("input"); text.type = "text"; text.value = label; text.setAttribute("aria-label", langText("Tekst na diagramie", "Text on the diagram"));
    text.addEventListener("input", () => {
      const current = lines(); current[index] = replaceInLine(current[index], label, text.value); label = text.value; apply(current);
      codeField.value = current[index].trim();
    });
    const codeField = el("input", "mermaid-inspector-code"); codeField.type = "text"; codeField.spellcheck = false; codeField.value = line.trim(); codeField.setAttribute("aria-label", langText("Linia kodu", "Line of code"));
    codeField.addEventListener("input", () => { const current = lines(); current[index] = indent + codeField.value; apply(current); });
    const labels = el("div", "mermaid-inspector-row");
    labels.append(el("span", "mermaid-inspector-caption", langText("Tekst", "Text")), text);
    const code = el("div", "mermaid-inspector-row");
    code.append(el("span", "mermaid-inspector-caption", langText("Kod", "Code")), codeField);

    const range = blockRange(all, index, kind());
    const buttons = el("div", "mermaid-inspector-row");
    const move = (direction: -1 | 1) => () => {
      const moved = moveRange(lines(), range, direction); if (!moved || !match) return;
      apply(moved.lines); match = { ...match, indices: [moved.start], current: 0 }; panel();
    };
    buttons.append(
      action(langText("Wyżej", "Move up"), move(-1)), action(langText("Niżej", "Move down"), move(1)),
      action(langText("Powiel", "Duplicate"), () => { apply(duplicateRange(lines(), range)); select(null); }),
      action(range[1] > range[0] ? langText("Usuń blok", "Delete block") : langText("Usuń linię", "Delete line"), () => { apply(deleteRange(lines(), range)); select(null); }, true),
    );
    element.replaceChildren(head, labels, code, buttons);
  };

  function select(next: LineMatch | null) { match = next; unmark(); panel(); }
  hint();

  return {
    element,
    pick(target) {
      const holder = target?.closest("text, foreignObject") ?? target;
      const clicked = holder ? normalizeText(holder.textContent ?? "") : "";
      if (!holder || !clicked) { select(null); return; }
      const same = preview ? [...preview.querySelectorAll("text, foreignObject")].filter(item => normalizeText(item.textContent ?? "") === clicked) : [];
      const found = matchLines(lines(), clicked, Math.max(0, same.indexOf(holder.closest("text, foreignObject") ?? holder)));
      select(found); label = found?.found ?? "";
      if (found) { picked = holder; holder.classList.add("is-picked"); panel(); }
      else element.replaceChildren(el("div", "mermaid-inspector-hint", langText("Nie znaleziono tego tekstu w kodzie – edytuj kod po lewej.", "That text was not found in the code – edit the code on the left.")));
    },
    refresh(root) { preview = root; picked = null; },
    cancelLink: () => false,
    setActive(active) { element.hidden = !active; if (!active) { match = null; unmark(); hint(); } },
  };
}
