# File support: encodings, many more formats, viewers, import and file associations (0.5.116)

Plan and result of the file-support work that followed the research of what a complete, useful Markdown/text tool should open.

## What was done

| Area | Result |
| --- | --- |
| Encoding | Files are read as bytes and decoded in their own encoding (`src/filesystem/text-codec.ts`, `text-io.ts`): UTF-8 (with or without BOM), UTF-16 LE/BE, Windows-1250, ISO-8859-2, Windows-1252, ISO-8859-15, Windows-1251. A file that is not valid UTF-8 is guessed as Windows-1250 or ISO-8859-2 (Polish letters decide). They are written back in the same encoding; when characters would be lost the user is asked to save as UTF-8. |
| Line endings | CRLF / LF / CR are detected and kept when saving (the editor works with LF). |
| Status bar | Two buttons show the encoding and the line endings of the active document. Their menus change how the file is saved, add or remove the UTF-8 BOM, or reopen the file in another encoding. The format travels with a tab torn off into another window. |
| Which files open | `src/filesystem/file-types.ts` classifies names (markdown, text, image, pdf, audio, video, docx, binary, unknown). About 340 text extensions (all that CodeMirror can highlight plus additions), file names such as Dockerfile / Makefile / `.gitignore` / `.env.*`, and **unknown extensions are tried as text**; binary content (NUL bytes, control characters) is turned away with a message. Known binary formats stay greyed in the Project tree. |
| Syntax highlighting | `src/filesystem/language-map.ts`: JSON-like formats (jsonc, json5, jsonl, canvas, excalidraw, ipynb, ...), shell variants, Python stubs, web templates, XML-based formats (csproj, xaml, plist, xsd, drawio, ...), ini-like config, BibTeX, CMake, Haskell and the rest of CodeMirror's languages; `diff` / `patch` are highlighted; plain text stays plain. |
| Markdown family | `.rmd`, `.qmd`, `.mdc` (with `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`) are Markdown: preview, outline, graph. |
| Previews | CSV / TSV are shown as a table (delimiter detected, quoted cells, 2000 rows); `.mmd` / `.mermaid` files are drawn as a diagram, and the Mermaid editor works on the whole file. |
| Format document | Tools > Format document (Shift+Alt+F, command palette): JSON (and canvas, ipynb, ...), JSON Lines, YAML (comments kept), XML (re-indented, tags checked), Markdown tables (aligned); TOML is validated. Errors put the caret at the line and column. |
| Viewers | PDF (pdf.js; pages drawn as they scroll into view, zoom, fit to width, page counter), audio and video (player dialog), TIFF (decoded to PNG with UTIF). `![](clip.mp4)`, `![](song.mp3)` and `![](paper.pdf)` in Markdown become a player or an "open PDF" button; TIFF images work in the preview too. The Rust grant for local files covers PDF, audio and video as well as pictures. |
| Import | Word `.docx` (mammoth) and HTML (turndown) become Markdown in a new tab: click the file in the Project tree, drop it, or Tools > Import Word/HTML document. Pictures in Word files are skipped (the toast says how many). |
| File associations | The installers register Markdown (`md`, `markdown`, `mdown`, `mkd`, `mdx`, `rmd`, `qmd`, `mdc`) and Mermaid (`mmd`, `mermaid`) files. A file passed on the command line, or handed over by a second launch of the app, opens in a tab (`take_launch_paths`, event `open-paths`; Rust grants the file to the file-system scope). |

New dependencies: `yaml`, `smol-toml`, `pdfjs-dist` (4.10), `utif`, `mammoth`, `turndown` (+ `@types/turndown`); the PDF, TIFF and Word code is loaded only when such a file is opened.

## Not done (and why)
- HEIC and JPEG XL pictures: a decoder (libheif / libjxl as WebAssembly) is about 1.5 MB; they stay greyed out.
- RTF, ODT and Excel (`xlsx`) import: no small, reliable converter; `.docx` and HTML are covered.
- An editable grid for CSV: the table is a preview only.
- PlantUML and Graphviz (`.puml`, `.dot`): they open as text; drawing needs Java or a large WebAssembly build.
- Reformatting JSONC / JSON5 (comments would be lost) and HTML/CSS/JavaScript (needs a formatter such as Prettier).

## Verification
`tsc --noEmit`, `npm test` (codec, file kinds and highlighting, formatters, CSV/Mermaid preview source), `cargo test --lib` (13 tests, including the media grant and the launch-path filter), and a headless-Edge run against a mocked Tauri bridge: a Windows-1250 / CRLF file opened and saved byte-exact, CSV table, Mermaid file, JSON formatting, unknown extension opened, binary file refused, PDF page drawn on a canvas, TIFF decoded, player dialog, Word file converted, status-bar menus, file opened by a launch argument. Not run in the real app: opening a file by double click (the Windows shell), real audio/video playback, and the PDF viewer inside WebView2/WebKitGTK.
