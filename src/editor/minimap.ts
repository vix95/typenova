/** Editor minimap overlay: canvas rendering, viewport indicator and dragging. */
import { $ } from "../app/dom";
import { view } from "./editor-view";
import { langText } from "../i18n/language";

export const minimapState = {
  minimapEnabled: (localStorage.getItem("typenova.minimap") !== "false") as boolean,
};
export let minimapWrap: HTMLDivElement | null = null;
let minimapCanvas: HTMLCanvasElement | null = null;
let minimapViewport: HTMLDivElement | null = null;
let minimapResizeObserver: ResizeObserver | null = null;
let minimapDrawFrame = 0;
let minimapDragging = false;
export function initializeEditorMinimap() {
  const host = $("editor") as HTMLElement;
  minimapWrap = document.createElement("div");
  minimapWrap.className = "editor-minimap";
  minimapWrap.setAttribute("role", "scrollbar");
  minimapWrap.setAttribute("aria-orientation", "vertical");
  minimapWrap.setAttribute("aria-valuemin", "0");
  minimapWrap.setAttribute("aria-valuemax", "100");
  minimapWrap.setAttribute("aria-controls", "editor");
  minimapWrap.tabIndex = 0;
  minimapWrap.setAttribute("aria-label", langText("Minimapa dokumentu. Kliknij lub przeciągnij, aby przewijać.", "Document minimap. Click or drag to navigate."));
  minimapCanvas = document.createElement("canvas");
  minimapCanvas.className = "editor-minimap-canvas";
  minimapCanvas.setAttribute("aria-hidden", "true");
  minimapViewport = document.createElement("div");
  minimapViewport.className = "editor-minimap-viewport";
  minimapWrap.append(minimapCanvas, minimapViewport);
  host.append(minimapWrap);

  const navigate = (clientY: number) => {
    if (!minimapWrap || !minimapState.minimapEnabled) return;
    const rect = minimapWrap.getBoundingClientRect();
    if (rect.height <= 0) return;
    const fraction = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const scroll = view.scrollDOM;
    scroll.scrollTop = fraction * Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    updateMinimapViewport();
  };
  minimapWrap.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0 || minimapWrap?.style.display === "none") return;
    event.preventDefault();
    minimapDragging = true;
    minimapWrap?.setPointerCapture(event.pointerId);
    navigate(event.clientY);
  });
  minimapWrap.addEventListener("pointermove", (event: PointerEvent) => {
    if (minimapDragging) navigate(event.clientY);
  });
  const stopDragging = () => { minimapDragging = false; };
  minimapWrap.addEventListener("pointerup", stopDragging);
  minimapWrap.addEventListener("pointercancel", stopDragging);
  minimapWrap.addEventListener("lostpointercapture", stopDragging);
  minimapWrap.addEventListener("keydown", (event: KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const scroll = view.scrollDOM;
    if (event.key === "Home") scroll.scrollTop = 0;
    else if (event.key === "End") scroll.scrollTop = scroll.scrollHeight;
    else if (event.key === "ArrowUp") scroll.scrollTop -= 40;
    else if (event.key === "ArrowDown") scroll.scrollTop += 40;
    else if (event.key === "PageUp") scroll.scrollTop -= scroll.clientHeight * .8;
    else scroll.scrollTop += scroll.clientHeight * .8;
    updateMinimapViewport();
  });
  if (typeof ResizeObserver !== "undefined") {
    minimapResizeObserver = new ResizeObserver(() => {
      updateMinimapLayout();
      scheduleMinimapDraw();
    });
    minimapResizeObserver.observe(host);
  }
  updateMinimapLayout();
  scheduleMinimapDraw();
}
export function updateMinimapLayout() {
  const host = $("editor") as HTMLElement | null;
  if (!host || !minimapWrap) return;
  const hostWidth = host.clientWidth;
  const hostHeight = host.clientHeight;
  // At narrow pane widths the overview would crowd the editable text, so collapse it automatically.
  const show = minimapState.minimapEnabled && hostWidth >= 285 && hostHeight >= 120 && view.state.doc.lines >= 2;
  if (!show) {
    minimapWrap.style.display = "none";
    minimapWrap.style.width = "0px";
    view.dom.style.flex = "1 1 auto";
    view.dom.style.width = "auto";
    view.requestMeasure();
    return;
  }
  const width = Math.min(132, Math.max(82, Math.round(hostWidth * .30)));
  minimapWrap.style.display = "block";
  minimapWrap.style.width = `${width}px`;
  minimapWrap.style.flexBasis = `${width}px`;
  view.dom.style.flex = "1 1 auto";
  view.dom.style.width = "auto";
  view.dom.style.minWidth = "0";
  view.requestMeasure();
  updateMinimapViewport();
}
export function scheduleMinimapDraw() {
  if (minimapDrawFrame) return;
  minimapDrawFrame = requestAnimationFrame(() => {
    minimapDrawFrame = 0;
    drawEditorMinimap();
  });
}
function drawEditorMinimap() {
  const canvas = minimapCanvas;
  const wrap = minimapWrap;
  if (!canvas || !wrap || wrap.style.display === "none") return;
  const width = Math.max(1, wrap.clientWidth);
  const height = Math.max(1, wrap.clientHeight);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const theme = document.documentElement.dataset.theme || "midnight";
  const palette: Record<string, { base: string; heading: string; code: string; comment: string; markup: string; link: string; fence: string }> = {
    midnight: { base: "#8697b0", heading: "#7fb0ff", code: "#ffbf75", comment: "#73947e", markup: "#72c9c5", link: "#86baff", fence: "#c9a0ff" },
    light: { base: "#8794a6", heading: "#286bd3", code: "#9a5a11", comment: "#63836b", markup: "#177e88", link: "#165dbb", fence: "#7c4db1" },
    newsprint: { base: "#8e8575", heading: "#9a4137", code: "#9b5d20", comment: "#697b57", markup: "#277b83", link: "#2a5d98", fence: "#8754a1" },
    retro: { base: "#9ab097", heading: "#baff66", code: "#ffd166", comment: "#6d9d6d", markup: "#74e6dc", link: "#a7f3ff", fence: "#d7b5ff" },
    contrast: { base: "#ffffff", heading: "#ffff00", code: "#ffb000", comment: "#00ffff", markup: "#00ff00", link: "#00ffff", fence: "#ff00ff" }
  };
  const colors = palette[theme] || palette.midnight;
  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--ui-editor-bg").trim() || "#111a29";
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const doc = view.state.doc;
  const lineCount = doc.lines;
  const maxRows = Math.max(100, Math.min(2400, Math.ceil(height * 1.8)));
  const sampleCount = Math.min(lineCount, maxRows);
  const step = height / Math.max(1, sampleCount);
  const barHeight = Math.max(.8, Math.min(1.7, step * .58));
  for (let i = 0; i < sampleCount; i++) {
    const lineNumber = sampleCount === lineCount ? i + 1 : 1 + Math.round(i * (lineCount - 1) / Math.max(1, sampleCount - 1));
    const text = doc.line(lineNumber).text;
    if (!text.trim()) continue;
    const trimmed = text.trimStart();
    let color = colors.base;
    if (/^#{1,6}\s/.test(trimmed)) color = colors.heading;
    else if (/^(```|~~~)/.test(trimmed)) color = colors.fence;
    else if (/^(\/\/|\/\*|\*|<!--|#\s)/.test(trimmed)) color = colors.comment;
    else if (/^(>|[-*+]\s|\d+\.\s|\|)/.test(trimmed)) color = colors.markup;
    else if (/\[[^\]]+\]\([^)]+\)|https?:\/\//.test(trimmed)) color = colors.link;
    else if (/^(import|from|export|class|def|function|const|let|var|public|private|async|return|if|for|while|interface|type|SELECT|INSERT|UPDATE)\b/.test(trimmed)) color = colors.code;
    const indent = text.length - trimmed.length;
    const x = Math.min(width - 4, 3 + Math.min(12, indent * .45));
    const available = Math.max(2, width - x - 3);
    const barWidth = Math.min(available, Math.max(2.5, trimmed.length * .68));
    const y = Math.min(height - barHeight, i * step + Math.max(0, (step - barHeight) * .5));
    ctx.fillStyle = color;
    ctx.globalAlpha = /^#{1,6}\s/.test(trimmed) ? .96 : .76;
    ctx.fillRect(x, y, barWidth, barHeight);
  }
  ctx.globalAlpha = 1;
  updateMinimapViewport();
}
export function updateMinimapViewport() {
  const wrap = minimapWrap;
  const marker = minimapViewport;
  if (!wrap || !marker || wrap.style.display === "none") return;
  const height = wrap.clientHeight;
  const scroll = view.scrollDOM;
  const scrollHeight = Math.max(scroll.scrollHeight, scroll.clientHeight, 1);
  const viewportHeight = Math.max(18, Math.min(height, height * scroll.clientHeight / scrollHeight));
  const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  const top = maxScroll <= 0 ? 0 : (height - viewportHeight) * Math.max(0, Math.min(1, scroll.scrollTop / maxScroll));
  marker.style.height = `${viewportHeight}px`;
  marker.style.transform = `translateY(${top}px)`;
  wrap.setAttribute("aria-valuenow", String(Math.round(maxScroll > 0 ? 100 * scroll.scrollTop / maxScroll : 0)));
}
