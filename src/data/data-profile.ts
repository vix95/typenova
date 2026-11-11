/** The profile of a whole delimited file, built row by row (pure): column statistics, the first rows for the table, and what was found odd. */
import { ColumnAccumulator, type ColumnProfile } from "./column-stats.js";
import { parseNumber, parseDay } from "./value-parse.js";

export const PREVIEW_ROWS = 500;
export const MAX_COLUMNS = 200;

export interface DataProfile {
  columns: ColumnProfile[];
  /** Data rows (without the header). */
  rows: number;
  /** Rows with a different number of cells than the header. */
  ragged: number;
  hasHeader: boolean;
  /** The first rows, as they are in the file (for the table). */
  preview: string[][];
  /** Columns beyond MAX_COLUMNS that were not analysed. */
  skippedColumns: number;
}

/** The first row is a header unless every filled cell of it is a number or a date (then the file starts with data). */
export function looksLikeHeader(row: readonly string[]): boolean {
  const filled = row.filter(cell => cell.trim() !== "");
  if (!filled.length) return false;
  return filled.some(cell => parseNumber(cell) !== parseNumber(cell) && parseDay(cell) !== parseDay(cell));
}

/** Unique, non-empty column names from a header row (a missing name becomes "column N", a repeated one gets a number). */
export function columnNames(header: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((cell, index) => {
    const base = cell.trim() || `column ${index + 1}`, used = seen.get(base) ?? 0;
    seen.set(base, used + 1);
    return used ? `${base} (${used + 1})` : base;
  });
}

export interface Profiler {
  addRow(row: string[]): void;
  /** The profile so far (cheap enough to ask for progress updates). */
  result(): DataProfile;
  readonly rows: number;
  /** Plain text without a delimiter has no header: every line is data. Call before the first row. */
  noHeader(): void;
}

export function createProfiler(): Profiler {
  let accumulators: ColumnAccumulator[] = [];
  let names: string[] = [];
  let width = 0, rows = 0, ragged = 0, skipped = 0;
  let hasHeader = true, started = false, headerForbidden = false;
  const preview: string[][] = [];

  function start(first: string[]): void {
    started = true;
    hasHeader = !headerForbidden && looksLikeHeader(first);
    width = Math.min(first.length, MAX_COLUMNS);
    skipped = Math.max(0, first.length - MAX_COLUMNS);
    names = hasHeader ? columnNames(first.slice(0, width)) : Array.from({ length: width }, (_, index) => `column ${index + 1}`);
    accumulators = names.map(name => new ColumnAccumulator(name));
    preview.push(first);
  }

  function addRow(row: string[]): void {
    if (row.length === 1 && row[0] === "") return;
    if (!started) { start(row); if (hasHeader) return; }
    else if (preview.length <= PREVIEW_ROWS) preview.push(row);
    rows++;
    if (row.length !== width + skipped) ragged++;
    for (let column = 0; column < width; column++) accumulators[column].add(row[column]);
  }

  return {
    addRow,
    noHeader() { headerForbidden = true; },
    get rows() { return rows; },
    result: () => ({ columns: accumulators.map(accumulator => accumulator.profile()), rows, ragged, hasHeader, preview: preview.slice(0, PREVIEW_ROWS + 1), skippedColumns: skipped }),
  };
}
