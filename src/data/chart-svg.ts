/** Draws a chart as SVG text (pure). Colours are CSS variables of the page, so a chart follows the theme and needs no redraw when it changes. All text is escaped. */
import type { ChartData } from "./chart-job.js";

export interface ChartTexts {
  /** "x of y" caption pieces, localized by the caller. */
  empty: string;
  /** Description for assistive technology. */
  describe: (data: ChartData) => string;
}

const esc = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** 1200 -> 1.2k, 3400000 -> 3.4M; small numbers keep their decimals. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value)) return "–";
  const scaled = (divisor: number, unit: string) => `${Number((value / divisor).toFixed(abs / divisor >= 100 ? 0 : 1))}${unit}`;
  if (abs >= 1e9) return scaled(1e9, "G");
  if (abs >= 1e6) return scaled(1e6, "M");
  if (abs >= 1e4) return scaled(1e3, "k");
  return String(Number(value.toPrecision(abs >= 100 ? 5 : 3)));
}

/** Round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const rough = (max - min) / count, magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find(candidate => candidate * magnitude >= rough) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return ticks;
}

const PAD = { left: 56, right: 16, top: 12, bottom: 34 };

interface Frame { width: number; height: number; plotW: number; plotH: number }
const frameOf = (width: number, height: number): Frame => ({ width, height, plotW: width - PAD.left - PAD.right, plotH: height - PAD.top - PAD.bottom });

function yAxis(frame: Frame, min: number, max: number, label: string): string {
  const scale = (value: number) => PAD.top + frame.plotH - ((value - min) / (max - min || 1)) * frame.plotH;
  const lines = niceTicks(min, max).map(tick => `<line class="dv-grid" x1="${PAD.left}" x2="${PAD.left + frame.plotW}" y1="${scale(tick).toFixed(1)}" y2="${scale(tick).toFixed(1)}"/><text class="dv-tick" x="${PAD.left - 6}" y="${(scale(tick) + 4).toFixed(1)}" text-anchor="end">${esc(compact(tick))}</text>`);
  return `${lines.join("")}<text class="dv-axis" x="12" y="${PAD.top + frame.plotH / 2}" transform="rotate(-90 12 ${PAD.top + frame.plotH / 2})" text-anchor="middle">${esc(clip(label, 28))}</text>`;
}

function xLabels(frame: Frame, labels: readonly string[], position: (index: number) => number, name: string): string {
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(frame.plotW / 64))));
  const out = labels.map((label, index) => index % every === 0 ? `<text class="dv-tick" x="${position(index).toFixed(1)}" y="${PAD.top + frame.plotH + 16}" text-anchor="middle">${esc(clip(label, 11))}</text>` : "");
  return `${out.join("")}<text class="dv-axis" x="${PAD.left + frame.plotW / 2}" y="${frame.height - 4}" text-anchor="middle">${esc(clip(name, 40))}</text>`;
}

function barChart(data: ChartData, width: number): { svg: string; height: number } {
  const rows = data.points, barH = 22, gap = 8, right = 60;
  const left = Math.min(150, Math.max(48, Math.max(...rows.map(point => clip(point.label, 18).length)) * 6.6 + 16));
  const height = rows.length * (barH + gap) + 16;
  const max = Math.max(...rows.map(point => point.value), 0), min = Math.min(...rows.map(point => point.value), 0);
  const span = max - min || 1, zero = left + ((0 - min) / span) * (width - left - right);
  const bars = rows.map((point, index) => {
    const y = 8 + index * (barH + gap), end = left + ((point.value - min) / span) * (width - left - right);
    const x = Math.min(zero, end), w = Math.max(1, Math.abs(end - zero));
    return `<text class="dv-tick" x="${left - 8}" y="${y + barH / 2 + 4}" text-anchor="end">${esc(clip(point.label, 18))}</text><rect class="dv-bar${point.label === "…" ? " is-other" : ""}" x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="3"><title>${esc(point.label)}: ${esc(compact(point.value))}</title></rect><text class="dv-value" x="${(end + (point.value < 0 ? -6 : 6)).toFixed(1)}" y="${y + barH / 2 + 4}" text-anchor="${point.value < 0 ? "end" : "start"}">${esc(compact(point.value))}</text>`;
  });
  return { svg: bars.join(""), height };
}

function lineChart(data: ChartData, width: number, height: number): string {
  const frame = frameOf(width, height), points = data.points;
  const values = points.map(point => point.value), min = Math.min(0, ...values), max = Math.max(...values, min + 1);
  const x = (index: number) => PAD.left + (points.length < 2 ? frame.plotW / 2 : (index / (points.length - 1)) * frame.plotW);
  const y = (value: number) => PAD.top + frame.plotH - ((value - min) / (max - min)) * frame.plotH;
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join("");
  const area = `${path}L${x(points.length - 1).toFixed(1)} ${y(min).toFixed(1)}L${x(0).toFixed(1)} ${y(min).toFixed(1)}Z`;
  const dots = points.length <= 60 ? points.map((point, index) => `<circle class="dv-dot" cx="${x(index).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="3"><title>${esc(point.label)}: ${esc(compact(point.value))}</title></circle>`).join("") : "";
  return `${yAxis(frame, min, max, data.yLabel)}<path class="dv-area" d="${area}"/><path class="dv-line" d="${path}"/>${dots}${xLabels(frame, points.map(point => point.label), x, data.xLabel)}`;
}

function histogramChart(data: ChartData, width: number, height: number): string {
  const frame = frameOf(width, height), histogram = data.histogram!;
  const peak = Math.max(...histogram.counts, 1), count = histogram.counts.length, slot = frame.plotW / count;
  const bars = histogram.counts.map((value, index) => {
    const h = (value / peak) * frame.plotH, from = histogram.from + ((histogram.to - histogram.from) * index) / count;
    return `<rect class="dv-bar" x="${(PAD.left + index * slot + 1).toFixed(1)}" y="${(PAD.top + frame.plotH - h).toFixed(1)}" width="${Math.max(1, slot - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(compact(from))}…: ${value}</title></rect>`;
  });
  const edges = [0, 0.25, 0.5, 0.75, 1].map(part => histogram.from + (histogram.to - histogram.from) * part);
  const labels = edges.map((edge, index) => `<text class="dv-tick" x="${(PAD.left + (index / 4) * frame.plotW).toFixed(1)}" y="${PAD.top + frame.plotH + 16}" text-anchor="middle">${esc(compact(edge))}</text>`);
  return `${yAxis(frame, 0, peak, data.yLabel)}${bars.join("")}${labels.join("")}<text class="dv-axis" x="${PAD.left + frame.plotW / 2}" y="${height - 4}" text-anchor="middle">${esc(clip(data.xLabel, 40))}</text>`;
}

function scatterChart(data: ChartData, width: number, height: number): string {
  const frame = frameOf(width, height), pairs = data.scatter!;
  const xs = pairs.map(pair => pair[0]), ys = pairs.map(pair => pair[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const px = (value: number) => PAD.left + ((value - x0) / (x1 - x0 || 1)) * frame.plotW;
  const py = (value: number) => PAD.top + frame.plotH - ((value - y0) / (y1 - y0 || 1)) * frame.plotH;
  const dots = pairs.map(([a, b]) => `<circle class="dv-point" cx="${px(a).toFixed(1)}" cy="${py(b).toFixed(1)}" r="2.6"/>`).join("");
  const xTicks = niceTicks(x0, x1).map(tick => `<text class="dv-tick" x="${px(tick).toFixed(1)}" y="${PAD.top + frame.plotH + 16}" text-anchor="middle">${esc(compact(tick))}</text>`);
  return `${yAxis(frame, y0, y1, data.yLabel)}${dots}${xTicks.join("")}<text class="dv-axis" x="${PAD.left + frame.plotW / 2}" y="${height - 4}" text-anchor="middle">${esc(clip(data.xLabel, 40))}</text>`;
}

/** The chart as an `<svg>` element, or a short message when there is nothing to draw. */
export function renderChartSvg(data: ChartData, texts: ChartTexts, width = 640): string {
  const hasData = data.kind === "scatter" ? !!data.scatter?.length : data.kind === "histogram" ? !!data.histogram && data.rows > 0 : data.points.length > 0;
  if (!hasData) return `<p class="dv-chart-empty">${esc(texts.empty)}</p>`;
  const label = esc(texts.describe(data));
  if (data.kind === "bar") {
    const { svg, height } = barChart(data, width);
    return `<svg class="dv-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><title>${label}</title>${svg}</svg>`;
  }
  const height = 280;
  const body = data.kind === "line" ? lineChart(data, width, height) : data.kind === "histogram" ? histogramChart(data, width, height) : scatterChart(data, width, height);
  return `<svg class="dv-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><title>${label}</title>${body}</svg>`;
}
