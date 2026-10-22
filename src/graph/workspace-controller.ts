/** Minimal worker contract kept injectable so graph lifecycle is testable without a browser. */
export interface TerminableWorker {
  terminate(): void;
}

/**
 * Coordinates graph indexing generations and their worker lifetime.
 * A response is only allowed to mutate the workspace while its generation is current.
 */
export interface GraphWorkspaceController {
  beginBuild(): number;
  cancel(): number;
  isCurrent(generation: number): boolean;
  attachIndexWorker(generation: number, worker: TerminableWorker, onCancel?: () => void): boolean;
  releaseIndexWorker(worker: TerminableWorker): void;
}

export function createGraphWorkspaceController(): GraphWorkspaceController {
  let generation = 0;
  let indexWorker: { worker: TerminableWorker; onCancel?: () => void } | null = null;

  const stopIndexWorker = () => {
    const current = indexWorker;
    indexWorker = null;
    if (!current) return;
    try { current.onCancel?.(); } catch { /* cancellation must not block worker cleanup */ }
    current.worker.terminate();
  };

  return {
    beginBuild() {
      generation += 1;
      stopIndexWorker();
      return generation;
    },
    cancel() {
      generation += 1;
      stopIndexWorker();
      return generation;
    },
    isCurrent(candidate) {
      return candidate === generation;
    },
    attachIndexWorker(candidate, worker, onCancel) {
      if (candidate !== generation) {
        try { onCancel?.(); } finally { worker.terminate(); }
        return false;
      }
      if (indexWorker && indexWorker.worker !== worker) stopIndexWorker();
      indexWorker = { worker, onCancel };
      return true;
    },
    releaseIndexWorker(worker) {
      if (indexWorker?.worker === worker) indexWorker = null;
    }
  };
}
