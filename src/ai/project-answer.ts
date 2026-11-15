/** The parts of a chat message that belong to the project: what was sent to the model (the passages, listed so that nothing leaves unseen), the citations in an answer that open the cited section, and the changes the assistant proposes, shown as differences that are applied only when the person says so. */
import { documentState } from "../documents/document-state";
import { showFileTab } from "../documents/file-navigation";
import { textOfTab } from "../documents/link-rename-apply";
import { sameSessionPath } from "../documents/session";
import { button, el } from "../editor/bookmark-browser";
import { view } from "../editor/editor-view";
import { loadTextFile } from "../filesystem/text-io";
import { openGraphSection } from "../graph-ui/selection";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { locateProposal, proposalDiff, resolveFile, type EditProposal } from "./edit-proposals";
import type { Source } from "./project-prompt";
import type { ProjectTurn } from "./project-turn";

const sourceTitle = (source: Source): string => `${source.file}${source.section ? ` › ${source.section}` : ""}`;

/** An answer's paragraph with its citations turned into buttons that open the cited section (text is put in with textContent: an answer can hold anything). */
export function renderProse(parent: HTMLElement, text: string, sources: readonly Source[]): void {
  const byId = new Map(sources.map(source => [source.id, source]));
  const paragraph = el("p", "ai-text");
  let last = 0;
  for (const match of text.matchAll(/\[(\d{1,3})\]/g)) {
    const source = byId.get(Number(match[1]));
    if (!source) continue;
    paragraph.append(document.createTextNode(text.slice(last, match.index)));
    const cite = el("button", "ai-cite", match[0]);
    cite.type = "button";
    const label = langText(`Źródło ${source.id}: ${sourceTitle(source)}, wiersz ${source.line}`, `Source ${source.id}: ${sourceTitle(source)}, line ${source.line}`);
    cite.dataset.tooltip = label; cite.setAttribute("aria-label", label);
    cite.addEventListener("click", () => { void openGraphSection({ path: source.path, line: source.line }); });
    paragraph.append(cite);
    last = (match.index ?? 0) + match[0].length;
  }
  paragraph.append(document.createTextNode(text.slice(last)));
  parent.append(paragraph);
}

function turnSummary(turn: ProjectTurn, provider: string): string {
  const notes = new Set(turn.sources.map(source => source.path)).size;
  const where = turn.folder ? langText(`z folderu „${turn.folder}”`, `from the folder “${turn.folder}”`) : langText("z projektu", "from the project");
  return langText(`${turn.sources.length} fragmentów z ${notes} notatek ${where} wysłano do ${provider}`, `${turn.sources.length} passages from ${notes} notes ${where} sent to ${provider}`);
}

/** What was sent to the model with a message, as a folded list (every passage opens at its place): the person can always see which notes the answer rests on. */
export function renderSentSources(turn: ProjectTurn, provider: string): HTMLElement {
  const box = el("div", "ai-sources-sent");
  if (turn.tooLarge) { box.append(el("p", "ai-context-caption", langText("Projekt ma za dużo plików, żeby go przeszukać. Nic z projektu nie zostało wysłane.", "The project has too many files to search. Nothing from the project was sent."))); return box; }
  if (!turn.sources.length) { box.append(el("p", "ai-context-caption", langText(`Nie znaleziono pasujących fragmentów w ${turn.fileCount} notatkach. Nic z projektu nie zostało wysłane.`, `No matching passages in ${turn.fileCount} notes. Nothing from the project was sent.`))); return box; }
  const details = el("details", "ai-sources-details");
  details.append(el("summary", "ai-context-caption", turnSummary(turn, provider)));
  const list = el("ol", "ai-sources-list");
  for (const source of turn.sources) {
    const item = el("li", "ai-sources-item");
    const open = el("button", "ai-source-link", `[${source.id}] ${sourceTitle(source)}`);
    open.type = "button";
    open.dataset.tooltip = langText(`Otwórz: ${source.file}, wiersz ${source.line}`, `Open: ${source.file}, line ${source.line}`);
    open.addEventListener("click", () => { void openGraphSection({ path: source.path, line: source.line }); });
    item.append(open);
    list.append(item);
  }
  details.append(list);
  box.append(details);
  const limits = [turn.clipped ? langText("Dłuższe fragmenty przycięto.", "Longer passages were shortened.") : "", turn.dropped ? langText(`Pominięto ${turn.dropped} fragmentów, które się nie zmieściły.`, `${turn.dropped} passages that did not fit were left out.`) : ""].filter(Boolean).join(" ");
  if (limits) box.append(el("p", "ai-context-caption", limits));
  return box;
}

/** The text of a note now: the open document as it is in the editor (saved or not), else the file. */
async function currentText(path: string): Promise<string> {
  const tab = documentState.tabs.find(item => sameSessionPath(item.path, path));
  return tab ? textOfTab(tab).toString() : (await loadTextFile(path)).text;
}

function diffView(lines: NonNullable<ReturnType<typeof proposalDiff>>): HTMLElement {
  const block = el("pre", "ai-diff");
  for (const line of lines) {
    const row = el("span", `ai-diff-line ai-diff-${line.kind}`, `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "} ${line.text}`);
    block.append(row, document.createTextNode("\n"));
  }
  return block;
}

/** One proposed change as a card: the file, the difference with its surroundings, and Apply / Reject. Applying puts the change into the editor (undoable, not saved); the file on disk changes only when the person saves. */
function proposalCard(proposal: EditProposal, known: readonly { file: string; path: string }[]): HTMLElement {
  const card = el("div", "ai-proposal");
  const status = el("span", "ai-proposal-status");
  const head = el("div", "ai-proposal-head");
  head.append(el("span", "ai-proposal-file", proposal.file), status);
  const body = el("div", "ai-proposal-body");
  const actions = el("div", "ai-proposal-actions");
  card.append(head, body, actions);
  const path = resolveFile(proposal.file, known);
  const finish = (text: string) => { status.textContent = text; actions.replaceChildren(); };
  if (!path) { finish(langText("Nie ma takiego pliku w projekcie.", "No such file in the project.")); return card; }
  void currentText(path).then(text => {
    const diff = proposalDiff(text, proposal);
    if (!diff) { finish(langText("Tego tekstu nie ma już w pliku (albo występuje kilka razy): zmiana nie pasuje.", "This text is no longer in the file (or occurs several times): the change does not fit.")); return; }
    body.append(diffView(diff));
    const apply = button("ai-flat-button primary-flat", "check", langText("Zastosuj w edytorze", "Apply in the editor"), () => { void applyProposal(path, proposal).then(message => finish(message)); }, true);
    const reject = button("ai-flat-button", "close", langText("Odrzuć", "Reject"), () => finish(langText("Odrzucono.", "Rejected.")), true);
    actions.append(apply, reject);
  }).catch(() => finish(langText("Nie można odczytać pliku.", "The file could not be read.")));
  return card;
}

async function applyProposal(path: string, proposal: EditProposal): Promise<string> {
  const shown = await showFileTab(path);
  if (shown !== "shown") return langText("Nie można otworzyć pliku.", "The file could not be opened.");
  const place = locateProposal(view.state.doc.toString(), proposal);
  if (!place.ok) return langText("Tekst w pliku się zmienił: zmiana nie pasuje.", "The text in the file has changed: the change does not fit.");
  view.dispatch({ changes: { from: place.from, to: place.to, insert: proposal.replace }, selection: { anchor: place.from, head: place.from + proposal.replace.length }, userEvent: "input.ai", scrollIntoView: true });
  view.focus();
  showToast(langText("Zmiana jest w edytorze, ale nie zapisana. Cofnij ją (Ctrl+Z) albo zapisz (Ctrl+S).", "The change is in the editor but not saved. Undo it (Ctrl+Z) or save (Ctrl+S)."));
  return langText("Zastosowano w edytorze (niezapisane).", "Applied in the editor (not saved).");
}

/** The proposals of a finished answer, one card each. */
export function renderProposals(container: HTMLElement, proposals: readonly EditProposal[], known: readonly { file: string; path: string }[]): void {
  for (const proposal of proposals) container.append(proposalCard(proposal, known));
}
