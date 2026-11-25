/** "What's new": the last five versions, each with the day of its release and a few general words (no details: this is a glance, the changelog has the rest). The newest comes first. No DOM. */

export interface NewsEntry {
  version: string;
  /** The day of the release, `YYYY-MM-DD`. */
  date: string;
  pl: string;
  en: string;
}

/** The entries shown; add the new version at the top and the list keeps the last five. */
const ENTRIES: readonly NewsEntry[] = [
  { version: "0.5.167", date: "2026-11-25", pl: "Powiadomienie o nowej wersji w rogu okna i częstsze sprawdzanie.", en: "A notice of a new version at the corner of the window, and more frequent checks." },
  { version: "0.5.166", date: "2026-11-25", pl: "Nowości w dużym oknie z datami i wyraźniejsze sprawdzanie aktualizacji.", en: "A large What's new window with dates, and a clearer update check." },
  { version: "0.5.165", date: "2026-11-25", pl: "Automatyczne aktualizacje: nowe wersje instalują się po potwierdzeniu.", en: "Automatic updates: new versions install after you confirm." },
  { version: "0.5.164", date: "2026-11-25", pl: "Czytelniejszy graf gałęzi w oknie Git.", en: "A clearer branch graph in the Git window." },
  { version: "0.5.163", date: "2026-11-25", pl: "Poprawki zapamiętywania rozmiaru okna.", en: "Fixes for remembering the window size." },
  { version: "0.5.162", date: "2026-11-25", pl: "Okno pamięta tryb, rozmiar i położenie.", en: "The window remembers its mode, size and position." },
  { version: "0.5.161", date: "2026-11-25", pl: "Nowości: krótki przegląd zmian w programie.", en: "What's new: a short glance at the changes of the program." },
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

/** A release day (`YYYY-MM-DD`) written out in the language ("25 listopada 2026", "25 Nov 2026"); anything else is returned unchanged. */
export function formatNewsDate(date: string, language: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(day.getTime()) || day.getUTCDate() !== Number(match[3])) return date;
  const polish = language.startsWith("pl");
  return new Intl.DateTimeFormat(polish ? "pl-PL" : "en-GB", { day: "numeric", month: polish ? "long" : "short", year: "numeric", timeZone: "UTC" }).format(day);
}
