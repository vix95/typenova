# TypeNova — mandatory coding-agent instructions

**This file is the canonical repository guide. Read it completely before inspecting or modifying code.** If your coding environment has a platform-specific entry point (`CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/typenova.mdc`, or a TypeNova skill), follow that entry point too; it points back here. For every UI/HTML/CSS, theme, interaction, or accessibility task, also read and obey [`typenova-ui-css`](.claude/skills/typenova-ui-css/SKILL.md).

## Non-negotiable workflow

1. Inspect the relevant implementation and read the related documentation in `docs/` before changing behavior. Check `README.md` and `docs/ARCHITECTURE.md` (the single technical reference) when the change spans multiple areas.
2. Preserve existing architecture and behavior outside the requested scope. Prefer small, localized changes over rewrites or new dependencies. Do not silently remove features, docs, icons, scripts, or project files.
3. If expected behavior, product requirements, or a safety-sensitive detail remains materially ambiguous after reviewing the code and docs, ask the user instead of inventing a rule.
4. Hand work back as changes in the working tree and say which files changed. Build a ZIP or installers only when the user asks; such a package contains the whole project (hidden agent files included) without `.git/`, and is verified before it is linked.
5. State which checks actually ran. Never describe a build, runtime workflow, or UI behavior as tested if it was not. If dependency installation, a platform limitation, or a timeout blocks verification, report that precisely.
6. Keep delivery notes factual and concise.


## Version control

- The repository uses Git and is hosted on GitHub. Work happens on feature branches that are merged through pull requests.
- **Never commit, stage, branch, tag, push or open a pull request unless the user asks.** Do not create automatic-commit scripts or hooks. When a commit is wanted, propose a message (imperative subject, short body) and let the user commit.
- Do not rewrite shared history (force-push, rebase of published branches) and do not bypass hooks.

## Tooltip localization audit (mandatory)

- Every added or modified tooltip must be explicitly localized for Polish and English. Set `data-tooltip`, `aria-label`, and any accessible name through a language-aware helper such as `langText`; do not rely on tooltip text inferred from a button's current `textContent`, `title`, or a stale `aria-label`.
- When changing a control, audit its visible label, custom tooltip, native `title`, `aria-label`, and focus-triggered tooltip in both languages. Remove redundant native titles when the application tooltip system is used.
- Include a static audit of tooltip literals and both language states in the handoff checklist and feature documentation. Never claim the audit passed unless the relevant source has been checked.

## UI / CSS interaction rules (mandatory)

- For every stateful button, toggle, or segmented switch, implement a persistent visual selected/pressed state tied to the same source of truth as its ARIA state. `:hover` and transient `:active` alone are never sufficient.
- Keep visual classes and `aria-pressed`, `aria-checked`, or `aria-selected` synchronized on initial render and every state transition. A mutually exclusive view switch must visibly identify exactly one selected option, including after the pointer leaves.
- Use the existing theme tokens and provide a visible `:focus-visible` style. Audit light/dark themes and high-contrast mode; do not rely on a subtle color tint alone to communicate selection.
- Scope styles and hide/show behavior to the owning component or module. Inspect the full cascade, including late overrides, before adding CSS. Preserve keyboard access and alternate access paths to actions when hiding a toolbar control.
- Buttons always use SVG icons (`ICONS` in `src/ui/icons.ts` for buttons built in TypeScript, inline `<svg aria-hidden="true">` in `index.html`), never text characters or emoji as icons. Give each icon button a localized tooltip and accessible name.
- The full hard-rule checklist is [`.claude/skills/typenova-ui-css/SKILL.md`](.claude/skills/typenova-ui-css/SKILL.md); read it before any UI/CSS change and use its verification checklist before handoff.

## Repository map

- `src/main.ts` — thin composition root (keep it thin): imports the feature modules and runs the boot sequence. **Do not add feature logic here.** The registration order of top-level side effects is behaviour; see section 2 of `docs/ARCHITECTURE.md`.
- `src/app`, `src/ui`, `src/i18n`, `src/editor`, `src/documents`, `src/preview`, `src/outline`, `src/layout`, `src/project`, `src/graph-ui` — feature modules of the UI. Search for existing helpers and state objects (`documentState`, `previewState`, `outlineState`, `scrollSyncState`, `minimapState`, `layoutState`, `graphUi`) before adding new paths. Side effects belong in an exported `init*` function that `main.ts` calls at the right position; `tests/module-structure.test.mjs` enforces this.
- `src/styles/` — `foundation.css` (layout, component styles, design tokens, themes, focus states, responsive behavior), `graph-workspace.css` and `theme-project.css`.
- `src/preview.worker.ts` — Markdown parsing/rendering worker and preview-side processing. Keep expensive Markdown work off the UI thread and preserve the existing worker protocol.
- `src-tauri/` — Tauri 2 host, Rust commands, capabilities, filesystem permissions, and native build configuration.
- `docs/ARCHITECTURE.md` — the single technical reference: module contract, preview and graph performance rules, file handling, filesystem security, CSP. Read the relevant section before editing a subsystem and update it when a rule changes.
- `README.md` and `docs/CHANGELOG.md` — user-facing overview and commit-based release history.
- `package.json` — canonical frontend scripts and dependency declarations.
- `.gitignore`, `.gitattributes` — ignored build output and secrets; `examples/file-types/**` is stored byte-exact (`-text`), so do not let line-ending conversion touch it.

## Technology and normal checks

TypeNova is a local-first desktop application using TypeScript, Vite, Tauri 2 / Rust, CodeMirror 6, and a Markdown preview worker. The Markdown documents on disk are authoritative. Do not introduce an AI/cloud dependency or network service for local editor behavior unless the user explicitly requests it.

Use the scripts defined by `package.json` rather than guessing command names:

- `npm run dev` — frontend development server.
- `npm run build` — TypeScript check followed by Vite production build.
- `npm run tauri:dev` — desktop development application.
- `npm run tauri:build` — desktop production build.
- `npm test` — compiles the pure modules listed in the `test` script and runs `tests/*.test.mjs`, including the module-structure test (function ≤ 100 lines, module ≤ 600 lines, every `init*` called once from `main.ts`). **A new pure module that tests import must be added to the file list in the `test` script** and use `.js` suffixes in its relative imports.
- `npm run typecheck` — `tsc --noEmit`; `npm run benchmark:graph` — section-graph indexing benchmark (both run in CI together with `npm test` and `npm run build`).

For Rust-only changes, consider `cargo check` from `src-tauri/` when the native toolchain and dependencies are available. For Rust changes also run `cargo test` in `src-tauri/`. Sample files in `examples/file-types/` are generated by `samples.mjs`; after changing `samples.mjs`, run `node examples/file-types/generate-samples.mjs` and keep the generated files with it. Do not claim a script was run unless it was actually executed. Do not add or regenerate a package lockfile without a concrete reason.

## Architecture and correctness constraints

- Contribution rules for humans and agents alike (small focused changes, security boundaries, tests) are in [`RULES.md`](RULES.md); the security rules below apply to every change.
- File content is data and is never executed. Previewed HTML pages run in a sandboxed frame without scripts until the user enables them, never with `allow-same-origin`, and are served by the `tnpage` scheme from the project folder only. Do not widen the asset-protocol scope, the CSP or the capabilities without a documented reason.

- Keep CodeMirror transactions, caret/selection updates, layout, and other latency-sensitive interaction responsive. Do not put full-document Markdown parsing or other expensive scans on the UI thread when the existing worker architecture handles that work.
- Preserve preview virtualization, source block identity, worker revision checks, stale-result rejection, and the current worker message protocol unless a documented design change requires otherwise.
- Keep theme behavior consistent: prefer existing CSS variables/design tokens over hard-coded theme-specific colors. Check light, dark, and special/high-contrast themes when touching shared controls.
- Retain keyboard operation, focus states, accessible labels, and visible shortcut hints when changing menus or tree interactions.
- Keep file operations scoped to the user-selected project root and the filesystem permissions already granted by Tauri. Do not grant blanket drive access or weaken `src-tauri/capabilities/default.json` merely to make a file operation easier.
- For file-tree copy, cut, paste, delete, duplicate, and drag/drop, read sections 6 and 7 of `docs/ARCHITECTURE.md`. Avoid overwrites, invalid self/descendant moves, stale open-tab paths, and partial directory operations.
- For preview or Markdown parser changes, inspect `docs/ARCHITECTURE.md` and the related preview documentation. Escape or sanitize user-content output using the existing rendering conventions; do not introduce unsafe HTML injection.
- Do not replace the app framework, switch package managers, or add substantial dependencies as incidental cleanup.

## Change and release documentation

- For a user-visible behavior change, update the matching section of `docs/ARCHITECTURE.md` when an architectural rule changes; do not add per-feature note files. `docs/CHANGELOG.md` is built from the commit history (Keep a Changelog, one entry per release, each item linked to its commit): add the entry for a release together with the version-bump commit, and do not invent entries for work that is not committed.
- **Always bump the application version when handing work back to the user** (the user's standing instruction): `package.json`, `package-lock.json` (both version fields), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and the `typenova` entry of `src-tauri/Cargo.lock`, plus the release entry in `docs/CHANGELOG.md`. Only edits to agent instructions or documentation alone do not need a bump. Installers and ZIP files, when requested, carry the new version in their names.
- Do not mark runtime behavior as verified based only on static code inspection.

## Before handing work back

1. Review the final diff / changed files and ensure no unrelated files were altered.
2. Run the most relevant available checks: `npx tsc --noEmit`, `npm test`, `npm run build`, and `cargo test` for Rust changes. A headless browser or mock is not the real desktop app; say which one you used.
3. If the user asked for a ZIP or installers, open the result and confirm it is readable and complete.
4. Summarize the substantive changes and clearly disclose any checks that could not be completed. Do not commit; offer a commit message.
