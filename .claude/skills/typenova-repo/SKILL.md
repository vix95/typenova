---
name: typenova-repo
description: Use for any TypeNova repository task, including frontend, Markdown preview, project tree, Tauri/Rust, styling, packaging, and release documentation.
---

# TypeNova repository skill

Before making a plan or editing files, read the complete root `AGENTS.md`. Follow it as the canonical and mandatory set of repository instructions. Inspect the relevant code and existing `docs/` notes before changing behavior.

For every UI/HTML/CSS, interaction, theme, or accessibility task, also read and strictly follow `.claude/skills/typenova-ui-css/SKILL.md`. Stateful buttons and segmented switches must have persistent selected/pressed visual feedback synchronized with ARIA state; `:hover` and transient `:active` alone are not enough.

Apply particular care to the preview worker's message/revision protocol, Markdown preview virtualization, theme-aware CSS tokens, keyboard-accessible menus, and Tauri filesystem scope. Do not make broad rewrites or introduce new dependencies as incidental cleanup. Ask the user if a material product requirement remains ambiguous after source/documentation inspection.

Git is the version control of this repository. Create commits, branches, tags, pushes or pull requests only when the user asks for them, and never commit automatically; when a commit is wanted, propose its message.

Bump the application version when handing work back (see `AGENTS.md`). Build a ZIP or installers only when asked, and verify them before linking. Report only tests/builds that actually ran; disclose blocked checks.

Buttons always use SVG icons (`ICONS` in `src/ui/icons.ts` for buttons built in TypeScript, inline `<svg aria-hidden="true">` in `index.html`), never text characters or emoji as icons. Also enforce the tooltip localization audit from `AGENTS.md`: explicitly localize all changed tooltips and accessible names in Polish and English, including `data-tooltip`, `title`, `aria-label`, and keyboard-focus behavior.
