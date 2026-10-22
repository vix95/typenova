# Contributing rules

Thanks for wanting to work on TypeNova. This page is short on purpose: it covers the things that are easy to get wrong and expensive to fix later. If a rule here gets in your way, open an issue and say why; I'd rather change the rule than have it quietly ignored.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Read the closest note in [`docs/`](docs/) before touching an existing subsystem. Most features have one, and they explain decisions that the code alone doesn't.
- Keep changes small and focused. Please don't mix a feature with unrelated cleanup, and don't remove features, docs or scripts as a side effect.
- Don't add a dependency, switch the package manager or replace a framework as incidental cleanup. If you need a new dependency, explain why in the issue.
- Don't add a package lockfile or regenerate one without a concrete reason.

## What TypeNova is

A local-first desktop app (TypeScript, Vite, Tauri 2 / Rust, CodeMirror 6, with Markdown rendering in a web worker). Markdown files on disk are the source of truth. No feature that works on local files should need a cloud service, an account or an AI model.

## Code structure

- [`src/main.ts`](src/main.ts) is a thin composition root. **Don't put feature logic there.** It imports modules and calls their `init*` functions in a fixed order, and that order is behaviour.
- Features live in focused modules under `src/` (`app`, `ui`, `i18n`, `editor`, `documents`, `preview`, `outline`, `layout`, `project`, `graph-ui`). Look for an existing helper or state object before adding a new one. Side effects belong in an exported `init*` function.
- `tests/module-structure.test.mjs` enforces these rules (thin `main.ts`, module size, init wiring, function length). If it fails, restructure the code rather than loosening the test.
- Background Markdown work stays in the worker. Keep CodeMirror transactions and caret updates responsive, and don't run full-document parsing on the UI thread.
- Keep preview virtualization, source block identity, worker revision checks and stale-result rejection working. The worker message protocol only changes with a documented reason.
- Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/ARCHITECTURE-MODULARIZATION-0.5.113.md`](docs/ARCHITECTURE-MODULARIZATION-0.5.113.md).

## Files and security

- File operations stay inside the project folder the user selected and inside the permissions Tauri already grants. Don't widen `src-tauri/capabilities/default.json` or the asset-protocol scope to make something easier. `tests/tauri-config.test.mjs` guards the important parts.
- File content is data. Never execute it, and don't inject unsanitized HTML into the preview; follow the existing escaping and rendering conventions.
- For copy, cut, paste, delete, duplicate and drag-and-drop in the project tree, read [`docs/FILE-TREE-OPERATIONS-0.5.59.md`](docs/FILE-TREE-OPERATIONS-0.5.59.md) and [`docs/FILESYSTEM-SCOPE-0.5.58.md`](docs/FILESYSTEM-SCOPE-0.5.58.md). Avoid overwrites, moving a folder into itself, stale paths in open tabs and half-finished directory operations.
- Don't change the Content Security Policy casually. Tauri adds nonces to CSP directives it is allowed to modify, which silently disables `'unsafe-inline'`; see [`docs/CSP-STYLE-NONCE-0.5.113.md`](docs/CSP-STYLE-NONCE-0.5.113.md).

## UI and CSS

- Use the existing design tokens (`--ui-bg`, `--ui-panel`, `--ui-text`, `--ui-accent`, `--ui-hover`, `--ui-focus-ring` and so on) instead of hard-coded colours. Check the light, dark and high-contrast themes when you touch a shared control.
- Every stateful button, toggle or segmented switch needs a visual selected state that persists after the pointer leaves, and it must match its ARIA state (`aria-pressed`, `aria-checked` or `aria-selected`). Hover and `:active` alone don't count. A mutually exclusive switch always shows exactly one selected option.
- Every interactive element needs a visible `:focus-visible` style and keyboard access. Don't remove an alternative way to reach an action (menu, shortcut) just because you hid a toolbar button.
- Scope styles to the component that owns them. Before adding CSS, look at the whole cascade, including later overrides, and avoid new `!important`.
- Respect `prefers-reduced-motion`.

## Language and tooltips

The interface is available in Polish and English, and both must work.

- Every new or changed tooltip, `aria-label` and accessible name is localized in both languages through the language-aware helper (`langText`) or the paired `data-pl` / `data-en` attributes. Don't derive tooltip text from a button's current text or an old `aria-label`.
- Use the application tooltip system (`data-tooltip`) and don't also add a native `title`.
- Check the control in both languages, including after switching language while it is in its selected state.

## Checks

Run these before opening a pull request:

```bash
npx tsc --noEmit    # type check
npm test            # unit and structure tests
npm run build       # type check and production bundle
```

For Rust changes, also run `cargo check` (and `cargo test`) in `src-tauri/`.

In the pull request, say what you actually ran and what you didn't. "Not tested in the desktop window" is a perfectly fine thing to write; claiming something works when you only read the code is not.

## Documentation

- For a user-visible change, add a line to the current version in [`docs/CHANGELOG.md`](docs/CHANGELOG.md) and a short focused note in `docs/`, following the existing naming (`FEATURE-NAME-x.y.z.md`).
- Bump the version in `package.json` only for an actual release, not for every change.

## Pull requests

- One logical change per pull request, with a clear description of what changed and why.
- Include screenshots for visible UI changes, ideally in both themes you touched.
- Review your own diff first and make sure it contains no unrelated edits.
