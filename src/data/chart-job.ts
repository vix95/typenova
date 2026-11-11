/** Turns the rows of a file into the figures of one chart (pure), in a single pass with bounded memory: grouped sums for bars and lines, a sample for histograms and scatter plots. */
import { Reservoir, histogramOf, seededRandom, type Histogram } from "./column-stats.js";
import { findColumn, type Aggregate, type ChartKind, type ChartSpec } from "./chart-spec.js";
import { looksLikeHeader, columnNames } from "./data-profile.js";
import { dayToIso, parseDay, parseNumber } from "./value-parse.js";

const MAX_GROUPS = 50_000;
const MAX_LINE_POINTS = 240;
const SCATTER_POINTS = 3000;

export interface Point { label: string; value: number }
export interface ChartData {
  kind: ChartKind;
  title: string;
  xLabel: string;
  yLabel: string;
  /** Bars and lines. */
  points: Point[];
  histogram?: Histogram;
  scatter?: Array<[number, number]>;
  /** Rows that took part in the chart. */
  rows: number;
  /** Rows left out because the x or y cell was empty or not of the right kind. */
  skipped: number;
  /** More distinct values than can be kept: later new ones were left out. */
  capped: boolean;
  /** Categories not drawn (bar chart) and whether their sum was folded into one "other" bar. */
  hidden: number;
  other: boolean;
  /** Histogram and scatter figures come from a sample of the rows. */
  sampled: boolean;
  /** The step dates were grouped by (line chart). */
  step?: "day" | "month" | "year";
}

interface Group { n: number; sum: number; min: number; max: number }
const newGroup = (): Group => ({ n: 0, sum: 0, min: Infinity, max: -Infinity });
function addTo(group: Group, value: number): void {
  group.n++; group.sum += value;
  if (value < group.min) group.min = value;
  if (value > group.max) group.max = value;
}
function merge(into: Group, from: Group): void {
  into.n += from.n; into.sum += from.sum;
  if (from.min < into.min) into.min = from.min;
  if (from.max > into.max) into.max = from.max;
}
export function valueOf(group: Group, agg: Aggregate): number {
  switch (agg) {
    case "count": return group.n;
    case "sum": return group.sum;
    case "mean": return group.n ? group.sum / group.n : 0;
    case "min": return group.min;
    default: return group.max;
  }
}

export interface ChartJob {
  addRow(row: string[]): void;
  result(): ChartData;
  /** The error found in the header (a column that does not exist), or null. */
  readonly error: string | null;
}

/** Counts per key, capped so that a column of unique ids cannot use all the memory. */
class Groups<K> {
  readonly map = new Map<K, Group>();
  capped = false;
  add(key: K, value: number): void {
    let group = this.map.get(key);
    if (!group) { if (this.map.size >= MAX_GROUPS) { this.capped = true; return; } group = newGroup(); this.map.set(key, group); }
    addTo(group, value);
  }
}

function emptyData(spec: ChartSpec, xLabel: string, yLabel: string): ChartData {
  return { kind: spec.type, title: spec.title ?? "", xLabel, yLabel, points: [], rows: 0, skipped: 0, capped: false, hidden: 0, other: false, sampled: false };
}

/** The x cell of a bar/line chart, tried as a date, a number and text: all three are kept and the right one is chosen at the end. */
class KeyedRows {
  readonly days = new Groups<number>(); readonly numbers = new Groups<number>(); readonly labels = new Groups<string>();
  dayRows = 0; numberRows = 0; rows = 0;
  add(x: string, value: number): void {
    this.rows++;
    const day = parseDay(x);
    if (day === day) { this.dayRows++; this.days.add(day, value); }
    else { const number = parseNumber(x); if (number === number) { this.numberRows++; this.numbers.add(number, value); } }
    this.labels.add(x, value);
  }
}

/** Neighbouring groups merged until at most `limit` remain (a line chart over a million distinct x values still has a readable number of points). */
function shrink(sorted: Array<[number, Group]>, limit: number): Array<[number, Group]> {
  if (sorted.length <= limit) return sorted;
  const size = Math.ceil(sorted.length / limit), out: Array<[number, Group]> = [];
  for (let index = 0; index < sorted.length; index += size) {
    const part = sorted.slice(index, index + size), group = newGroup();
    for (const [, each] of part) merge(group, each);
    out.push([part[0][0], group]);
  }
  return out;
}

function lineFromDays(keyed: KeyedRows, spec: ChartSpec, data: ChartData): void {
  const sorted = [...keyed.days.map].sort((a, b) => a[0] - b[0]);
  const span = sorted.length ? sorted[sorted.length - 1][0] - sorted[0][0] : 0;
  const step = spec.step !== "auto" ? spec.step : span > 365 * 3 ? "year" : span > 120 ? "month" : "day";
  const buckets = new Map<string, Group>();
  for (const [day, group] of sorted) {
    const iso = dayToIso(day), label = step === "year" ? iso.slice(0, 4) : step === "month" ? iso.slice(0, 7) : iso;
    let bucket = buckets.get(label);
    if (!bucket) { bucket = newGroup(); buckets.set(label, bucket); }
    merge(bucket, group);
  }
  data.step = step;
  data.points = [...buckets].map(([label, group]) => ({ label, value: valueOf(group, spec.agg) }));
}

function lineFromKeys(keyed: KeyedRows, spec: ChartSpec, data: ChartData): void {
  const useDays = keyed.dayRows >= keyed.rows * 0.98, useNumbers = keyed.numberRows >= keyed.rows * 0.98;
  if (useDays) return lineFromDays(keyed, spec, data);
  if (useNumbers) {
    const sorted = shrink([...keyed.numbers.map].sort((a, b) => a[0] - b[0]), MAX_LINE_POINTS);
    data.points = sorted.map(([key, group]) => ({ label: String(Number(key.toPrecision(6))), value: valueOf(group, spec.agg) }));
    return;
  }
  const labels = [...keyed.labels.map].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, MAX_LINE_POINTS);
  data.points = labels.map(([label, group]) => ({ label, value: valueOf(group, spec.agg) }));
}

function barFromLabels(keyed: KeyedRows, spec: ChartSpec, data: ChartData): void {
  const ranked = [...keyed.labels.map].map(([label, group]) => ({ label, group, value: valueOf(group, spec.agg) })).sort((a, b) => b.value - a.value);
  const shown = ranked.slice(0, spec.top), rest = ranked.slice(spec.top);
  data.points = shown.map(({ label, value }) => ({ label, value }));
  data.hidden = rest.length;
  if (rest.length && (spec.agg === "count" || spec.agg === "sum")) {
    data.points.push({ label: "…", value: rest.reduce((sum, each) => sum + each.value, 0) });
    data.other = true;
  }
}

export function createChartJob(spec: ChartSpec): ChartJob {
  let names: string[] | null = null;
  let xIndex = -1, yIndex = -1, error: string | null = null;
  let data = emptyData(spec, spec.x, spec.y ?? "");
  const keyed = new KeyedRows();
  const sample = new Reservoir(), pairs: Array<[number, number]> = [];
  const random = seededRandom(0x51ed270b);
  let pairsSeen = 0, min = Infinity, max = -Infinity;

  function resolve(first: string[]): boolean {
    const header = looksLikeHeader(first);
    names = header ? columnNames(first) : first.map((_, index) => `column ${index + 1}`);
    xIndex = findColumn(names, spec.x); yIndex = spec.y === undefined ? -1 : findColumn(names, spec.y);
    if (xIndex < 0) error = `no column “${spec.x}”`;
    else if (spec.y !== undefined && yIndex < 0) error = `no column “${spec.y}”`;
    const measure = spec.y === undefined ? "" : names[yIndex] ?? spec.y;
    data = emptyData(spec, names[xIndex] ?? spec.x, spec.type === "scatter" ? measure : "");
    if (spec.type === "histogram") data.yLabel = "count";
    else if (spec.type !== "scatter") data.yLabel = spec.agg === "count" || !measure ? "count" : `${spec.agg}(${measure})`;
    return header;
  }

  function addScatter(x: number, y: number): void {
    pairsSeen++;
    if (pairs.length < SCATTER_POINTS) pairs.push([x, y]);
    else { const slot = Math.floor(random() * pairsSeen); if (slot < SCATTER_POINTS) pairs[slot] = [x, y]; }
  }

  function addRow(row: string[]): void {
    if (row.length === 1 && row[0] === "") return;
    if (names === null) { if (resolve(row)) return; }
    if (error) return;
    const x = row[xIndex] ?? "";
    if (spec.type === "histogram" || spec.type === "scatter") {
      const number = parseNumber(x), other = spec.type === "scatter" ? parseNumber(row[yIndex] ?? "") : 0;
      if (number !== number || other !== other) { data.skipped++; return; }
      data.rows++;
      if (spec.type === "scatter") { addScatter(number, other); return; }
      sample.add(number); if (number < min) min = number; if (number > max) max = number;
      return;
    }
    if (x.trim() === "") { data.skipped++; return; }
    const value = spec.agg === "count" ? 1 : parseNumber(row[yIndex] ?? "");
    if (value !== value) { data.skipped++; return; }
    data.rows++;
    keyed.add(x, value);
  }

  function result(): ChartData {
    const out = { ...data };
    if (spec.type === "histogram") { out.histogram = histogramOf([...sample.values].sort((a, b) => a - b), min, max, spec.bins); out.sampled = sample.sampled; }
    else if (spec.type === "scatter") { out.scatter = pairs.slice(); out.sampled = pairsSeen > SCATTER_POINTS; }
    else if (spec.type === "line") lineFromKeys(keyed, spec, out);
    else barFromLabels(keyed, spec, out);
    out.capped = keyed.labels.capped || keyed.days.capped || keyed.numbers.capped;
    return out;
  }

  return { addRow, result, get error() { return error; } };
}
