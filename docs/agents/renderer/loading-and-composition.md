# Loading and composition

How each page's file lists are generated (#152) and how the UI kit, the fronts and an app's page compose (#579).

- **How the files are loaded** (#152): each app's page (`apps/<app>/renderer/index.html`) holds its
  `<link>`/`<script>` lines between `<!-- generated:styles -->` / `<!-- generated:scripts -->`
  markers, written by `npm run docs` (`scripts/docs.js`) from the app's composition (below);
  `node scripts/docs.js --check` (CI) fails when they are stale. A new module or stylesheet is a new
  file plus `npm run docs`. Order, per list: the pure modules of `packages/shared/`, the files whose
  header comment has a `load: early` line in any layer (`api-http.js`, `view-registry.js`…,
  `style.css`), then the UI kit (`app.js`, its other root files, its `views/`), then each front of the
  composition in order (its `views/`), then the app's own page files, each group sorted by path
  (`x-part.js` sorts before `x.js`); paths are relative to the page (`../../../packages/ui-kit/app.js`).
  A file that needs another one as it loads (top-level code, not a function called later) says so in
  its header: `load: after views/duo/duo-issue.js (why)`, naming a file of its own package, else one
  of the UI kit (which loads before every front); a CSS file that overrides another's rules too
  (`load: after <file>.css`). The vendor files (`node_modules`) stay hand-kept outside the markers.
  The CSP and the packaged app are unchanged: the page still lists plain files.
- **Composition** (the reorganisation study, #558; phase 3, #579): a **front** is a workspace
  `fronts/<id>/` of `views/` folders, each calling `registerView` as today, plus its stylesheets, its
  `features/` and its `test/`; it registers its screens, its menu entries and its Home cards itself,
  and never names another front: what it offers the others (the project's page, the Projects
  screen and the project dialog, Workflows at a definition, Artifacts at a file, an agent's card) is
  an **action** it registers as it loads (`Actions.register`, `packages/ui-kit/actions.js`), which
  the kit and the other fronts call by name (`Actions.call`) and do without when no shipped front
  offers it (`Actions.has` hides a button, picks a fallback). An **app** (`apps/desktop`, the browser UI the engine serves from
  `apps/web`) lists the fronts it ships in one **composition file** (`<app>/composition.js`): a list
  of front ids, nothing else (`scripts/source-tree.js` `composition()` reads it; without the file an
  app ships every installed front). The page is generated from the composition (the lists above); a
  composition of one front builds that front alone, the default composition builds them all. The
  shell (the app frame, Home, Settings, Setup, Account, the run kernel and the controls) belongs to
  no front: it is the UI kit (`packages/ui-kit`) every composition starts from. The fronts: `analyser`
  (project, analytics, the project city), `build` (projects, backlog with the Roadmap and the Product
  Owner, releases, sessions, workflows, run, runchat, artifacts, supervisor), `plan` (inbox,
  discovery, arena, duo), `ai` (oracle, nightwatch, agents, skills, usage); a front's id is its menu
  group's (decision 7 of 2026-10-24). **Home's cards** (decision 5): Home is the shell's, its content
  the fronts' — each front registers a card with `HomeCards.register` (`packages/ui-kit/home-cards.js`)
  as its `<id>-home.js` loads: its stages of the flow strip with their counts and how a count opens
  the screen, its "What needs you" rows with their one button, its "Today" stats, a banner above the
  body (the Night watch's morning summary) and the clicks of the buttons it draws; a composition
  without a front shows none of its parts, and the Analytics tab hides without the analyser front.
- Several runs can be in progress: `state.runs` (run id → view: run, sessions, steps, log, gates) and
  `state.runId` (the one the Run screen shows; #412: the top bar shows no run); `state.run`, `state.sessions`… read the
  selected one. Route anything run-specific by `ev.run_id` and pass the `runId` to `stopRun`,
  `resolveApproval` and the terminals. There is no approval dialog: a gate is answered inside its run
  (the run chats, or the gate card on its Run screen, `renderRunGates`); elsewhere the Run badge, a
  dismissable toast, Home's "What needs you" list and a desktop notification say it waits.
  Nothing a run raises may cover the screen: dialogs are for the user's own clicks.
