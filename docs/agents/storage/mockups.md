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
a branch of the repository (created on `main`): `mockups:variants` lists them, `mockups:create-variant`
and `mockups:switch-variant` check out, and every turn of the designer commits on the current branch.
`mockups:keep-variant` makes the kept branch `main` (`reset --hard`) and deletes the others; `chat/`
is not tracked, so the chat survives.

## Flows, export and attachments (#835, D12)

`flows/<flow>.json` links an element of a screen to another screen (`MockupModel.normalizeFlow`: a slug
name, both screens must exist); the editor's Interact mode follows them (`MockupModel.flowTarget`) inside
the same sandboxed canvas, with no network and no `window.api`. `exportZip` (`mockups:export`, base64)
packs the tracked files (`git ls-files`: no `.git/`, no `chat/`) plus an `index.html` with relative
links to every screen: a static .zip that opens offline, no live link. `attachment` (`mockups:attach`)
freezes a version for a Discovery card: `{ projectId, slug, commit (full sha), name
'<slug>@<sha7>.mockup.json', thumbnail (an SVG data URL) }`, stored as a card attachment; the card shows
its thumbnail and `screenAt` reads that version back.
