# UI conventions

The skills that set the UI rules, long text in cards, how a screen is built and reviewed, and this app's controls.

## UI conventions

The general rules (and the visual review of the screenshots) are in the `ui-conventions` skill,
which the software-development developer and evidence agents load (#111). The design tokens
(colours, spacing scale, typography, radius, alignment grid, from the `:root` block of
`style.css`) are in the separate [`design-system`](../../../skills/design-system/SKILL.md) skill (#151);
ai-development-local-hero's `ui_reviewer` reviews the screenshots against both. A token added or
changed in `style.css` goes into that skill too.

Long text in cards and panels (#443, #437) uses the shared classes of `style.css`, not a fix per
card: `.fit-box` on a grid or flex card (its items get `min-width: 0`), `.text-cut` on a path or an
id (one line ending in "…", the element carries the whole text in `title`), `.text-prose` on prose
(wraps, long words too). A status pill (`.pill`) never wraps: the title next to it truncates
(`.run-title-text`). `status_pill.*` labels stay at 16 characters or fewer in every language
(`test/i18n-catalog-check-329.test.js`). Guards: `test/css-layout.js` cascades the stylesheets onto
rendered markup and reports what would be wider than its box (`test/renderer-run-suite-card-overflow.test.js`).

How a screen is built and reviewed (#387):
- **Build**: ai-development-local-hero's developer loads both skills (`ui-conventions` and
  `design-system`): every colour, gap, size and radius comes from the `:root` tokens. The design
  section of `ui-conventions` (adapted from Anthropic's `frontend-design`, credited in
  `THIRD_PARTY_NOTICES.md`; the tokens always win) sets the copy, motion, decoration and quality
  floor rules; its developer-only part, *plan before the markup* (`role_sections`), asks for a short
  plan per new screen in the decision log: the 5-second message, what leads, the type roles and
  token colours, a text wireframe.
- **Capture**: `scripts/screenshot.js` runs the deterministic checks on each captured state
  (`scripts/screenshot/checks.js`): axe-core's `color-contrast` and `target-size` rules and the
  visible native controls (a bare `<select>`, date or datetime-local field), into
  `<name>.<side>.checks.json` beside the PNG. The screenshots step turns them into `axe_findings`
  (`packages/engine/domains/evidence/ui-review-checks.js`): a finding the original side has too is a baseline (a ratchet), never
  blocking. A data-heavy screen adds a real-scale state from the shared `largeProjectFixture`
  (`scripts/screenshot/helpers.js`; e.g. `--view project --tab architecture --mode large`).
- **Review**: the `ui_reviewer` gets the `axe_findings` in its prompt and keeps each one in
  `ui_findings` or dismisses it with a written reason (`dismissed`). Per screenshot it marks every
  item of the readability checklist and the design items pass or fail with one line of evidence,
  and writes the screen's 5-second message and its biggest weakness (`screens`, required by its
  `agent_output_schema`: no "approved, 0 findings" without them).

In this app:

- **Reuse what `style.css` has**: `.btn` (`.primary`, `.ghost`, `.sm`; `.ghost.danger` red for a
  destructive action, `.warn-ghost` amber for one that holds work back, `.btn-icon` with an icon before
  the text: the Roadmap bar's Stop and Pause, #269), `.link-btn` for small
  actions ("add note", "Edit"); `.badge` (neutral; `.warn`, `.live`, `.p-mock`…) and `.pill`
  (`-idle`, `-running`, `-success`, `-failed`, `-cancelled`, `-interrupted`) for states: a run's
  or an item's status is always drawn by `StatusPill` (`status-pill.js`, #266:
  `statusPill(status, { waiting })`, or `statusLabel` for plain text), never as its raw id: the
  label is readable ("Running" with the pulsing dot, "Waiting for you", "Merged locally"), the id
  stays in `data-status` (tests and E2E steps read it); a new status gets its label there; `.field`
  (label above the control, `.hint` for the help line, `.row` for a pair); `.s-group`/`.s-row` for
  settings-like lists; `.switch` and `.check` for flags; `.seg` (`.sm`) for a small set of choices;
  `.empty-state`; the standard `select` / `input[type=text]` styles (their focus is on the control).
- **Class names are per screen**: every stylesheet is global and `index.html` loads them in a
  generated order, so a screen's own classes carry its prefix and no other screen reuses them. The
  robot containers in particular: `ag-robot` is the Agents screen's 280px editor preview
  (`views/agents/agents.css`), the Analytics Agents tab's 44px card robot is `an-robot`
  (`views/analytics/analytics-insights.css`), the 3D HUD's `r3d-avatar`
  (#297: a second `.ag-robot` once shrank the editor's preview to 44px; a test refuses one outside
  `views/agents/`).
- **Controls follow the data**: workflow inputs are always drawn by `WorkflowInputs`
  (`workflow-inputs.js`, #116), never by hand: the input's `label` (or one derived from the key; a
  YAML slug is never shown), its `options` labels, pills (`.seg`) for an enum of up to 5 short
  values, a select for a longer one, a `.switch` for a boolean (or an enum of `"false"`/`"true"`), a
  compact box for text, the local branches for a `*branch` input, `show_if`, and the `description`
  as `.hint`. Read the values with `WorkflowInputs.read`, set one with `.set`, prefill the project's
  language and branches with `.applyHints`. Add `.wi-grid` to the container for aligned labels.
  Elsewhere, an enum is a select or a `.seg` toggle and a flag a switch or a checkbox. Short values
  never get a full-width box.
- **Selects, dates and checkboxes (#383)**: `style.css` sets `color-scheme: dark` on `:root`
  (`light` under `.r3d[data-theme="light"]`), so native pickers and scrollbars follow the theme.
  Every `select` is the customizable select (`appearance: base-select`): the same height and radius
  as the text inputs, a chevron, its list (`::picker(select)`) on `--panel` with the chosen option
  marked; keyboard, ARIA, disabled options and groups stay native, and so do `.value`, `change` and
  the E2E `selectOption` steps. `select.js` adds a search list (`data-testid="select-search"`,
  `role="listbox"`) to a select with more than 10 options (`select-search.js`), and
  `Select.markup(attrs, options, value)` builds a select's markup. A date range is
  `DateRange.fields({ testid, from, to, fromAttrs, toAttrs, presets })` (`date-range.js`: From / To
  inputs `date-range-from` / `date-range-to`, the presets Last 24 h, 7 days, 30 days and All in the
  owner's time zone via `DateRange.presetRange`). Date and datetime-local inputs share the base input
  rule. Checkboxes and radios are `--check-size` (18px; 16px in `.small` and the compact toggles).
  **No new bare control**: a `<select` tag, `type="date"` or `type="datetime-local"` written in a
  renderer file fails `test/bare-controls-383.test.js` (`scripts/bare-controls.js`, run it with
  `node scripts/bare-controls.js`); the files that had some when it landed are its `BASELINE`, whose
  counts may only go down. Use `Select.markup` and `DateRange.fields` instead.
- **What leads**: titles (issue, run, project) are the headline; workflow files, ids and run ids
  are small badges or links with the full value in `title`. Long titles ellipsize.
- **Edits**: several fields → an Edit form with Save / Cancel; one obvious choice (a mode) → a
  toggle that saves at once; optional text (a note) appears when set or from an "add …" link.
