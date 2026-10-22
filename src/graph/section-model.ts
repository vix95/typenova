/** Renderer-independent model shared by Flat, Tree and Globe views. */
export interface SectionNode {
  id: string;
  path: string;
  file: string;
  title: string;
  level: number;
  line: number;
  parent: string | null;
  links: string[];
  content: string;
}

export interface MarkdownSourceFile {
  path: string;
  name: string;
  text: string;
}

export type SectionRelationKind = "tree" | "section" | "link";

const SECTION_RELATION_PRIORITY: Record<SectionRelationKind, number> = { tree: 3, link: 2, section: 1 };

/** Return the semantically stronger relation when multiple relation types share an endpoint pair. */
export function preferredSectionRelationKind(
  current: SectionRelationKind,
  incoming: SectionRelationKind,
): SectionRelationKind {
  return SECTION_RELATION_PRIORITY[incoming] > SECTION_RELATION_PRIORITY[current] ? incoming : current;
}
export interface SectionRelation {
  sourceId: string;
  targetId: string;
  kind: SectionRelationKind;
}
export interface SectionGraphModel {
  sections: SectionNode[];
  byId: Map<string, SectionNode>;
  relations: SectionRelation[];
  /** Incident edges indexed once so filtered renderer views never rescan all edges. */
  relationsByNodeId: Map<string, SectionRelation[]>;
  degreeById: Map<string, number>;
  adjacencyById: Map<string, Set<string>>;
  childrenByParentId: Map<string, string[]>;
  sectionsByFile: Map<string, SectionNode[]>;
}

export type SectionIndexStage = "headings" | "content" | "links" | "relations";
export interface SectionIndexProgress {
  stage: SectionIndexStage;
  percent: number;
  fileIndex: number;
  fileCount: number;
  processed?: number;
}
export interface SectionIndexOptions {
  isCancelled?: () => boolean;
  onProgress?: (progress: SectionIndexProgress) => void;
  yieldControl?: () => Promise<void>;
}
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Files are processed in batches before yielding, so thousands of small files do not flood the task queue. */
const YIELD_EVERY_FILES = 32;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_PATTERN = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const WIKI_LINK_PATTERN = /\[\[([^\]|#]+)?(?:#([^\]|]+))?(?:\|[^\]]+)?\]\]/g;

const normalizeFileKey = (value: string) => value.replace(/\\\\/g, "/").replace(/^\.\//, "").toLocaleLowerCase();

function pushIndexed<K>(index: Map<K, SectionNode[]>, key: K, section: SectionNode): void {
  const bucket = index.get(key);
  if (bucket) bucket.push(section);
  else index.set(key, [section]);
}

/** Tracks whether a line sits inside a fenced code block (``` or ~~~, closed by a matching, long-enough fence). */
interface FenceState {
  marker: "`" | "~" | null;
  length: number;
}

/** Feeds one line to the tracker; returns true when the line is itself a fence delimiter. */
function consumeFenceLine(state: FenceState, line: string): boolean {
  const match = FENCE_PATTERN.exec(line);
  if (!match) return false;
  const marker = match[1][0] as "`" | "~";
  if (!state.marker) {
    state.marker = marker;
    state.length = match[1].length;
  } else if (marker === state.marker && match[1].length >= state.length && /^\s*$/.test(match[2])) {
    state.marker = null;
    state.length = 0;
  }
  return true;
}

/** Lookup tables built while scanning headings and consumed by the content and link passes. */
interface SectionIndexes {
  linesByPath: Map<string, string[]>;
  sections: SectionNode[];
  sectionsByFile: Map<string, SectionNode[]>;
  byTitle: Map<string, SectionNode[]>;
  sectionsByNormalizedPath: Map<string, SectionNode[]>;
  sectionsByNormalizedFile: Map<string, SectionNode[]>;
  sectionEndById: Map<string, number>;
}

/** Shared progress, yielding and cancellation plumbing for the indexing passes. */
interface IndexContext {
  files: readonly MarkdownSourceFile[];
  fileTotal: number;
  report(stage: SectionIndexStage, percent: number, fileIndex: number, processed?: number): void;
  /** Gives the UI a turn; resolves to true when indexing was cancelled meanwhile. */
  pause(): Promise<boolean>;
  shouldYieldAfterFile(fileIndex: number): boolean;
}

function createIndexContext(files: readonly MarkdownSourceFile[], options: SectionIndexOptions): IndexContext {
  const yieldControl = options.yieldControl || yieldTask;
  let lastReportedStage: SectionIndexStage | null = null;
  let lastReportedPercent = -Infinity;
  return {
    files,
    fileTotal: Math.max(1, files.length),
    report(stage, percent, fileIndex, processed) {
      const normalizedPercent = Math.max(0, Math.min(94, percent));
      // Progress is advisory. Emit at stage transitions and at ~1% intervals rather
      // than flooding the UI thread with one message per input file.
      if (stage !== lastReportedStage || normalizedPercent >= lastReportedPercent + 1 || (fileIndex >= files.length && processed === undefined)) {
        options.onProgress?.({ stage, percent: normalizedPercent, fileIndex, fileCount: files.length, processed });
        lastReportedStage = stage;
        lastReportedPercent = normalizedPercent;
      }
    },
    async pause() {
      await yieldControl();
      return options.isCancelled?.() === true;
    },
    shouldYieldAfterFile: fileIndex => (fileIndex + 1) % YIELD_EVERY_FILES === 0 || fileIndex + 1 === files.length,
  };
}

/** Pass 1: finds ATX headings outside code fences and registers every section in the lookup tables. Returns false when cancelled. */
async function scanHeadings(ctx: IndexContext, index: SectionIndexes): Promise<boolean> {
  const { files, fileTotal } = ctx;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    const lines = file.text.split(/\r?\n/);
    index.linesByPath.set(file.path, lines);
    const stack: SectionNode[] = [];
    const fence: FenceState = { marker: null, length: 0 };
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (lineIndex > 0 && lineIndex % 1000 === 0) {
        ctx.report("headings", 8 + ((fileIndex + lineIndex / Math.max(1, lines.length)) / fileTotal) * 47, fileIndex + 1, lineIndex);
        if (await ctx.pause()) return false;
      }
      const line = lines[lineIndex];
      if (consumeFenceLine(fence, line) || fence.marker) continue;
      const match = HEADING_PATTERN.exec(line);
      if (!match) continue;
      const level = match[1].length;
      const title = match[2].replace(/\s+\{#.*?\}\s*$/, "").trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const section: SectionNode = {
        id: `${file.path.replace(/\\/g, "/")}::${lineIndex + 1}`,
        path: file.path,
        file: file.name,
        title,
        level,
        line: lineIndex + 1,
        parent: stack.length ? stack[stack.length - 1].id : null,
        links: [],
        content: ""
      };
      index.sections.push(section);
      stack.push(section);
      pushIndexed(index.sectionsByFile, file.path, section);
      pushIndexed(index.sectionsByNormalizedPath, normalizeFileKey(file.path), section);
      pushIndexed(index.sectionsByNormalizedFile, normalizeFileKey(file.name), section);
      pushIndexed(index.byTitle, title.toLocaleLowerCase(), section);
    }
    ctx.report("headings", 8 + ((fileIndex + 1) / fileTotal) * 47, fileIndex + 1);
    if (ctx.shouldYieldAfterFile(fileIndex) && await ctx.pause()) return false;
  }
  return true;
}

/**
 * Exclusive end line index of every section (the next heading of the same or a higher level),
 * computed in linear time with a stack of open sections.
 */
function computeSectionEndIndexes(local: readonly SectionNode[], lineCount: number): number[] {
  const endIndexes = new Array<number>(local.length).fill(lineCount);
  const stack: number[] = [];
  for (let i = 0; i < local.length; i++) {
    const current = local[i];
    while (stack.length && local[stack[stack.length - 1]].level >= current.level) {
      const previous = stack.pop()!;
      endIndexes[previous] = current.line - 1;
    }
    stack.push(i);
  }
  for (const index of stack) endIndexes[index] = lineCount;
  return endIndexes;
}

/** Pass 2: fills each section's body text and records where it ends. Returns false when cancelled. */
async function fillSectionContent(ctx: IndexContext, index: SectionIndexes): Promise<boolean> {
  const { files, fileTotal } = ctx;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    const lines = index.linesByPath.get(file.path) || [];
    const local = index.sectionsByFile.get(file.path) || [];
    const endIndexes = computeSectionEndIndexes(local, lines.length);
    for (let i = 0; i < local.length; i++) {
      const section = local[i];
      index.sectionEndById.set(section.id, endIndexes[i]);
      section.content = lines.slice(section.line - 1, endIndexes[i]).join("\n").trim();
      if (i > 0 && i % 240 === 0) {
        ctx.report("content", 55 + ((fileIndex + i / Math.max(1, local.length)) / fileTotal) * 20, fileIndex + 1, i);
        if (await ctx.pause()) return false;
      }
    }
    ctx.report("content", 55 + ((fileIndex + 1) / fileTotal) * 20, fileIndex + 1);
    if (ctx.shouldYieldAfterFile(fileIndex) && await ctx.pause()) return false;
  }
  return true;
}

/** Section body without fenced code blocks, so links inside code samples are ignored. */
function visibleBodyText(bodyLines: readonly string[]): string {
  const fence: FenceState = { marker: null, length: 0 };
  const visible: string[] = [];
  for (const line of bodyLines) {
    if (consumeFenceLine(fence, line)) continue;
    if (!fence.marker) visible.push(line);
  }
  return visible.join("\n");
}

/** Resolves one `[[target#anchor|alias]]` link to a section, preferring the same file and case-insensitive titles. */
function resolveWikiLink(match: RegExpMatchArray, sourcePath: string, index: SectionIndexes): SectionNode | undefined {
  const rawFileTarget = (match[1] || "").trim();
  const rawAnchor = (match[2] || "").trim();
  const looksLikeFileTarget = /[\\/]/.test(rawFileTarget) || /\.[a-z0-9]{1,8}$/i.test(rawFileTarget);
  if (rawFileTarget && looksLikeFileTarget) {
    const targetPath = normalizeFileKey(rawFileTarget.replace(/\\/g, "/"));
    const normalizedSource = normalizeFileKey(sourcePath);
    const sourceDirectory = normalizedSource.includes("/") ? normalizedSource.slice(0, normalizedSource.lastIndexOf("/") + 1) : "";
    const relativeTargetPath = targetPath.startsWith("/") ? targetPath : `${sourceDirectory}${targetPath}`;
    const basename = targetPath.split("/").pop() || targetPath;
    const candidates = index.sectionsByNormalizedPath.get(relativeTargetPath)
      || index.sectionsByNormalizedPath.get(`${relativeTargetPath}.md`)
      || index.sectionsByNormalizedPath.get(targetPath)
      || index.sectionsByNormalizedPath.get(`${targetPath}.md`)
      || index.sectionsByNormalizedFile.get(basename)
      || index.sectionsByNormalizedFile.get(basename.endsWith(".md") ? basename : `${basename}.md`);
    if (!candidates?.length) return undefined;
    return rawAnchor
      ? candidates.find(candidate => candidate.title.toLocaleLowerCase() === rawAnchor.toLocaleLowerCase())
      : candidates[0];
  }
  const titleTarget = (rawAnchor || rawFileTarget).replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,8}$/i, "").toLocaleLowerCase();
  const candidates = index.byTitle.get(titleTarget) || [];
  return candidates.find(candidate => candidate.path === sourcePath) || candidates[0];
}

/** Pass 3: resolves Obsidian-style links of every section. Returns false when cancelled. */
async function resolveSectionLinks(ctx: IndexContext, index: SectionIndexes): Promise<boolean> {
  const { files, fileTotal } = ctx;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    const lines = index.linesByPath.get(file.path) || [];
    const sourceSections = index.sectionsByFile.get(file.path) || [];
    for (let i = 0; i < sourceSections.length; i++) {
      const section = sourceSections[i];
      const endIndex = index.sectionEndById.get(section.id) ?? lines.length;
      const body = visibleBodyText(lines.slice(section.line, endIndex));
      for (const match of body.matchAll(WIKI_LINK_PATTERN)) {
        const destination = resolveWikiLink(match, file.path, index);
        if (destination && destination.id !== section.id && !section.links.includes(destination.id)) section.links.push(destination.id);
      }
      if (i > 0 && i % 200 === 0) {
        ctx.report("links", 75 + ((fileIndex + i / Math.max(1, sourceSections.length)) / fileTotal) * 19, fileIndex + 1, i);
        if (await ctx.pause()) return false;
      }
    }
    ctx.report("links", 75 + ((fileIndex + 1) / fileTotal) * 19, fileIndex + 1);
    if (ctx.shouldYieldAfterFile(fileIndex) && await ctx.pause()) return false;
  }
  return true;
}

/**
 * Builds complete Markdown sections with stable path/line IDs, parent chains,
 * section bodies and Obsidian-style links. It is intentionally independent of
 * Canvas/SVG/DOM so all graph renderers consume the same source of truth.
 */
export async function buildSectionNodes(
  files: readonly MarkdownSourceFile[],
  options: SectionIndexOptions = {}
): Promise<SectionNode[]> {
  const ctx = createIndexContext(files, options);
  const index: SectionIndexes = {
    linesByPath: new Map(),
    sections: [],
    sectionsByFile: new Map(),
    byTitle: new Map(),
    sectionsByNormalizedPath: new Map(),
    sectionsByNormalizedFile: new Map(),
    sectionEndById: new Map(),
  };
  if (!await scanHeadings(ctx, index)) return [];
  if (!await fillSectionContent(ctx, index)) return [];
  if (!await resolveSectionLinks(ctx, index)) return [];
  return index.sections;
}

/** Builds relationships once for whichever subset of sections is currently visible. */
export function buildSectionGraphModel(sections: readonly SectionNode[]): SectionGraphModel {
  const byId = new Map(sections.map(section => [section.id, section] as const));
  const childrenByParentId = new Map<string, string[]>();
  const sectionsByFile = new Map<string, SectionNode[]>();
  const degreeById = new Map<string, number>();
  const adjacencyById = new Map<string, Set<string>>();
  const edgeByPair = new Map<string, SectionRelation>();
  for (const section of sections) {
    degreeById.set(section.id, 0);
    adjacencyById.set(section.id, new Set());
    if (section.parent && byId.has(section.parent)) {
      const children = childrenByParentId.get(section.parent) || [];
      children.push(section.id);
      childrenByParentId.set(section.parent, children);
    }
    const fileSections = sectionsByFile.get(section.path) || [];
    fileSections.push(section);
    sectionsByFile.set(section.path, fileSections);
  }
  const addRelation = (sourceId: string, targetId: string, kind: SectionRelationKind) => {
    if (sourceId === targetId || !byId.has(sourceId) || !byId.has(targetId)) return;
    const pair = sourceId < targetId ? `${sourceId}\u0000${targetId}` : `${targetId}\u0000${sourceId}`;
    const current = edgeByPair.get(pair);
    if (current) {
      current.kind = preferredSectionRelationKind(current.kind, kind);
      return;
    }
    edgeByPair.set(pair, { sourceId, targetId, kind });
  };
  for (const section of sections) if (section.parent && byId.has(section.parent)) addRelation(section.parent, section.id, "tree");
  for (const group of sectionsByFile.values()) {
    group.sort((a, b) => a.line - b.line);
    for (let i = 1; i < group.length; i++) addRelation(group[i - 1].id, group[i].id, "section");
  }
  for (const section of sections) {
    for (const targetId of section.links) {
      const target = byId.get(targetId);
      if (target && target.parent !== section.id && section.parent !== target.id) addRelation(section.id, targetId, "link");
    }
  }
  const relations = [...edgeByPair.values()];
  const relationsByNodeId = new Map<string, SectionRelation[]>();
  for (const relation of relations) {
    degreeById.set(relation.sourceId, (degreeById.get(relation.sourceId) || 0) + 1);
    degreeById.set(relation.targetId, (degreeById.get(relation.targetId) || 0) + 1);
    adjacencyById.get(relation.sourceId)?.add(relation.targetId);
    adjacencyById.get(relation.targetId)?.add(relation.sourceId);
    const sourceRelations = relationsByNodeId.get(relation.sourceId) || [];
    sourceRelations.push(relation);
    relationsByNodeId.set(relation.sourceId, sourceRelations);
    const targetRelations = relationsByNodeId.get(relation.targetId) || [];
    targetRelations.push(relation);
    relationsByNodeId.set(relation.targetId, targetRelations);
  }
  return { sections: [...sections], byId, relations, relationsByNodeId, degreeById, adjacencyById, childrenByParentId, sectionsByFile };
}

const sectionGraphViewCache = new WeakMap<SectionGraphModel, Map<string, SectionGraphModel>>();
const SECTION_GRAPH_VIEW_CACHE_LIMIT = 8;

/**
 * Derives a renderer-specific filtered view from the shared graph index.
 * It only visits incident relations of visible nodes; repeated filter states are cached.
 */
export function projectSectionGraphModel(source: SectionGraphModel, sections: readonly SectionNode[]): SectionGraphModel {
  if (sections.length === source.sections.length && sections.every((section, index) => section.id === source.sections[index]?.id)) return source;
  // Use a compact signature instead of retaining a multi-megabyte joined key for huge projects.
  let signature = 2166136261;
  for (const section of sections) {
    const id = section.id;
    for (let i = 0; i < id.length; i++) signature = Math.imul(signature ^ id.charCodeAt(i), 16777619) >>> 0;
    signature = Math.imul(signature ^ 1, 16777619) >>> 0;
  }
  const cacheKey = `${sections.length}:${signature.toString(16)}`;
  let cache = sectionGraphViewCache.get(source);
  if (!cache) { cache = new Map(); sectionGraphViewCache.set(source, cache); }
  const cached = cache.get(cacheKey);
  if (cached && cached.sections.length === sections.length && cached.sections.every((section, index) => section.id === sections[index]?.id)) return cached;

  const byId = new Map(sections.map(section => [section.id, section] as const));
  const childrenByParentId = new Map<string, string[]>();
  const sectionsByFile = new Map<string, SectionNode[]>();
  const degreeById = new Map<string, number>();
  const adjacencyById = new Map<string, Set<string>>();
  const relations: SectionRelation[] = [];
  const seenRelations = new Set<string>();
  for (const section of sections) {
    degreeById.set(section.id, 0);
    adjacencyById.set(section.id, new Set());
    if (section.parent && byId.has(section.parent)) {
      const children = childrenByParentId.get(section.parent) || [];
      children.push(section.id);
      childrenByParentId.set(section.parent, children);
    }
    const group = sectionsByFile.get(section.path) || [];
    group.push(section);
    sectionsByFile.set(section.path, group);
    for (const relation of source.relationsByNodeId.get(section.id) || []) {
      const otherId = relation.sourceId === section.id ? relation.targetId : relation.sourceId;
      if (!byId.has(otherId)) continue;
      const relationKey = relation.sourceId < relation.targetId ? `${relation.sourceId}\u0000${relation.targetId}` : `${relation.targetId}\u0000${relation.sourceId}`;
      if (seenRelations.has(relationKey)) continue;
      seenRelations.add(relationKey);
      relations.push(relation);
      degreeById.set(relation.sourceId, (degreeById.get(relation.sourceId) || 0) + 1);
      degreeById.set(relation.targetId, (degreeById.get(relation.targetId) || 0) + 1);
      adjacencyById.get(relation.sourceId)?.add(relation.targetId);
      adjacencyById.get(relation.targetId)?.add(relation.sourceId);
    }
  }
  const relationsByNodeId = new Map<string, SectionRelation[]>();
  for (const relation of relations) {
    const sourceRelations = relationsByNodeId.get(relation.sourceId) || [];
    sourceRelations.push(relation);
    relationsByNodeId.set(relation.sourceId, sourceRelations);
    const targetRelations = relationsByNodeId.get(relation.targetId) || [];
    targetRelations.push(relation);
    relationsByNodeId.set(relation.targetId, targetRelations);
  }
  const model: SectionGraphModel = { sections: [...sections], byId, relations, relationsByNodeId, degreeById, adjacencyById, childrenByParentId, sectionsByFile };
  cache.set(cacheKey, model);
  if (cache.size > SECTION_GRAPH_VIEW_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return model;
}
