/** Statistics of one column, gathered one value at a time in a single pass over the file (pure). Memory stays bounded: counters, a sample of numbers, a capped table of distinct values. */
import { dayToIso, parseBoolean, parseDay, parseNumber } from "./value-parse.js";

export type ColumnType = "number" | "date" | "boolean" | "category" | "text" | "empty";

export const SAMPLE_SIZE = 20_000;
export const MAX_DISTINCT = 5_000;
const HISTOGRAM_BINS = 24;

export interface Histogram { from: number; to: number; counts: number[] }
export interface NumberSummary { min: number; max: number; mean: number; std: number; median: number; q1: number; q3: number; histogram: Histogram; sampled: boolean }
export interface DateSummary { min: string; max: string; unit: "day" | "month" | "year"; buckets: Array<{ label: string; count: number }> }
export interface ColumnProfile {
  name: string;
  type: ColumnType;
  /** Cells with a value. */
  count: number;
  /** Empty cells. */
  missing: number;
  /** Distinct values; `distinctExact` is false when there were more than MAX_DISTINCT (the number is then a lower bound). */
  distinct: number;
  distinctExact: boolean;
  /** Cells that did not fit the type of the column (a word in a column of numbers). */
  mismatched: number;
  top: Array<{ value: string; count: number }>;
  number?: NumberSummary;
  date?: DateSummary;
  length?: { min: number; max: number; mean: number };
}

/** A deterministic generator, so that the same file always gives the same sample and the same figures. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; };
}

/** A uniform sample of a stream of numbers (reservoir sampling): exact while the stream is not longer than the sample. */
export class Reservoir {
  readonly values: number[] = [];
  seen = 0;
  private readonly random = seededRandom(0x9e3779b9);
  constructor(private readonly size = SAMPLE_SIZE) {}
  add(value: number): void {
    this.seen++;
    if (this.values.length < this.size) this.values.push(value);
    else { const slot = Math.floor(this.random() * this.seen); if (slot < this.size) this.values[slot] = value; }
  }
  get sampled(): boolean { return this.seen > this.size; }
}

/** The quantile (0..1) of sorted numbers, interpolated. */
export function quantile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * fraction, low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** Equal-width bins over [from, to]; a single value (from == to) gets one bin. */
export function histogramOf(values: readonly number[], from: number, to: number, bins = HISTOGRAM_BINS): Histogram {
  if (!(to > from)) return { from, to, counts: [values.length] };
  const counts = new Array<number>(bins).fill(0), width = (to - from) / bins;
  for (const value of values) counts[Math.min(bins - 1, Math.max(0, Math.floor((value - from) / width)))]++;
  return { from, to, counts };
}

/** Accumulates one column. Which type the column has is decided only at the end, from how the values behaved. */
export class ColumnAccumulator {
  private count = 0; private missing = 0;
  private numeric = 0; private dates = 0; private booleans = 0;
  private mean = 0; private m2 = 0; private min = Infinity; private max = -Infinity;
  private readonly sample = new Reservoir();
  private dayMin = Infinity; private dayMax = -Infinity;
  private readonly days = new Map<number, number>();
  private readonly values = new Map<string, number>();
  private overflow = false;
  private lengthSum = 0; private lengthMin = Infinity; private lengthMax = 0;

  constructor(readonly name: string) {}

  add(raw: string | undefined): void {
    if (raw === undefined || raw.length === 0 || (raw.charCodeAt(0) <= 32 && raw.trim() === "")) { this.missing++; return; }
    this.count++;
    const number = parseNumber(raw);
    if (number === number) { this.addNumber(number); }
    else {
      const day = parseDay(raw);
      if (day === day) this.addDay(day);
      else if (parseBoolean(raw) !== null) this.booleans++;
    }
    this.countValue(raw);
    const length = raw.length;
    this.lengthSum += length; if (length < this.lengthMin) this.lengthMin = length; if (length > this.lengthMax) this.lengthMax = length;
  }

  private addNumber(value: number): void {
    this.numeric++;
    const delta = value - this.mean;
    this.mean += delta / this.numeric;
    this.m2 += delta * (value - this.mean);
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;
    this.sample.add(value);
  }

  private addDay(day: number): void {
    this.dates++;
    if (day < this.dayMin) this.dayMin = day;
    if (day > this.dayMax) this.dayMax = day;
    this.days.set(day, (this.days.get(day) ?? 0) + 1);
  }

  /** Distinct values are counted until there are too many; after that the table is dropped (a partial count would mislead) and counting stops, which is also what keeps text columns fast. */
  private countValue(raw: string): void {
    if (this.overflow) return;
    const known = this.values.get(raw);
    if (known !== undefined) this.values.set(raw, known + 1);
    else if (this.values.size < MAX_DISTINCT) this.values.set(raw, 1);
    else { this.overflow = true; this.values.clear(); }
  }

  /** The type the values add up to: a column is a number (date, yes/no) column when 98% of its values are. */
  private decideType(): ColumnType {
    if (!this.count) return "empty";
    const enough = (part: number) => part >= this.count * 0.98;
    if (enough(this.numeric)) return "number";
    if (enough(this.dates)) return "date";
    if (enough(this.booleans)) return "boolean";
    const distinct = this.overflow ? Infinity : this.values.size;
    return distinct <= 50 || (distinct <= 1000 && distinct <= this.count / 4) ? "category" : "text";
  }

  profile(): ColumnProfile {
    const type = this.decideType();
    const fit = { number: this.numeric, date: this.dates, boolean: this.booleans }[type as "number" | "date" | "boolean"];
    const top = [...this.values].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 12).map(([value, count]) => ({ value, count }));
    const profile: ColumnProfile = {
      name: this.name, type, count: this.count, missing: this.missing,
      distinct: this.overflow ? MAX_DISTINCT : this.values.size, distinctExact: !this.overflow,
      mismatched: fit === undefined ? 0 : this.count - fit, top,
    };
    if (type === "number") profile.number = this.numberSummary();
    if (type === "date") profile.date = this.dateSummary();
    if (this.count) profile.length = { min: this.lengthMin, max: this.lengthMax, mean: this.lengthSum / this.count };
    return profile;
  }

  private numberSummary(): NumberSummary {
    const sorted = [...this.sample.values].sort((a, b) => a - b);
    return {
      min: this.min, max: this.max, mean: this.mean, std: this.numeric > 1 ? Math.sqrt(this.m2 / (this.numeric - 1)) : 0,
      median: quantile(sorted, 0.5), q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75),
      histogram: histogramOf(sorted, this.min, this.max), sampled: this.sample.sampled,
    };
  }

  private dateSummary(): DateSummary {
    const span = this.dayMax - this.dayMin;
    const unit = span > 365 * 3 ? "year" : span > 120 ? "month" : "day";
    const buckets = new Map<string, number>();
    for (const [day, count] of [...this.days].sort((a, b) => a[0] - b[0])) {
      const iso = dayToIso(day), label = unit === "year" ? iso.slice(0, 4) : unit === "month" ? iso.slice(0, 7) : iso;
      buckets.set(label, (buckets.get(label) ?? 0) + count);
    }
    return { min: dayToIso(this.dayMin), max: dayToIso(this.dayMax), unit, buckets: [...buckets].map(([label, count]) => ({ label, count })) };
  }
}
