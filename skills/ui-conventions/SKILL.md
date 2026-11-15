---
name: ui-conventions
description: How a screen change is built, captured and checked for how it looks and is used, not only for what it does - reuse the project's shared components, controls that follow the data, state as badges, the primary information first, explicit Save/Cancel; a readability checklist (the 5-second test, a text budget, themed native controls, 24 px targets); a design section (copy, motion, decoration, quality floor) with a plan before the markup for the developer; the interaction states to capture; and the visual review of the screenshots (ui_findings, a pass/fail line per checklist item). Use when a change touches a screen, a dialog, a component or styles.
summary: "UI changes: shared components, controls that follow the data, a readability checklist, a design section, states to capture, and the visual review of the screenshots (ui_findings)"
used_by: "developer (software-development workflows, when the change touches the UI); evidence (the visual review); ui_reviewer (ai-development-local-hero, with design-system)"
# "## Developer: ..." reaches only the developer agent's prompt (#300); "## Evidence and UI
# reviewer: ..." only the evidence and ui_reviewer agents' (#387)
role_sections: [developer, evidence, ui_reviewer]
---

# UI conventions

A screen can do everything its issue asks and still be hard to use: the file name leads instead of
the title, an enum is a free-text box hidden in a collapsed section, a form is misaligned
full-width boxes. Nobody catches that in a diff. These rules apply to every change that touches a
screen; they are skipped for changes without UI. You run unattended: record a default, never ask.

## Conventions (the developer builds with them, the reviewer checks against them)

- **Reuse the shared components** before writing new ones: the project's docs name them (this
  orchestrator: `docs/agents/renderer/ui-conventions.md`; elsewhere the design system, the
  shared stylesheet or component folder). Copy the markup of a screen that already uses them.
- **Controls follow the data**: a fixed list (`enum`) is a select or a segmented toggle, never a
  text box; a flag is a switch or a checkbox; free text only for free values. Short values (a mode,
  a language, a number) get a short control, never a full-width box.
- **State as badges**, not plain text: running / waiting / failed / done, a mode, a size, each a
  coloured or neutral badge from the shared set.
- **The primary information leads**: what the user recognises the thing by (an issue's title, a
  run's title, a project's name) is the headline; file names, ids and technical names are small,
  secondary, with the full value on hover. Long text is cut with an ellipsis and shown on hover.
- **Forms**: the label above the control (or the project's field component), aligned in a grid,
  a muted help line from the field's description. A multi-field edit has explicit **Save** /
  **Cancel**; a single obvious choice (a toggle) may save at once. Nothing saves on every keystroke.
- **Focus on the control**, not on a whole row or card; keyboard reachable, visible focus.
- **Stable locators**: every new control an end-to-end scenario could use gets a semantic element
  or an ARIA `role` with an accessible name (a `<button>` with its text, `aria-label` on an icon
  button), and a `data-testid` (kebab-case, named after what it is, e.g. `gate-approve`) on the
  controls and containers a step asserts on. E2E steps locate by role and test id, never by CSS
  classes or layout.
- **Quiet by default**: optional fields appear when set or when asked ("add note"), not as empty
  inputs everywhere. Edit areas look like edit areas (a framed panel), not like raw controls.
- **States**: every screen you add or change has its empty state, its edit state, its error state
  and its running/loading state designed, not left to chance.
- **One click, one way back**: an action that removes or replaces something in one click offers
  **Undo** in the toast that confirms it (what was removed returns at its place, the previous order
  or name comes back), or asks first when it cannot be undone. The toast says what changed in the
  screen's own words ("Removed #279 from the roadmap"), and Undo says why when it can no longer be
  done; it never undoes more than that one action.

## Readability checklist (the developer builds to it, the reviewer marks it)

1. **The 5-second test**: the one message the screen gives, and what leads; none or buried: blocking.
2. **A text budget**: a card shows a one-line title and at most two lines before "more".
3. **Numbers as visuals**: bars, scores and coloured chips, not sentences or raw lists.
4. **Nothing printed by default that only experts need**: caveats and commands behind ⓘ or "more".
5. **One primary action per area.**
6. **Native controls themed**: no bare `<select>`, `<input type="date">` or `datetime-local`
   opening in the system's light colours, no unstyled checkbox.
7. **Targets a person can hit**: controls of at least 24 × 24 px (WCAG 2.5.8).
8. **Full screen** for canvas and map views (the city, the 3D run view).
9. **Empty, loading and error states** in the evidence for a screen that has them.
10. **Nothing cut, overlapping or out of its box**, with real-scale data too.

## Design (adapted from Anthropic's frontend-design; the tokens win)

The tokens always win (`design-system`, section 1): no new palette, typeface or per-screen style.
- **Copy**: plain, active, sentence case for labels, buttons and messages. An error says what
  happened and how to fix it; an empty state, what to do next; nothing apologetic or vague. The
  tokens' uppercase titles and badges stay.
- **Motion**: only in answer to a user action, one orchestrated moment per screen at most,
  `prefers-reduced-motion` respected (3D views too); a hover never makes a canvas flash.
- **Decoration earns its place**: no gradient, shadow, rule, numbering or hover effect without
  information; numbering only for a real sequence.
- **Quality floor**: every control shows its focus (`--focus-ring`) and is keyboard reachable; at
  the window's minimum size nothing overlaps or is cut.

## Developer: plan before the markup

Per new or reshaped screen, before any markup, a short plan in the decision log: the 5-second
message and what leads, the type roles and token colours, a text wireframe (`score bar | top 5,
worst first | more ▸ caveats`). Check it against the checklist, the design rules and weak defaults
(every section open, numbers as sentences, a native control), then code.

## Developer: build, log, plan the capture

- Before writing markup, find the closest existing screen and the shared components it uses.
- Log each UI choice a reviewer could question in the decision log (which component, which control
  for which field, what leads), like any other decision.
- Make the project's screenshot demo data cover what the change introduces (the new field, a long
  title, an item of each state), or the screenshots can't show it. That data is code, in your commit.
- Never run `npm run screenshot` (or the project's screenshot command) yourself when the workflow
  captures the states you list: the engine captures them and the evidence step judges them.
- In `evidence_plan`, list per issue **the interaction states to capture**: the default view, then
  every edit form, menu, empty state and error state the change adds, each with how to reach it
  (e.g. the screenshot command's `--click <css selector>`, a tab, a mode). Keep it to the states
  that change; at most 4 beyond the default view.
- A data-heavy screen (lists, reports, charts, the city) adds a real-scale state from the shared
  `largeProjectFixture` (`scripts/screenshot/helpers.js`).

## Evidence and UI reviewer: capture the states, then review them

- Capture what the plan lists (the default view original and modified, plus each listed state
  modified only), with the project's screenshot command and its click option, into your round
  folder (`evidence_dir`) as `<issue>-<screen>-<state>.original.png` / `.modified.png`. Look at
  each PNG once.
- Review every UI screenshot against the Conventions, the readability checklist and the design
  rules. **Matches the mockup**: when the run has a `mockup` input (a frozen mockup version, its
  `index.html` and `kit/`), compare the screenshots of that screen with it and report each
  difference (layout, controls, texts, order, states) as a blocking finding (`convention: mockup:
  <folder>`); the item is pass or fail in the checklist. Per screenshot, even on an approval (`screens` when the output has it): `message`, its
  5-second message; `weakness`, its biggest weakness (there always is one); `checklist`, each
  checklist item and design rule (copy, motion, decoration, quality floor) pass or fail with one
  line of evidence. Only small data on a data-heavy screen: `small_data: true` and a non-blocking
  finding asking for the real-scale state.
- The deterministic checks run first (axe-core `color-contrast` and `target-size`, the
  native-control scan): each of their findings stays in `ui_findings` unless dismissed with a
  written reason. One the original side has too is a baseline, never blocking.
- **Not taken from frontend-design**, so never a finding: its palettes and typefaces, and the
  avoid-list items the tokens prescribe (uppercase 11 px titles and badges, `--mono` data, one
  `--radius`).
- Return `ui_findings`, one per problem:
  - `element`: what you look at ("the item's mode", "the Edit form's language field");
  - `problem`: what is wrong, concretely ("free-text box for an enum", "label widths differ, the
    boxes don't line up", "file name in bold, the issue titles only in tooltips");
  - `convention`: the rule it breaks (`ui-conventions: <rule>`; a design rule:
    `ui-conventions: design`);
  - `screenshot`: the file it shows in;
  - `blocking`: true when it makes the screen hard to read or use (a wrong control for the data,
    the primary information hidden, a form without Save/Cancel, a broken layout, a missing state
    the change adds); false for polish (spacing, a colour, a wording).
- Judge only what the screenshots show and only what the change touched; don't review the rest of
  the app. No screenshot, or a change without UI: `ui_findings` is an empty list.
- Blocking findings go back to the developer once (one fix round at most), like review findings;
  the rest are recorded for the owner.

## Done when

- the change uses the shared components and its controls follow the data;
- the evidence shows the default view and every state the change adds, with realistic data;
- every UI screenshot was reviewed: its findings in `ui_findings` (empty when none), its message,
  its weakness and each checklist item pass or fail with its evidence.
