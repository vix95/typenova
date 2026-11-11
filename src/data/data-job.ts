/** Feeds the bytes of a file, piece by piece, through decoding and parsing into a profile or a chart (pure; the worker and the tests run this same code). */
import { looksBinary, guessLegacyEncoding, type TextEncodingName } from "../filesystem/text-codec.js";
import { createDelimitedParser, detectDelimiter, NO_DELIMITER, type DelimitedParser } from "./delimited-stream.js";
import { createChartJob, type ChartData, type ChartJob } from "./chart-job.js";
import { overviewSpecsOfSample } from "./overview.js";
import { createProfiler, type DataProfile } from "./data-profile.js";
import type { ChartSpec } from "./chart-spec.js";

/** "overview" is the profile plus a fixed set of charts chosen from the first rows, all in one pass over the text. */
export type JobTarget = { kind: "profile" } | { kind: "chart"; spec: ChartSpec } | { kind: "overview" };

export type JobResult =
  | { kind: "profile"; profile: DataProfile; encoding: string; delimiter: string }
  | { kind: "chart"; data: ChartData; error: string | null; encoding: string; delimiter: string }
  | { kind: "overview"; profile: DataProfile; charts: Array<{ spec: ChartSpec; data: ChartData }>; encoding: string; delimiter: string }
  | { kind: "error"; reason: "binary" | "decode" };

export interface DataJob {
  /** The next piece of the file. Returns false once the file is known not to be readable as text (the job is then finished). */
  push(bytes: Uint8Array): boolean;
  /** Data rows read so far. */
  readonly rows: number;
  finish(): JobResult;
}

const HEAD_SIZE = 65536;
/** The overview chooses its charts from a longer start of the file. */
const OVERVIEW_HEAD_SIZE = 262144;
const startsWith = (bytes: Uint8Array, ...prefix: number[]) => prefix.every((value, index) => bytes[index] === value);

function encodingOf(first: Uint8Array): TextEncodingName {
  if (startsWith(first, 0xff, 0xfe)) return "utf-16le";
  if (startsWith(first, 0xfe, 0xff)) return "utf-16be";
  if (startsWith(first, 0xef, 0xbb, 0xbf)) return "utf-8";
  try { new TextDecoder("utf-8", { fatal: true }).decode(first, { stream: true }); return "utf-8"; } catch { return guessLegacyEncoding(first); }
}

/** `extension` (without the dot) helps to choose the delimiter: .tsv is tab separated. */
export function createDataJob(target: JobTarget, extension: string): DataJob {
  const overview = target.kind === "overview";
  const profiler = target.kind === "profile" || overview ? createProfiler() : null;
  const chart = target.kind === "chart" ? createChartJob(target.spec) : null;
  const overviewJobs: Array<{ spec: ChartSpec; job: ChartJob }> = [];
  const headSize = overview ? OVERVIEW_HEAD_SIZE : HEAD_SIZE;
  const sink = (row: string[]) => { if (profiler) profiler.addRow(row); else chart!.addRow(row); for (const each of overviewJobs) each.job.addRow(row); };
  let decoder: TextDecoder | null = null, parser: DelimitedParser | null = null;
  /** The first pieces are kept until there is enough to recognise the encoding and the delimiter. */
  let head: Uint8Array[] = [], headBytes = 0;
  let encoding = "utf-8", delimiter = ",", failed: "binary" | "decode" | null = null;

  function begin(first: Uint8Array): boolean {
    if (looksBinary(first)) { failed = "binary"; return false; }
    encoding = encodingOf(first);
    decoder = new TextDecoder(encoding);
    const sample = new TextDecoder(encoding).decode(first.subarray(0, headSize), { stream: true });
    delimiter = detectDelimiter(sample.replace(/^﻿/, ""), extension);
    if (overview && delimiter !== NO_DELIMITER) for (const spec of overviewSpecsOfSample(sample.replace(/^﻿/, ""), delimiter, first.length < headSize)) overviewJobs.push({ spec, job: createChartJob(spec) });
    if (delimiter === NO_DELIMITER) profiler?.noHeader();
    parser = createDelimitedParser(delimiter, sink);
    return true;
  }

  function feed(bytes: Uint8Array): boolean {
    try { parser!.feed(decoder!.decode(bytes, { stream: true })); } catch { failed = "decode"; return false; }
    return true;
  }

  /** Starts reading with everything kept so far. */
  function flushHead(): boolean {
    const first = new Uint8Array(headBytes);
    let at = 0;
    for (const piece of head) { first.set(piece, at); at += piece.length; }
    head = []; headBytes = 0;
    return first.length === 0 || (begin(first) && feed(first));
  }

  function push(bytes: Uint8Array): boolean {
    if (failed) return false;
    if (decoder) return feed(bytes);
    head.push(bytes); headBytes += bytes.length;
    return headBytes < headSize || flushHead();
  }

  function finish(): JobResult {
    if (!failed && !decoder) flushHead();
    if (failed) return { kind: "error", reason: failed };
    if (decoder && parser) { parser.feed(decoder.decode()); parser.end(); }
    if (overview) {
      const charts = overviewJobs.filter(each => !each.job.error).map(each => ({ spec: each.spec, data: each.job.result() }));
      return { kind: "overview", profile: profiler!.result(), charts, encoding, delimiter };
    }
    if (profiler) return { kind: "profile", profile: profiler.result(), encoding, delimiter };
    return { kind: "chart", data: chart!.result(), error: chart!.error, encoding, delimiter };
  }

  return { push, finish, get rows() { return profiler ? profiler.rows : 0; } };
}
