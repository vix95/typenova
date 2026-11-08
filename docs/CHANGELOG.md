# Changelog

Version notes for TypeNova, newest first (only the last few versions are listed here).

## 0.5.118 — tree preview for JSON, XML and XAML, video and audio player, page preview fix

- **Tree view for JSON and XML** (`.json`, `.geojson`, `.jsonld`, `.xml`, `.xaml`, `.axaml`, `.xsd`, `.xsl`, `.rss`, `.atom`, `.opml`, `.csproj` and similar, `.resx`, `.plist`): the structure as a tree with arrows to fold and unfold every branch (click the arrow or the row), "expand all" and "collapse all" buttons, coloured values and item counts. The first two levels are open at first; what you fold stays folded while you edit. Invalid text keeps the last good tree and shows the parser's message. XAML is shown as a tree, not as a rendered window.
- **Audio and video player** now has TypeNova's own controls (play/pause, position, time, mute, volume, icon close button) instead of the browser's.
- **Video** (`.mp4`, `.m4v`, `.webm`, `.ogv`, `.mov`, `.mkv`) opens in the same player: click the picture to play or pause, double click or the full-screen button (F) for full screen, playback speed button (0.5x to 2x), arrow keys to skip 5 seconds, M to mute. Whether a file plays depends on the codecs of the system's web view. New sample `media/clip.webm`.
- Player rules (clock, speeds, keys, skipping) live in the pure module `src/preview/media-format.ts`, covered by `tests/media-player.test.mjs` together with the new `clip.webm` sample.
- Sample `media/pixel.gif` was a single transparent pixel and looked empty; it is now `media/image.gif`, a visible 32x32 picture.
- **Canvas preview** (`.canvas`, JSON Canvas / Obsidian): the board is drawn as a Mermaid flowchart (text, file, link and group nodes, labelled edges). Positions are not kept.
- Very large files are cut (5000 items, 2000 table rows) with a note. Values are shown as code, so file content is never interpreted as Markdown or HTML.
- New pure module `src/preview/structured-preview.ts`, `tests/structured-preview.test.mjs` and sample files in `examples/file-types/` (including `data/users.json`).

## 0.5.117 — page preview for HTML files, sample files

- **HTML page preview**: `.html`, `.htm` and `.xhtml` files get a preview that shows the rendered page with the style sheets, images and fonts it links to (including `url()` and `@import` inside the CSS). The frame is sandboxed, so the page cannot reach the app or other files.
- **Page scripts** are off until the run button (play icon) in the preview is pressed; they then run in the same isolated frame. The preview shows the saved file: save (Ctrl+S) to refresh it, or use the refresh button.
- Pages are served by a new `tnpage` URL scheme (Rust, `page_server.rs`) instead of the asset protocol, so relative links (`css/style.css`, `../img/a.png`) resolve like in a browser. Links reach the open project folder (or the page's own folder), web file types only, never outside it; served pages may not load anything from the network (own CSP). The asset-protocol scope is unchanged; the app CSP only gained `frame-src` for this scheme.
- **Sample files**: `examples/file-types/` holds English sample files for every supported type (encodings, line endings, CSV, Mermaid, PDF, images, audio, Word, a small web page, binary files that must be refused). `tests/sample-files.test.mjs` checks them and they are meant for manual checks too.

## 0.5.116 — encodings, many more file types, viewers, import and file associations

- **Encodings and line endings**: text files keep their encoding (UTF-8 with/without BOM, UTF-16, Windows-1250, ISO-8859-2, Windows-1252, ISO-8859-15, Windows-1251) and CRLF/LF/CR when saved; the status bar shows both and lets you change them or reopen the file in another encoding.
- **More files open**: about 340 text extensions, Dockerfile / Makefile / dotfiles; unknown extensions are tried as text and binary content is refused. Syntax highlighting is mapped for formats CodeMirror lists under other names (jsonc, zsh, svelte, csproj, ...); `.rmd`, `.qmd`, `.mdc` are Markdown.
- **Previews**: CSV / TSV as a table, `.mmd` / `.mermaid` as a diagram (the Mermaid editor edits the whole file).
- **Format document** (`Shift+Alt+F`): JSON, JSON Lines, YAML, XML, Markdown tables; TOML is validated.
- **Viewers**: PDF, audio and video players, TIFF; embedded in Markdown with `![](file)`.
- **Import** of Word (`.docx`) and HTML as Markdown.
- **File associations** for Markdown and Mermaid files in the installers, and opening files passed on the command line.
- New dependencies: `yaml`, `smol-toml`, `pdfjs-dist`, `utif`, `mammoth`, `turndown`. Details, including what was not done: [`FILE-SUPPORT-0.5.116.md`](FILE-SUPPORT-0.5.116.md).

## 0.5.115 — Git history, paste from Explorer, Linux packages, find on demand

- Right-click an image in the preview or the image viewer to copy it; disabled context-menu entries look disabled.
- **Git history** (Tools > Git history…): branches, tags, commit graph, commit details and diffs, read only. Needs `git` on the PATH.
- **Paste files from Explorer** into the Project tree with Ctrl+V or right-click > Paste (Windows).
- **Find**: nothing is searched while typing; the query runs on Enter or the Search button, in chunks, so large documents stay responsive.
- PNG icons and `deb`, `rpm`, `appimage` targets, so one `tauri build` produces installers on Windows and Linux.

## 0.5.114 — formula and diagram editors, find panel, project tree

- **Math / LaTeX editor** (visual MathLive field, LaTeX source, KaTeX preview, symbol palette) and **Mermaid editor** (live pannable preview, templates, builder, click-to-edit for every diagram type, undo/redo).
- **Find and replace panel** redesigned.
- **Project tree**: images open in the viewer with a thumbnail on hover, Rename (F2), Show in file explorer, New folder; the paste-image dialog builds the file name from the description.
- **Outline**: hidden sections and "Show only this section".
