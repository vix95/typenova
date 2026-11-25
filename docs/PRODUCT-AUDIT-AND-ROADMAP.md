# TypeNova — Product Audit and Strategic Roadmap

> Product and engineering recommendations based on a repository review. This is a strategic assessment, not a runtime, penetration, or performance audit. Validate implementation details with tests and representative workloads before treating recommendations as confirmed defects.

## Executive summary

TypeNova already has a substantial foundation: a local-first Tauri desktop application, CodeMirror-based editing, multi-group workspaces, a worker-backed Markdown preview, a section-level knowledge graph, WikiLinks and backlinks, project indexing, AI integrations, Git tooling, and local data inspection.

Its strongest differentiator is the **section-level knowledge model**. Most note-taking graphs connect files. TypeNova can connect individual sections while allowing users to keep long, coherent documents intact. This is a meaningful product position.

The next stage should not be defined by adding more file formats or isolated editor features. It should turn the existing capabilities into a coherent system for writing, connecting, understanding, and analysing information.

**Strategic thesis:** make TypeNova the local-first workspace where documents remain the source of truth, sections become navigable knowledge units, and AI helps users understand relationships across an entire project—with transparent evidence and user-controlled data flow.

## 1. Current strengths

The repository and README describe a broad feature set:

- **Writing:** CodeMirror 6, formatting commands, outline and breadcrumbs, minimap, spell-checking, bookmarks, highlights, find/replace, and command palette.
- **Workspace:** tabs, up to four editor groups, drag-and-drop layout, session restoration, project tree, terminal, and multiple project folders.
- **Preview and authoring:** worker-backed Markdown rendering, Mermaid, KaTeX, code highlighting, media and PDF viewers, HTML preview, and document export/print.
- **Knowledge navigation:** section-level graph, tree and globe renderers, WikiLinks, backlinks, heading-aware navigation, link completion, and link-aware heading rename.
- **AI:** configurable providers, local model support, document/selection context, and proposed edits that require user acceptance.
- **Data:** CSV/TSV inspection, column profiling, statistics, charts, and chart embedding in notes.
- **Engineering foundations:** TypeScript and Tauri 2, a Rust host, pure modules separated from UI code, worker-based processing, tests, benchmarks, and documented filesystem constraints.

The architecture's separation of the graph model from its renderers is particularly valuable. It allows the product to evolve graph capabilities without binding the knowledge model to one visual implementation.

## 2. Product gaps and opportunities

### 2.1 Knowledge Engine

**Priority: P1 — core differentiator**

Build on the existing section graph, index, and explicit links to create a richer knowledge model.

Potential capabilities:

- Detect orphaned sections and documents.
- Identify likely duplicate or overlapping sections.
- Suggest missing links between related sections.
- Group sections into topic clusters.
- Distinguish explicit links from inferred relationships.
- Support typed relationships such as `supports`, `contradicts`, `extends`, and `depends on`.
- Identify underdeveloped topics and potential knowledge gaps.
- Explain why two sections are related, with evidence and navigable source references.

A particularly strong feature would be **Knowledge Gaps**: identify topics that appear relevant to a project but are poorly represented in its documents. Treat these as suggestions, not authoritative claims. Show the evidence and allow users to dismiss or correct them.

### 2.2 Project Intelligence and semantic retrieval

**Priority: P1 — high user value**

The inspected `src/ai/project-search.ts` implements a lightweight BM25-style lexical search with heading and filename weighting. This is a useful baseline, but lexical matching alone will miss some conceptually related passages that use different vocabulary.

Evolve retrieval incrementally:

1. Retain lexical search as a fast, explainable baseline.
2. Add optional embeddings for semantic retrieval.
3. Combine lexical and semantic scores using hybrid retrieval.
4. Add a reranking stage only if evaluation shows a measurable improvement.
5. Return section-level citations with file path, heading path, and line information.
6. Make the selected context visible before sending it to a remote provider.

Target experience:

> “Find all arguments against the current architecture and explain where each one appears.”

The assistant should retrieve relevant passages across the project, synthesise them, distinguish evidence from inference, and link each claim to its source.

Design constraints:

- Local embeddings and local inference should be supported where practical.
- Remote providers must be explicit and visible.
- Never silently upload an entire project.
- Show which passages are included in a request.
- Respect excluded folders, ignored files, and user-defined privacy boundaries.
- Make indexing, embedding generation, and model selection configurable.
- Keep ordinary search useful when no model is configured.

### 2.3 Graph as a thinking tool

**Priority: P1/P2**

The graph should help users investigate and reason, not merely display connections.

Potential capabilities:

- Topic clustering and community detection.
- Semantic edges, clearly distinguished from explicit WikiLinks.
- Filters by folder, topic, relation type, date, and confidence.
- Path finding between two sections.
- Centrality measures such as degree, betweenness, and PageRank, where they answer a real user question.
- Identification of bridge sections connecting otherwise separate topic clusters.
- Graph comparison across revisions.
- “Explain this connection”: show the path and evidence connecting two selected sections.

Avoid adding metrics for their own sake. Each graph operation should answer a concrete question and remain usable on large projects.

### 2.4 Knowledge history and temporal context

**Priority: P2**

Git integration provides a foundation for a more useful history of knowledge.

Potential capabilities:

- Section-level history and diffs.
- Timeline of how a topic evolved.
- Identify when a concept was introduced, revised, or removed.
- Compare relationships between sections across revisions.
- Summarise changes to a project or topic.
- Link a current section to relevant historical versions.

The experience should work with ordinary Git repositories and should not require a proprietary cloud history service.

### 2.5 Workspace and project workflows

**Priority: P2**

The existing editor groups and session restoration can grow into configurable workflows:

- Named workspace profiles and saved panel layouts.
- Project-specific settings.
- Focus, writing, research, and data-analysis modes.
- Persistent project dashboards.
- Cross-project search, with explicit scope selection.
- Contextual bookmarks and saved research views.
- Better restoration of the complete working context.

The goal is to reduce setup friction, not add panels indiscriminately. Keep the default workspace approachable.

### 2.6 Data analysis

**Priority: P2/P3**

TypeNova already has a useful local data-inspection workflow. It could become more capable without turning the application into a full spreadsheet.

Potential extensions:

- Editable CSV grid, if demand justifies the complexity.
- Optional DuckDB integration for SQL over local files.
- Queries joining multiple local datasets.
- Data-quality checks and anomaly summaries.
- Data lineage from a chart or report back to source files and query definitions.
- Export charts as SVG/PNG.
- Generate Markdown reports from analysis results.

Treat SQL and DuckDB as optional capabilities. Keep source files local and preserve clear provenance for generated results.

### 2.7 Accessibility, reliability, and release quality

**Priority: P0 — release foundation**

The README already identifies keyboard-accessible graph navigation, a full accessibility pass, duplicate-heading handling, and signed installers as future work.

Prioritise:

- Complete keyboard navigation, including graph and tree interactions.
- Screen-reader semantics and meaningful accessible names.
- Contrast, focus visibility, reduced-motion support, and scalable UI.
- Robust handling of duplicate headings and unresolved or ambiguous links.
- Crash recovery and safe restoration of unsaved work.
- Regression tests for file changes, moves, renames, and save conflicts.
- Tests for permission loss, inaccessible files, and external modifications.
- Signed installers and update artifacts.
- Reproducible release builds and documented release verification.

## 3. Technical review observations

These are observations from selected source files and repository documentation, not proof of runtime defects.

### 3.1 Search implementation

File: `src/ai/project-search.ts`

The current search builds a BM25-style index over passage text, headings, and filenames. Heading and filename weighting is a sensible relevance heuristic.

Recommended evolution:

- Add a representative search evaluation set before changing ranking.
- Measure recall@k, precision@k, and ranking quality on real project questions.
- Compare lexical, semantic, and hybrid retrieval.
- Evaluate Polish and English queries, inflection, abbreviations, and technical vocabulary.
- Add reranking only if it improves measured results.
- Preserve deterministic lexical fallback.

Do not replace a fast, reliable baseline with embeddings without evidence that users receive better results.

### 3.2 Project indexing

File: `src/graph/project-index-engine.ts`

The index engine already has useful design features: a port abstraction, persisted snapshots, file stamps, incremental reads of changed files, checkpoints, yielding, cancellation-related integration, and a maximum file threshold.

Potential improvements:

- Use filesystem watcher events to schedule targeted invalidation and refresh.
- Debounce bursts of events and coalesce duplicate paths.
- Treat watcher events as hints; reconcile against disk to handle missed events.
- Handle rename and delete events explicitly.
- Persist snapshots atomically, with versioning and validation.
- Make recovery from partial or corrupt index data deterministic.
- Expose index freshness and partial-failure state in the UI.
- Benchmark cold start, warm start, incremental refresh, and large-folder traversal.

Do not assume watcher events are complete or ordered. Retain a reconciliation path.

### 3.3 Graph architecture and rendering

File family: `src/graph/` and `src/graph-ui/`

The renderer-independent model is a strong architectural choice. Keep graph semantics, indexing, layout, and rendering responsibilities separate.

Do not migrate from Canvas 2D to WebGL solely because a larger graph sounds impressive. First benchmark representative vaults and measure:

- Index build time.
- Layout time.
- Interaction latency during pan, zoom, and selection.
- Frame time and dropped frames.
- Memory consumption.
- Cost of filtering and recomputing clusters.

Use the results to determine whether optimising the current renderer or introducing a WebGL renderer is justified.

### 3.4 Security and privacy

The architecture documentation describes scoped filesystem access, a constrained Tauri capability configuration, a restrictive Content Security Policy, and a sandboxed HTML page preview. These are important foundations.

Continue to review:

- Tauri capabilities and filesystem scopes whenever features are added.
- Path canonicalisation and traversal protections.
- The HTML preview's isolation boundaries.
- External link handling and URL schemes.
- API-key storage, key derivation, encryption, and secret lifetime.
- Logging and crash reports for accidental disclosure.
- AI context construction and remote data transmission.
- Dependency vulnerabilities and release provenance.

The README describes encrypted API-key storage, while historical changelog entries describe earlier provider implementations with different storage behaviour. Audit the current implementation provider by provider; do not assume all historical paths have identical guarantees.

A security review should include adversarial tests and the actual packaged application, not only configuration inspection.

### 3.5 Testing and quality engineering

The repository has pure-module tests, structural tests, selected end-to-end tests, and graph benchmarks. This is a good foundation.

Strengthen the test strategy around user-critical workflows:

- Open, edit, save, close, and recover a document.
- External modification while a document is open.
- Rename a heading with inbound links.
- Rename or move files with references and sidecar configuration.
- Rebuild an index after file additions, deletions, and renames.
- Open large and malformed files.
- Lose and regain filesystem permissions.
- Cancel long-running indexing and data jobs.
- Switch providers and handle timeouts, rate limits, and malformed AI responses.
- Verify that remote AI requests contain only the user-approved context.

Run tests on supported Windows and Linux environments. Add macOS only if it is an intended supported platform.

## 4. Product positioning

Recommended positioning:

# TypeNova
## Your Knowledge, Connected.

*A local-first workspace for writing, research, data, and connected thinking.*

Four product pillars:

1. **Write** — a dependable environment for long-form documents.
2. **Connect** — a section-level knowledge graph that preserves coherent documents.
3. **Understand** — project-wide intelligence with transparent, source-grounded AI.
4. **Analyze** — local data inspection, visualisation, and reproducible analysis.

The section-level graph is the distinctive entry point. Project-wide intelligence is the natural next layer. Data analysis broadens the audience, but should not distract from the core knowledge workflow.

## 5. Prioritised roadmap

### P0 — Reliability and v1.0 readiness

- Complete the accessibility pass, including graph keyboard navigation.
- Resolve duplicate-heading and ambiguous-link behaviour.
- Improve incremental index refresh and recovery.
- Expand end-to-end coverage of critical document and filesystem workflows.
- Validate crash recovery and save-conflict handling.
- Audit current secret storage and AI data flow.
- Sign installers and update artifacts.
- Document reproducible release and verification procedures.

**Exit criteria:** critical workflows are covered by automated tests; accessibility issues in primary workflows are addressed; release artifacts and update signatures can be independently verified.

### P1 — TypeNova Intelligence

- Create a representative retrieval evaluation dataset.
- Improve lexical retrieval and add optional semantic embeddings.
- Implement hybrid search and evaluate reranking.
- Add project-wide Q&A with section-level citations.
- Add transparent context selection and provider disclosure.
- Introduce knowledge-gap and related-section suggestions with evidence.
- Clearly distinguish explicit links from AI-inferred relationships.

**Exit criteria:** users can ask cross-document questions, inspect the evidence, navigate to sources, and control exactly what context leaves the device.

### P2 — Knowledge Engine

- Topic clusters and semantic graph exploration.
- Typed relationships and user-confirmed inferred links.
- Explain connections and paths between sections.
- Topic-level history and section diffs.
- Project insights and knowledge coverage.
- Saved research and workspace profiles.

**Exit criteria:** graph and intelligence features solve repeatable research tasks better than manual navigation alone, without overwhelming the default interface.

### P3 — Professional workspace and data workflows

- Multi-project search and configurable workspace profiles.
- Optional DuckDB/SQL integration.
- Data quality checks and lineage.
- Reproducible analysis reports and chart export.
- Extension points or plugin architecture, if user demand supports the maintenance cost.

**Exit criteria:** advanced workflows are modular, documented, and do not compromise local-first defaults or core editor performance.

## 6. What not to prioritise

Avoid:

- Adding many more file extensions without a clear user problem.
- Expanding Mermaid and LaTeX indefinitely.
- Replacing the graph renderer without benchmark evidence.
- Making the product dependent on one AI provider.
- Requiring cloud accounts or cloud sync for core functionality.
- Adding panels and modes without simplifying the overall workflow.
- Building sophisticated analytics metrics that do not support a concrete task.

The principal product risk is **feature creep**: a large feature set without a sufficiently clear hierarchy of value.

## 7. Suggested success metrics

Establish a baseline before setting numerical targets.

### Reliability
- Crash-free sessions.
- Document recovery success rate.
- Save-conflict incidents and data-loss reports.
- Release build and update verification success.

### Performance
- Cold and warm project-index startup time.
- Incremental index refresh time.
- Search latency at p50 and p95.
- Editor input latency on large documents.
- Graph interaction frame time and memory use.

### Intelligence quality
- Retrieval recall@k and precision@k.
- Citation correctness and source coverage.
- User acceptance rate for suggested links.
- False-positive rate for duplicate, contradiction, and knowledge-gap suggestions.
- Time to find a relevant passage for representative tasks.

### Product adoption
- Activation: users who open a project and successfully use core editing and navigation.
- Weekly retained users.
- Usage of graph, search, and project-wide AI.
- Completion rate of cross-document research tasks.
- Qualitative feedback on whether TypeNova replaces or complements existing tools.

Avoid optimising for raw feature usage. Measure whether users complete meaningful work more effectively.

## 8. First implementation sequence

A practical sequence for the next development cycle:

1. Define a small, version-controlled corpus of representative Markdown projects and cross-document questions.
2. Add baseline tests and metrics for current indexing and lexical retrieval.
3. Audit current AI context assembly, provider routing, and secret storage.
4. Improve index invalidation and filesystem event reconciliation.
5. Implement semantic retrieval behind an optional feature flag.
6. Evaluate hybrid retrieval against the baseline.
7. Add source-grounded project Q&A and visible context selection.
8. Introduce knowledge suggestions only after retrieval quality is measurable.
9. Complete accessibility and release-readiness work in parallel.

This sequence creates measurable foundations before adding more intelligent behaviour.

## 9. Overall assessment

The repository demonstrates a strong and unusually broad foundation for a local-first Markdown workspace. Its most defensible differentiator is not the number of supported formats or editor tools. It is the ability to represent and navigate knowledge at the section level while keeping ordinary files as the source of truth.

The highest-leverage opportunity is to connect the existing graph, index, search, and AI capabilities into a trustworthy **Knowledge Engine**.

The recommended order is:

1. Make the existing product dependable and accessible.
2. Make project-wide retrieval accurate and explainable.
3. Make graph relationships useful for reasoning and discovery.
4. Expand professional data workflows only where they reinforce the product's core identity.

**The goal is not to make TypeNova another application with an AI chat panel. The goal is to make it a workspace that understands how a user's documents fit together—without taking control of those documents away from the user.**

---

## Appendix: scope and limitations of this review

This document was prepared from a review of the repository's README, architecture documentation, package and Tauri configuration, changelog, and selected source modules including:

- `src/ai/project-search.ts`
- `src/ai/project-chunks.ts`
- `src/graph/project-index-engine.ts`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`

No application build, automated test suite, packaged-app inspection, live performance benchmark, or penetration test was run as part of this review. Recommendations are therefore prioritised hypotheses and engineering directions, not claims that every suggested capability is absent or every identified area is defective. Revalidate against the current default branch before implementation.
