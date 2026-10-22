/** Shared state of the preview pipeline: worker bookkeeping, block metrics and caches. */
import { readPreferenceFlag } from "../settings/preferences";
import MarkdownIt from "markdown-it";

export let pendingRenderIndices = new Set<number>();
export let forceRenderIndices = new Set<number>();
export type PreviewBlock = { key: string; hash: string; type: string; startLine: number; endLine: number; estimatedHeight: number; sourceLength: number; isHeavy: boolean };
export const htmlCache = new Map<string, string>();
export const heightCache = new Map<string, number>();
export const blockElements = new Map<string, HTMLElement>();
export const blockIndex = new Map<string, number>();
export const previewState = {
  workerBusy: false as boolean,
  updatePending: false as boolean,
  activeWorkerRequest: null as { id: number; action: "update" | "render"; revision: number } | null,
  previewBlocks: [] as PreviewBlock[],
  blockOffsets: [0] as number[],
  totalPreviewHeight: 0 as number,
  lastRenderedRange: [-1, -1] as [number, number],
  previewPreference: readPreferenceFlag("typenova.previewVisible", true) as boolean,
  previewVisible: undefined as unknown as boolean,
  renderWorker: null as Worker | null,
  // Markdown parsing/rendering must stay in the worker to keep the UI responsive.
  previewFallbackActive: false as boolean,
  previewFallbackRenderer: null as MarkdownIt | null,
};
previewState.previewVisible = previewState.previewPreference;
