# The Findings button

Capturing a finding bundle from any screen and reading one (#361).

## Findings button (#361)

`findings.js` (`window.Findings`) and `packages/shared/findings-model.js` (`window.FindingsModel`, pure: visibility,
Ctrl+Shift+F, `resolvePin`) are the development tool after ToolSeeds' `sightline`. The button is a
sidebar entry at the menu's end (`[data-testid="findings-button"]`). It shows from source, or with
`settings.findingsButton`, and never in `scripts/screenshot.js` captures unless the setting is on
(app:info's `isPackaged` and `screenshot`). It opens `[data-testid="findings-overlay"]` over the
window's capture (`window:capture`, desktop only). Pins are DOM `[data-testid="findings-pin"]`
elements and the shapes are drawn on the canvas. It records the last 50 clicks and navigations;
the service records the last 50 channel calls (`areas/findings.js`) and `packages/engine/domains/workspace/main-log.js` keeps
the main log. Screenshots: `--view findings --mode marking|saved|list`.

**Reading a finding bundle** (`<workspace>/findings/<id>/`, named in the issue the Product Owner
filed):
- start from `note.md` and `marked.png`;
- each numbered pin in `marks.json` has its `element`: `testid`, `view`, `tab`, `ids` (run, step,
  stage, item, issue, session) and `box`. Search the `data-testid` in `apps/desktop/renderer/`, then the code
  map for its module. `empty: true` is a pin on empty space: read its note and the picture;
- `context.json` has the view and tab, project, run ids, window and theme, and the app version and
  commit. `actions` holds the last UI actions, `calls` the last service calls with their errors,
  and `log` the main log;
- reproduce the state with the view's seed module (`scripts/screenshot/views/<view>.js`, same tab
  and size). Add the check that fails before the fix: a renderer test on the pinned element's
  module, or the seed extended so the screenshot shows the defect.
