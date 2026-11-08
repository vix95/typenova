/** The right-hand side of the Git panel: one commit's message, author, parents and changed files, and the diff of the chosen file. */
import { ICONS } from "../ui/icons";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { gitCommitDetail, gitFileDiff, type GitCommitDetail, type GitFileChange } from "./git-api";
import { diffLines, shortHash } from "./git-graph";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

const STATUS_LABELS: Record<string, [string, string]> = {
  A: ["Dodany", "Added"], M: ["Zmieniony", "Modified"], D: ["Usunięty", "Deleted"], R: ["Przeniesiony", "Renamed"], C: ["Skopiowany", "Copied"], T: ["Zmieniony typ", "Type changed"],
};

const STATUS_ICONS: Record<string, string> = { A: ICONS.fileAdded, M: ICONS.fileModified, D: ICONS.fileDeleted, R: ICONS.fileRenamed, C: ICONS.fileAdded, T: ICONS.fileModified };

export interface DetailPanel {
  element: HTMLElement;
  show(hash: string): Promise<void>;
  clear(): void;
}

export function createDetailPanel(host: { repo(): string; openCommit(hash: string): void }): DetailPanel {
  const element = el("div", "git-details");
  const head = el("div", "git-detail-head"), files = el("div", "git-files"), diff = el("pre", "git-diff");
  diff.hidden = true;
  element.append(head, files, diff);
  let token = 0, current = "";

  const empty = () => { head.replaceChildren(el("div", "git-hint", langText("Wybierz commit z listy, aby zobaczyć jego zmiany.", "Pick a commit from the list to see its changes."))); files.replaceChildren(); diff.hidden = true; };

  const renderHead = (detail: GitCommitDetail) => {
    const [subject, ...rest] = detail.body.split("\n");
    const title = el("div", "git-detail-title", subject);
    const meta = el("div", "git-detail-meta");
    const date = new Date(detail.date);
    meta.append(
      el("span", "git-detail-author", `${detail.author} <${detail.email}>`),
      el("span", "", Number.isNaN(date.getTime()) ? detail.date : date.toLocaleString(document.documentElement.lang || undefined)),
    );
    const hashRow = el("div", "git-detail-hash");
    const hashText = el("code", "", detail.hash); hashText.title = detail.hash;
    const copy = el("button", "git-small-btn", langText("Kopiuj hash", "Copy hash")); copy.type = "button";
    copy.addEventListener("click", () => void navigator.clipboard.writeText(detail.hash).then(() => showToast(langText("Skopiowano hash commitu.", "Commit hash copied.")), () => showToast(langText("Nie udało się skopiować.", "Could not copy."))));
    hashRow.append(hashText, copy);
    head.replaceChildren(title, meta, hashRow);
    if (detail.parents.length) {
      const parents = el("div", "git-detail-parents", langText(detail.parents.length > 1 ? "Rodzice: " : "Rodzic: ", detail.parents.length > 1 ? "Parents: " : "Parent: "));
      for (const parent of detail.parents) {
        const link = el("button", "git-link", shortHash(parent)); link.type = "button"; link.addEventListener("click", () => host.openCommit(parent)); parents.append(link, " ");
      }
      head.append(parents);
    }
    const body = rest.join("\n").trim();
    if (body) head.append(el("pre", "git-detail-body", body));
    if (detail.committer && detail.committer !== detail.author) head.append(el("div", "git-hint", `${langText("Zatwierdził", "Committed by")}: ${detail.committer}`));
  };

  const showDiff = async (hash: string, file: GitFileChange, row: HTMLElement) => {
    files.querySelectorAll(".git-file.selected").forEach(node => node.classList.remove("selected"));
    row.classList.add("selected");
    const mine = ++token;
    diff.hidden = false; diff.replaceChildren(el("div", "git-hint", langText("Wczytywanie zmian…", "Loading changes…")));
    try {
      const text = await gitFileDiff(host.repo(), hash, file.path, file.oldPath);
      if (mine !== token) return;
      if (!text.trim()) { diff.replaceChildren(el("div", "git-hint", langText("Brak zmian w treści (np. sama zmiana nazwy lub uprawnień).", "No content changes (for example only a rename or a mode change)."))); return; }
      const fragment = document.createDocumentFragment();
      for (const line of diffLines(text)) fragment.append(el("div", `git-diff-line ${line.kind}`, line.text || " "));
      diff.replaceChildren(fragment); diff.scrollTop = 0;
    } catch (error) { if (mine === token) diff.replaceChildren(el("div", "git-hint", String(error))); }
  };

  const renderFiles = (detail: GitCommitDetail) => {
    const total = detail.files.reduce((sum, file) => [sum[0] + (file.added ?? 0), sum[1] + (file.deleted ?? 0)], [0, 0]);
    const summary = el("div", "git-files-summary");
    summary.append(`${langText("Zmienione pliki", "Changed files")}: ${detail.files.length} `, el("span", "git-added", `+${total[0]}`), " ", el("span", "git-deleted", `−${total[1]}`));
    const list = el("div", "git-file-list");
    for (const file of detail.files) {
      const row = el("button", "git-file"); row.type = "button";
      const status = el("span", `git-status status-${file.status}`); status.innerHTML = STATUS_ICONS[file.status] ?? ICONS.fileModified; const label = STATUS_LABELS[file.status];
      if (label) status.title = langText(label[0], label[1]);
      const name = el("span", "git-file-name", file.oldPath ? `${file.oldPath} → ${file.path}` : file.path); name.title = name.textContent ?? "";
      const stat = el("span", "git-file-stat");
      if (file.added === null) stat.textContent = langText("binarny", "binary");
      else stat.append(el("span", "git-added", `+${file.added}`), " ", el("span", "git-deleted", `−${file.deleted ?? 0}`));
      row.append(status, name, stat);
      row.addEventListener("click", () => void showDiff(detail.hash, file, row));
      list.append(row);
    }
    files.replaceChildren(summary, list);
    const first = list.querySelector<HTMLElement>(".git-file");
    if (first && detail.files.length) void showDiff(detail.hash, detail.files[0], first);
    else diff.hidden = true;
  };

  empty();
  return {
    element,
    clear() { token++; current = ""; empty(); },
    async show(hash) {
      if (hash === current) return;
      current = hash; const mine = ++token;
      files.replaceChildren(); diff.hidden = true; head.replaceChildren(el("div", "git-hint", langText("Wczytywanie…", "Loading…")));
      try {
        const detail = await gitCommitDetail(host.repo(), hash);
        if (mine !== token) return;
        renderHead(detail); renderFiles(detail);
      } catch (error) { if (mine === token) head.replaceChildren(el("div", "git-hint", String(error))); }
    },
  };
}
