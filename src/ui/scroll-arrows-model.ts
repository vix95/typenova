/** Where the small scroll arrows of the editor and the preview take the view: pure arithmetic, no DOM. */
export type ScrollStep = "page-up" | "page-down" | "top" | "bottom";

/** A page step keeps a tenth of the view on screen, so that the eye has something to hold on to. */
const PAGE_FRACTION = 0.9;
const MIN_PAGE_PX = 40;
/** Closer than this to an edge counts as being at the edge (fractional scroll positions of a zoomed display). */
const EDGE_PX = 2;

export const maxScrollTop = (client: number, height: number): number => Math.max(0, height - client);

/** The scroll position a step leads to, kept inside the document. */
export function scrollDestination(step: ScrollStep, top: number, client: number, height: number): number {
  const max = maxScrollTop(client, height);
  const page = Math.max(MIN_PAGE_PX, Math.round(client * PAGE_FRACTION));
  const target = step === "top" ? 0 : step === "bottom" ? max : step === "page-up" ? top - page : top + page;
  return Math.max(0, Math.min(max, target));
}

/** Whether there is anything left to scroll to in a direction (an arrow with nothing behind it is disabled). */
export function canScroll(direction: "up" | "down", top: number, client: number, height: number): boolean {
  return direction === "up" ? top > EDGE_PX : top < maxScrollTop(client, height) - EDGE_PX;
}
