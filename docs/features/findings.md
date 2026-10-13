---
order: 255
---

<!-- section:workflows -->
### Findings: report what is on screen (development)

The **Findings** button (bottom-right corner, or **Ctrl+Shift+F**) is a tool for the people
building the app, after the `sightline` seed of Kent Beck's
[ToolSeeds](https://github.com/KentBeck/ToolSeeds). It shows when the app runs from source
(`npm start`), or when **Settings › General › Findings button** is on (off by default). It never
shows in `scripts/screenshot.js` captures unless that setting is on.

- **Freeze**: a click captures the window's real pixels and the view stops updating while you mark
  it. **Esc** or **Cancel** closes it and nothing is saved.
- **Mark**: numbered **Pins**, **Circle**, **Box**, **Arrow** and **Freehand**, each with an
  optional note, and a note for the finding. A pin resolves to the element under it: its
  `data-testid`, the view and tab, the ids it carries (run, step, stage, item, issue, session) and
  its bounding box; a pin on empty space says so.
- **Save** writes the finding to `<workspace>/findings/<timestamp>/`: `screenshot.png`,
  `marked.png`, `marks.json`, `context.json` (view and tab, project, visible runs, window size,
  theme, app version and commit, the last 50 UI actions, the last 50 service calls with their
  errors, the last 200 lines of the main log) and `note.md`. Tokens, auth state, environment
  variables and file contents are never written. **Open folder** shows it.
- **File as issue** sends the finding to the Product Owner's inbox. The Product Owner writes the
  issue (English, UI criteria) with the marked image and names the finding's folder, so a run can
  read the bundle.
- **Settings › General › Findings** lists the saved findings with their status: Saved, Sent
  (waiting in the Product Owner's inbox) or Filed.

<!-- section:workspace-tree -->
  findings/<timestamp>/ findings saved by the Findings button (screenshot, marks, context, note)
