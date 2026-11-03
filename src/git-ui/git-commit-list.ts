/** The commit list of the Git panel: rows with the graph, reference labels, author, date and hash, loaded page by page. */
import { langText } from "../i18n/language";
import { gitLog, type GitCommit } from "./git-api";
import { classifyRefs, layoutGraph, relativeTime, shortHash, type GraphRow, type GraphState } from "./git-graph";

const PAGE = 200, LANE_WIDTH = 14, ROW_HEIGHT = 28, MAX_LANES = 10;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};

const laneX = (lane: number) => Math.min(lane, MAX_LANES - 1) * LANE_WIDTH + LANE_WIDTH / 2 + 2;
const laneColour = (lane: number) => `var(--git-lane-${lane % 8})`;
const columnWidth = (lanes: number) => Math.min(lanes, MAX_LANES) * LANE_WIDTH + 8;

/** SVG of one row of the graph: the lines of the lanes and the commit's dot (a ring for a merge). */
function graphSvg(row: GraphRow, commit: GitCommit, width: number): string {
  const half = ROW_HEIGHT / 2, node = laneX(row.lane), paths: string[] = [];
  for (const lane of row.passes) paths.push(`<path d="M${laneX(lane)} 0V${ROW_HEIGHT}" stroke="${laneColour(lane)}"/>`);
  for (const lane of row.joins) paths.push(lane === row.lane ? `<path d="M${node} 0V${half}" stroke="${laneColour(lane)}"/>` : `<path d="M${laneX(lane)} 0Q${laneX(lane)} ${half} ${node} ${half}" stroke="${laneColour(lane)}"/>`);
  for (const lane of row.parentLanes) paths.push(lane === row.lane ? `<path d="M${node} ${half}V${ROW_HEIGHT}" stroke="${laneColour(lane)}"/>` : `<path d="M${node} ${half}Q${laneX(lane)} ${half} ${laneX(lane)} ${ROW_HEIGHT}" stroke="${laneColour(lane)}"/>`);
  const merge = commit.parents.length > 1;
  return `<svg class="git-graph" width="${width}" height="${ROW_HEIGHT}" viewBox="0 0 ${width} ${ROW_HEIGHT}" aria-hidden="true" focusable="false"><g fill="none" stroke-width="1.8" stroke-linecap="round">${paths.join("")}</g><circle cx="${node}" cy="${half}" r="${merge ? 3.6 : 4.4}" fill="${merge ? "var(--ui-panel)" : laneColour(row.lane)}" stroke="${laneColour(row.lane)}" stroke-width="2"/></svg>`;
}

function buildRow(commit: GitCommit, row: GraphRow, width: number, remotes: ReadonlySet<string>): HTMLElement {
  const now = Date.now(), language = document.documentElement.lang || "en";
  const item = el("div", "git-row"); item.setAttribute("role", "option"); item.setAttribute("aria-selected", "false"); item.dataset.hash = commit.hash;
  item.insertAdjacentHTML("afterbegin", graphSvg(row, commit, width));
  const message = el("div", "git-subject");
  for (const ref of classifyRefs(commit.refs, remotes)) message.append(el("span", `git-ref ${ref.kind}${ref.current ? " current" : ""}`, ref.label));
  const text = el("span", "git-msg", commit.subject); text.title = commit.subject; message.append(text);
  const date = el("span", "git-date", relativeTime(commit.date, now, language)); date.title = new Date(commit.date).toLocaleString(language);
  const author = el("span", "git-author", commit.author); author.title = `${commit.author} <${commit.email}>`;
  item.append(message, author, date, el("code", "git-hash", shortHash(commit.hash)));
  return item;
}

export interface CommitList {
  element: HTMLElement;
  /** Starts the list again for a repository and a branch, tag or hash (empty = every branch). */
  reset(repo: string, rev: string, remotes: ReadonlySet<string>): Promise<void>;
  select(hash: string, scroll?: boolean): void;
  /** Selects a commit, loading further pages until it is found; false when it is not in this list. */
  jumpTo(hash: string): Promise<boolean>;
}

export function createCommitList(onSelect: (hash: string) => void): CommitList {
  const element = el("div", "git-commits"); element.tabIndex = 0; element.setAttribute("role", "listbox"); element.setAttribute("aria-label", langText("Commity", "Commits"));
  const rows = new Map<string, HTMLElement>();
  let repo = "", rev = "", remotes: ReadonlySet<string> = new Set(), loading = false, finished = false, loaded = 0, maxLanes = 1, selected = "";
  let commits: GitCommit[] = [], graphState: GraphState = [];

  const select = (hash: string, scroll = true) => {
    const previous = rows.get(selected); previous?.classList.remove("selected"); previous?.setAttribute("aria-selected", "false");
    selected = hash;
    const row = rows.get(hash);
    row?.classList.add("selected"); row?.setAttribute("aria-selected", "true");
    if (scroll) row?.scrollIntoView({ block: "nearest" });
    onSelect(hash);
  };

  const loadMore = async (): Promise<void> => {
    if (loading || finished) return;
    loading = true;
    const mine = `${repo}\u0000${rev}`;
    try {
      const page = await gitLog(repo, rev, loaded, PAGE);
      if (mine !== `${repo}\u0000${rev}`) return; // another branch was chosen meanwhile
      const laid = layoutGraph(page, graphState);
      graphState = laid.state; loaded += page.length; commits = commits.concat(page);
      const widest = Math.max(maxLanes, ...laid.rows.map(row => row.width));
      if (widest !== maxLanes) { maxLanes = widest; element.querySelectorAll("svg.git-graph").forEach(svg => svg.setAttribute("width", String(columnWidth(maxLanes)))); }
      const fragment = document.createDocumentFragment();
      page.forEach((commit, index) => {
        const row = buildRow(commit, laid.rows[index], columnWidth(maxLanes), remotes);
        row.addEventListener("click", () => { select(commit.hash, false); element.focus(); });
        rows.set(commit.hash, row); fragment.append(row);
      });
      element.append(fragment);
      if (page.length < PAGE) finished = true;
      if (!commits.length) element.replaceChildren(el("div", "git-hint", langText("Brak commitów.", "No commits.")));
      else if (!selected) select(commits[0].hash, false);
    } catch (error) { element.append(el("div", "git-hint", String(error))); finished = true; } finally { loading = false; }
  };

  element.addEventListener("scroll", () => { if (element.scrollTop + element.clientHeight > element.scrollHeight - 400) void loadMore(); });
  element.addEventListener("keydown", event => {
    const step = ({ ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 } as Record<string, number>)[event.key];
    if (step === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = commits.findIndex(commit => commit.hash === selected);
    const target = event.key === "Home" ? 0 : event.key === "End" ? commits.length - 1 : Math.max(0, Math.min(commits.length - 1, index + (step ?? 0)));
    if (commits[target]) select(commits[target].hash);
    if (target >= commits.length - 20) void loadMore();
  });

  return {
    element, select,
    async reset(nextRepo, nextRev, nextRemotes) {
      repo = nextRepo; rev = nextRev; remotes = nextRemotes;
      element.replaceChildren(); rows.clear(); commits = []; graphState = []; maxLanes = 1; selected = ""; loaded = 0; finished = false; loading = false;
      await loadMore();
    },
    async jumpTo(hash) {
      while (!rows.has(hash) && !finished) await loadMore();
      if (!rows.has(hash)) return false;
      select(hash); return true;
    },
  };
}
