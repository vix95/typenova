export type ForceEdgeKind = "tree" | "section" | "link";
export interface ForceLayoutNode { x: number; y: number; radius: number }
export interface ForceLayoutEdge { a: number; b: number; kind: ForceEdgeKind }
export interface ForceLayoutResult { positions: Float32Array; iteration: number; iterations: number }
export interface ForceLayoutHandlers {
  onFrame(result: ForceLayoutResult): void;
  onDone(result: ForceLayoutResult): void;
  onError(error: Error): void;
}

let runSequence = 0;

/** Runs the initial force layout off the UI thread. Call the returned function to cancel it. */
export function startForceLayoutWorker(
  nodes: readonly ForceLayoutNode[],
  edges: readonly ForceLayoutEdge[],
  iterations: number,
  handlers: ForceLayoutHandlers
): () => void {
  const runId = ++runSequence;
  let worker: Worker;
  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    try { worker.postMessage({ type: "cancel", runId }); } catch { /* worker may already have stopped */ }
    worker.terminate();
  };
  try {
    worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    // Defer fallback until the caller has stored the cancellation callback.
    const workerError = error instanceof Error ? error : new Error(String(error));
    queueMicrotask(() => handlers.onError(workerError));
    return () => { finished = true; };
  }
  worker.onmessage = event => {
    const message = event.data as { type?: string; runId?: number; positions?: Float32Array; iteration?: number; iterations?: number; message?: string };
    if (finished || message.runId !== runId) return;
    if (message.type === "frame" || message.type === "done") {
      const result = {
        positions: message.positions instanceof Float32Array ? message.positions : new Float32Array(message.positions || []),
        iteration: Number(message.iteration) || 0,
        iterations: Number(message.iterations) || iterations
      };
      if (message.type === "frame") handlers.onFrame(result);
      else {
        finished = true;
        worker.terminate();
        handlers.onDone(result);
      }
    } else if (message.type === "error") {
      finished = true;
      worker.terminate();
      handlers.onError(new Error(message.message || "Graph layout worker failed"));
    }
  };
  worker.onerror = event => {
    if (finished) return;
    finished = true;
    worker.terminate();
    handlers.onError(new Error(event.message || "Graph layout worker failed"));
  };
  try {
    worker.postMessage({
      type: "start", runId,
      nodes: nodes.map(node => ({ x: node.x, y: node.y, radius: node.radius })),
      edges: edges.map(edge => ({ a: edge.a, b: edge.b, kind: edge.kind })),
      iterations: Math.max(1, Math.floor(iterations))
    });
  } catch (error) {
    finished = true;
    worker.terminate();
    const workerError = error instanceof Error ? error : new Error(String(error));
    queueMicrotask(() => handlers.onError(workerError));
    return () => { finished = true; };
  }
  return cleanup;
}
