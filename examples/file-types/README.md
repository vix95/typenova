# File type samples

A small set of files in English for checking that TypeNova handles every file type it claims to support. Tests and developers use the same files.

- `samples.mjs` is the single source: each sample's content and what TypeNova is expected to do with it.
- `generate-samples.mjs` writes the files and `manifest.json` (`node examples/file-types/generate-samples.mjs`; add `--check` to compare without writing). Binary samples (PNG, TIFF, BMP, GIF, WAV, PDF, DOCX, ZIP) are built from code with fixed dates, so the output is byte-for-byte reproducible.
- `tests/sample-files.test.mjs` fails when a file on disk differs from `samples.mjs`, and checks the file kind, encoding, byte order mark, line endings, highlighting language, formatter, table/diagram preview source and Word/HTML import against the manifest.

After changing `samples.mjs`, run the generator and commit the generated files together with it.

## Folders

| Folder | What it checks |
| --- | --- |
| `markdown/` | Every Markdown extension (`.md .markdown .mdx .rmd .qmd .mdc`), math, diagrams, table formatting |
| `text/`, `code/`, `config/` | Plain text, logs, source code and configuration files: highlighting and the "unknown extension opens as text" rule |
| `data/` | CSV/TSV table preview, JSON/JSONL/YAML/TOML formatting (valid and broken files) |
| `diagrams/` | Mermaid files (`.mmd`): whole-file diagram preview and editing |
| `encodings/` | UTF-8 with and without BOM, UTF-16, Windows-1250/1252, ISO-8859-2, and LF/CRLF/CR/mixed line endings: they must open and save byte-for-byte |
| `media/` | Images, PDF, audio: viewers and Markdown embeds |
| `documents/` | Word and HTML files imported as Markdown |
| `pages/` | A small web page (HTML + CSS + JS + image) for the page preview; `about.html` checks following a link |
| `unsupported/` | Binary files that must be refused instead of opened as garbage, including a binary file with a `.txt` name |

## Checking by hand

Open the folder in TypeNova and walk through it. Each file's expectations are in `manifest.json`. For `pages/index.html` the preview must show the heading in red, a green "The script has run." line and the logo.
