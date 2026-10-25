# Fronts: the engine side of a front (#590)

Phase 4 of the reorganisation study: a front package carries the channels, areas and domain modules only it uses; the engine discovers them from the installed fronts and serves the ones the app's composition names.

Read this before adding a channel, an area or a domain module, before moving one between the engine
kernel (`packages/engine`) and a front (`fronts/<id>`), and before changing how the service loads
them (`packages/engine/service/index.js`, `manifest.js`, `fronts.js`). The study is
`docs/reorganisation-study-2026-10.md` (decision 1 of 2026-10-24: vertical fronts); the UI side of a
front (its screens, its Home card, the composition file, the actions registry) is in
[renderer.md](../renderer.md), "Composition".

## What a front package carries

```
fronts/<id>/
  package.json        "multiagent": { "front": "<id>" }    declares the front; its id = the menu group id
  engine/             the engine side (`multiagent.engine` may name another folder)
    channels/*.js     (ctx) => [entries], as packages/engine/service/channels/*.js
    areas/*.js        (ctx) => { helpers }, as packages/engine/service/areas/*.js
    domains/*.js      the front's domain modules (flat; the kernel's are domains/<name>/)
  test/               its UI tests (phase 3) and its engine tests, fixtures included
  views/, features/   the UI side, unchanged
```

- A front without `engine/` is UI-only. `scripts/source-tree.js` (`fronts()`, `frontEngineDirs()`)
  and the engine (`packages/engine/service/fronts.js` `installedFronts()`) read the same field, so the
  tooling and the runtime agree on the list; a test keeps them equal.
- **File names are unique across the kernel and every installed front** (the loader refuses a
  duplicate): a channel file keeps its name when it moves, so the manifest's grouping by file and
  [channels.md](../channels.md) are unchanged, and `test/service/<area>.test.js` keeps its name in
  `fronts/<id>/test/`.
- A front's engine test uses the service like the kernel's (`makeService` of
  `packages/engine/test/service/helpers.js`); `npm test -w fronts/<id>` runs the front's `test/` only.

## How the engine discovers it

- **Installed fronts**: the packages under `<appRoot>/fronts/*/` and `<appRoot>/node_modules/@multiagent/*/`
  whose `package.json` has `multiagent.front`, by id; a package found at both places (the checkout's
  workspace link, the packaged copies) counts once, `fronts/<dir>` first. The app root is
  `packages/engine/domains/workspace/app-root.js`'s.
- **The service takes a composition**: `createService({ host, fronts })` with `fronts` a list of front
  ids (an unknown one is an error) or absent (every installed front: what the tests' `makeService`,
  the contract suite and `npm run docs` get). `installed` replaces the scan (tests). The service
  reports `fronts`, and `app:info` carries them.
- **One load order**: `loadAreas` and `loadChannels` read the kernel's folder plus each served front's
  `engine/areas/` and `engine/channels/`, and load the files **sorted by file name across all
  folders** (`serviceFiles`): the order a single folder had, so the areas' creation order, the
  manifest's order and the contract hash (#339) do not depend on which package holds a file. Moving
  a file changes nothing for the shipped compositions.
- **Which fronts an engine serves**: the desktop app passes its `apps/desktop/composition.js` (the same
  list its page is generated from, `apps/desktop/host/main.js`); `multiagent-engine` serves the
  composition of the UI app it serves (`multiagent.ui` → `apps/web/composition.js`), narrowed by
  `--fronts <id,id>` (a one-front engine for tests, or an engine without a UI). The page stays the
  app's generated one: a screen whose front the engine does not serve gets 404s.
- **A one-front engine** serves the kernel's channels plus that front's; a channel of another front
  is unknown (`POST /api/<channel>` → 404 `Unknown channel`, and the manifest does not list it).
  `packages/engine/test/service/one-front-composition-590.test.js` checks it over HTTP on a
  temporary app root with two fronts.

## What stays in the engine kernel

Decided channel file by channel file from `node scripts/dep-map.js` (the caller list of each file):
a file **one front's screens alone call moves to that front; a file several fronts, the shell (the
kit's Home, Settings, the controls) or the engine itself needs stays in the kernel**. The kernel keeps,
whatever the fronts installed:

- the channel files `runs`, `projects`, `workflows`, `chain`, `chat`, `agents`, `skills`, `app`,
  `storage`, `sessions`, `releases`, `artifacts`, `pipelines`, `app-update`, `usage` (the kit's usage
  widget), `backlog`, `roadmap` (`roadmap:propose` with it), `product-owner`, `findings`, `notify`,
  `analytics` (Home's occupancy), `nightwatch` and `phonegates` (Settings), `voice` and
  `pasted-images` (the kit's voice and paste controls);
- every area whose helpers a kernel file calls plainly, every domain a kernel file requires, and what
  the engine needs to run a workflow. The four domains the engine's steps call stay whatever the
  front that shows their results: `run/supervision.js` → `supervisor`, `run/machine-steps.js` →
  `release-city`, `run/project-map-steps.js` → `project-map`, `run/refactor-proposals-steps.js` →
  `refactor-proposals-run`. **No step registry in phase 4**: a machine step's domain is kernel code,
  because a bundled workflow must run on any engine whatever fronts it ships (the Refactor proposals
  workflow on a build-only engine). A step registry the fronts contribute stays an open idea
  ([backlog.md](../backlog.md)) for the day a front ships a workflow of its own.
- the Oracle service (`ctx.oracleService`, `performAction`, `checkAction`, `restoreAction`,
  `inboxRules`, the findings wake): the kernel's run area, the seed runs, the Product Owner and the
  Night watch call it, so it is a kernel area; the `ai` front holds the `oracle:*` channels.

The mapping after the moves (the study's phase 4 row records the final one): `analyser` the channels
`architecture`, `refactor`, `seeds`, `diff`, the area `diff`, the domains `refactor-outcome`,
`seed-tool-issue`; `plan` the channel `discovery`, the area `discovery-automations`, the domain
`discovery-import`; `ai` the `oracle:*` channels; `build` the channels `local-preview`, `supervisor`,
the area `local-preview`, the domain `supervisor-watch`.

## Hooks: helpers across the kernel and the fronts

The areas share one `ctx`; a helper is read at call time. Since a front may not be served:

- a kernel file uses a helper **a front's area defines only as an optional call**
  (`ctx.stopLocalPreview?.(…)`, `ctx.discoveryIssueCards?.()`, `ctx.refactorPriorityOptions?.()`);
- a front's engine file uses **another front's** helper the same way (`ctx.supervisorRequest?.`);
- a front uses the kernel's helpers plainly.

`packages/engine/test/service/front-hooks-590.test.js` loads every area with a recording ctx and
checks the three rules over every `ctx.<name>` use of the kernel and the fronts (a name a channel
file sets on ctx itself, `ctx.x = …`, counts as that file's).

## The layering rule (`scripts/layers.js`)

A front's engine code is its own area `front-engine:<id>`: it may require `@multiagent/engine` (the
kernel: `service/common`, `service/schemas`, `engine/*`, `domains/*`) and `@multiagent/shared`, and
its own files, **never another front and never the UI**. The kernel never requires a front (no
exception). The front's UI (`front:<id>`) never requires its own engine code: it reaches it only
through `window.api`. `node scripts/dep-map.js` says which package holds each channel file and flags
a front's file called from outside the front.

## Where a new piece goes

- A channel one front's screens alone call: that front's `engine/channels/<area>.js`; anything the
  shell or two fronts call: `packages/engine/service/channels/`.
- A helper behind such a channel: the front's `engine/areas/`, unless a kernel file needs it plainly.
- A domain module: next to its only requirers; the kernel's `domains/<name>/` as soon as the engine,
  a kernel area or another front's code requires it.
