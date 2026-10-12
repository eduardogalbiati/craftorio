---
name: ui-conventions
description: How a screen change is built, captured and checked for how it looks and is used, not only for what it does - reuse the project's shared components, controls that follow the data, state as badges, the primary information first, explicit Save/Cancel; the interaction states to capture; and the visual review of the screenshots (ui_findings). Use when a change touches a screen, a dialog, a component or styles.
summary: "UI changes: shared components, controls that follow the data, states to capture, and the visual review of the screenshots (ui_findings)"
used_by: "developer (software-development workflows, when the change touches the UI); evidence (the visual review); ui_reviewer (ai-development-local-hero, with design-system)"
# "## Developer: ..." reaches only the developer agent's prompt (#300)
role_sections: [developer]
---

# UI conventions

A screen can do everything its issue asks and still be hard to use: the file name leads instead of
the title, an enum is a free-text box hidden in a collapsed section, a form is misaligned
full-width boxes. Nobody catches that in a diff. These rules apply to every change that touches a
screen; they are skipped for changes without UI. You run unattended: record a default, never ask.

## Conventions (the developer builds with them, the reviewer checks against them)

- **Reuse the shared components** before writing new ones: the project's docs name them (this
  orchestrator: "UI conventions" in `docs/agents/renderer.md`; elsewhere the design system, the
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

## Evidence: capture the states, then review them

- Capture what the plan lists (the default view original and modified, plus each listed state
  modified only), with the project's screenshot command and its click option, into your round
  folder (`evidence_dir`) as `<issue>-<screen>-<state>.original.png` / `.modified.png`. Look at
  each PNG once.
- Review every UI screenshot against the Conventions section and return `ui_findings`, one per problem:
  - `element`: what you look at ("the item's mode", "the Edit form's language field");
  - `problem`: what is wrong, concretely ("free-text box for an enum", "label widths differ, the
    boxes don't line up", "file name in bold, the issue titles only in tooltips");
  - `convention`: the rule of the Conventions section it breaks;
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
- every UI screenshot was reviewed and its findings are in `ui_findings` (empty when none).
