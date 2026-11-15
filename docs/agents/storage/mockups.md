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
  kit/  tokens.css  components.css  components.html  kit.json (sources, lines, fonts, components, inferences)
  screens/<slug>/  index.html (data-mid on every node)  meta.json { slug, title, source, createdAt }
  flows/<flow>.json    { name, links: [{ from: { screen, mid }, to }] } (#835)
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

## Kit map and Promote to kit (#835, D3)

A `ui-kit-map` run's output reaches `applyKitMap` (`mockups:kit-map`, and `onKitEvent` on the run's
event): it writes `kit/components.css`, `kit/components.html` (one section `#c-<slug>` per component,
the gallery the Kit tab previews in sandboxed iframes) and `kit.json` (`components: [{ name, source
(file:line), class?, html? }]`, `inferences`) in one `Kit map` commit; the tokens stay. A greenfield
project still starts from references. `promoteToKit` (`mockups:promote`) takes one element of a screen
(`data-mid`): the colours of its inline style become tokens (`--<name>-<prop>` in `tokens.css`), its
style a `.<name>` rule of `components.css`, and `kit.json` lists it with `source:
screens/<slug>/index.html#<mid>`, in one commit; the kit lint then accepts those values.

## Versions, compare and variants (#835, D10)

`compareVersions` (`mockups:compare`) reads one screen at two commits (`git show`, byte for byte) and
returns `MockupModel.diffMids` (the added, removed or changed `data-mid`s). The canvas can serve an
older version with `mockup://<id>/screens/<slug>/index.html?at=<sha>` (the Compare sides). A variant is
a branch of the repository, created from the current branch (`switch -c`): `mockups:variants` lists
them, `mockups:create-variant` and `mockups:switch-variant` check out, and every turn of the designer
commits on the current branch. `mockups:keep-variant` switches to the kept branch, deletes every other
branch (`branch -D`) and renames the kept one to `main` (`branch -m`); `chat/` is not tracked, so the
chat survives. A new repository starts on `main` (`init` + `symbolic-ref`, any git version).

## Flows, export and attachments (#835, D12)

`flows/<flow>.json` links an element of a screen to another screen (`MockupModel.normalizeFlow`: a slug
name, both screens must exist); the editor's Interact mode follows them (`MockupModel.flowTarget`) inside
the same sandboxed canvas, with no network and no `window.api`. `exportZip` (`mockups:export`, base64)
packs the tracked files (`git ls-files`: no `.git/`, no `chat/`) plus an `index.html` with relative
links to every screen: a static .zip that opens offline, no live link. `attachment` (`mockups:attach`)
freezes a version for a Discovery card: `{ projectId, slug, commit (full sha), name
'<slug>@<sha7>.mockup.json', thumbnail (an SVG data URL) }`, stored as a card attachment; `discovery:attachment` returns that frozen
thumbnail as the attachment's `dataUrl`, so the card shows it, and `screenAt` reads that version back.

## Handoff: issues, dev-run input and the review (#836, D5/D11/D13)

The handoff only prepares work: no channel here starts a development run or files an issue, and no
`human_approval` gate is crossed.
- `mockups:freeze` (`freezeVersion`) writes `frozen/<slug>@<sha7>/` (the screen's `index.html` and `kit/`
  as they were at that commit; not versioned, no commit) and answers `{ ref, slug, commit, dir }`. `dir` is
  the value of a dev run's optional `mockup` input (feature, fix, the local hero): the developer reads the
  screen and its kit, and the UI reviewer's "Matches the mockup" item compares each `.modified.png` with it.
  The editor's **Start a development run** freezes the current version and opens the main window's Start
  panel with `inputs.mockup` filled (`main-window:navigate` `mockups:start-run`); the owner starts the run.
- `mockups:crops` (`saveCrops`) turns the regions selected in the editor (`data-mid`) into cropped images
  saved by `saveRef` in `refs/` (`[{ mid, file, name }]`); a mid missing at that version is refused. The host
  captures the pixels; simulated, a placeholder image. **Prepare issues** then opens the #258 commit dialog
  of the Discovery card the mockup is attached to (`mockups:prepare-issues`); each crop goes into every
  issue of the split (`discovery_commit.crops`, a section of the issue body with its `data-mid`), and
  nothing is filed until the owner confirms in the dialog.
- `mockups:review` (`reviewScreen`) is **Review this screen**: on demand only, its estimate
  (`review-screen`) shown first; kit findings from `MockupModel.lintMockup`, axe findings from the given
  violations, layout findings from the model turn. Simulated: $0, no workflow run. A designer turn never
  reviews.
- `mockups:recreate` creates a screen from a page of the running app (D5): refused without Run App / Local
  preview (the project's `localPreview`, then `.multiagent/local-preview.yaml`); its estimate
  (`recreate-screen`) is shown first. Real: `mockup-generate` with `mode: recreate` and `app_url`;
  simulated: a draft screen that links the kit, no workflow run.
