export type GraphVisualMode = "graph" | "tree";
export type GraphRendererKind = "flat-canvas" | "tree-dom" | "globe-svg";

/** Central renderer policy; the graph model is not coupled to any one renderer. */
export function resolveGraphRenderer(mode: GraphVisualMode, globe3d: boolean): GraphRendererKind {
  if (mode === "tree") return "tree-dom";
  return globe3d ? "globe-svg" : "flat-canvas";
}

export interface GraphRendererLifecycle {
  mount(): void;
  unmount(): void;
  resize?(): void;
}
