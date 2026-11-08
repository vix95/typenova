# GitHub Copilot instructions — TypeNova

**Before planning or editing, open and read the full root `AGENTS.md`.** It is the canonical source of repository-specific rules and must be followed for every task. In particular:

- Inspect the existing implementation and relevant `docs/` notes before editing; ask the user when a material requirement remains ambiguous.
- Preserve the TypeScript/Vite + Tauri 2 architecture, the Markdown preview worker protocol, and the project-root filesystem security boundary.
- Keep theme tokens, keyboard accessibility, and existing file-tree semantics intact.
- For every UI/HTML/CSS, interaction, theme, or accessibility task, also read and obey `.claude/skills/typenova-ui-css/SKILL.md`.
- Every stateful button, toggle, and segmented switch must have a persistent visual pressed/selected state synchronized with `aria-pressed`, `aria-checked`, or `aria-selected`; hover-only or transient `:active` feedback is insufficient.
- **Tooltip localization audit:** explicitly localize every added/modified tooltip and accessible name in Polish and English; audit `data-tooltip`, `title`, `aria-label`, and focus-triggered states. Do not rely on text inferred from button labels. See `AGENTS.md` for the mandatory checklist.
- Git is the version control of this repository. Create commits, branches, tags, pushes or pull requests only when the user asks for them, and never commit automatically; when a commit is wanted, propose its message.
- Run the available relevant checks and describe only checks that actually completed.
- Buttons always use SVG icons (`ICONS` in `src/ui/icons.ts` for buttons built in TypeScript, inline `<svg aria-hidden="true">` in `index.html`), never text characters or emoji as icons.
- Bump the application version when handing work back (see `AGENTS.md`). A ZIP or installers only on request.

When this file is updated, keep it as a pointer/short checklist; do not let it contradict `AGENTS.md`.
