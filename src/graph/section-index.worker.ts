/// <reference lib="webworker" />
import { buildSectionGraphModel, buildSectionNodes, type MarkdownSourceFile, type SectionIndexProgress } from "./section-model";

type Request = { type: "index"; requestId: number; files: MarkdownSourceFile[] } | { type: "cancel"; requestId: number };
const cancelled = new Set<number>();
self.addEventListener("message", event => {
  const message = event.data as Request;
  if (message.type === "cancel") { cancelled.add(message.requestId); return; }
  if (message.type !== "index") return;
  const { requestId, files } = message;
  void buildSectionNodes(files, {
    isCancelled: () => cancelled.has(requestId),
    yieldControl: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
    onProgress: (progress: SectionIndexProgress) => self.postMessage({ type: "progress", requestId, progress })
  }).then(sections => {
    if (cancelled.has(requestId)) { cancelled.delete(requestId); return; }
    self.postMessage({ type: "progress", requestId, progress: { stage: "relations", percent: 95, fileIndex: files.length, fileCount: files.length } });
    const model = buildSectionGraphModel(sections);
    if (!cancelled.has(requestId)) self.postMessage({ type: "done", requestId, model });
    cancelled.delete(requestId);
  }).catch(error => {
    if (!cancelled.has(requestId)) self.postMessage({ type: "error", requestId, message: error instanceof Error ? error.message : String(error) });
    cancelled.delete(requestId);
  });
});
