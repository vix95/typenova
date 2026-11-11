/** The description of a chart that is written in a Markdown note (a ```chart block) or chosen in the data viewer (pure). */

export type ChartKind = "bar" | "line" | "histogram" | "scatter";
export type Aggregate = "count" | "sum" | "mean" | "min" | "max";
export type DateStep = "auto" | "day" | "month" | "year";

export interface ChartSpec {
  /** Path of the data file, relative to the note that holds the block. */
  file: string;
  type: ChartKind;
  /** Column name, or "#3" for the third column. */
  x: string;
  y?: string;
  agg: Aggregate;
  /** Bar charts: how many bars are drawn (the rest is summed up as "other" when the aggregate allows it). */
  top: number;
  bins: number;
  step: DateStep;
  title?: string;
}

export const KINDS: readonly ChartKind[] = ["bar", "line", "histogram", "scatter"];
export const AGGREGATES: readonly Aggregate[] = ["count", "sum", "mean", "min", "max"];
const STEPS: readonly DateStep[] = ["auto", "day", "month", "year"];

export const DEFAULT_TOP = 12, DEFAULT_BINS = 24;

export type SpecResult = { ok: true; spec: ChartSpec } | { ok: false; error: string };

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined => allowed.find(item => item === value?.toLowerCase());
const whole = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

/** Reads the `key: value` lines of a chart block. A `#` starts a comment when it follows a space (so a column called "#3" is still a column). */
export function parseChartSpec(text: string): SpecResult {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/(^|\s)#(?=\s|$).*$/, "").trim();
    if (!clean) continue;
    const colon = clean.indexOf(":");
    if (colon <= 0) return { ok: false, error: `line "${clean.slice(0, 40)}" is not "key: value"` };
    entries.set(clean.slice(0, colon).trim().toLowerCase(), clean.slice(colon + 1).trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  const file = entries.get("file") ?? entries.get("data");
  if (!file) return { ok: false, error: "missing “file:”" };
  if (/^\w{2,}:\/\//.test(file)) return { ok: false, error: "the file must be a path on this computer, not an address" };
  const type = oneOf(entries.get("type"), KINDS) ?? "bar";
  if (entries.has("type") && !oneOf(entries.get("type"), KINDS)) return { ok: false, error: `unknown type “${entries.get("type")}” (bar, line, histogram, scatter)` };
  const x = entries.get("x");
  if (!x) return { ok: false, error: "missing “x:” (a column name)" };
  const y = entries.get("y");
  if (type === "scatter" && !y) return { ok: false, error: "a scatter chart needs “y:”" };
  const agg = oneOf(entries.get("agg"), AGGREGATES) ?? (y && type !== "scatter" ? "sum" : "count");
  if (agg !== "count" && !y && type !== "histogram") return { ok: false, error: `“agg: ${agg}” needs “y:”` };
  return {
    ok: true,
    spec: {
      file, type, x, y, agg, top: whole(entries.get("top"), DEFAULT_TOP, 1, 50), bins: whole(entries.get("bins"), DEFAULT_BINS, 3, 100),
      step: oneOf(entries.get("by"), STEPS) ?? "auto", title: entries.get("title"),
    },
  };
}

/** The block as text, ready to be put into a note. */
export function specToBlock(spec: ChartSpec): string {
  const lines = [`file: ${spec.file}`, `type: ${spec.type}`, `x: ${spec.x}`];
  if (spec.y && spec.type !== "histogram") lines.push(`y: ${spec.y}`);
  if (spec.type === "bar" || spec.type === "line") lines.push(`agg: ${spec.agg}`);
  if (spec.type === "bar") lines.push(`top: ${spec.top}`);
  if (spec.type === "histogram") lines.push(`bins: ${spec.bins}`);
  if (spec.type === "line" && spec.step !== "auto") lines.push(`by: ${spec.step}`);
  if (spec.title) lines.push(`title: ${spec.title}`);
  return "```chart\n" + lines.join("\n") + "\n```\n";
}

/** The index of the column a spec names (by name, ignoring case, or "#3"), or -1. */
export function findColumn(names: readonly string[], wanted: string | undefined): number {
  if (wanted === undefined) return -1;
  const position = /^#(\d+)$/.exec(wanted.trim());
  if (position) { const index = Number(position[1]) - 1; return index >= 0 && index < names.length ? index : -1; }
  const exact = names.indexOf(wanted);
  return exact >= 0 ? exact : names.findIndex(name => name.toLowerCase() === wanted.trim().toLowerCase());
}

/** A key for caching the result of a chart: the file's identity and everything in the spec that changes the figures. */
export function specKey(spec: ChartSpec, fileStamp: string): string {
  return JSON.stringify([fileStamp, spec.type, spec.x, spec.y ?? "", spec.agg, spec.top, spec.bins, spec.step]);
}

/** True for a path with a drive or a leading slash. A block may name one, but the file must lie in the project folder of the note. */
export const isAbsoluteFile = (file: string): boolean => /^(?:[a-z]:|[\\/])/i.test(file);

/** The absolute path (with "/" separators) of a file named in a block: relative to the note, or as it is when already absolute; null when the path climbs above the top of the drive. */
export function resolveBesideNote(notePath: string, relative: string): string | null {
  if (isAbsoluteFile(relative)) return relative.replace(/\\/g, "/");
  const parts = notePath.replace(/\\/g, "/").split("/");
  parts.pop();
  for (const part of relative.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (parts.length <= 1) return null; parts.pop(); } else parts.push(part);
  }
  return parts.join("/");
}
