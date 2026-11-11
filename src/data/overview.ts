/** Chooses the charts shown for a file in the Preview pane (pure): one chart for every column, by the type found in its values. Nothing depends on what a column is called. */
import { createDelimitedParser } from "./delimited-stream.js";
import { createProfiler, type DataProfile } from "./data-profile.js";
import { DEFAULT_BINS, DEFAULT_TOP, type ChartSpec } from "./chart-spec.js";

/** Most charts of an overview; a file with more columns shows the first ones. */
export const MAX_OVERVIEW_CHARTS = 48;

/**
 * A number column gets a histogram of its values, a date column the number of rows over time, a category or yes/no column the number of rows per value.
 * Text with too many different values (names, free text) has nothing to chart and is left out, as is an empty column.
 */
export function overviewSpecs(profile: DataProfile): ChartSpec[] {
  const base = { file: "", top: DEFAULT_TOP, bins: DEFAULT_BINS, step: "auto" as const, agg: "count" as const };
  const specs: ChartSpec[] = [];
  for (const column of profile.columns) {
    if (column.count === 0) continue;
    if (column.type === "number") specs.push({ ...base, type: "histogram", x: column.name });
    else if (column.type === "date") specs.push({ ...base, type: "line", x: column.name });
    else if (column.type === "category" || column.type === "boolean") specs.push({ ...base, type: "bar", x: column.name });
  }
  return specs.slice(0, MAX_OVERVIEW_CHARTS);
}

/** The specs for the beginning of a file's text (cut at a line end, so that a half row does not count). */
export function overviewSpecsOfSample(sample: string, delimiter: string, complete: boolean): ChartSpec[] {
  const text = complete ? sample : sample.slice(0, Math.max(0, sample.lastIndexOf("\n")));
  const profiler = createProfiler();
  const parser = createDelimitedParser(delimiter, row => profiler.addRow(row));
  parser.feed(text); parser.end();
  return overviewSpecs(profiler.result());
}
