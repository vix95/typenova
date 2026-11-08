# TypeNova architecture

The single technical reference of the repository. It describes how the application is built and the rules that keep it correct. What changed in each release is in [CHANGELOG.md](CHANGELOG.md); user-facing features are in the [README](../README.md).

TypeNova is a local-first desktop Markdown workspace: TypeScript + Vite in a Tauri 2 / Rust shell, CodeMirror 6 for editing, a Web Worker for Markdown. Documents on disk are authoritative; nothing is sent to a network service.

## 1. Source layout

| Path | Responsibility |
|---|---|
| `src/main.ts` | Thin composition root. Imports the feature modules and runs the boot sequence. No feature logic. |
| `src/app` | Shell: `$` helper, workspace scaffolding, sidebar, command palette, menu/toolbar/settings/global bindings. |
| `src/ui` | Reusable UI infrastructure: tooltip, themed select, dialogs, toast, `icons.ts` (SVG icon set). |
| `src/i18n` | Polish/English switching: phrase table, `applyLanguage`, `langText`. |
| `src/editor` | CodeMirror: extensions, completions, snippets, minimap, scroll sync, Math and Mermaid editors, format document. |
| `src/documents` | Open documents: state, tabs, dirty flag, file actions, recovery, session restore. |
| `src/preview` | Preview pipeline: worker client, virtual window, fallback, code blocks, Mermaid, export/print, media/PDF/TIFF viewers, structured (JSON/XML) tree, page preview. |
| `src/outline`, `src/layout` | Heading outline and breadcrumbs; pane widths, appearance, focus mode, splitters. |
| `src/project`, `src/filesystem` | Project explorer UI; pure filesystem logic (paths, file kinds, encodings, tree operations). |
| `src/graph`, `src/graph-ui` | Section graph: renderer-independent model and workers (`graph`); state, indexing, Tree / Flat canvas / Globe renderers and interactions (`graph-ui`). |
| `src/git-ui` | Read-only Git history dialog (graph, commit list, detail, diff). |
| `src/preview.worker.ts` | Markdown parsing and rendering worker. |
| `src/style.css`, `src/styles/` | `style.css` only imports `foundation.css`, `theme-project.css`, `graph-workspace.css` in that order; the order is the cascade. |
| `src-tauri/` | Rust host: commands, capabilities, filesystem scope, `page_server`, `git`, `clipboard_files`. |
| `tests/`, `benchmarks/`, `examples/file-types/` | Node tests, graph indexing benchmark, reproducible sample files per supported type. |

Element ids and `localStorage` keys still use the former `brain` prefix (`#brainView`, `typenova.brain.*`); they are persisted or shared with CSS and were deliberately kept.

## 2. Module contract

- A module's top level contains **declarations only**. Anything with a side effect (event listeners, DOM setup) is in an exported `init*` function that `main.ts` calls once, at the position where the behaviour must run. Registration order is behaviour: several handlers share `document` `keydown`, and the language pass snapshots the DOM text nodes that exist at that moment.
- State written from more than one module lives in a small exported state object owned by one module: `documentState`, `previewState`, `outlineState`, `scrollSyncState`, `minimapState`, `layoutState`, `graphUi`. Do not export a mutable `let`.
- `tests/module-structure.test.mjs` enforces: functions ≤ 100 lines, modules ≤ 600 lines, every `init*` called exactly once from `main.ts`, worker `new URL(…, import.meta.url)` paths resolve.
- Pure modules (no DOM, no Tauri) are compiled and tested by `npm test`. A new pure module imported by a test must be added to the file list of the `test` script, with `.js` suffixes in its relative imports.
- `tsconfig.json` enables `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`; `$` is generic (`$<HTMLInputElement>("id")`).

## 3. Editing and preview performance

The per-keystroke path never calls `doc.toString()`, tokenizes Markdown, counts words or compares whole documents.

1. **UI thread**: CodeMirror transactions, selection, layout, virtual preview window, dirty flag, scroll coordination.
2. **Markdown worker**: parses the current snapshot, builds source-mapped top-level block metadata, the outline and statistics, keeps parser tokens for the current revision, renders only requested block indexes. Export/print uses a separate worker so virtualization stays on during editing.
3. **Virtual preview**: mounts a visible range plus overscan; estimated heights keep a scrollable document, measured heights refine them; off-screen DOM is evicted and re-rendered from retained tokens without reparsing. Blocks removed from the window must not cache a height of 0 px (it makes the preview jump).
4. **Heavy blocks**: a very large block shows a placeholder; rendering it is explicit, with a confirmation above 1 MB. Mermaid renders only near the viewport.

Correctness rules:
- Stable source-block keys; parser-mode and reference-definition changes invalidate caches; heading keys include a context signature because anchor ids depend on other headings.
- Every worker request carries the document revision; stale results are discarded, one request is in flight, pending work is coalesced to the latest snapshot.
- Parsing stays a full-document pass (reference links, nested lists, fences and heading ids cross block boundaries); it is off the UI thread and only visible blocks render.
- Documents ≥ 2 million UTF-16 code units use a performance profile (no bare-URL autolinking or typography, no highlighting of code blocks > 8 KB). Above 1 MB the editor drops active-line highlighting only; fold gutter stays. Syntax modes other than Markdown are off from 750,000 code units.
- Do not advertise performance figures that were not measured on a real release build.

## 4. Section graph

`src/graph` holds a renderer-independent section model (`buildSectionNodes`: scan headings, fill section content, resolve wikilinks), spatial queries and the workspace controller; indexing runs in a worker with progress and cancellation. The UI offers three renderers over the same model: Tree (dedicated layout), Flat (one Canvas 2D surface) and Globe (SVG projection).

- No node or edge cap, sampling or truncation: the whole filtered model stays in memory; only drawing is limited to what is visible.
- **Flat canvas**: adaptive pixel ratio; pan/zoom transforms the last frame with CSS and repaints once the interaction settles; spatial hash for hit-testing and viewport queries (rebuilt only when positions change); segment grid for edges with an overflow list for very long edges; edge redraw deferred during drags; layout and drawing batched over animation frames with reused typed arrays.
- **Level of detail** (`src/graph/lod-policy.ts`, shared by Flat and Globe): from 200 visible vertices only a fraction (20% overview ratio) is drawn, growing with zoom to full detail at a threshold scaled by √(vertex count). Vertices are ordered by heading level first (H1 before H2, …), then by degree, then by a stable key, so the same vertices appear for the same zoom. Labels are independent from collision suppression: disabled labels stay hidden even on hover.
- Ambient motion is off by default and throttled (2D redraws at most every 50 ms; Globe has its own frame interval).
- Graph and Tree are two modes of one workspace: whole-module controls behave consistently in both; the Graph/Tree switch keeps exactly one option selected and synchronizes `.is-active` with `aria-pressed`. `body.graph-mode` hides the top-bar Save and Preview buttons (Save remains in the File menu and Ctrl+S).
- Considered and not adopted: Sigma.js/Graphology (WebGL, strongest candidate if Canvas becomes insufficient, needs a full compatibility pass), Cytoscape.js, d3-force, Three.js instancing, a force-layout worker. Benchmark on a representative workspace before any migration. `npm run benchmark:graph` measures indexing; `benchmarks/baseline-*.json` are reference results.

## 5. Files, encodings and viewers

- **File kinds** (`file-types.ts`): markdown (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`, `.rmd`, `.qmd`, `.mdc`), about 340 text extensions plus names such as `Dockerfile`, `Makefile`, dotfiles; unknown extensions are tried as text and binary content (NUL, control characters) is refused. Images, PDF, audio, video, TIFF and Word have their own handling.
- **Encodings** (`text-codec.ts`, `text-io.ts`): files are read as bytes and decoded in their own encoding (UTF-8 with/without BOM, UTF-16 LE/BE, Windows-1250/1251/1252, ISO-8859-2/15); invalid UTF-8 is guessed as Windows-1250 or ISO-8859-2. They are written back in the same encoding and line endings (CRLF/LF/CR; the editor works on LF). The status bar shows both and can reopen a file in another encoding.
- **Previews**: CSV/TSV as a table (2000 rows), `.mmd`/`.mermaid` as a diagram, JSON (`json`, `geojson`, `jsonld`) and XML family (`xml`, `xaml`, `axaml`, `xsd`, `xsl`, `rss`, `atom`, `opml`, `csproj`, `resx`, `plist`, …) as a lazily expanded tree with expand/collapse all (limits: 5000 items, depth 24, text 300 characters; an error keeps the last valid tree), `.canvas` as a Mermaid flowchart, PDF (pdf.js), TIFF (UTIF), audio/video in a TypeNova player with seek, volume, speed and shortcuts. `![](clip.mp4)`, audio and PDF embed in Markdown.
- **HTML pages** (`page-preview.ts`, `src-tauri/src/page_server.rs`): the saved page is shown in an `<iframe sandbox="">` (no scripts) loaded from the custom `tnpage` scheme, so relative CSS, images and fonts resolve inside the project folder. Scripts run only after the user enables them (`allow-scripts`, never `allow-same-origin`). The scheme serves only web file types, only inside the registered root, with a per-response CSP that forbids network access and frames. On Windows `canonicalize` yields a `\\?\` prefix that must be stripped before `starts_with` comparisons.
- **Format document** (Shift+Alt+F): JSON, JSON Lines, YAML (comments kept), XML, Markdown tables; TOML is validated.
- **Import**: Word `.docx` (mammoth) and HTML (turndown) become Markdown in a new tab. PDF, TIFF and Word code is loaded lazily.
- **Not supported**: HEIC/JPEG XL, RTF/ODT/Excel import, editable CSV grid, PlantUML/Graphviz drawing, reformatting JSONC/JSON5/HTML/CSS/JS.
- **Sample files**: `examples/file-types/samples.mjs` is the single source for sample files and `manifest.json`; `generate-samples.mjs` writes them (`--check` compares). They are stored byte-exact (`.gitattributes` `-text`), including CRLF and `server.log`.

## 6. Project tree and file operations

- Several project folders can be open at once; the tree refreshes when files change on disk (F5 for manual refresh) and accepts files dragged from the system file manager.
- Internal clipboard (Ctrl+C/X/V, context menu) stores a path and copy/move mode; files and folders copied in the system file manager are pasted via a Rust command (`clipboard_file_list`, `paste_clipboard_files`) with collision-safe names.
- Drag and drop moves into folders or the project root; moves into the source or its descendants are rejected, existing files are never overwritten (copy-suffixed names), folder copy is recursive and an incomplete destination is removed, a failed native rename falls back to copy-then-remove, and open-tab paths are updated.
- Images open from the tree with a hover thumbnail; paste of a clipboard image asks for a description, file name and folder inside the project.

## 7. Filesystem security

- Access is tied to what the user selected. The folder dialog requests recursive scope; `tauri-plugin-persisted-scope` restores grants after restart; a project path without a grant offers "Choose folder" instead of a misleading retry. Never grant whole drives and never widen `src-tauri/capabilities/default.json` for convenience (it enables only the fs commands the app needs, including `exists`, `rename`, `remove`).
- **Asset protocol** scope is `$HOME/**` and `$APPDATA/**`; `tests/tauri-config.test.mjs` fails if it is widened. Local images outside it are granted one file at a time by `allow_preview_image` (canonical path, existing regular file, image extension only, read-only, not persisted). Audio, video and PDF use the same per-file grant. A placeholder with a localized label is shown when an image cannot be loaded. Trade-off: a Markdown file the user opens can make the preview display any existing image file it names; the CSP still forbids network exfiltration.
- **CSP** (`tauri.conf.json`): `connect-src` is limited to IPC; `frame-src` allows only the `tnpage` scheme. Tauri adds a nonce to `style-src` in production builds, which makes browsers ignore `'unsafe-inline'` and blocks every inline style (CodeMirror stylesheets, KaTeX, tooltips); `dangerousDisableAssetCspModification: ["style-src"]` prevents this and a test guards it. This only shows in production windows, never in the dev server or a plain browser.
- **Browser features are off** (`harden_webview`, Windows/WebView2): devtools, browser accelerator keys, zoom, status bar, autofill. `initBrowserShortcutGuard` also blocks F12, F5, Ctrl+Shift+I/J/C/R, Ctrl+U/R/H/J, zoom keys and Ctrl+wheel on all platforms. Ctrl+P is swallowed and does not print; printing stays in the File menu.
- File content is data, never executed. User-content output is escaped or sanitized through the existing rendering conventions; Git commands run in Rust with validated arguments and read-only.

## 8. Session, windows and recovery

- Open file-backed tabs are persisted as paths only (`typenova.openSession.v1`, `localStorage`), gated by `startupSessionReady`; paths that cannot be read are skipped and reported, and a blank `Untitled.md` is the fallback. Startup order: restore tabs, initialize editor and preview, then offer recovery of unsaved work (the recovery record must not be cleared before that).
- Editor and preview scroll positions are remembered per document, also across restarts. Tabs can be dragged out into a new window or into another TypeNova window (Rust window commands and a drag ghost); the format of a document travels with the tab. The app quits when the last editor window closes.
- Hidden sections are stored in `<file>.md.config.json` next to the document and excluded from editor, preview, print and export.

## 9. UI, themes and accessibility

- Themes: light, midnight, newsprint, retro and contrast, defined as tokens in `foundation.css`; use `--ui-*` tokens, not fixed colours. Honour `prefers-reduced-motion`.
- Every stateful button or segmented switch needs a persistent selected state tied to `aria-pressed`/`aria-checked`/`aria-selected`; hover alone is not enough. Buttons use SVG icons only. Tooltips and accessible names are localized explicitly in Polish and English through `langText()` or `data-pl`/`data-en`. The full checklist is in `.claude/skills/typenova-ui-css/SKILL.md`.

## 10. Verification

| Check | Command |
|---|---|
| Types | `npm run typecheck` |
| Pure-module and structure tests | `npm test` |
| Frontend bundle | `npm run build` |
| Rust | `cargo test` in `src-tauri/` |
| Graph indexing benchmark | `npm run benchmark:graph` |

CI (`.github/workflows/build.yml`) runs the tests, the benchmark, the build and the Windows installer on every pull request. A headless browser with a mocked Tauri bridge is not the desktop application: behaviour that depends on WebView2, the asset protocol, custom URI schemes, CSP or native windows must be checked in a real debug build (a build with a separate `identifier` and `CARGO_TARGET_DIR` can run next to an installed copy; WebView2 accepts `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`).
