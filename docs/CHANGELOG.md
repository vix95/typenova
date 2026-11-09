# Changelog

All notable changes to TypeNova are recorded here, newest first. Every entry corresponds to a commit of this repository and links to it. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the ones in `package.json`.

## [0.5.121] - 2026-11-09

### Added

- Claude assistant, using your own Anthropic API key. The key (masked unless revealed, with a button that pastes it from the clipboard; Ctrl+V also falls back to reading the clipboard when the webview does not deliver the paste) and the model are set in a separate window, "Claude options", opened from Settings ("Claude assistant" section), from the chat pane or from the "Ask Claude" window. The model (Claude Opus 5.5 by default, also Sonnet 5.5, Haiku 5.5 and Fable 5.1) can also be changed directly in the chat pane and in the "Ask Claude" window. Requests go from the program straight to `api.anthropic.com` through the official SDK (`@anthropic-ai/sdk`) and are billed to your account.
- A chat pane at the right edge of the window (the "Claude" button in the top bar, which looks like Preview when active, `Ctrl+Shift+M`, or the command palette) with its own splitter. The open document and the selection are sent as context ("Send to Claude" buttons with check marks switch each off; the selection button shows the number of selected characters and follows the selection), answers stream in as they are written, can be stopped, and code in an answer has buttons to copy it, insert it at the caret or replace the selection.
- "Ask Claude" for the selection (`Ctrl+Shift+A`, the editor's context menu, the command palette): type an instruction or pick a ready-made one (fix mistakes, shorten, expand, simplify, translate), see the proposal as a line-by-line comparison and press Apply; one Undo reverts it. With nothing selected the result is inserted at the caret. Nothing in the document changes before you apply it.

### Security

- The Content Security Policy of the window now also allows connections to `https://api.anthropic.com`, and nothing else on the network. The API key is kept in the program's local data on this computer (not encrypted) and is sent only to that address; conversations are not stored.

## [0.5.120] - 2026-11-09

### Added

- Show white space: a button with a pilcrow icon in the formatting toolbar (before Mermaid; it moves into the three-dot menu when the toolbar is narrow) and a command palette entry show spaces as dots, tabs as arrows and a paragraph mark at the end of every line. The setting is remembered between sessions and applies to all open documents; the marks follow the theme colours and are stronger in the high-contrast theme.

## [0.5.119] - 2026-11-09

### Added

- Bookmarks: mark a place in a file and come back to it later. Click the column left of the line numbers or press `Ctrl+F2` to set or remove a bookmark on a line; `F2` and `Shift+F2` go to the next and previous bookmark, also across files. Bookmarks follow their text while the file is edited, find their line again by its text when the file changed while it was closed, and are kept between sessions.
- Bookmarks have an optional name and an optional note. A bookmark without a name is called "Bookmark #1", "Bookmark #2", and so on (numbers are never reused).
- A Bookmarks view in the left panel, next to the project tree, the table of contents and the graph, with search, go to, edit and delete. It is shown by the bookmark button in the row of project buttons (open folder, add, refresh, Git history) or by the "Bookmarks panel" command; a back button returns to the files.
- A Bookmarks menu with the commands, entries in the editor's context menu and the command palette, and the shortcuts in the keyboard shortcut help.
- Bookmarks file next to a Markdown document: the bookmarks of `notes.md` are also saved in `notes.md.bookmarks.json` in the same folder, in the same way the hidden sections of a document are kept in `notes.md.config.json`. The file holds the names, notes and places of the bookmarks but no folder path, so it can travel with the folder or be committed to a repository. It is read the first time a document is shown (what it says replaces the program's bookmarks of that document) and written whenever the bookmarks change; with no bookmarks left the file is removed. A file that is not a bookmarks file is never overwritten.
- Setting "Bookmarks file next to a Markdown document" in the program settings. It is on by default; when it is off, bookmarks stay only in the program and existing files are left unchanged.
- Renaming a file or folder in the project tree keeps its bookmarks, and renaming a Markdown file renames its bookmarks file along with it.

### Fixed

- The start-up fallback that gives buttons a tooltip from their label no longer replaces a tooltip that was set explicitly, so tooltips that are localized by their owner stay in the interface language.

## [0.5.118] - 2026-11-08

Pull request [#2]. Also contains the work that was tracked internally as 0.5.116 and 0.5.117.

### Added

- Collapsible tree preview for JSON (`.json`, `.geojson`, `.jsonld`) and XML (`.xml`, `.xaml`, `.axaml`, `.xsd`, `.xsl`, `.rss`, `.atom`, `.opml`, `.csproj`, `.resx`, `.plist` and similar), with expand/collapse all, item counts and coloured values. Invalid text keeps the last valid tree and shows the parser message. Trees are capped at 5,000 items. [2e3f1ed]
- `.canvas` (JSON Canvas) boards are rendered as Mermaid flowcharts. [2e3f1ed]
- HTML page preview (`.html`, `.htm`, `.xhtml`) in a sandboxed frame with the page's CSS, images and fonts. Page scripts stay off until enabled with the run button. Pages are served through the new `tnpage` URL scheme (`src-tauri/src/page_server.rs`), so relative links resolve inside the project folder only, for web file types only, and pages cannot reach the network. [2e3f1ed]
- Audio and video player with TypeNova controls: play/pause, seek, volume, playback speed (0.5x–2x), full screen, and keyboard shortcuts (Space, ←/→ skip 5 s, M, F). [2e3f1ed]
- Text encodings and line endings are preserved on save (UTF-8 with or without BOM, UTF-16, Windows-1250/1251/1252, ISO-8859-2/15; CRLF, LF, CR). The status bar shows both and can reopen a file in another encoding. [2e3f1ed]
- About 340 text extensions plus Dockerfile, Makefile and dotfiles open as text; unknown extensions are tried as text and binary content is refused. Syntax highlighting is mapped for formats CodeMirror lists under other names. [2e3f1ed]
- CSV/TSV files are previewed as tables and `.mmd`/`.mermaid` files as diagrams. [2e3f1ed]
- Format document (`Shift+Alt+F`) for JSON, JSON Lines, YAML, XML and Markdown tables; TOML is validated. [2e3f1ed]
- PDF and TIFF viewers, and `![](file)` embedding of audio, video and PDF in Markdown. [2e3f1ed]
- Import of Word (`.docx`) and HTML files as Markdown. [2e3f1ed]
- File associations for Markdown and Mermaid files in the installers; files passed on the command line are opened. [2e3f1ed]
- `examples/file-types/`: reproducible sample files for every supported type with a manifest, generator and tests. [2e3f1ed]
- Dependencies: `yaml`, `smol-toml`, `pdfjs-dist`, `utif`, `mammoth`, `turndown`. [2e3f1ed]

### Changed

- Regression tests for the pure modules `structured-preview`, `media-format`, `file-types`, `text-codec` and `format-document`, and Rust tests for `page_server`. [2e3f1ed]
- The application CSP gained `frame-src` for the `tnpage` scheme; the asset-protocol scope is unchanged. [2e3f1ed]

### Fixed

- The invisible 1×1 sample GIF was replaced with a visible image. [2e3f1ed]
- CI: `examples/file-types/text/server.log` was excluded by `*.log` in `.gitignore`, so the sample tests failed with `ENOENT`; `.gitattributes` now keeps sample files byte-exact. [a6bd190]
- CI: four samples had their CRLF line endings converted to LF by `core.autocrlf`; they are stored as generated. [48602e5]

## [0.5.115] - 2026-11-06

Pull request [#1] (Linux support).

### Added

- Read-only Git history dialog: branches, tags, commit list with graph, commit details and per-file diff, backed by Rust commands that call `git` with validated arguments. [bc6990f]
- Paste files and folders copied in the system file manager into the project tree with Ctrl+V or the context menu; the clipboard is read in Rust and items are copied with collision-safe names. New dependency `clipboard-win`. [bc6990f]
- "Copy image" in the right-click menu of preview images and of the image viewer (Mermaid diagrams copy as SVG code); the image goes to the clipboard as PNG. [c5b82b3]
- Linux packages: PNG icons and `deb`, `rpm` and `appimage` bundle targets next to the Windows installers. [d90a50c]
- `install-and-run.sh`: checks requirements, builds and launches the app on Linux. [e0c14a1]

### Changed

- The find panel no longer highlights or jumps on a single typed character; it jumps to the first match after a short pause from two characters, with softer match colours. [bc6990f]
- The image viewer uses its own context menu; "Copy selection" over an image appears only when text is selected. [c5b82b3]

### Fixed

- Disabled context-menu items look disabled and are no longer highlighted on hover. [c5b82b3]
- CI: restored the missing graph indexing benchmark. [2e5a6bf]

## [0.5.114] - 2026-11-02

### Added

- Math/LaTeX editor: visual formula field, LaTeX source, live preview, symbol palette with matrices, accents and decorations. Dependency `mathlive`. [dc24352]
- Mermaid editor: live pannable preview, templates, flowchart builder, click-to-edit for every diagram type, undo/redo. [dc24352]
- Compact find and replace panel with match counter, case/word/regex toggles and a collapsible replace row. [dc24352]
- Image lightbox in the preview; local images are granted read access on demand instead of asking for a folder. [e7afd44]
- Media viewer for images and Mermaid diagrams with zoom, pan, fit-and-center and full screen. [285d485]
- Editor and preview scroll position is remembered per document, also across restarts. [285d485]
- Project tree with several folders (the plus button adds a folder), working with graph, filters and file operations. [149062f]
- Editor tabs: mouse-wheel scrolling, drag-and-drop reordering, and dragging a tab out of the strip to a new window or to another TypeNova window. New Rust command layer for document windows. [149062f]
- The project tree refreshes itself when files change on disk and has "Refresh" (F5); files dragged from the file explorer open in tabs and folders join the tree. [bf5d5cd]
- Hidden sections: hide a section from the editor, preview, print and export through the outline menu, stored in `<file>.md.config.json` next to the document. [26fd326]
- Ctrl+V with an image on the clipboard opens a dialog (description, file name, folder inside the project) and inserts the Markdown reference. [26fd326]
- Images open from the project tree with a hover thumbnail; Rename (F2), "Show in file explorer", "New folder" and "Show only this section" menu items. [40c6aa9]

### Changed

- Browser features are turned off: devtools (F12), accelerator keys, zoom, status bar and autofill; Ctrl+P no longer prints. [26fd326]
- The app quits when the last editor window closes, so the hidden drag-ghost window cannot keep an invisible instance alive. [bf5d5cd]
- The About dialog reads the version from `package.json`. [049d8d4]
- File names for pasted images are built from the description, with a confirmation before replacing an existing file. [40c6aa9]
- New dialogs use the themed dropdown. [dc24352]

### Fixed

- Tauri's CSP nonce is disabled for `style-src` so production builds render correctly; tests guard the CSP and asset-protocol settings. [e7afd44]
- The preview no longer jumps while scrolling the editor: blocks removed from the virtual window stop caching a height of 0 px. [285d485]
- Tooltips show above modal dialogs. [285d485]
- The tab context menu closes on an outside click, Escape, blur or resize. [bf5d5cd]
- Image path completion filters by prefix after every typed character. [149062f]

## [0.5.113] - 2026-10-22

Initial commit of the application. [303d2af]

### Added

- Local-first desktop Markdown workspace built with TypeScript, Vite, Tauri 2 and CodeMirror 6.
- Editor with tabs, outline and document recovery.
- Worker-based preview with KaTeX math, Mermaid diagrams and Jupyter notebooks.
- Project explorer and section graph (Flat, Tree and Globe views).
- Polish and English interface with themes.
- Windows installers (NSIS and MSI).
- Regression tests for pure modules, a section graph benchmark and a GitHub Actions build workflow.

[#1]: https://github.com/vix95/typenova/pull/1
[#2]: https://github.com/vix95/typenova/pull/2
[2e3f1ed]: https://github.com/vix95/typenova/commit/2e3f1ed
[a6bd190]: https://github.com/vix95/typenova/commit/a6bd190
[48602e5]: https://github.com/vix95/typenova/commit/48602e5
[bc6990f]: https://github.com/vix95/typenova/commit/bc6990f
[c5b82b3]: https://github.com/vix95/typenova/commit/c5b82b3
[d90a50c]: https://github.com/vix95/typenova/commit/d90a50c
[e0c14a1]: https://github.com/vix95/typenova/commit/e0c14a1
[2e5a6bf]: https://github.com/vix95/typenova/commit/2e5a6bf
[dc24352]: https://github.com/vix95/typenova/commit/dc24352
[e7afd44]: https://github.com/vix95/typenova/commit/e7afd44
[285d485]: https://github.com/vix95/typenova/commit/285d485
[149062f]: https://github.com/vix95/typenova/commit/149062f
[bf5d5cd]: https://github.com/vix95/typenova/commit/bf5d5cd
[26fd326]: https://github.com/vix95/typenova/commit/26fd326
[049d8d4]: https://github.com/vix95/typenova/commit/049d8d4
[40c6aa9]: https://github.com/vix95/typenova/commit/40c6aa9
[303d2af]: https://github.com/vix95/typenova/commit/303d2af
