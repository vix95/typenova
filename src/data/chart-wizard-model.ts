/** The rules behind the chart wizard (pure): which kinds of chart a file can offer, which columns suit which role, and a sensible first choice for each kind. */
import type { ColumnProfile } from "./column-stats.js";
import type { DataProfile } from "./data-profile.js";
import { DEFAULT_BINS, DEFAULT_TOP, type Aggregate, type ChartKind, type ChartSpec } from "./chart-spec.js";

/** How well the data fits a kind: "good" is recommended, "possible" works but is not the natural choice, "missing" lacks something (see `need`). */
export interface KindFit { kind: ChartKind; fit: "good" | "possible" | "missing"; need?: "number" | "two-numbers" }

const usable = (column: ColumnProfile): boolean => column.type !== "empty" && column.count > 0;
const numbers = (profile: DataProfile): ColumnProfile[] => profile.columns.filter(column => column.type === "number" && column.count > 0);
const dates = (profile: DataProfile): ColumnProfile[] => profile.columns.filter(column => column.type === "date");
const groups = (profile: DataProfile): ColumnProfile[] => profile.columns.filter(column => (column.type === "category" || column.type === "boolean") && column.count > 0);

/** Running numbers (1, 2, 3, …) or all-different values say little as a measure. Decided by the values only, never by what the column is called. */
const isIdentifier = (column: ColumnProfile, rows: number): boolean =>
  !!column.number && column.number.max - column.number.min === rows - 1 && (!column.distinctExact || column.distinct >= rows);

/** Number columns in the order of the file; a column whose values never change and a column of running numbers go last. */
export function measures(profile: DataProfile): ColumnProfile[] {
  const rank = (column: ColumnProfile): number => (column.number && column.number.max === column.number.min ? 2 : isIdentifier(column, profile.rows) ? 1 : 0);
  return numbers(profile).map((column, index) => ({ column, index })).sort((x, y) => rank(x.column) - rank(y.column) || x.index - y.index).map(item => item.column);
}

export function kindFits(profile: DataProfile): KindFit[] {
  const count = numbers(profile).length;
  return [
    { kind: "bar", fit: groups(profile).length ? "good" : profile.columns.some(usable) ? "possible" : "missing" },
    { kind: "line", fit: dates(profile).length ? "good" : count ? "possible" : profile.columns.some(usable) ? "possible" : "missing" },
    { kind: "histogram", fit: count ? "good" : "missing", need: count ? undefined : "number" },
    { kind: "scatter", fit: measures(profile).length >= 2 ? "good" : "missing", need: count >= 2 ? undefined : "two-numbers" },
  ];
}

/** The columns that can play a role in a kind, best first. `x` is what is grouped or placed along the axis, `y` the measure. */
export function columnsFor(profile: DataProfile, kind: ChartKind, role: "x" | "y"): ColumnProfile[] {
  if (role === "y" || kind === "histogram" || kind === "scatter") return measures(profile);
  const all = profile.columns.filter(usable);
  const rank = (column: ColumnProfile): number => kind === "line"
    ? (column.type === "date" ? 0 : column.type === "number" ? 1 : 2)
    : (column.type === "category" || column.type === "boolean" ? 0 : column.type === "date" ? 1 : column.type === "text" ? 2 : 3);
  return [...all].sort((a, b) => rank(a) - rank(b));
}

/** A complete, sensible spec for a kind; null when the data cannot make that chart. */
export function defaultSpec(profile: DataProfile, kind: ChartKind, file: string): ChartSpec | null {
  const base = { file, top: DEFAULT_TOP, bins: DEFAULT_BINS, step: "auto" as const };
  const measure = measures(profile)[0];
  const x = columnsFor(profile, kind, "x")[0];
  if (kind === "histogram") return measure ? { ...base, type: kind, x: measure.name, agg: "count" } : null;
  if (kind === "scatter") {
    const pair = measures(profile);
    return pair.length >= 2 ? { ...base, type: kind, x: pair[0].name, y: pair[1].name, agg: "count" } : null;
  }
  if (!x) return null;
  const withMeasure = measure && measure.name !== x.name;
  return { ...base, type: kind, x: x.name, y: withMeasure ? measure.name : undefined, agg: withMeasure ? "sum" : "count" };
}

/** The spec after the user changed one thing: other fields stay unless they no longer make sense (a measure is dropped when the aggregate is "count"). */
export function withChoice(spec: ChartSpec, change: Partial<ChartSpec>, profile: DataProfile): ChartSpec {
  const next = { ...spec, ...change };
  if (next.type === "bar" || next.type === "line") {
    if (next.agg !== "count" && !next.y) next.y = measures(profile).find(column => column.name !== next.x)?.name;
    if (!next.y) next.agg = "count";
  }
  return next;
}

export type Sentence =
  | { kind: "rows"; x: string }
  | { kind: "aggregate"; agg: Exclude<Aggregate, "count">; x: string; y: string; over: boolean }
  | { kind: "spread"; x: string }
  | { kind: "pair"; x: string; y: string }
  | { kind: "count-over"; x: string };

/** What the chart says, as data for a sentence ("Total amount for each country"); the caller words it in the interface language. */
export function sentenceOf(spec: ChartSpec): Sentence {
  if (spec.type === "histogram") return { kind: "spread", x: spec.x };
  if (spec.type === "scatter") return { kind: "pair", x: spec.x, y: spec.y ?? "" };
  const over = spec.type === "line";
  if (spec.agg === "count" || !spec.y) return over ? { kind: "count-over", x: spec.x } : { kind: "rows", x: spec.x };
  return { kind: "aggregate", agg: spec.agg, x: spec.x, y: spec.y, over };
}
