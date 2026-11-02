/** A pannable, zoomable area that shows one rendered SVG diagram (mouse wheel zooms at the pointer, dragging pans). */

export interface DiagramViewport {
  element: HTMLElement;
  /** Shows a rendered SVG; the first one is fitted to the area, later ones keep the user's zoom and position. */
  setSvg(svg: string): void;
  clear(): void;
  fit(): void;
  zoomBy(factor: number): void;
}

const MIN_SCALE = 0.1, MAX_SCALE = 8;

function naturalSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.viewBox?.baseVal;
  if (box && box.width && box.height) return { width: box.width, height: box.height };
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 300, height: rect.height || 200 };
}

/** `onPick` receives the element under the pointer when the area is clicked without dragging (null for the empty background). */
export function createDiagramViewport(onPick?: (target: Element | null) => void): DiagramViewport {
  const element = document.createElement("div"); element.className = "diagram-viewport"; element.tabIndex = 0;
  const stage = document.createElement("div"); stage.className = "diagram-stage"; element.append(stage);
  let scale = 1, x = 0, y = 0, size = { width: 0, height: 0 }, fitted = false;
  const apply = () => { stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };

  const zoomAt = (factor: number, originX: number, originY: number) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    const ratio = next / scale;
    x = originX - (originX - x) * ratio; y = originY - (originY - y) * ratio; scale = next; apply();
  };
  const fit = () => {
    if (!size.width || !size.height) return;
    const width = element.clientWidth || 600, height = element.clientHeight || 400;
    scale = Math.min(width / size.width, height / size.height, 2) * 0.94;
    x = (width - size.width * scale) / 2; y = (height - size.height * scale) / 2; apply();
  };

  element.addEventListener("wheel", event => {
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  let drag: { id: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null = null;
  element.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, originX: x, originY: y, moved: false };
    element.setPointerCapture(event.pointerId); element.classList.add("dragging");
  });
  element.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
    x = drag.originX + event.clientX - drag.startX; y = drag.originY + event.clientY - drag.startY; apply();
  });
  const end = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    const clicked = !drag.moved && event.type === "pointerup";
    drag = null; element.classList.remove("dragging");
    if (clicked && onPick) onPick(document.elementsFromPoint(event.clientX, event.clientY).find(node => stage.contains(node) && node !== stage) ?? null);
  };
  element.addEventListener("pointerup", end); element.addEventListener("pointercancel", end);
  element.addEventListener("dblclick", fit);
  element.addEventListener("keydown", event => {
    if (event.key === "+" || event.key === "=") zoomAt(1.2, element.clientWidth / 2, element.clientHeight / 2);
    else if (event.key === "-") zoomAt(1 / 1.2, element.clientWidth / 2, element.clientHeight / 2);
    else if (event.key === "0") fit();
  });

  return {
    element,
    setSvg(svg) {
      stage.innerHTML = svg;
      const drawing = stage.querySelector("svg");
      if (!drawing) return;
      const previous = size; size = naturalSize(drawing);
      // A very different drawing (another diagram type) is fitted again; small edits keep the zoom and position.
      const changed = previous.width && (size.width / previous.width > 1.5 || size.width / previous.width < 0.67 || size.height / previous.height > 1.5 || size.height / previous.height < 0.67);
      drawing.removeAttribute("style"); drawing.setAttribute("width", String(size.width)); drawing.setAttribute("height", String(size.height));
      if (!fitted || changed) { fitted = true; fit(); }
    },
    clear() { stage.replaceChildren(); size = { width: 0, height: 0 }; fitted = false; },
    fit,
    zoomBy(factor) { zoomAt(factor, element.clientWidth / 2, element.clientHeight / 2); },
  };
}
