# Mandatory instructions for Claude Code

Before doing any repository work, read the complete root [`AGENTS.md`](AGENTS.md) and treat it as mandatory. It is the canonical guide for this repository: architecture constraints, safe filesystem behavior, testing honesty, documentation, and the version-bump rule.

Use the `typenova-repo` skill at `.claude/skills/typenova-repo/SKILL.md` for repository tasks. For every UI/HTML/CSS, interaction, theme, or accessibility change, MUST also read and follow `.claude/skills/typenova-ui-css/SKILL.md`. If this file and `AGENTS.md` ever differ, follow `AGENTS.md` and update this pointer rather than maintaining conflicting rules.

Git is the version control of this repository. Create commits, branches, tags, pushes or pull requests only when the user asks for them, and never commit automatically; when a commit is wanted, propose its message.

Also apply the mandatory tooltip localization audit in `AGENTS.md`: every new or changed tooltip must be explicitly localized in Polish and English, including `data-tooltip`, `title`, `aria-label`, and focus behavior.
