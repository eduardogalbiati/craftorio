# Project mockups

The project mockups of Plan & Design › Mockups in `<workspace>/mockups/` (#625).

## The mockups folder: files and a local git repository (#625)

Files only, in `<workspace>/mockups/<project-id>/` (no index.db table yet), written by
`fronts/plan/engine/domains/mockups.js` through the `mockups:*` channels
(`fronts/plan/engine/channels/mockups.js`); never next to `__dirname`, never in the project's
repository (the designer only reads it). The folder is its own local git repository (D10): one commit
per change (a new screen, a designer turn, a restore, a kit build), so `mockups:versions` is
`git log` of `screens/<slug>/` and `mockups:restore` writes an older version back as a new commit.

```
<workspace>/mockups/<project-id>/
  .git/                versions (one commit per turn)
  kit/  tokens.css  components.css  kit.json (sources, lines, fonts, components, inferences)
  screens/<slug>/  index.html (data-mid on every node)  meta.json { slug, title, source, createdAt }
  flows/               (phase 2)
  refs/<sha256>.<ext>  pasted reference images, named by their hash
  chat/<slug>.jsonl    the designer chat, one { role, text, payload?, runId?, at } per line
```

The editor window serves the folder to its sandboxed canvas on the `mockup://<project-id>/<path>`
protocol (`apps/desktop/host/mockups-window.js` `resolveMockupRequest`: no `..`, no `.git`, contained
in the project's folder) with `MOCKUP_CSP` (no network). `kit/tokens.css` comes from the machine step
(`MockupModel.extractTokens` on the project's stylesheets, free); `components.css` and the catalogue in
`kit.json` from a `ui-kit-map` run. Screens come from `MockupModel.draftScreen` when simulated, from a
`mockup-generate` run (its `html` output) otherwise. Removing the folder removes every mockup of the
project and its history.
