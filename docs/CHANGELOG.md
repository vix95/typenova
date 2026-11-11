# Changelog

All notable changes to TypeNova are recorded here, newest first. Every entry corresponds to a commit of this repository and links to it. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the ones in `package.json`.

## [0.5.130]   2026 11-11

### Added

- Data view for CSV, TSV and TXT files. "Data view…" in the file tree's menu (and the command palette) opens a read only dialog with three tabs: Data (the first 500 rows), Summary (rows, columns, missing values and, for each column, its type, statistics and distribution: histogram, top values or date range) and Charts (bar, line, histogram and scatter charts of the whole file, with the columns, aggregate and number of bars chosen on the spot). The file is read in pieces by a worker, so files of hundreds of megabytes work and the window stays responsive; encoding, header and delimiter are detected. CSV and text files from 50 MB open in the data view instead of the editor, which offers an "Editor" button for those who still want the text.
- Charts in Markdown notes. A ```chart block (`file: data/orders.csv`, `type: bar`, `x: country`, `y: amount`, `agg: sum`, optional `top`, `bins`, `by`, `title`) is drawn in the preview from the data file, which is named relative to the note and must lie in the project folder. "Insert into note" in the data view writes the block at the cursor.
- The Preview pane of CSV, TSV and TXT files has two tabs: Data (the rows as a table) and Charts (a chart for every column by its type, with its figures). Plain text without a delimiter shows its lines.
- Chart wizard in the data view: choose what to see, complete a sentence about it ("Show the total of amount for each country"), then insert the chart into the note; the chart is drawn live. Also in the command palette: "Insert a chart from a data file into the note…".
- Demo data in the demo vault: `data/orders.csv` (8,000 orders, semicolons and decimal commas), `data/model-runs.csv` (400 training runs) and `data/sensor-readings.txt` (pipe-delimited text), written by `examples/generate-demo-data.mjs`, and the note `08-Data-Analysis.md` with seven chart blocks over them.
- Capabilities `fs:allow-open` and `fs:allow-read` (reading a file in pieces); the path scope is unchanged.

## [0.5.129] - 2026-11-11

### Added

- Integrated terminal. Ctrl+` (or the terminal button in the status bar, View > Toggle terminal, the command palette) opens a panel under the editor with real shells running in a pseudo terminal (ConPTY on Windows): Windows PowerShell, PowerShell 7, Command Prompt, Git Bash, WSL, bash, zsh, fish, Nushell and any other found on the computer, plus shells you add yourself in Settings. You can have up to 24 terminals at once, each in its own tab; double-click a tab or press F2 to give it a name, right-click it for Properties (shell, project folder, subfolder, startup command), Duplicate, Restart, Stop the process, Close, Close the others and Close all (one question when some of them are in use). A terminal whose shell ended shows its exit code and starts again on Enter. Copy and paste work as in any terminal (Ctrl+C copies a selection, Ctrl+V pastes), the panel can be dragged to any height or enlarged, and the colours follow the theme of the program.
- Terminals can be split like a split editor: the Split button opens a new terminal beside the one in focus, and its menu has Split right (Ctrl+Shift+5), Split down (Ctrl+Shift+6) and Show only the active terminal. The focused terminal is the one that is split, so a split right followed by a split down gives one terminal on the left and two stacked on the right, and so on (up to four on screen). "Show beside" and "Show below" in a tab's menu put an existing terminal there. Every pane has a small bar with its name and status and a button that takes it off the screen without closing it; the splitters between panes are dragged (or moved with the arrow keys) and each shell gets the size of its own pane. The panel can also take the whole window: the full screen button or F11 (Escape leaves it from the tabs, Ctrl+` returns to the normal size).
- The terminals of a project are saved in the project: names, shells, folders and startup commands go to `typenova.config.json` in the project folder (each open folder keeps its own) and come back when the project is opened (their shells start when they are first shown). A config file never names a program, only a shell of this computer by id, and a startup command from a project runs only after you allow it: the program asks once for the commands it does not know and asks again when one changes. Saving can be turned off in Settings.

## [0.5.128] - 2026-11-10

### Changed

- The More (⋯) menu of the formatting toolbar no longer has the "Command palette" item (the palette stays on the search bar and Ctrl+K / Ctrl+Shift+P), and every action in it has an icon: Snippet, Image snippet, Focus, Find, and the ones that move there when the toolbar is narrow (Mermaid, White space, Highlight selection, formatting). The Mermaid toolbar button is an icon like the others.
- Highlights are part of the editor's undo history: marking a passage, removing a highlight and changing its colour, note or group can be taken back with Ctrl+Z and brought again with Ctrl+Y, each as a step of its own (apart from typing). Changes made from the Highlights panel to a highlight of another file are not in the open document's history.

### Fixed

- `[[Section name]]` links were only drawn as edges in the graph; in the preview they stayed plain text and in the editor nothing happened. In the preview they are now links that open the section they lead to; in the editor they are underlined and Ctrl+click (Cmd+click on macOS) follows them. A link with no matching section says so. Links resolve like the graph does (by title, by `file#Section`, preferring the current file); `![[image]]` embeds and links in code are left alone.
- Renaming a heading updates the links the moment the edit settles (the caret leaves the heading, or two seconds pass without typing): the links in the document at once, those in other files through the link index (below). A file that changed on disk in the meantime is read again before it is touched. Following a link to a section of the document it is written in does not look at the project at all.
- In the editor a `[[link]]` shows a tooltip ("Ctrl+click to go to the section", in Polish and English; Cmd on macOS), and while Ctrl (Cmd) is held the pointer over a link turns into a hand.
- Renaming a heading no longer misses the update when the title is erased completely before the new one is typed, or when typing pauses halfway: renames are processed one after another (and merged when the same heading is edited again), so the links end up pointing at the final title.
- Every `[[link]]` can now name its file and its header, `[[06-Monitoring.md#Drift Detection]]`. Typing `[[` offers the project's files, and after the file the sections of that file. In the preview such a link shows only the section's name, and the file is named in the tooltip. A link that names its file opens by reading that one file; one that names only a title is looked up in the index.
- The project has a link index (the files, their sections and what their links name). It is read in the background when a Markdown document is shown, kept on disk between sessions (only files that changed are read again), refreshed on each save, and checked against the disk again when it is older than half a minute. Following a link and renaming a heading use it, so only the files concerned are read, however large the project is. The index is stored in the application data folder, never in the project.
- Renaming a heading rewrites the links to it in the full form, `[[File.md#New title]]`, also those written as `[[Old title]]` (their alias stays). The command "Links: write [[Title]] as [[file#Title]] across the project" does the same for every link that names only a title (a title that several files share is left, and counted); it can be undone.
- When no link is found after a rename, or no section after a click, the message says how many files were searched and the first read error, if any. The demo vault is written with the new links.

## [0.5.127] - 2026-11-10

### Added

- Renaming a heading now updates the `[[Section name]]` links that point at it, automatically: in the open documents (as editor edits) and in the other Markdown files of the project (on disk). A toast reports how many links changed and offers Undo. Links that could mean another section with the same title, links inside code, and titles containing `[ ] | #` are left unchanged (the last two cases are reported). The behaviour can be turned off in Settings ("Update links when a heading is renamed").

## [0.5.126] - 2026-11-10

### Fixed

- In a narrow sidebar the Graph tab was centred in a row of its own while Files and Table of contents were left-aligned. All three tabs now sit in their own rows, left-aligned and the same width.
- After the editor groups were merged back into one, the editor kept the width it had as part of a split and filled only half of the editor area (the rest stayed empty). The remaining group now fills the whole area.

### Changed

- The README describes the editor groups, the Mermaid and formula editors, bookmarks, highlights and the AI assistant (providers, encrypted keys, the list of what is sent), and its screenshots were retaken on the demo vault, including the new ones. A two-minute demo video (`docs/media/typenova-demo.mp4`) and a short animated tour (`typenova-demo.gif`) show the features at work.

## [0.5.125] - 2026-11-10

### Added

- Editor groups: the editor area can be split into up to four groups, side by side or stacked, and each group has its own tab strip and its own editor. The split button at the end of the tab strip, **View → Split the editor right**, the command palette and `Ctrl+\` split off the next tab (or a new empty document) to the right and merge the groups again; a tab's context menu has **Open to the right**, **Open below** and **Merge the groups into one**, and a group's `+` opens a new document in that group.
- Dragging a tab: onto another group's strip it takes a place there; onto the middle of a group's editor it joins that group; onto the left, right, top or bottom edge of a group's editor it opens a new group on that side (a zone shows where it would land). The dividers between groups are dragged, or moved with the arrow keys, and each group's strip has an accent line while it is the one in use. Groups and their sizes are restored with the open documents when the program starts again.
- The group in use is the active document: typing, saving, search, the outline, the breadcrumbs, the statistics and the preview all follow it. A document belongs to exactly one group, so there is one editor state per document: opening a tab that is in another group moves to that group instead of loading it twice. Closing the last tab of a group removes the group.

### Changed

- Theme, wrapping, line numbers and white space are applied to every group. The minimap is shown only while there is a single group, and the Ctrl+hover image preview works over the group in use.
- Dragging a tab out of the strip still opens it in a window of its own (or moves it to another TypeNova window) when it is released above or below the strip over the sidebar, the preview or the toolbar, or outside the window; over the editor groups it is dropped on a strip or a group instead.

## [0.5.124] - 2026-11-09

### Added

- The assistant works with more than one provider: Claude (Anthropic), OpenAI (GPT), Gemini (Google), Ollama (a model on your computer or in your network) and a "Custom API" for any service that speaks the OpenAI protocol (LM Studio, OpenRouter, a company gateway…). In "AI assistant options" you choose the provider on a card; exactly one is on, and only its settings are shown. Each card says what is still missing ("No key", "No address", "Choose a model") or "Ready". A provider has only the fields it needs: a key, an address, a model. The models of OpenAI, Gemini, Ollama and a custom service are asked for from the service itself, and a sensible one (for example `gpt-5`, `gemini-2.5-pro`) is chosen when you have not chosen yet.
- "Check the connection" for every provider. It saves the key you typed, asks the service for its models and says in plain words whether it works or what is wrong (a rejected key, no credit left, the address cannot be reached, a missing path such as `/v1`), and whether the model you chose is on the list. The chat and the "Ask" window use the same words for their errors.
- The chat lists what it sends along with a message: the open document with its full path and a button that opens it, and the selection with the section it lies in, its lines and a button that goes to it. The list is above the message field and is kept under every message sent, so it stays clear which document and passage an answer is about.

### Changed

- The assistant is named neutrally: the top-bar button, the pane title, the command palette and the context menu say "AI Chat" / "Ask AI" instead of a provider's name. Which provider is on still shows in the chat texts and the model chooser.
- Each provider's API key is encrypted (AES-256-GCM) in the program's data folder, the same way on Windows and Linux, and the interface never receives it again: after you confirm with "Done" the key cannot be viewed, only its last characters are shown (with buttons to enter a new key or remove it). Keys are saved when the window is confirmed or closed, or when you press "Check the connection", not while they are typed. A Claude key kept in plain text by an earlier version is encrypted and removed from the settings the first time the program starts. If the files are copied to another computer or user a key cannot be read there and is asked for again.
- The requests are made by the backend, which reads the key itself, instead of the webview, with one adapter per protocol (`src-tauri/src/ai/`). Claude and Gemini are always contacted at their own address, so their keys cannot be sent elsewhere; only OpenAI-compatible services and Ollama take an address from you. The Anthropic SDK dependency and the `connect-src` exception for `api.anthropic.com` in the Content Security Policy are gone.
- The model, the address and the key are kept separately for each provider, so switching provider does not lose the others' settings.

### Fixed

- The dividing line next to the chat pane was not drawn. Its splitter now looks like the other splitters of the window.

## [0.5.123] - 2026-11-09

### Added

- Spell checking for Polish and English. Misspelled words are underlined with a wavy line in Markdown and text documents (not in code files); code, fenced code blocks, inline code, addresses, e-mails, link targets, HTML, formulas, front matter, acronyms in capitals and names like `iPhone` or `TypeNova` are not checked. The word being typed is left alone until the typing pauses.
- Right-clicking a misspelled word shows suggestions (a click replaces the word), "Add to the dictionary" and "Ignore"; `Ctrl+.` opens the same menu for the word at the caret, and `F8` / `Shift+F8` go to the next and previous mistake. The command palette has the same commands and "Spelling: personal dictionary".
- Settings: "Spell checking" (on by default), the languages (Polish and English, Polish, or English; a word is right if it is right in any chosen language) and a personal dictionary window to add and remove words. The personal dictionary is stored only on this computer.
- The dictionaries are the Hunspell dictionaries `pl` and `en_US`, built into the program and read by a spell checker in the backend (`spellbook`, Rust), so nothing is sent anywhere. They keep their own licenses (`src-tauri/dictionaries/README.md`; the Polish one is used under the Mozilla Public License). The program grows by about 5 MB.

## [0.5.122] - 2026-11-09

### Added

- Highlights: mark a passage of a document as important. Select text and press `Ctrl+Shift+H`, use the marker button in the formatting toolbar, the editor's context menu or the Highlights menu. The passage is drawn on a yellowish background in the editor and in the preview (the preview finds it again inside the rendered text, also when it contains Markdown formatting); the high-contrast theme underlines it as well. Highlights follow their text while the document is edited, find it again when the file changed while it was closed, and are kept between sessions.
- A colour (yellow, green, blue, pink, orange), an optional group and an optional note for each highlight, set in the highlight window (the Highlights menu, the context menu or the edit button of the list). A tooltip over a highlight shows its group and note. A highlight that has a note gets a small note icon after it, in the editor and in the preview; the tooltip is then on the icon (the marked text shows none), and a click on the icon opens the highlight window. The window offers the groups already in use as buttons: the eight most used, "+N more" shows all of them in a scrolling area, and typing in the field filters them.
- A Highlights view in the left panel (the marker button in the row of project buttons, the Highlights menu or the command palette): search, a switch between sections per file and per group, go to, edit and delete, and "Copy all as Markdown" (headings per file or group, passages as quotations with their notes). `F4` and `Shift+F4` go to the next and previous highlight, also across files.
- Highlights are saved in the program and in the config file next to a Markdown document, like bookmarks. Renaming a file or folder in the project tree keeps them.

### Changed

- One config file per document: `notes.md.config.json` now holds the hidden sections, the bookmarks and the highlights together. Bookmarks that earlier versions kept in `notes.md.bookmarks.json` are moved into it the first time the document is shown, and the old file is removed. Each part is saved without touching the others, and a file that is not a config file is never overwritten.
- The setting "Config file next to a Markdown document" (before: "Bookmarks file next to a Markdown document") turns the config file off for bookmarks and highlights; hidden sections are always saved in it, because they have no other place.

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
