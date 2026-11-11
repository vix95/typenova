/** Picks a sensible first chart for a file from its profile (pure), so that the Charts tab never opens empty. */
import type { ColumnProfile } from "./column-stats.js";
import type { DataProfile } from "./data-profile.js";
import { DEFAULT_BINS, DEFAULT_TOP, type ChartSpec } from "./chart-spec.js";
import { measures } from "./chart-wizard-model.js";

const usable = (column: ColumnProfile): boolean => column.type !== "empty" && column.count > 0;

/** Date and numeric columns first make a trend; else a category with a number is a bar chart of sums; else the first number as a histogram; else counts of the first category. null when nothing can be drawn. */
export function suggestSpec(profile: DataProfile, file: string): ChartSpec | null {
  const columns = profile.columns.filter(usable);
  const base = { file, top: DEFAULT_TOP, bins: DEFAULT_BINS, step: "auto" as const };
  const date = columns.find(column => column.type === "date");
  const measure = measures(profile)[0];
  const category = columns.find(column => column.type === "category" || column.type === "boolean");
  if (date && measure) return { ...base, type: "line", x: date.name, y: measure.name, agg: "sum" };
  if (date) return { ...base, type: "line", x: date.name, agg: "count" };
  if (category && measure) return { ...base, type: "bar", x: category.name, y: measure.name, agg: "sum" };
  if (measure) return { ...base, type: "histogram", x: measure.name, agg: "count" };
  if (category) return { ...base, type: "bar", x: category.name, agg: "count" };
  return columns[0] ? { ...base, type: "bar", x: columns[0].name, agg: "count" } : null;
}

/** The chart that fits one column best: a histogram of a number, a trend of counts for a date, counts of a category. */
export function specForColumn(column: ColumnProfile, file: string): ChartSpec {
  const base = { file, top: DEFAULT_TOP, bins: DEFAULT_BINS, step: "auto" as const, x: column.name, agg: "count" as const };
  if (column.type === "number") return { ...base, type: "histogram" };
  return { ...base, type: column.type === "date" ? "line" : "bar" };
}
