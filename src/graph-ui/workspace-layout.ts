/** Keeps the graph workspace aligned with the top bar. */
import { $ } from "../app/dom";

export function updateGraphWorkspaceTop() {
  const topbar = $("topbar");
  const bottom = topbar.getBoundingClientRect().bottom;
  document.documentElement.style.setProperty("--tn-graph-top", `${Math.max(0, bottom)}px`);
}

export function initGraphWorkspaceLayout(): void {
  if (typeof ResizeObserver !== "undefined") {
    const graphTopObserver = new ResizeObserver(updateGraphWorkspaceTop);
    graphTopObserver.observe($("topbar"));
  }
  updateGraphWorkspaceTop();
}
