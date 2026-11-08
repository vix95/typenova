# Instructions for coding agents

The mandatory repository guide is [`AGENTS.md`](AGENTS.md). Coding agents must read it completely before beginning any task.

Platform entry points are provided for common tools:

- `CLAUDE.md` and `.claude/skills/typenova-repo/SKILL.md` — Claude Code.
- `.github/copilot-instructions.md` — GitHub Copilot.
- `.cursor/rules/typenova.mdc` — Cursor (always applied).
- `GEMINI.md` — Gemini Code Assist / CLI.

Git is the version control of this repository. Create commits, branches, tags, pushes or pull requests only when the user asks for them, and never commit automatically; when a commit is wanted, propose its message.

Keep these pointers aligned with `AGENTS.md`; do not create competing repositories' rules. Handoffs are changes in the working tree; a ZIP of the full project (without `.git/`) is built only on request. Buttons always use SVG icons (`ICONS` in `src/ui/icons.ts` for buttons built in TypeScript, inline `<svg aria-hidden="true">` in `index.html`), never text characters or emoji as icons.

For every UI/HTML/CSS, interaction, theme, or accessibility task, agents must also read and obey [the TypeNova UI/CSS skill](.claude/skills/typenova-ui-css/SKILL.md). A stateful button/toggle/segmented switch must retain a visible selected/pressed state and synchronize it with its ARIA state; `:hover` and transient `:active` alone are insufficient.

Additional mandatory rule: explicitly localize every new or modified tooltip and accessible name in both Polish and English; audit `data-tooltip`, `title`, `aria-label`, and keyboard-focus behavior rather than relying on text inferred from button labels. See `AGENTS.md`.
