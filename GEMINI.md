# Mandatory instructions for Gemini Code Assist / CLI

Before planning, inspecting for implementation, or editing code, read the full root [`AGENTS.md`](AGENTS.md) and follow it. That file is the canonical guide for architecture, filesystem safety, documentation, verification, and delivery. Buttons always use SVG icons (`ICONS` in `src/ui/icons.ts` for buttons built in TypeScript, inline `<svg aria-hidden="true">` in `index.html`), never text characters or emoji as icons.

Git is the version control of this repository. Create commits, branches, tags, pushes or pull requests only when the user asks for them, and never commit automatically; when a commit is wanted, propose its message.

Most importantly, preserve the existing TypeNova architecture and user data boundaries, ask the user when a material requirement remains unresolved after source/docs review, and bump the version on handoff (see `AGENTS.md`); build a ZIP only when asked. Be transparent about checks that did not run.

For every UI/HTML/CSS, interaction, theme, or accessibility task, also read and follow `.claude/skills/typenova-ui-css/SKILL.md`. Every stateful button/toggle/segmented switch must have a persistent selected/pressed visual state synchronized with its ARIA state; `:hover` or `:active` alone is not enough.

Also apply the mandatory tooltip localization audit in `AGENTS.md`: every new or changed tooltip must be explicitly localized in Polish and English, including `data-tooltip`, `title`, `aria-label`, and focus behavior.
