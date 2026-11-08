---
name: typenova-ui-css
description: Mandatory rules for every TypeNova UI, interaction, theme, HTML, and CSS change.
---

# TypeNova UI and CSS — mandatory agent rules

Apply this skill to every task that changes or reviews HTML structure, UI behavior, buttons, switches, accessibility, application themes, layout, visual design, or CSS. These are hard requirements, not suggestions. Read the complete root `AGENTS.md` first. This skill extends it; when there is any conflict, `AGENTS.md` remains canonical.

## 1. Inspect before editing

- MUST inspect the relevant `index.html` structure, the owning feature module's state/handlers/rendering (see the repository map in `AGENTS.md`; `src/main.ts` only composes modules), and every occurrence of the relevant selectors in `src/styles/*.css` before changing a control.
- MUST inspect the related feature note under `docs/` and the final/cascade-overriding CSS rules, including theme overrides and media queries. A selector's first declaration may not be the effective declaration.
- MUST identify the real state source and ensure markup defaults, JavaScript state, CSS classes, and ARIA state agree on first render and after every interaction.
- MUST make localized changes and preserve unrelated functionality. Do not add a new dependency for styling or interaction polish.

## 2. Stateful buttons, toggles, and segmented switches

- EVERY stateful/toggle button MUST have a persistent visual state when enabled/selected. The state MUST remain visible after the pointer leaves; `:hover` and `:active` alone do not satisfy this rule.
- The visual selected/pressed state MUST be tied to the same state that updates the semantic attribute (`aria-pressed`, `aria-checked`, or `aria-selected`) and the corresponding class/state. Do not allow CSS and ARIA to disagree.
- For button toggles, use `aria-pressed`. For binary controls whose semantics are a switch, use `role="switch"` with `aria-checked`. For tabs, preserve the tab pattern and use `aria-selected`. Do not combine incompatible or contradictory semantics.
- Segmented controls MUST show which option is selected at rest. A switch with mutually exclusive modes (for example, Graph / Tree) MUST keep exactly one selected option, update both options' visual state and ARIA state in the same transition, and correctly restore the persisted mode on startup.
- The selected state MUST be distinct from the unselected state by more than a transient hover color. Use theme-aware changes to surface/background, border, text/icon foreground and/or an inset/recessed pressed treatment. Do not communicate selection through color alone in high-contrast mode.
- Add a coherent `:active` feedback for the physical click, without replacing the persistent selected style. Ensure selected controls still look selected while hovered or focused.
- MUST explicitly style enabled, selected/unselected, hover, `:focus-visible`, disabled, and high-contrast cases where applicable. Keep keyboard focus clearly visible and do not remove the browser focus indicator without a visible replacement.

## 3. Theme and color rules

- MUST use existing design tokens for component styling: prefer `--ui-bg`, `--ui-panel`, `--ui-panel2`, `--ui-input-bg`, `--ui-border`, `--ui-text`, `--ui-muted`, `--ui-accent`, `--ui-accent-contrast`, `--ui-hover`, `--ui-active`, `--ui-focus-ring`, and the established shadow tokens.
- MUST NOT introduce fixed theme-specific colors in shared component rules when a token or `color-mix()` can express the state. Hard-coded colors are allowed only where they belong to an existing explicit theme definition or where a documented platform constraint requires them.
- MUST consider all shipped palettes (including light, dark/Midnight, Newsprint, Terminal/Retro, and high-contrast where present). High-contrast states need a strong border/focus indicator and readable contrast, not only a subtle tint or shadow.
- MUST honor `prefers-reduced-motion`; transitions should be short and restrained. Disable nonessential motion when reduced motion is requested.
- MUST keep surfaces, text, borders, icons, selected states, disabled states, and focus indicators coherent with the active theme.

## 4. CSS organization and cascade

- MUST search for duplicate, later, more-specific, or `!important` rules before editing. Confirm which declaration wins. Do not stack a new override blindly at the end of the file as a substitute for understanding the cascade.
- Put rules beside the existing component styles where practical. When a later override is genuinely needed to preserve the cascade, document why and use a concise version/change comment.
- Scope styles to the component or workspace root. Do not use broad selectors that accidentally change unrelated controls or modules.
- Avoid introducing competing duplicate declarations, unnecessary `!important`, inline style attributes for persistent states, or global resets as incidental cleanup. If `!important` is required by the existing cascade, explain through a nearby comment or a clearly scoped selector.
- Preserve layout constraints (`min-width: 0`, `min-height: 0`, flex/grid behavior, overflow and scroll ownership) when modifying toolbar or workspace controls. Check narrow/responsive layouts and prevent unintended horizontal overflow.
- Use existing classes and tokens before adding a new design pattern. Do not redesign neighboring components unless the request includes them.

## 5. UI state scope and module ownership

- Module-level behavior MUST be scoped to the module's actual root/state (for example `body.graph-mode` or `#brainView`), not inferred from an individual subview (`Graph` versus `Tree`) when the entire module should behave consistently.
- Hiding a module's toolbar actions MUST NOT silently disable the same underlying operation everywhere else. Preserve alternate access paths (menu commands and keyboard shortcuts) unless removal is explicitly requested.
- A change to a view switch MUST handle initial/persisted state, clicks, keyboard activation, and mode re-rendering. Do not add event listeners or state flags that duplicate existing behavior.

## 6. Accessibility, labels, and localization

- MUST preserve semantic HTML, accessible names, focus order, keyboard operation, and visible focus.
- MUST explicitly localize added or modified tooltip text and accessible names in Polish and English. Follow `AGENTS.md`'s tooltip audit for `data-tooltip`, `title`, `aria-label`, and focus-triggered tooltips.
- For dynamically changed controls, use the existing `langText()` / language-aware update path or the repository's paired `data-pl` / `data-en` convention. Test language switching after the control has entered a selected state.
- Do not rely on a visible label, stale `title`, or inferred text to provide a control's accessible name. If the shared tooltip system is in use, avoid redundant native `title` tooltips.
- Buttons always use SVG icons (`ICONS` in `src/ui/icons.ts` for buttons built in TypeScript, inline `<svg aria-hidden="true">` in `index.html`), never text characters or emoji as icons.
- Use text/icon labels that remain understandable without color. Decorative SVG elements must remain hidden from assistive technology; interactive SVGs need an accessible name on their control.

## 7. Module-specific examples and constraints

- Graph and Tree are two modes of the same Graph workspace. Any control that belongs to the whole module must behave consistently in both modes.
- The Graph / Tree switch MUST visibly depress the selected option persistently and synchronize `.is-active` with `aria-pressed`.
- The editor's top-bar Save and Preview buttons MUST be hidden while `body.graph-mode` is active, including Tree mode. Preserve Save through the File menu and Ctrl+S. Do not hide these controls globally in editor mode.
- Do not break graph/tree node selection, preview, filtering, keyboard navigation, the preview worker, or Tauri filesystem boundaries while working on its presentation.

## 8. Verification checklist

Before handoff, MUST:

1. Review the final diff and confirm the implementation follows the real state source and does not introduce unrelated edits.
2. Audit the active/inactive styles and `aria-pressed` / `aria-checked` / `aria-selected` states for consistency.
3. Inspect default, hover, focus-visible, disabled, light/dark, and high-contrast styling as applicable; check that selected state persists after pointer exit.
4. Check responsive overflow and reduced-motion behavior when the affected layout uses motion or compact controls.
5. Audit modified tooltip literals and accessible names in both Polish and English.
6. Run available checks and report only those that actually completed. Do not claim runtime or visual testing from static inspection alone.
7. Update the focused feature note under `docs/` for user-visible behavior changes and follow the changelog and version rules in `AGENTS.md`.
