/** "What's new": the last five versions, each in a few general words (no details: this is a glance, the changelog has the rest). The newest comes first. No DOM. */

export interface NewsEntry {
  version: string;
  pl: string;
  en: string;
}

/** The entries shown; add the new version at the top and the list keeps the last five. */
const ENTRIES: readonly NewsEntry[] = [
  { version: "0.5.161", pl: "Nowości: krótki przegląd zmian w programie.", en: "What's new: a short glance at the changes of the program." },
  { version: "0.5.160", pl: "Aktualizacja instalatora w miejscu: ustawienia i skróty zostają.", en: "The installer updates in place: settings and shortcuts stay." },
  { version: "0.5.159", pl: "Pełne zarządzanie repozytorium Git z poziomu TypeNova.", en: "Full management of a Git repository from TypeNova." },
  { version: "0.5.158", pl: "Edytowalne tabele w trybie Pisarza i szybsze okno Git.", en: "Editable tables in Writer mode and a faster Git window." },
  { version: "0.5.157", pl: "Podgląd baz SQLite i klonowanie repozytoriów.", en: "A viewer for SQLite databases and cloning of repositories." },
];

export const NEWS_LIMIT = 5;

/** The entries to show: at most `NEWS_LIMIT`, the newest first. */
export function recentNews(entries: readonly NewsEntry[] = ENTRIES): NewsEntry[] {
  const number = (version: string): number[] => version.split(".").map(part => Number.parseInt(part, 10) || 0);
  const newer = (a: NewsEntry, b: NewsEntry): number => {
    const x = number(a.version), y = number(b.version);
    for (let index = 0; index < Math.max(x.length, y.length); index++) if ((x[index] ?? 0) !== (y[index] ?? 0)) return (y[index] ?? 0) - (x[index] ?? 0);
    return 0;
  };
  return [...entries].sort(newer).slice(0, NEWS_LIMIT);
}
