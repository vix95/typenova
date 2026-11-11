/** A delimited-text (CSV/TSV/TXT) parser that takes the text in pieces (pure), so that a file of hundreds of megabytes never has to be in memory at once. */

export interface DelimitedParser {
  /** Parses the next piece of text; rows that end inside it are delivered at once, an unfinished one waits for the next piece. */
  feed(text: string): void;
  /** Delivers the last row (a file does not have to end with a line break). */
  end(): void;
}

const QUOTE = 34, LF = 10, CR = 13;

/**
 * RFC 4180: a cell starting with a quote may hold the delimiter, line breaks and doubled quotes. Line breaks are LF, CRLF or CR.
 * The state (inside quotes, a pending CR, the half-read cell) is kept between pieces, so the pieces may be cut anywhere.
 */
export function createDelimitedParser(delimiter: string, onRow: (row: string[]) => void): DelimitedParser {
  const delimiterCode = delimiter.charCodeAt(0);
  let row: string[] = [];
  let cell = "";
  let inQuotes = false, afterQuote = false, crPending = false;

  const endRow = (): void => { onRow(row); row = []; };

  function feed(text: string): void {
    let start = 0;
    const length = text.length;
    for (let index = 0; index < length; index++) {
      const code = text.charCodeAt(index);
      if (crPending) { crPending = false; if (code === LF) { start = index + 1; continue; } }
      if (inQuotes) {
        if (code === QUOTE) { cell += text.slice(start, index); start = index + 1; inQuotes = false; afterQuote = true; }
        continue;
      }
      if (afterQuote) {
        afterQuote = false;
        if (code === QUOTE) { cell += '"'; inQuotes = true; start = index + 1; continue; }
        start = index;
      }
      if (code === QUOTE && index === start && cell === "") { inQuotes = true; start = index + 1; }
      else if (code === delimiterCode) { row.push(cell + text.slice(start, index)); cell = ""; start = index + 1; }
      else if (code === LF || code === CR) {
        row.push(cell + text.slice(start, index)); cell = ""; start = index + 1;
        crPending = code === CR;
        endRow();
      }
    }
    cell += text.slice(start);
  }

  function end(): void {
    if (inQuotes || afterQuote || cell !== "" || row.length) { row.push(cell); cell = ""; endRow(); }
    inQuotes = afterQuote = crPending = false;
  }

  return { feed, end };
}

const CANDIDATES = [",", ";", "\t", "|"] as const;
/** Used for a file without any delimiter (a plain text or log file): it never occurs in text, so every line is one cell. */
export const NO_DELIMITER = "\u0001";

/** The delimiter of a file from its first lines: the candidate that splits them into the same number (above one) of cells most consistently. Plain text without a delimiter gives NO_DELIMITER. */
export function detectDelimiter(sample: string, extension: string): string {
  if (extension === "tsv") return "\t";
  const lines = sample.split(/\r?\n/).filter(line => line.trim() !== "").slice(0, 20);
  if (lines.length > 1 && sample.length > 4096) lines.pop(); // the last line of a cut sample may be incomplete
  let best = NO_DELIMITER, bestScore = 0;
  for (const candidate of CANDIDATES) {
    const counts = lines.map(line => { let n = 1; const parser = createDelimitedParser(candidate, row => { n = row.length; }); parser.feed(line); parser.end(); return n; });
    if (!counts.length || counts[0] < 2) continue;
    const agreeing = counts.filter(count => count === counts[0]).length;
    const score = counts[0] * (agreeing / counts.length) ** 3;
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}
