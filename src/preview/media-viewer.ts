/** Preview media viewer: images and Mermaid diagrams open in a modal dialog with zoom and pan. */
import { preview } from "../app/workspace-dom";
import { langText } from "../i18n/language";

const MIN_SCALE_FACTOR = 0.25;   // relative to the fitted scale
const MAX_SCALE = 16;
const BUTTON_STEP = 1.25;
const KEY_PAN_STEP = 48;
const STAGE_MIN = { width: 560, height: 360 };
const ICONS = {
  out: '<path d="M5 12h14"/>',
  in: '<path d="M12 5v14M5 12h14"/>',
  fit: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  restore: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>'
};

type Viewer = {
  dialog: HTMLDialogElement; stage: HTMLElement; content: HTMLElement; caption: HTMLElement; level: HTMLElement;
  buttons: Record<"out" | "in" | "fit" | "fullscreen" | "close", HTMLButtonElement>;
};
const view = { scale: 1, x: 0, y: 0, fit: 1, width: 1, height: 1, maxInitial: 1, stageWidth: 0, stageHeight: 0 };
/** Compact stage size chosen on open; restored when leaving the full-window mode. */
let compactStage = { width: "", height: "" };
let usedFullscreenApi = false;
let viewer: Viewer | null = null;

function iconButton(kind: keyof typeof ICONS): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button"; button.className = `media-viewer-button media-viewer-${kind}`; button.dataset.action = kind;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[kind]}</svg>`;
  return button;
}

function createViewer(): Viewer {
  const dialog = document.createElement("dialog");
  dialog.id = "mediaViewer"; dialog.className = "media-viewer";
  const header = document.createElement("div"); header.className = "media-viewer-header";
  const caption = document.createElement("span"); caption.className = "media-viewer-caption";
  const level = document.createElement("span"); level.className = "media-viewer-level"; level.setAttribute("aria-live", "polite");
  const buttons = { out: iconButton("out"), in: iconButton("in"), fit: iconButton("fit"), fullscreen: iconButton("fullscreen"), close: iconButton("close") };
  const tools = document.createElement("div"); tools.className = "media-viewer-tools";
  tools.append(buttons.out, level, buttons.in, buttons.fit, buttons.fullscreen);
  header.append(caption, tools, buttons.close);
  const stage = document.createElement("div"); stage.className = "media-viewer-stage"; stage.tabIndex = -1;
  const content = document.createElement("div"); content.className = "media-viewer-content";
  stage.append(content); dialog.append(header, stage);
  document.body.append(dialog);
  const created = { dialog, stage, content, caption, level, buttons };
  bindViewer(created);
  return created;
}

function applyTransform(v: Viewer) {
  v.content.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  v.level.textContent = `${Math.round(view.scale * 100)}%`;
}

function stageSize(v: Viewer) { const rect = v.stage.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }

function resetView(v: Viewer) {
  const { width, height } = stageSize(v);
  view.stageWidth = width; view.stageHeight = height;
  view.fit = Math.min(width / view.width, height / view.height, view.maxInitial);
  view.scale = view.fit;
  view.x = (width - view.width * view.scale) / 2; view.y = (height - view.height * view.scale) / 2;
  applyTransform(v);
}

/** Zooms by `factor` keeping the point (cx, cy), given in stage coordinates, fixed under the pointer. */
function zoomAt(v: Viewer, factor: number, cx: number, cy: number) {
  const next = Math.max(view.fit * MIN_SCALE_FACTOR, Math.min(MAX_SCALE, view.scale * factor));
  const ratio = next / view.scale;
  view.x = cx - (cx - view.x) * ratio; view.y = cy - (cy - view.y) * ratio; view.scale = next;
  applyTransform(v);
}
function zoomAtCentre(v: Viewer, factor: number) { const { width, height } = stageSize(v); zoomAt(v, factor, width / 2, height / 2); }

function isMaximized(v: Viewer) { return v.dialog.classList.contains("is-maximized"); }

function updateFullscreenButton(v: Viewer) {
  const maximized = isMaximized(v), button = v.buttons.fullscreen;
  const label = maximized ? langText("Wyjdź z pełnego ekranu", "Exit full screen") : langText("Pełny ekran", "Full screen");
  button.setAttribute("aria-label", label); button.dataset.tooltip = label; button.setAttribute("aria-pressed", String(maximized));
  button.classList.toggle("is-active", maximized);
  button.querySelector("svg")!.innerHTML = maximized ? ICONS.restore : ICONS.fullscreen;
}

/** Makes the viewer fill the whole window (and the screen, where the Fullscreen API is available) or returns it to its compact size. */
function setMaximized(v: Viewer, maximized: boolean) {
  if (isMaximized(v) === maximized) return;
  v.dialog.classList.toggle("is-maximized", maximized);
  if (maximized) {
    compactStage = { width: v.stage.style.width, height: v.stage.style.height };
    v.stage.style.width = ""; v.stage.style.height = "";
    usedFullscreenApi = false;
    if (v.dialog.requestFullscreen && !document.fullscreenElement) {
      v.dialog.requestFullscreen().then(() => { usedFullscreenApi = true; }).catch(() => { /* the full-window layout still applies */ });
    }
  } else {
    v.stage.style.width = compactStage.width; v.stage.style.height = compactStage.height;
    if (document.fullscreenElement === v.dialog) void document.exitFullscreen().catch(() => undefined);
  }
  updateFullscreenButton(v);
}

function bindViewer(v: Viewer) {
  // Keep the picture in place when the stage changes size (full-window mode, window resize): refit when it was fitted,
  // otherwise keep the centre of the view fixed.
  new ResizeObserver(() => {
    if (!v.dialog.open) return;
    const { width, height } = stageSize(v);
    if (!width || !height || (width === view.stageWidth && height === view.stageHeight)) return;
    if (Math.abs(view.scale - view.fit) <= 0.01 || !view.stageWidth) resetView(v);
    else { view.x += (width - view.stageWidth) / 2; view.y += (height - view.stageHeight) / 2; view.stageWidth = width; view.stageHeight = height; applyTransform(v); }
  }).observe(v.stage);
  document.addEventListener("fullscreenchange", () => {
    // Leaving real full screen (for example with Escape) also leaves the full-window mode.
    if (!document.fullscreenElement && usedFullscreenApi && isMaximized(v)) { usedFullscreenApi = false; setMaximized(v, false); }
  });
  v.dialog.addEventListener("close", () => { if (isMaximized(v)) setMaximized(v, false); });
  v.buttons.fullscreen.addEventListener("click", () => setMaximized(v, !isMaximized(v)));
  const { dialog, stage, buttons } = v;
  // A click on the backdrop targets the dialog itself; the header and the stage stay inert.
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  buttons.close.addEventListener("click", () => dialog.close());
  buttons.in.addEventListener("click", () => zoomAtCentre(v, BUTTON_STEP));
  buttons.out.addEventListener("click", () => zoomAtCentre(v, 1 / BUTTON_STEP));
  buttons.fit.addEventListener("click", () => resetView(v));
  stage.addEventListener("wheel", event => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomAt(v, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0016)), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  let drag: { id: number; x: number; y: number } | null = null;
  stage.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId); stage.classList.add("is-panning");
  });
  stage.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    view.x += event.clientX - drag.x; view.y += event.clientY - drag.y; drag.x = event.clientX; drag.y = event.clientY;
    applyTransform(v);
  });
  const endDrag = (event: PointerEvent) => { if (drag?.id === event.pointerId) { drag = null; stage.classList.remove("is-panning"); } };
  stage.addEventListener("pointerup", endDrag); stage.addEventListener("pointercancel", endDrag);
  // Double click toggles between the fitted view and 100% around the pointer.
  stage.addEventListener("dblclick", event => {
    const rect = stage.getBoundingClientRect();
    if (Math.abs(view.scale - view.fit) > 0.01) resetView(v);
    else zoomAt(v, view.fit < 1 ? 1 / view.fit : 2, event.clientX - rect.left, event.clientY - rect.top);
  });
  dialog.addEventListener("keydown", event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const pan = (dx: number, dy: number) => { event.preventDefault(); view.x += dx; view.y += dy; applyTransform(v); };
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAtCentre(v, BUTTON_STEP); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomAtCentre(v, 1 / BUTTON_STEP); }
    else if (event.key === "0") { event.preventDefault(); resetView(v); }
    else if (event.key === "f" || event.key === "F") { event.preventDefault(); setMaximized(v, !isMaximized(v)); }
    else if (event.key === "ArrowLeft") pan(KEY_PAN_STEP, 0);
    else if (event.key === "ArrowRight") pan(-KEY_PAN_STEP, 0);
    else if (event.key === "ArrowUp") pan(0, KEY_PAN_STEP);
    else if (event.key === "ArrowDown") pan(0, -KEY_PAN_STEP);
  });
}

function localizeControls(v: Viewer) {
  const labels: Record<keyof Viewer["buttons"], string> = {
    out: langText("Pomniejsz", "Zoom out"), in: langText("Powiększ", "Zoom in"),
    fit: langText("Dopasuj i wyśrodkuj", "Fit and center"), fullscreen: langText("Pełny ekran", "Full screen"), close: langText("Zamknij podgląd", "Close viewer")
  };
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) { v.buttons[key].setAttribute("aria-label", labels[key]); v.buttons[key].dataset.tooltip = labels[key]; }
  updateFullscreenButton(v);
  v.stage.setAttribute("aria-label", langText(
    "Kółko myszy powiększa, przeciąganie przesuwa, dwuklik przełącza dopasowanie i 100%, F włącza pełny ekran",
    "Mouse wheel zooms, dragging pans, double click toggles fit and 100%, F toggles full screen"));
}

/** Shows `element` (natural size `width` x `height`) in the viewer. */
function openViewer(element: HTMLElement, width: number, height: number, label: string, maxInitial: number) {
  viewer ??= createViewer();
  const v = viewer;
  localizeControls(v);
  v.dialog.setAttribute("aria-label", label); v.caption.textContent = label;
  element.style.width = `${width}px`; element.style.height = `${height}px`;
  v.content.replaceChildren(element);
  view.width = width; view.height = height; view.maxInitial = maxInitial;
  // Size the stage to the fitted content so small media gets a compact dialog and large media fills the window.
  const availWidth = Math.max(STAGE_MIN.width, window.innerWidth - 64), availHeight = Math.max(STAGE_MIN.height, window.innerHeight - 64 - 48);
  const fit = Math.min(availWidth / width, availHeight / height, maxInitial);
  v.stage.style.width = `${Math.max(STAGE_MIN.width, Math.min(availWidth, Math.round(width * fit)))}px`;
  v.stage.style.height = `${Math.max(STAGE_MIN.height, Math.min(availHeight, Math.round(height * fit)))}px`;
  if (!v.dialog.open) v.dialog.showModal();
  resetView(v);
  v.stage.focus({ preventScroll: true });
}

function openImage(source: HTMLImageElement) {
  const image = document.createElement("img");
  image.decoding = "async"; image.draggable = false; image.alt = source.alt; image.src = source.currentSrc || source.src;
  openViewer(image, source.naturalWidth, source.naturalHeight, source.alt.trim() || langText("Powiększony obraz", "Enlarged image"), 1);
}

function svgNaturalSize(svg: SVGSVGElement): { width: number; height: number } | null {
  const box = svg.viewBox?.baseVal;
  if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height };
  const rect = svg.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : null;
}

function openDiagram(container: HTMLElement) {
  const source = container.querySelector<SVGSVGElement>("svg");
  const size = source && svgNaturalSize(source);
  if (!source || !size) return;
  const svg = source.cloneNode(true) as SVGSVGElement;
  svg.removeAttribute("style"); svg.setAttribute("width", String(size.width)); svg.setAttribute("height", String(size.height));
  svg.setAttribute("focusable", "false");
  const holder = document.createElement("div"); holder.className = "media-viewer-diagram"; holder.append(svg);
  openViewer(holder, size.width, size.height, langText("Diagram Mermaid", "Mermaid diagram"), 2);
}

export function initMediaViewer(): void {
  preview.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("a, button")) return;
    if (target instanceof HTMLImageElement) {
      if (target.classList.contains("image-unavailable") || !target.complete || !target.naturalWidth) return;
      event.preventDefault(); openImage(target); return;
    }
    const diagram = target.closest<HTMLElement>(".mermaid-container");
    if (diagram && !window.getSelection()?.toString()) { event.preventDefault(); openDiagram(diagram); }
  });
}
