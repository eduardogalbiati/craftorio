// UI screenshots for tests and PRs: opens one screen of the app with simulated data, saves a PNG and
// quits by itself. The caller only chooses what to show; it never writes its own Electron script.
//
//   npx electron scripts/screenshot.js --view <view> [options]      (or: npm run screenshot -- ...)
//
//   --view <name>      dashboard, sessions, projects, project, backlog, roadmap, artifacts, workflows, agents,
//                      skills, usage, analytics, oracle, nightwatch, settings, duo, arena, inbox,
//                      discovery, run-chat, run, home-empty, setup
//                      (default dashboard, the menu's Home (#255: the flow strip, "What needs you" and
//                      "Today" on demo data; its Analytics tab: --view analytics; home-empty: Home in a
//                      new workspace, no project and no run: how to start); projects: Settings › Projects; roadmap: the
//                      same as backlog --mode roadmap; the Supervisor's drawer: --view workflows --click
//                      "#btn-wf-supervisor"; a folded menu group: --click ".nav-group[data-group=workflows]
//                      .nav-group-title"; oracle: Settings with the Oracle's drawer open from its
//                      header button; Home shows its docked panel; nightwatch (#172): two
//                      replayed nights, src/night-watch-demo.js, also Home's morning
//                      summary; its turn-on form: --click "#nw-switch", the permissions' Save /
//                      Cancel: --click ".nw-perm-check[data-perm=skip]")
//   --oracle <state>   the Oracle's demo state (#171), on any view: empty | conversation | answering |
//                      error | paused | unavailable | unread | attachment | actions (#123: wake-up,
//                      cards, delegation, Night watch on; its form: --oracle conversation --click
//                      "#oracle-dock [data-oracle-night]") (unread: on a view other
//                      than the Dashboard, whose panel reads the answers; the Edit form of its
//                      memory: --click "#oracle-dock [data-oracle-memory]")
//   --tab <name>       settings: general | projects | agents | execution | phone | about; workflows: runs | definitions | builder | pipelines;
//                      analytics: usage | performance | run | occupancy | agents (performance: a demo git repository and a
//                      marker; run: AI Development runs, the newest shown; occupancy: 30 days of runs and nights;
//                      agents: four weeks of the Oracle's, the Product Owner's and the Supervisor chat's turns, #280)
//   --mode <name>      backlog: list | kanban | epics (roadmap: the Roadmap screen, #254)
//                      setup (#319): the first-run Setup on one step: agents (default) | try-it-safely |
//                      workflows | first-project (with --missing-clis: CLIs not installed)
//                      nightwatch (#278): self-healing (Self-healing on since yesterday: "Self-healing
//                      is on" in place of the end time, a finding of each detector, its days in the
//                      report; its switch: --view settings --tab execution)
//                      inbox (#256): empty (no card: the empty state; without it, demo cards, the
//                      newest with an image; a card open: --click "[data-testid=inbox-card]")
//                      discovery (#257): empty (no card: the empty board; without it, demo cards in
//                      every column, a bug and a hotfix in the fast lane, Define over its WIP limit;
//                      a card's panel: --click "[data-testid=discovery-card][data-type=prd]
//                      [data-testid=discovery-card-title]"; a narrow window: --size 820x900;
//                      #258: two committed cards in the Committed list (a committed card's panel:
//                      --click "[data-testid=discovery-committed-title]"); the commit dialog:
//                      --click "[data-testid=discovery-card][data-column=ready]
//                      [data-testid=discovery-card-title]" --click "[data-testid=discovery-commit]";
//                      #259: Shape's automation runs on a card (Running…), Ready's is off; a column's
//                      automation settings: --click "[data-testid=discovery-column-automation][data-column=shape]")
//   --run <mock|dir>   run-chat: a simulated software-development run (default) or a copy of a run folder
//   --workflow <file>  the workflow of the simulated run (default software-development.yaml)
//   --pipeline <file>  run: starts this saved pipeline instead (#135, e.g. develop-to-retrospective.yaml):
//                      its Run screen shows each stage's run
//   --then <file>      run: the workflow the run's chain starts when it finishes (#134), set in the
//                      Start panel; its Run screen offers "Save as pipeline" (--click "[data-chain=save-pipe-open]")
//   --input <k=v>      run: a workflow input of the Start panel (repeatable), e.g. mode=validated
//   --stop-at <step>   run: approves every gate but this step's and captures once it waits there
//                      (e.g. --input mode=validated --stop-at developer_check: the two-column gate
//                      with Run App and its Artifacts panel)
//   --no-demo-shots    artifacts, run: no demo screenshots (e.g. the gate's "No screenshots: …" state)
//   --keep-awake <s>   off | idle | active | error: the Keep awake switch (#162, Workflows header,
//                      Settings › Execution, the sidebar's moon-off item); active and error show
//                      demo states (2 runs, roadmap stage 3/6; a blocker that failed to start)
//   --missing-clis     usage, settings: Claude Code, Grok, gh and glab not installed, no speech-to-text
//                      CLI and gh without the "user" scope (the install commands and their play
//                      buttons, #147)
//   --live <state>     backlog: the demo roadmap's Live roadmap (#164): off (planned, the switch off) |
//                      on (running, simulated, last refill 03:12 +3 stages) | refilling (the Product
//                      Owner picking) | empty (done: nothing left under complexity 2) | budget (done:
//                      the daily budget reached); the banner shows on every --mode, the box on roadmap
//   --budget <state>   backlog: the spending budget (#206): paused (a daily budget of $60 reached: the
//                      roadmap paused before its next stage, with Raise for today / Resume anyway) |
//                      set (the same budget, not reached: the top bar's "$X / $60 today")
//   --roadmap <state>  backlog: more states of the roadmap card (#282, #284): states (the running run
//                      in a fix round, back in Develop after its review; the stage "Reports and
//                      health" disabled; the last stage's item simulated)
//   --po <state>       backlog: the Product Owner's drawer open with its live turn (#180): working (the
//                      activity line, timer, Stop and the last steps) | writing (the answer as it is
//                      written, its JSON block hidden) | stopped (an answer stopped by the owner) |
//                      failed (an error with what was written kept); Stop: --click "#po-log [data-live-stop]",
//                      the steps folded: --click "#po-log [data-live-steps]"; with --workflow <file>
//                      the drawer plans with that workflow (#235, e.g. ai-development-local-hero.yaml)
//   --agents-window <agent>  the Agents window (#263) opened from the view on oracle | product-owner |
//                      supervisor, and captured instead of the main window (--size sizes it: 700x800
//                      shows the rail collapsed; --click applies inside it, e.g. a rail item)
//   --fill <css>=<text>  types this text in the field (its value, then input and change, as a person
//                      leaving the field; repeatable, in order with the --click options), e.g. the
//                      runs' search box or a colour's hex field (#309). Not "--type": Chromium's own switch
//   --click <css>      clicks this element once the view is open (repeatable, in order)
//   --context <css>    then right-clicks this element (repeatable): e.g. an artifact's copy menu
//   --press <css>[@f]  then presses the primary button on this element (repeatable), at the part f of
//                      its width (0..1, default 0.5): a pointerdown / pointerup pair, for what listens
//                      to the pointer instead of a click, e.g. the timeline of a run's 3D view:
//                      --view run-chat --click "#rc-3d" --press "[data-testid=run3d-strip]@0.4"
//   --key <key>        then presses this key on the page (repeatable; a KeyboardEvent key such as
//                      ArrowLeft, or Space; "Shift+ArrowLeft" holds Shift), e.g. --key Space plays or
//                      pauses the 3D view's replay
//   --paste <css>      then pastes a demo screenshot into this prompt field (repeatable, #130): the
//                      chip row under it, saved in the scratch workspace like a real Ctrl+V; e.g. the
//                      Start drawer on issue-tracker: --view dashboard --workflow issue-tracker.yaml
//                      --click "#btn-quick-start" --paste "#in-request" --paste "#in-request"
//   --paste-big <css>  the same with a 12 MB image: the red "Image too large" chip
//                      (--workflow on a view other than run: the workflow the Start drawer opens on)
//   --theme <t>        dark | light | system: the theme Electron reports (prefers-color-scheme)
//   --size <WxH>       window content size (default 1400x900)
//   --ref <git ref>    captures the app as it is at this ref (e.g. main, for the "original" shots)
//   --out <dir>        output folder (default runs/screenshots); --name <file> without .png
//                      (run evidence: --out <run_dir>/evidence/<step>/round-<n> --name <issue>-<screen>-<state>)
//   --side <s>         original | modified: saves <name>.<side>.png, the two images of a pair
//                      (default original with --ref, modified with --caption, else no suffix)
//   --caption <text>   records this shot with its caption and commit in <run_dir>/evidence/manifest.json
//                      (src/evidence.js): needs --out <run_dir>/evidence/<step>/round-<n>
//   --wait <ms>        extra time before the capture (default 1500; run: 20000)
//   --timeout <ms>     hard limit: the app exits with code 1 after it (default 90000)
//
// Always a scratch workspace in the temp folder, removed at the end: simulated runs only
// (MULTIAGENT_AUTH=off, developer mode on), no sign-in, and HOME/USERPROFILE/APPDATA/GH_CONFIG_DIR
// point inside it, so the screens never show this machine's CLI sessions, usage or accounts. Demo
// data: a project `demo-app` with a few issues (the Backlog's sync never calls gh) and, for the
// views that list runs, one simulated run; backlog and duo also get an accepted Write & Review run
// on issue #12, whose Save to issue only previews (backlog:save-doc is forced to preview). The
// simulated run of artifacts, and the live run of `run --stop-at`, get demo screenshots (two
// rounds, an original/modified pair) for the Artifacts panel and the image viewer, e.g.
// `--view run --input mode=validated --stop-at developer_check --click ".run-gate-side [data-iv-thumb]"`
// opens the viewer (then `--click '.iv [data-iv-zoom="in"]'` zooms).
// One capture at a time on the machine (#199): it first takes the machine-wide screenshot slot
// (src/engine/machine-slot.js) and prints `screenshot: waiting for the screenshot slot` while
// another run's capture holds it; a slot held by a dead process is freed.
// Prints `screenshot: <path>` and exits 0, or exits 1 with the error.
// The Playwright E2E suite (features/support/app.js, #222) seeds its scratch workspaces with the same
// demo data: the helpers exported at the end (plain Node, no Electron needed).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const evidence = require('../src/evidence');
const machineSlot = require('../src/engine/machine-slot');

// #263: the agents the Agents window can open on (--agents-window)
const AGENTS_WINDOW_AGENTS = ['oracle', 'product-owner', 'supervisor'];
const VIEWS = {
  dashboard: {}, sessions: {}, projects: {}, project: {}, artifacts: {}, agents: {}, skills: {}, usage: {}, duo: {}, arena: {},
  // the Oracle's drawer (#171), opened from its header button on another screen (Settings)
  oracle: {},
  // Home in a new workspace (#255): no project and no run, how to start
  'home-empty': {},
  // the first-run Setup (#319), one mode per step of its stepper
  setup: { modes: ['agents', 'try-it-safely', 'workflows', 'first-project'] },
  // #254: the Roadmap screen; the same as --view backlog --mode roadmap (its tab until then)
  roadmap: {},
  // #260: the Releases screen (two shipped releases and the next one: #11, merged locally)
  releases: {},
  // the Night watch (#172): two replayed nights; self-healing (#278): Self-healing on since yesterday
  // ("Self-healing is on" in place of the end time, its days in the report)
  nightwatch: { modes: ['self-healing'] },
  // run: one AI Development run in depth against its workflow's runs (#228); occupancy: the 24/7 tab (#188)
  analytics: { tabs: ['usage', 'performance', 'run', 'occupancy', 'agents'] },
  backlog: { modes: ['list', 'kanban', 'roadmap', 'epics'] },
  // the Inbox (#256): demo discovery cards; empty: none (the empty state)
  inbox: { modes: ['empty'] },
  // the Discovery board (#257): demo cards in every column and the fast lane; empty: none
  discovery: { modes: ['empty'] },
  workflows: { tabs: ['runs', 'definitions', 'builder', 'pipelines'] },
  settings: { tabs: ['general', 'projects', 'agents', 'execution', 'phone', 'about'] },
  'run-chat': { run: true },
  run: { live: true },
};
const THEMES = ['dark', 'light', 'system'];
const KEEP_AWAKE = ['off', 'idle', 'active', 'error'];
const LIVE_STATES = ['off', 'on', 'refilling', 'empty', 'budget'];
const ROADMAP_STATES = ['states'];
const PO_STATES = ['working', 'writing', 'stopped', 'failed'];

function parseArgs(argv) {
  const a = { view: 'dashboard', tab: null, mode: null, run: 'mock', workflow: 'software-development.yaml', clicks: [], contexts: [], presses: [], keys: [], pastes: [], inputs: {}, stopAt: null, keepAwake: null, theme: null, size: [1400, 900], ref: null, out: null, name: null, side: null, caption: null, wait: null, timeout: 90000, demoShots: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    const ms = () => { const v = Number(next()); if (!Number.isFinite(v) || v < 0) throw new Error(`${k} takes milliseconds`); return v; };
    if (k === '--view') a.view = next();
    else if (k === '--tab') a.tab = next();
    else if (k === '--mode') a.mode = next();
    else if (k === '--run') a.run = next();
    else if (k === '--workflow') { a.workflow = next(); a.workflowGiven = true; }
    else if (k === '--then') a.then = next();
    else if (k === '--pipeline') a.pipeline = next();
    else if (k === '--click') a.clicks.push(next());
    else if (k === '--fill') {
      // the text follows the last "=": a selector may hold attribute values ([data-color="body"])
      const m = /^(.+)=(.*)$/s.exec(next());
      if (!m) throw new Error('--fill takes <css>=<text>');
      a.clicks.push({ fill: m[1], text: m[2] }); // in order with the clicks
    }
    else if (k === '--context') a.contexts.push(next());
    else if (k === '--press') {
      const m = /^(.*?)(?:@([\d.]+))?$/s.exec(next()), at = m[2] === undefined ? 0.5 : Number(m[2]);
      if (!m[1] || !(at >= 0 && at <= 1)) throw new Error('--press takes <css> or <css>@<0..1>');
      a.presses.push({ sel: m[1], at });
    } else if (k === '--key') {
      const parts = next().split('+'), key = parts.pop();
      if (!key || parts.some((p) => p !== 'Shift')) throw new Error('--key takes a key name, or Shift+<key>');
      a.keys.push({ key: key === 'Space' ? ' ' : key, shift: parts.length > 0 });
    }
    else if (k === '--paste') a.pastes.push({ sel: next(), big: false });
    else if (k === '--paste-big') a.pastes.push({ sel: next(), big: true });
    else if (k === '--stop-at') a.stopAt = next();
    else if (k === '--keep-awake') a.keepAwake = next();
    else if (k === '--missing-clis') a.missingClis = true;
    else if (k === '--input') {
      const m = /^([\w-]+)=(.*)$/s.exec(next());
      if (!m) throw new Error('--input takes key=value');
      a.inputs[m[1]] = m[2];
    }
    else if (k === '--theme') a.theme = next();
    else if (k === '--size') {
      const m = /^(\d+)x(\d+)$/i.exec(next());
      if (!m) throw new Error('--size takes WIDTHxHEIGHT, e.g. 1400x900');
      a.size = [+m[1], +m[2]];
    } else if (k === '--ref') a.ref = next();
    else if (k === '--out') a.out = next();
    else if (k === '--name') a.name = next();
    else if (k === '--caption') a.caption = next();
    else if (k === '--side') a.side = next();
    else if (k === '--wait') a.wait = ms();
    else if (k === '--timeout') a.timeout = ms();
    else if (k === '--no-demo-shots') a.demoShots = false;
    else if (k === '--oracle') a.oracle = next();
    else if (k === '--live') a.live = next();
    else if (k === '--budget') a.budget = next();
    else if (k === '--roadmap') a.roadmap = next();
    else if (k === '--release') a.release = next();
    else if (k === '--release-filter') a.releaseFilter = next();
    else if (k === '--po') a.po = next();
    else if (k === '--agents-window') a.agentsWindow = next();
    else throw new Error(`Unknown argument: ${k}`);
  }
  // #263: the Agents window on an agent, captured instead of the main window (--size sizes it too)
  if (a.agentsWindow && !AGENTS_WINDOW_AGENTS.includes(a.agentsWindow)) throw new Error(`--agents-window takes ${AGENTS_WINDOW_AGENTS.join(' | ')}`);
  let v = VIEWS[a.view];
  if (!v) throw new Error(`Unknown view: ${a.view}. Views: ${Object.keys(VIEWS).join(', ')}`);
  if (a.tab && !v.tabs?.includes(a.tab)) throw new Error(`--tab ${a.tab} does not apply to ${a.view}${v.tabs ? ` (tabs: ${v.tabs.join(', ')})` : ''}`);
  if (a.mode && !v.modes?.includes(a.mode)) throw new Error(`--mode ${a.mode} does not apply to ${a.view}${v.modes ? ` (modes: ${v.modes.join(', ')})` : ''}`);
  // #254: the Roadmap screen shows the Backlog's demo data in its roadmap mode
  if (a.view === 'roadmap') { Object.assign(a, { view: 'backlog', mode: 'roadmap' }); v = VIEWS.backlog; }
  if (a.theme && !THEMES.includes(a.theme)) throw new Error(`--theme takes ${THEMES.join(' | ')}`);
  if (a.keepAwake && !KEEP_AWAKE.includes(a.keepAwake)) throw new Error(`--keep-awake takes ${KEEP_AWAKE.join(' | ')}`);
  if (a.oracle && !ORACLE_STATES.includes(a.oracle)) throw new Error(`--oracle takes ${ORACLE_STATES.join(' | ')}`);
  if (a.live && !LIVE_STATES.includes(a.live)) throw new Error(`--live takes ${LIVE_STATES.join(' | ')}`);
  if (a.live && a.view !== 'backlog') throw new Error('--live applies to --view backlog');
  if (a.roadmap && !ROADMAP_STATES.includes(a.roadmap)) throw new Error(`--roadmap takes ${ROADMAP_STATES.join(' | ')}`);
  if (a.roadmap && a.view !== 'backlog') throw new Error('--roadmap applies to --view backlog');
  if (a.po && !PO_STATES.includes(a.po)) throw new Error(`--po takes ${PO_STATES.join(' | ')}`);
  if (a.po && a.view !== 'backlog') throw new Error('--po applies to --view backlog');
  if ((a.stopAt || Object.keys(a.inputs).length) && a.view !== 'run') throw new Error('--stop-at and --input apply to --view run');
  a.wait ??= v.live ? 20000 : 1500;
  a.name ??= [a.agentsWindow ? `agents-window-${a.agentsWindow}` : a.view, a.tab, a.mode, a.oracle && `oracle-${a.oracle}`, a.po && `po-${a.po}`, a.theme].filter(Boolean).join('-');
  if (!/^[\w.-]+$/.test(a.name)) throw new Error(`--name must be a plain file name: ${a.name}`);
  if (a.side && !SIDES.includes(a.side)) throw new Error(`--side takes ${SIDES.join(' | ')}`);
  if (a.caption && !(a.out && runOfRound(path.resolve(a.out)))) throw new Error('--caption needs --out <run_dir>/evidence/<step>/round-<n>');
  a.side ??= a.ref ? 'original' : a.caption ? 'modified' : null;
  return a;
}

const SIDES = ['original', 'modified'];
const fileName = (a) => `${a.name}${a.side ? `.${a.side}` : ''}.png`;
// <run_dir>/evidence/<step>/round-<n> → <run_dir>, else null
function runOfRound(dir) {
  const runDir = path.resolve(dir, '..', '..', '..');
  return evidence.roundOf(runDir, path.resolve(dir)) ? runDir : null;
}

/** Records a shot of a round folder (its caption and commit) in the run's evidence manifest; returns the manifest. */
function recordShot(dir, { file, caption, commit = null }) {
  const runDir = runOfRound(dir);
  if (!runDir) throw new Error(`Not a round folder of a run's evidence (<run_dir>/evidence/<step>/round-<n>): ${dir}`);
  const rel = path.relative(runDir, path.resolve(dir, path.basename(file))).split(path.sep).join('/');
  return evidence.writeManifest(runDir, { captions: { [rel]: { caption, commit } } });
}

// ---- simulated data ------------------------------------------------------------------------
const DEMO_REPO = 'https://github.com/example/demo-app';
// #124: an issue too big for one run (complexity 5, 12 tasks in two areas of the code): the Product
// Owner's plan answer proposes its split. #138: two epics (#14, #13), members with `epic`, #9 in none.
const BIG_TASKS = [
  'One app per workspace: a lock file in `src/workspace.js`', 'A second app opens read-only, with a banner', 'Run owners recorded in `src/runs.js`',
  'Only the owner resumes a run', 'Queue claims survive a restart (`src/store.js`)', 'Roadmap writes are atomic (`src/roadmap.js`)',
  'Resume dialog lists the steps (`src/renderer/run.js`)', 'Duplicate runs are flagged on the card (`src/renderer/backlog.js`)', 'Safe-write notice in the run header (`src/renderer/run.js`)',
  'Roadmap status derived from runs, shown in `src/renderer/backlog-roadmap.js`', 'Docs: run safety in the README', 'Tests',
];
const DEMO_ISSUES = [
  { number: 16, title: 'Keyboard focus is lost after closing a dialog', state: 'open', labels: [{ name: 'ui', color: '#c5def5' }, { name: 'complexity:2', color: '#ededed' }], body: '- [ ] Focus returns to the control that opened the dialog\n- [ ] Tests' },
  { number: 15, title: 'Run safety: one app per workspace, run owners, safe writes and a resume dialog that lists the steps', state: 'open', labels: [{ name: 'enhancement', color: '#a2eeef' }, { name: 'complexity:5', color: '#5319e7' }, { name: 'impact:5', color: '#d93f0b' }], body: ['## Context', '', 'Two apps on one workspace overwrite each other\'s runs and queue.', '', 'Decision (owner): one app per workspace; every write is safe.', '', '## Tasks', '', ...BIG_TASKS.map((t) => `- [ ] ${t}`)].join('\n') },
  { number: 14, title: 'Workspace safety and recovery', state: 'open', labels: [{ name: 'epic', color: '#5319e7' }], body: 'Runs, queues and roadmaps survive crashes, renames and a second app.' },
  { number: 13, title: 'Run reports', state: 'open', labels: [{ name: 'epic', color: '#5319e7' }], body: 'Everything a run produces, shared outside the app.' },
  { number: 12, title: 'Export a run report as Markdown', state: 'open', labels: [{ name: 'enhancement', color: '#a2eeef' }, { name: 'server', color: '#fbca04' }, { name: 'complexity:2', color: '#ededed' }, { name: 'impact:3', color: '#d93f0b' }], body: '- [x] Report layout\n- [ ] Export button\n- [ ] Tests' },
  { number: 11, title: 'Crash when the workspace folder is renamed', state: 'open', labels: [{ name: 'bug', color: '#d73a4a' }, { name: 'impact:5', color: '#d93f0b' }, { name: 'complexity:4', color: '#5319e7' }], body: 'Steps to reproduce: rename the folder while the app is open.' },
  { number: 10, title: 'Dark scrollbars in the terminal dock', state: 'open', labels: [{ name: 'ui', color: '#c5def5' }, { name: 'complexity:1', color: '#ededed' }, { name: 'impact:1', color: '#d93f0b' }], body: '' },
  { number: 9, title: 'Add a /health endpoint', state: 'open', labels: [{ name: 'enhancement', color: '#a2eeef' }, { name: 'server', color: '#fbca04' }, { name: 'complexity:3', color: '#ededed' }], body: '- [ ] Endpoint\n- [ ] Docs' },
  { number: 8, title: 'Document the workflow YAML', state: 'closed', labels: [{ name: 'docs', color: '#0075ca' }], body: '' },
  // #238: an archived idea (the Backlog's Archived chip)
  { number: 7, title: 'Splash screen with the workspace name on start', state: 'closed', labels: [{ name: 'archived', color: '#ededed' }, { name: 'ui', color: '#c5def5' }], body: 'An idea for later.' },
];

function demoBacklog(projectId, taskProgress) {
  const day = (n) => new Date(Date.UTC(2026, 0, 20 - n, 12)).toISOString();
  const issues = DEMO_ISSUES.map((i, n) => ({
    ...i, url: `${DEMO_REPO}/issues/${i.number}`, author: 'octocat', assignees: [],
    tasks: taskProgress(i.body), createdAt: day(n + 3), updatedAt: day(n),
    ...(DEMO_EPICS.find((e) => e.members.includes(i.number)) ? { epic: DEMO_EPICS.find((e) => e.members.includes(i.number)).id } : {}),
    ...(i.labels.some((l) => l.name === 'epic') ? { isEpic: true } : {}),
  }));
  const epics = DEMO_EPICS.map((e) => {
    const members = e.members.map((m) => issues.find((i) => i.number === m));
    const closed = members.filter((i) => i.state !== 'open').length;
    return { ...e, url: `${DEMO_REPO}/issues/${e.number}`, state: 'open', progress: { open: members.length - closed, closed, total: members.length } };
  });
  return { projectId, platform: 'github', repo: DEMO_REPO, syncedAt: new Date().toISOString(), issues, epics, epicsError: null };
}
const DEMO_EPICS = [
  { id: '#14', number: 14, kind: 'issue', title: 'Workspace safety and recovery', members: [11, 8] },
  { id: '#13', number: 13, kind: 'issue', title: 'Run reports', members: [12] },
];

// Demo GitHub Actions minutes (Usage): near the quota, as in the month that motivated the monitor.
function demoActionsUsage() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const item = (sku, quantity, price) => ({ date, product: 'actions', sku, unitType: 'minutes', quantity, grossAmount: quantity * price, netAmount: 0 });
  const { summarizeActionsUsage } = require('../src/actions-usage'); // only apps that have the channel ask
  return { login: 'demo-user', ...summarizeActionsUsage({ usageItems: [item('Actions Linux', 353, 0.008), item('Actions Windows', 560, 0.016), item('Actions macOS', 35, 0.08)] }, { includedMinutes: 2000, now }) };
}

// A local-hero run that merged #11 into the local main, not pushed yet (the Backlog's "Merged
// locally" column and Push bar): its summary and the project's cached push status. It started while
// GitHub could not be read (#168): its issue came from the last sync (the run list's "issue from cache").
function demoLocalMerge(ws, projectId) {
  const runId = '20260118-120000-demo0011';
  const commit = 'b7e4c2a91f0d3e5a6c8b9d0e1f2a3b4c5d6e7f80';
  fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
  fs.writeFileSync(path.join(ws.runs, runId, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'software-development-local-hero', project_id: projectId, status: 'success', mock: false,
    started_at: '2026-01-18T12:00:00.000Z', finished_at: '2026-01-18T12:40:00.000Z', duration_ms: 2400000,
    issues: [{
      number: 11, url: `${DEMO_REPO}/issues/11`, title: DEMO_ISSUES.find((x) => x.number === 11).title,
      updatedAt: '2026-01-18T09:30:00.000Z', fallback: 'cache', cachedAt: '2026-01-18T11:52:00.000Z',
    }], inputs: {}, sessions: [],
    local_merge: { branch: 'fix/workspace-rename', base: 'main', commit },
  }, null, 2));
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.local.json`), JSON.stringify({
    base: 'main', ahead: 2, behind: 0, fetchError: null, error: null, checkedAt: new Date().toISOString(), issues: [11],
    commits: [
      { sha: commit, subject: 'Survive a renamed workspace folder', issues: [11] },
      { sha: 'a1c3e5f7092b4d6f8a0c2e4f6b8d0f1a3c5e7b9d', subject: 'Test the rename with a scratch workspace', issues: [] },
    ],
  }, null, 2));
}

// The project's release history (#260, src/releases.js): two shipped releases of closed issues, each
// with its runs, cost, both suites' counts and notes (the last one fixed a regression before Ship);
// the next release is what demoLocalMerge merged locally (#11). The Backlog shows #8 as Released.
function demoReleases(ws, projectId) {
  const dir = path.join(ws.root, 'releases');
  fs.mkdirSync(dir, { recursive: true });
  const title = (n) => DEMO_ISSUES.find((x) => x.number === n).title;
  fs.writeFileSync(path.join(dir, `${projectId}.json`), JSON.stringify({
    releases: [
      {
        version: 'v0.8', tag: 'v0.8', date: '2025-12-19T17:30:00.000Z', commit: '4f2a9c1d7e3b5a6088c1d2e3f4a5b6c7d8e9f001', base: 'main',
        issues: [{ number: 7, title: title(7) }], runs: ['20251219-160000-demo0007', '20251219-171500-rel00008'], cost: 3.12,
        tests: { unit: { status: 'pass', passed: 388, failed: 0 }, e2e: { status: 'pass', passed: 31, failed: 0 } },
        notes: '# v0.8\n\n- #7 Splash screen with the workspace name on start\n\n2 runs, $3.12.', status: 'shipped',
      },
      {
        version: 'v0.9', tag: 'v0.9', date: '2026-01-10T18:00:00.000Z', commit: 'c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0', base: 'main',
        issues: [{ number: 8, title: title(8) }],
        runs: ['20260109-210000-demo0008', '20260110-170000-rel00009'], cost: 6.84,
        tests: { unit: { status: 'pass', passed: 412, failed: 0 }, e2e: { status: 'pass', passed: 37, failed: 0 } },
        notes: '# v0.9\n\n- #8 Document the workflow YAML\n\nThe release run found a regression in the workflow loader (the unit suite was red once the YAML examples merged) and fixed it before Ship.\n\n2 runs, $6.84.',
        status: 'shipped',
      },
    ],
    next: { notes: '' },
  }, null, 2));
  // #290: v0.9's release run needed a fix, so it wrote the release summary its row links
  const runDir = path.join(ws.runs, '20260110-170000-rel00009');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'release-summary.md'), [
    'Both suites are green after 2 unit rounds, 1 E2E round and 1 fix, in 38 minutes for US$ 1.12.',
    '',
    '## Timeline',
    '',
    '| # | Step | Result | Time | Cost |',
    '| --- | --- | --- | --- | --- |',
    '| 1 | Unit tests | red: 3 failures in test/workflows.test.js | 4 min | |',
    '| 2 | Fix the regression | 7b1e0c4: the workflow loader | 21 min | US$ 1.12 |',
    '| 3 | Unit tests | green (412) | 4 min | |',
    '| 4 | E2E scenarios | green (37) | 9 min | |',
    '',
    '## The fixes',
    '',
    '- **7b1e0c4** (src/engine/workflow.js, +6 −2): the loader read the YAML examples before #8 moved them. A regression of #7 by #8.',
    '',
    '## Before you ship',
    '',
    '- The diff to read: 1 file, 8 lines. Ship merges the fix, pushes the local main and tags it `v0.9`.',
    '- The version matches the tags (v0.8 before it).',
    '',
    '## Follow-ups',
    '',
    '- A unit test for the loader without the examples folder (the fix\'s test_notes).',
    '',
    'Nothing found against shipping.',
    '',
  ].join('\n'));
}

// #291 (--release checking | waiting | held | shipped): the release v0.10 of the demo roadmap's cut
// line, checked by a release run (unit tests twice around a fix, then E2E, then Ship): still checking
// (in E2E), waiting at its Ship gate (both live in "another app", studio-pc), held at Ship, or shipped
// (recorded in the history with stage 1's and tonight's done runs). Runs after demoRoadmap and
// demoReleases: the line takes the run.
function demoReleaseRun(ws, projectId, state) {
  if (!['checking', 'waiting', 'held', 'shipped'].includes(state)) throw new Error('--release takes checking | waiting | held | shipped');
  const runId = '20260120-233000-rel00010';
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  const groups = [{ name: 'Regression', steps: ['unit', 'e2e', 'suite_blocked'] }, { name: 'Fix', steps: ['fix', 'regression_failed'] }, { name: 'Ship', steps: ['ship', 'ship_failed'] }];
  const start = Date.now() - 50 * 6e4;
  const ev = (m, type, extra = {}) => JSON.stringify({ ts: new Date(start + m * 6e4).toISOString(), type, ...extra });
  const lines = [ev(0, 'workflow.started', { run_id: runId, workflow: 'release', file: 'release.yaml', project_id: projectId, mock: false, groups, inputs: { task: 'Check the release v0.10 of demo', version: 'v0.10' } })];
  // [step, start minute, end minute (null: still there)]
  const path_ = [['unit', 0, 8], ['fix', 8, 22], ['unit', 22, 30], ['e2e', 30, state === 'checking' ? null : 44], ...(state === 'checking' ? [] : [['ship', 44, state === 'waiting' ? null : 49]])];
  for (const [step, from, to] of path_) {
    lines.push(ev(from, 'step.started', { step_id: step, step_type: step === 'ship' ? 'human_approval' : step === 'fix' ? 'agent' : 'suite', ...(step === 'fix' ? { agent: 'developer' } : {}) }));
    if (step === 'fix') lines.push(ev(from + 0.1, 'session.opened', { session_id: 's-fix', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }));
    if (step === 'fix') lines.push(ev(to - 0.1, 'session.message_received', { session_id: 's-fix', step_id: 'fix', cost_usd: 2.46, session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }));
    if (step === 'ship' && to == null) lines.push(ev(from + 0.2, 'approval.requested', { step_id: 'ship', approval_id: 'ship-1', message: 'Ship v0.10?' }));
    if (to != null) lines.push(ev(to, 'step.finished', { step_id: step, duration_ms: (to - from) * 6e4 }));
  }
  const ended = state === 'held' || state === 'shipped';
  if (ended) lines.push(ev(50, 'workflow.finished', { status: state === 'held' ? 'cancelled' : 'success', summary: { cost_usd: 2.46, duration_ms: 50 * 6e4 } }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${lines.join('\n')}\n`);
  if (ended) {
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow: 'release', project_id: projectId, mock: false, groups, status: state === 'held' ? 'cancelled' : 'success', started_at: new Date(start).toISOString(),
      finished_at: new Date(start + 50 * 6e4).toISOString(), duration_ms: 50 * 6e4, inputs: { version: 'v0.10' }, sessions: [{ id: 's-fix', agent: 'developer', cost_usd: 2.46 }],
    }, null, 2));
  } else {
    // alive in another app (studio-pc) while the screenshot is taken
    const owner = { pid: 4242, host: 'studio-pc', role: 'run', started_at: new Date(start).toISOString() };
    const beat = () => { try { fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ ...owner, heartbeat_at: new Date().toISOString() })); } catch { clearInterval(timer); } };
    const timer = setInterval(beat, 5000);
    timer.unref?.();
    beat();
  }
  const file = path.join(ws.backlog, `${projectId}.roadmap.json`);
  const roadmap = JSON.parse(fs.readFileSync(file, 'utf8'));
  const line = roadmap.stages.find((s) => s.release?.name === 'v0.10');
  if (line) line.release = { name: 'v0.10', status: { checking: 'running', waiting: 'running' }[state] || state, runId };
  fs.writeFileSync(file, JSON.stringify(roadmap, null, 2));
  if (state !== 'shipped') return;
  const history = path.join(ws.root, 'releases', `${projectId}.json`);
  const h = JSON.parse(fs.readFileSync(history, 'utf8'));
  const done = roadmap.stages.flatMap((s) => s.items).filter((x) => x.status === 'done' && x.runId);
  h.releases.push({
    version: 'v0.10', tag: 'v0.10', date: new Date(start + 50 * 6e4).toISOString(), commit: '69a8158e2d4c6b8a0f1e3d5c7b9a1f3e5d7c9b0a', base: 'main',
    issues: done.map((x) => ({ number: x.number, title: x.title })), runs: [...done.map((x) => x.runId), '20260120-221500-demo0099', runId], cost: 41.37,
    tests: { unit: { status: 'pass', passed: 431, failed: 0 }, e2e: { status: 'pass', passed: 39, failed: 0 } }, notes: '# v0.10', status: 'shipped',
  });
  fs.writeFileSync(history, JSON.stringify(h, null, 2));
}

// The Product Owner registering an issue (#117): a short request with a screenshot, one question,
// the owner's answer, then a draft (long title, labels, Related, a close issue: #12), then a plan
// answer whose groups the demo roadmap already holds (#140), then a question about issues sent from
// the selection with a suggested extra issue (#169). Shown with `--click "#btn-bl-po"`;
// `--click "[data-po-act=create]"` previews the filing (po:file previews here).
function demoPoConversation(ws, projectId, po = null) {
  const at = (s) => new Date(Date.UTC(2026, 0, 20, 10, 0, s)).toISOString();
  const shot = path.join(ws.backlog, `${projectId}.po`, 'attachments', '1768903200000-run-report.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  fs.writeFileSync(shot, '');
  const body = [
    '## Context', '', 'The run report (#12) exports Markdown only (`src/report.js:41`, `exportMarkdown`). The owner shares reports with people who do not read Markdown.', '',
    'Decision (owner): a PDF export next to the Markdown one, same layout.', '',
    '## Tasks', '', '- [ ] **Export as PDF** in the run report menu, next to Markdown', '- [ ] The PDF keeps the report layout (headings, tables, cost)', '- [ ] Tests: a mock run exports a PDF with the report title', '',
    '## Triage', '', 'Impact 3 (sharing reports), complexity 2 (one renderer, estimate: `src/report.js`, `src/renderer/run.js`). Group with #12.', '',
    'Related: #12',
  ].join('\n');
  const big = DEMO_ISSUES.find((x) => x.number === 15);
  const poSplit = require('../src/po-split');
  const split = poSplit.normalizeSplit(poSplit.proposeSplit(big, { complexity: 5 }), big, { complexity: 5 });
  // #242: a long title and a long task line with inline Markdown, so the card must fit the drawer
  split.title = `${split.title || big.title}: keep every run's worktree, branch and logs safe when the app closes, crashes or the workspace moves to another disk`;
  if (split.tasks?.[0]) split.tasks[0] = { ...split.tasks[0], text: `**Recovery inbox per workspace**: list the runs left behind with \`events.jsonl\` and their branches, offer Resume or Discard, and link [the storage doc](https://example.com/storage) from the empty state; ${split.tasks[0].text}` };
  const messages = [
    { ts: at(0), role: 'user', mode: 'issue', text: 'export the report as pdf', attachments: [shot] },
    { ts: at(20), role: 'po', mode: 'issue', model: 'claude-sonnet-5', costUsd: 0.04, text: 'One question before I draft it:', issue: { reply: 'One question before I draft it:', questions: ['Should the PDF replace the Markdown export, or sit next to it?'], draft: null, duplicates: [], existingIssue: null, addition: '', assumptions: [] } },
    { ts: at(40), role: 'user', mode: 'issue', text: 'Next to it, same layout as the Markdown report.' },
    { ts: at(70), role: 'po', mode: 'issue', model: 'claude-sonnet-5', costUsd: 0.11, text: 'Drafted below. **#12** builds the report this exports: run them together.', issue: {
      reply: 'Drafted below.', questions: [],
      draft: { title: 'Export the run report as a PDF next to the Markdown export, keeping the same layout', body, labels: ['enhancement', 'impact:3', 'complexity:2', 'area:renderer'], related: [12], epic: '#13', epicTitle: 'Run reports' },
      duplicates: [{ number: 12, title: 'Export a run report as Markdown', state: 'open', relation: 'overlaps', reason: 'Same report and menu.' }],
      existingIssue: null, addition: '', assumptions: ['The PDF uses the same template as the Markdown export.'],
    } },
    // a plan answer (#140) against the demo roadmap: #12 + #9 is its stage 2, added from this answer
    // (In roadmap · Stage 2), #11 its done stage 1, planned before (Already in the roadmap), #10 + #8
    // only partly planned (Add the rest)
    { ts: at(90), role: 'user', mode: 'plan', text: 'Analyze the backlog and propose runs' },
    { ts: at(110), role: 'po', mode: 'plan', model: 'claude-opus-5-5', costUsd: 0.21, calibration: 2, cost: 1, text: 'Three runs: the rename crash first, then the server work together, then the small UI and docs fixes.', answer: {
      summary: 'Three runs.',
      cost: 1,
      estimateUsd: 27.4,
      estimateMissing: 1,
      groups: [
        { name: 'Rename crash', issues: [11], workflow: 'software-development-local-hero.yaml', inputs: { mode: 'auto' }, reason: 'It blocks the rest.', files: ['src/workspace.js'], stage: 1, complexity: 4, guessed: false, estimate: null, warnings: [] },
        { name: 'Reports and health', issues: [12, 9], workflow: 'software-development-local-hero.yaml', inputs: { mode: 'auto' }, reason: 'Both add a server route: one run avoids a merge conflict in src/server.', files: ['src/server.js'], stage: 2, complexity: 5, guessed: false, estimate: { minutes: 35, costUsd: 1.8, basis: '3 past runs' }, warnings: [],
          inputs: { mode: 'auto', unit_tests: 'run_existing', e2e_tests: 'write', screenshots: 'off' },
          costEstimate: { usd: 15.8, perPoint: 3.16, complexity: 5, runs: 12, estimated: false, basis: 'Median cost per step and complexity point of the last 12 successful runs of software-development-local-hero.yaml, × complexity 5 (test ×0.35, evidence ×0.5, developer_screenshots off).' },
          cost: { level: 1, name: 'Economy', inputs: { unit_tests: 'run_existing', e2e_tests: 'write', screenshots: 'off' }, grouping: 'Grouped to pay the run overhead once (same area or files).', notAdjustable: ['Agents: not adjustable (the workflow has no model or effort input)'] } },
        { name: 'Scrollbars and docs', issues: [10, 8], workflow: 'software-development.yaml', inputs: { mode: 'validated' }, reason: 'Two small fixes the owner can check in the app.', files: ['src/renderer/style.css'], stage: 3, complexity: 1, guessed: true, estimate: null, warnings: [] },
      ],
      conflicts: [], enrich: [],
      // #124: the big issue split along its two areas; #138: #15 placed in an epic, a new one for the UI fixes
      splits: [split],
      epics: {
        place: [{ issue: 15, epic: '#14', epicTitle: 'Workspace safety and recovery', reason: 'Run safety is this epic\'s theme.' }],
        create: [{ title: 'UI polish', goal: 'Small fixes to how the app looks and behaves with the keyboard, shipped together.', issues: [10, 16] }],
        merge: [],
        split: [],
      },
    } },
    // #169: issues sent from the Backlog's selection (#8 closed meanwhile: left out), a group with a
    // suggested extra issue (#10, unchecked until the owner keeps it); #189: planned for Quality, for this question only
    { ts: at(130), role: 'user', mode: 'plan', text: 'What is the best strategy to put these issues in the roadmap? Should any other open issue join them?', issues: [16, 8], calibration: 5, calibrationOverride: true },
    { ts: at(150), role: 'po', mode: 'plan', model: 'claude-opus-5-5', costUsd: 0.09, calibration: 5, calibrationOverride: true, text: 'One validated run for #16; **#10** touches the same styles and could join it. #8 is closed: left out.', answer: {
      summary: 'One run.',
      groups: [
        { name: 'Keyboard focus', issues: [16], workflow: 'software-development.yaml', inputs: { mode: 'validated' }, modeReason: 'A behaviour the owner can try in the app.', reason: 'A small UI fix on its own.', files: ['src/renderer/app.js'], stage: 1, complexity: 1, guessed: false, estimate: null, warnings: [],
          suggested: [{ issue: 10, reason: 'Same area (ui): the dialog and dock styles, one validated run.' }] },
      ],
      closed: [8],
      conflicts: [], enrich: [], splits: [], epics: { place: [], create: [], merge: [], split: [] },
    } },
    // #240: a request from the Oracle, mechanical (no model call, US$ 0): one card with its result
    { ts: at(160), role: 'request', text: 'Request from the Oracle: roadmap.add (The owner wants it in tonight\'s runs)', request: { from: 'oracle', kind: 'roadmap.add', ref: 'demo-request-1' }, reason: 'The owner wants it in tonight\'s runs', params: { issues: [16] } },
    { ts: at(161), role: 'po', text: 'Done: #16: added to the roadmap in stage 3 (software-development.yaml).', request: { from: 'oracle', kind: 'roadmap.add', ref: 'demo-request-1' }, costUsd: 0 },
  ];
  // --po stopped | failed (#180): the last answer stopped by the owner, or failed, with what was written kept
  const partial = 'Two runs so far: **#16** on its own (validated), then **#10** with the dock styles.\n\nI was checking whether #15 fits under complexity 5';
  const roadmapQ = { ts: at(170), role: 'user', mode: 'plan', text: 'Build a roadmap' };
  if (po === 'stopped') messages.push(roadmapQ, { ts: at(230), role: 'po', mode: 'plan', costUsd: 0, stopped: true, text: partial });
  if (po === 'failed') messages.push(roadmapQ, { ts: at(230), role: 'po', mode: 'plan', costUsd: 0, error: true, text: `Timed out after 900s\n\nWritten before the error:\n\n${partial}` });
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.po.jsonl`), messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
}

// --po working | writing (#180): po:ask never answers; its turn's progress is pushed to the window as
// the service would (chat:progress): a few steps done, one running, and with writing the answer's
// first paragraphs and its JSON block (which the drawer hides).
function demoPoTurn(sender, which, projectId) {
  const send = (phase, items = []) => sender.send('chat:progress', { chat: 'po', key: projectId, turnId: 'demo-turn', phase, items });
  send('start');
  const call = (id, name, input) => ({ kind: 'tool_call', id, name, input });
  const done = (id) => ({ kind: 'tool_result', id, is_error: false });
  send('items', [
    { kind: 'thinking' },
    call('t1', 'Read', { file_path: 'C:/projects/demo-app/src/roadmap.js' }), done('t1'),
    call('t2', 'Grep', { pattern: 'dispatchRoadmaps' }), done('t2'),
    call('t3', 'Read', { file_path: 'C:/projects/demo-app/src/server/routes.js' }), done('t3'),
    call('t4', 'Bash', { command: 'git log --oneline -20 -- src/server' }), done('t4'),
    call('t5', 'Bash', { command: 'gh issue view 15 --json body' }), done('t5'),
    call('t6', 'Bash', { command: 'gh issue list --state open --limit 100' }),
  ]);
  if (which === 'writing') {
    send('items', [
      done('t6'),
      { kind: 'text', text: '## Proposal\n\nThree runs: the **rename crash** (#11) first, since it blocks the rest; then **#12** and **#9** together: both add a server route, and one run avoids a merge conflict in `src/server`.' },
      { kind: 'text', text: 'Then the small UI fixes, **#10** and **#16**, in one validated run you can check in the app.' },
      { kind: 'text', text: '```json\n{ "summary": "Three runs.", "groups": [] }\n```' },
    ]);
  }
  return new Promise(() => {});
}

// A roadmap (Backlog › Roadmap, src/roadmap.js): stage 1 done (the local-hero run of #11), then a
// group of two issues (with the Product Owner's reasons, mode auto), then one UI issue (mode
// validated, no stage note); planned, so nothing starts. `--click "[data-rm-edit]"` opens the first
// planned item's Edit form (the workflow's inputs: select, checkbox, text).
// `live` (#164, --live): on / refilling run it simulated with the live switch on and a last refill;
// empty / budget end it done (every item done) with live still on and why refills stopped.
// `budget` (#206, --budget): set writes a daily budget of $60 (the top bar's "$X / $60 today"); paused
// also pauses the roadmap before its next stage, as the budget cap does.
// Cost (#205): the group of stage 2 was planned at Economy (grouped, existing tests only, no
// screenshots), so a test-batch item follows it; the UI issue of stage 3 at Generous.
// `more` (#282, #284, --roadmap states): the running run is in a fix round, the stage "Reports and
// health" is disabled and the last stage's item is simulated (the test-batch item has no estimate).
function demoRoadmap(ws, projectId, live = 'off', budget = null, more = null) {
  const states = more === 'states';
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const ended = live === 'empty' || live === 'budget';
  const refill = {
    on: { status: 'added', at: at(3, 12), added: 3, costUsd: 0.42, message: 'Added by the live roadmap at 03:12, Product Owner answer US$ 0.42. +3 stages.' },
    refilling: { status: 'refilling', at: at(3, 12), added: 0, costUsd: 0, message: 'The Product Owner is picking the next issues.' },
    empty: { status: 'empty', at: at(3, 12), added: 0, costUsd: 0.31, message: 'Live roadmap: nothing left under complexity 2. Start tries again.' },
    budget: { status: 'budget', at: at(3, 12), added: 0, costUsd: 0, message: 'Live roadmap: the daily budget of US$ 50.00 is reached (US$ 51.20 over the last 24 h): no more refills until it frees up.' },
  }[live];
  const liveFields = refill ? {
    state: ended ? 'done' : 'running', simulated: true, live: true, liveSince: at(1, 5), liveBy: 'owner', liveRefill: refill, liveRefills: refill.costUsd ? [{ at: refill.at, costUsd: refill.costUsd }] : [],
  } : {};
  const issue = (n) => {
    const i = DEMO_ISSUES.find((x) => x.number === n);
    return { number: n, url: `${DEMO_REPO}/issues/${n}`, title: i.title, body: i.body, knownPullRequests: [] };
  };
  const item = (id, workflow, numbers, extra = {}) => ({
    id, workflow, workflowName: workflow.replace(/\.yaml$/, ''), inputs: { language: 'js', mode: 'auto' }, mock: false,
    ...issue(numbers[0]), ...(numbers.length > 1 ? { issues: numbers.map(issue) } : {}), status: 'planned', runId: null, runs: [], error: null, ...extra,
    ...(ended ? { status: 'done' } : {}),
  });
  // without --live: a stage "Tonight" with a running, a waiting and a failed run (#194: the progress
  // rings) and a start refused for kept work that paused the roadmap (#196: Retry / Skip)
  const tonight = live === 'off' ? demoRoadmapRuns(ws, projectId, { fixRound: states }) : null;
  const refused = 'Could not start #14: #14 already has work from a cancelled run, 20260119-221000-demo0014 (3 commits on its branch). Choose with Retry on the roadmap item, Resume on the queue or Start on the issue.';
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.roadmap.json`), JSON.stringify({
    state: 'planned', simulated: false, error: null, pausedBy: null, updatedAt: new Date().toISOString(), ...liveFields,
    ...(tonight ? { state: 'paused', pausedBy: 'item-7', error: refused } : {}),
    ...(budget === 'paused' ? { state: 'paused', pausedBy: null, error: 'Budget reached: $58.40 of $60 today; next stage ≈ $24.60. Raise for today, or resume anyway.', budget: { period: 'day', spentUsd: 58.4, limitUsd: 60, nextUsd: 12.3, stageUsd: 24.6, at: new Date().toISOString() } } : {}),
    stages: [
      { id: 'stage-1', name: 'Stability first', note: 'The rename crash blocks the rest.', items: [item('item-1', 'software-development-local-hero.yaml', [11], { status: 'done', runId: '20260118-120000-demo0011', runs: ['20260118-120000-demo0011'] })] },
      ...(tonight ? [{ id: 'stage-tonight', name: 'Tonight', note: 'Three runs at once, then the refused start waits for your answer.', items: [
        item('item-4', 'software-development-local-hero.yaml', [16], { runId: tonight.running, runs: [tonight.running] }),
        item('item-5', 'software-development-local-hero.yaml', [15], { runId: tonight.waiting, runs: [tonight.waiting], inputs: { language: 'js', mode: 'validated' } }),
        item('item-6', 'software-development-local-hero.yaml', [13], { runId: tonight.failed, runs: [tonight.failed] }),
        item('item-7', 'software-development-local-hero.yaml', [14], { error: refused.replace(/^Could not start #14: /, '') }),
        // #215: done, real cost and time against the estimate (folded under the stage's "+2 done" chip, #267)
        item('item-9', 'software-development-local-hero.yaml', [9], { status: 'done', runId: tonight.better, runs: [tonight.better] }),
        item('item-10', 'software-development-local-hero.yaml', [12], { status: 'done', runId: tonight.worse, runs: [tonight.worse] }),
      ] }] : []),
      { id: 'stage-2', name: 'Reports and health', note: 'Both touch the server: one run, no conflict.', ...(states ? { disabled: true } : {}), items: [item('item-2', 'software-development-local-hero.yaml', [12, 9], {
        // #193: a reason of 500+ characters ends with "…" at the card's edge, whole when opened
        reason: 'Both add a server route and share the report formatter: one run avoids a merge conflict in src/server. Split from #136, whose tasks were spread over two stages: the report export needs the formatter that the health endpoint introduces, and both register their routes in src/server/routes.js, which every parallel run of this area edits; running them apart would conflict there and in the formatter tests. The health endpoint is small (complexity 3) and the export reuses its formatter, so together they stay under the group size of five issues per run and take one review instead of two.',
        modeReason: 'Auto: server code with no screen to try.',
        origin: new Date(Date.UTC(2026, 0, 20, 10, 1, 50)).toISOString(), // the demo Product Owner's plan answer
        inputs: { language: 'js', mode: 'auto', unit_tests: 'run_existing', e2e_tests: 'write', screenshots: 'off', ...(tonight ? { base_branch: 'release/2026-01-reports-and-health-with-a-very-long-branch-name-for-the-roadmap-card' } : {}) },
        cost: { level: 1, name: 'Economy', inputs: { unit_tests: 'run_existing', e2e_tests: 'write', screenshots: 'off' }, grouping: 'Grouped to pay the run overhead once (same area or files).', notAdjustable: ['Agents: not adjustable (the workflow has no model or effort input)'] },
      })] },
      // #260: a cut line after this stage ("Release here"): the last stage waits for the release v0.10
      { id: 'stage-2-tests', name: 'Test batch', note: '', release: { name: 'v0.10' }, items: [item('item-8', 'test-batch.yaml', [12, 9], {
        inputs: {}, reason: 'Economy: these issues ran with their existing tests only; one test writer session writes their unit tests together, after their stage.',
      })] },
      { id: 'stage-3', name: '', note: '', items: [item('item-3', 'software-development.yaml', [10], {
        ...(states ? { mock: true } : {}),
        inputs: { language: 'js', mode: 'validated', unit_tests: 'write_and_run', e2e_tests: 'write_and_run', screenshots: 'all' }, reason: 'A small UI fix on its own.', modeReason: 'Validated: a screen the owner can try in the app.',
        cost: { level: 5, name: 'Generous', inputs: { unit_tests: 'write_and_run', e2e_tests: 'write_and_run', screenshots: 'all' }, notAdjustable: [] },
      })] },
    ],
  }, null, 2));
  // (the settings file directly: this runs before the app's code is loaded, maybe from another --ref)
  if (budget) {
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(ws.settings, 'utf8')); } catch { /* the defaults */ }
    fs.writeFileSync(ws.settings, JSON.stringify({ ...settings, budget: { dailyUsd: 60, nightlyUsd: null, raised: null } }, null, 2));
  }
}

// The roadmap's runs (#194): two finished local-hero runs that give each step its typical time, then
// tonight's runs: one in code review, one waiting at the developer's gate (both live in "another app",
// studio-pc, whose heartbeat this script keeps fresh), one that failed in its tests. → their run ids.
// `fixRound` (--roadmap states): the running one is back in Develop after its review (round 2).
function demoRoadmapRuns(ws, projectId, { fixRound = false } = {}) {
  const file = 'software-development-local-hero.yaml';
  const workflow = 'software-development-local-hero';
  const groups = [
    { name: 'Develop', steps: ['develop', 'requirements_left_out', 'issue_not_done', 'developer_screenshots', 'developer_check'] },
    { name: 'Review', steps: ['code_review', 'human_review'] },
    { name: 'Validate', steps: ['test', 'suite', 'test_failed', 'build', 'build_failed', 'evidence', 'verify_change', 'verify_failed'] },
    { name: 'Merge', steps: ['resolve_merge', 'merge_blocked'] },
  ];
  const AGENT = {
    develop: ['developer', 'claude-opus-5-5'], code_review: ['reviewer', 'claude-sonnet-5-5'], test: ['test_writer', 'claude-sonnet-5'],
    build: ['builder', 'claude-sonnet-5'], evidence: ['evidence', 'claude-sonnet-5'], verify_change: ['verifier', 'claude-sonnet-5'],
  };
  const TYPE = { developer_check: 'human_approval', developer_screenshots: 'screenshots', suite: 'suite', human_review: 'human_approval' };
  // [step, minutes]: the usual path of a run that merged
  const PATH = [['develop', 38], ['developer_screenshots', 2], ['code_review', 11], ['human_review', 9], ['test', 18], ['suite', 4], ['build', 6], ['evidence', 7], ['verify_change', 5]];
  const min = 6e4;
  const ev = (ts, type, extra = {}) => JSON.stringify({ ts: new Date(ts).toISOString(), type, ...extra });
  // the events of the steps run so far; the last one `last`: running, waiting (a gate) or failed
  const events = (start, steps, last) => {
    const out = [ev(start, 'workflow.started', { workflow, file, project_id: projectId, mock: false, groups, inputs: { task: 'Demo roadmap run' } })];
    let t = start + 1e3;
    steps.forEach(([step, m], n) => {
      const [agent, model] = AGENT[step] || [];
      const sid = `s-${step}`;
      out.push(ev(t, 'step.started', { step_id: step, step_type: TYPE[step] || 'agent', ...(agent ? { agent } : {}) }));
      if (agent) out.push(ev(t + 500, 'session.opened', { session_id: sid, session: { agent, provider: 'claude', model } }));
      const end = n === steps.length - 1 && last;
      if (end === 'waiting') { out.push(ev(t + 1e3, 'approval.requested', { step_id: step, approval_id: 'gate-1' })); return; }
      if (end === 'running') return;
      if (agent) out.push(ev(t + m * min - 1e3, 'session.message_received', { session_id: sid, step_id: step, cost_usd: 0.4, duration_ms: m * min - 2e3, session: { agent, provider: 'claude', model } }));
      out.push(ev(t + m * min, 'step.finished', { step_id: step, duration_ms: m * min, ...(end === 'failed' ? { error: 'The suite failed: 3 tests in test/report.test.js' } : {}) }));
      t += m * min;
    });
    return { lines: out, end: t };
  };
  const write = (runId, lines, summary, owner) => {
    const dir = path.join(ws.runs, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), `${lines.join('\n')}\n`);
    if (summary) fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ run_id: runId, workflow, project_id: projectId, mock: false, groups, inputs: { task: 'Demo roadmap run' }, sessions: [], ...summary }, null, 2));
    if (owner) {
      const data = { pid: 4242, host: 'studio-pc', role: 'run', started_at: new Date(Date.now() - 2 * 3600e3).toISOString() };
      // stops once the scratch workspace is removed (the E2E suite seeds it from its own process)
      let timer = null;
      const beat = () => {
        try { fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ ...data, heartbeat_at: new Date().toISOString() })); } catch (e) { if (!timer) throw e; clearInterval(timer); }
      };
      beat();
      timer = setInterval(beat, 5000);
      timer.unref?.();
    }
  };
  const trail = (start, steps) => {
    let t = start + 1e3;
    return steps.map(([step, m]) => {
      const [agent, model] = AGENT[step] || [];
      const e = { step, visit: 1, type: TYPE[step] || 'agent', status: 'done', ts: new Date(t).toISOString(), cost: agent ? 0.4 : 0, durationMs: m * min, agents: agent ? [{ agent, provider: 'claude', model, cost: 0.4, durationMs: m * min }] : [] };
      t += m * min;
      return e;
    });
  };
  // what each agent step cost in the finished runs (#206: the estimates' median per step)
  const STEP_COST = { develop: 3.1, code_review: 0.7, test: 5.7, build: 0.2, evidence: 0.8, verify_change: 0.3 };
  const sessionsOf = (steps, k) => steps.filter(([step]) => AGENT[step]).map(([step]) => ({
    id: `s-${step}`, step_id: step, agent: AGENT[step][0], provider: 'claude', model: AGENT[step][1], cost_usd: Math.round(STEP_COST[step] * k * 100) / 100, tokens: { input: 1000, output: 2000, cache_read: 0, cache_write: 0 }, turns: 1,
  }));
  const now = Date.now();
  // a run that merged, `k` times the usual path's time and cost
  const merged = (start, k, runId) => {
    const steps = PATH.map(([s, m]) => [s, Math.round(m * k)]);
    const { lines, end } = events(start, steps, null);
    write(runId, [...lines, ev(end, 'workflow.finished', { status: 'success' })], {
      status: 'success', started_at: new Date(start).toISOString(), finished_at: new Date(end).toISOString(), duration_ms: end - start, progress: trail(start, steps), sessions: sessionsOf(steps, k),
    });
    return runId;
  };
  // the history: two runs that merged (a little slower, a little faster than the usual path)
  [[-3, 1.1], [-2, 0.9]].forEach(([day, k], n) => {
    const start = now + day * 864e5;
    merged(start, k, `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-210000-hist000${n + 1}`);
  });
  const stamp = (m) => new Date(now - m * min).toISOString().slice(0, 10).replace(/-/g, '');
  // #215: tonight's two runs that already merged: one cheaper and faster than estimated (green),
  // one far over (red)
  const better = merged(now - 300 * min, 0.6, `${stamp(300)}-190000-run00009`);
  const worse = merged(now - 420 * min, 1.8, `${stamp(420)}-170000-run00012`);
  const running = `${stamp(52)}-230500-run00016`;
  const waiting = `${stamp(95)}-221500-run00015`;
  const failed = `${stamp(190)}-204000-run00013`;
  // in code review for 6 minutes
  write(running, events(now - 52 * min, fixRound ? [['develop', 30], ['developer_screenshots', 2], ['code_review', 11], ['develop', 9]] : [['develop', 44], ['developer_screenshots', 2], ['code_review', 6]], 'running').lines, null, true);
  // at the developer's gate of the Validated mode (#282: the pipeline's "Your check" station)
  write(waiting, events(now - 95 * min, [['develop', 41], ['developer_screenshots', 2], ['developer_check', 0]], 'waiting').lines, null, true);
  // failed in its tests (a review → developer loop before)
  const failedSteps = [['develop', 35], ['developer_screenshots', 2], ['code_review', 10], ['develop', 14], ['code_review', 6], ['human_review', 7], ['test', 22]];
  const f = events(now - 190 * min, failedSteps, 'failed');
  const ft = trail(now - 190 * min, failedSteps).map((e, n, all) => ({ ...e, visit: all.slice(0, n).filter((x) => x.step === e.step).length + 1 }));
  ft[ft.length - 1].status = 'failed';
  write(failed, [...f.lines, ev(f.end, 'workflow.finished', { status: 'failed', error: 'The suite failed: 3 tests in test/report.test.js' })], {
    status: 'failed', error: 'The suite failed: 3 tests in test/report.test.js', started_at: new Date(now - 190 * min).toISOString(), finished_at: new Date(f.end).toISOString(), duration_ms: f.end - (now - 190 * min), progress: ft,
  });
  demoCostRuns(ws, projectId);
  demoArtifactRuns(ws, projectId);
  return { running, waiting, failed, better, worse };
}

// #233: two runs whose develop attempt was stopped at its timeout: `-run00233` with its estimated
// cost (priced from the attempt's model calls), `-old00233` recorded before costs were estimated
// (its cost "not recorded"). Days back, so tonight's roadmap runs stay as they are.
function demoCostRuns(ws, projectId) {
  const min = 6e4;
  const workflow = 'ai-development-local-hero';
  const file = `${workflow}.yaml`;
  const tokens = (input, output, cacheRead) => ({ input, output, cache_read: cacheRead, cache_write: 0, reasoning: 0 });
  const snap = (id, agent, model, extra) => ({
    id, agent, provider: 'claude', model, effort: null, parent_id: 'orchestrator', step_id: null, turns: 0, tokens: tokens(0, 0, 0), cost_usd: 0,
    status: 'idle', provider_session_id: `${id}-cli`, cwd: null, mode: 'persistent', ...extra,
  });
  const write = (runId, start, list, summary) => {
    const dir = path.join(ws.runs, runId);
    fs.mkdirSync(dir, { recursive: true });
    const at = (m) => new Date(start + m * min).toISOString();
    fs.writeFileSync(path.join(dir, 'events.jsonl'), `${list.map(([m, type, extra]) => JSON.stringify({ ts: at(m), type, ...extra })).join('\n')}\n`);
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow, project_id: projectId, mock: false, inputs: { task: 'Demo run with a timed-out attempt' }, started_at: at(0), ...summary,
    }, null, 2));
  };
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10).replace(/-/g, '');

  // estimated: attempt 1 killed at 30 min after 212 model calls, attempt 2 answered
  const start = Date.now() - 4 * 864e5;
  const dev = (extra) => snap('s1', 'developer', 'claude-opus-5-5', extra);
  const rev = (extra) => snap('s2', 'reviewer', 'claude-sonnet-5-5', extra);
  const devDone = dev({ turns: 1, tokens: tokens(9200, 41000, 2100000), cost_usd: 4.06, estimated_cost_usd: 1.84, status: 'idle', step_id: 'develop' });
  const revDone = rev({ turns: 1, tokens: tokens(2100, 3800, 240000), cost_usd: 0.52, status: 'idle', step_id: 'code_review' });
  write(`${day(4)}-201500-run00233`, start, [
    [0, 'workflow.started', { workflow, file, project_id: projectId, mock: false, inputs: { task: 'Demo run with a timed-out attempt' }, cost_accounting: 'per_turn' }],
    [0, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer' }],
    [0, 'session.opened', { session_id: 's1', session: dev() }],
    [0, 'session.message_sent', { session_id: 's1', turn: 1, step_id: 'develop', prompt: 'Implement the task', timeout_ms: 1800e3 }],
    [30, 'session.attempt_stopped', { session_id: 's1', turn: 1, step_id: 'develop', attempt: 1, error: 'Timed out after 1800s', usage: tokens(6100, 23000, 1500000), model_calls: 212, cost_usd: 1.84, estimated: true, session: dev({ tokens: tokens(6100, 23000, 1500000), cost_usd: 1.84, estimated_cost_usd: 1.84 }) }],
    [30, 'log', { level: 'error', message: '[developer] attempt 1/2 failed: Timed out after 1800s (US$ 1.84, estimated from 212 model calls)' }],
    [44, 'session.message_received', { session_id: 's1', turn: 1, step_id: 'develop', text: 'Done.', usage: tokens(3100, 18000, 600000), cost_usd: 2.22, duration_ms: 14 * min, active_ms: 14 * min, waiting_ms: 0, stalled_ms: 0, session: devDone }],
    [44, 'step.finished', { step_id: 'develop', visit: 1, duration_ms: 44 * min, output: {} }],
    [44, 'step.started', { step_id: 'code_review', visit: 1, step_type: 'agent', agent: 'reviewer' }],
    [44, 'session.opened', { session_id: 's2', session: rev() }],
    [45, 'session.message_sent', { session_id: 's2', turn: 1, step_id: 'code_review', prompt: 'Review the change' }],
    [53, 'session.message_received', { session_id: 's2', turn: 1, step_id: 'code_review', text: 'Approved.', usage: revDone.tokens, cost_usd: 0.52, duration_ms: 8 * min, active_ms: 8 * min, waiting_ms: 0, stalled_ms: 0, session: revDone }],
    [53, 'step.finished', { step_id: 'code_review', visit: 1, duration_ms: 9 * min, output: {} }],
    [53, 'workflow.finished', { status: 'success', error: null }],
  ], {
    status: 'success', finished_at: new Date(start + 53 * min).toISOString(), duration_ms: 53 * min, cost_usd: 4.58, cost_accounting: 'per_turn',
    tokens: tokens(11300, 44800, 2340000), sessions: [{ ...devDone, status: 'success' }, { ...revDone, status: 'success' }],
  });

  // recorded before #233: the stopped attempt left no cost at all
  const old = Date.now() - 5 * 864e5;
  const oldDev = (extra) => snap('s1', 'developer', 'claude-opus-5-5', { step_id: 'develop', ...extra });
  write(`${day(5)}-193000-old00233`, old, [
    [0, 'workflow.started', { workflow, file, project_id: projectId, mock: false, inputs: { task: 'Demo run with a timed-out attempt' } }],
    [0, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer' }],
    [0, 'session.opened', { session_id: 's1', session: oldDev() }],
    [1, 'session.message_sent', { session_id: 's1', turn: 1, step_id: 'develop', prompt: 'Implement the task', timeout_ms: 1800e3 }],
    [31, 'log', { level: 'error', message: '[developer] attempt 1/1 failed: Timed out after 1800s' }],
    [31, 'session.status', { session_id: 's1', status: 'error' }],
    [31, 'step.finished', { step_id: 'develop', visit: 1, duration_ms: 31 * min, output: { error: 'Timed out after 1800s' }, error: true }],
    [31, 'workflow.finished', { status: 'failed', error: 'Timed out after 1800s' }],
  ], {
    status: 'failed', error: 'Timed out after 1800s', finished_at: new Date(old + 31 * min).toISOString(), duration_ms: 31 * min, cost_usd: 0,
    tokens: tokens(0, 0, 0), sessions: [{ ...oldDev({ turns: 1 }), status: 'failed' }],
  });

  // #308: the developer's turn started 3 sub-agents: its usage is the whole turn, usage_main the main
  // conversation's, subagents their calls and tokens
  const sub = Date.now() - 6 * 864e5;
  const subDev = (extra) => snap('s1', 'developer', 'claude-opus-5-5', { step_id: 'develop', ...extra });
  const whole = tokens(4300, 52000, 2900000);
  const subDone = subDev({ turns: 1, tokens: whole, cost_usd: 5.12, status: 'idle' });
  write(`${day(6)}-204500-run00308`, sub, [
    [0, 'workflow.started', { workflow, file, project_id: projectId, mock: false, inputs: { task: 'Demo run whose developer started sub-agents' }, cost_accounting: 'per_turn' }],
    [0, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent', agent: 'developer' }],
    [0, 'session.opened', { session_id: 's1', session: subDev() }],
    [1, 'session.message_sent', { session_id: 's1', turn: 1, step_id: 'develop', prompt: 'Implement the task' }],
    [36, 'session.message_received', {
      session_id: 's1', turn: 1, step_id: 'develop', text: 'Done.', usage: whole, usage_main: tokens(3100, 41000, 2100000),
      subagents: { calls: 3, usage: tokens(1200, 11000, 800000) }, model_calls: 96, cost_usd: 5.12, duration_ms: 35 * min, active_ms: 35 * min, waiting_ms: 0, stalled_ms: 0, session: subDone,
    }],
    [36, 'step.finished', { step_id: 'develop', visit: 1, duration_ms: 36 * min, output: {} }],
    [36, 'workflow.finished', { status: 'success', error: null }],
  ], {
    status: 'success', finished_at: new Date(sub + 36 * min).toISOString(), duration_ms: 36 * min, cost_usd: 5.12, cost_accounting: 'per_turn',
    tokens: whole, sessions: [{ ...subDone, status: 'success' }],
  });
}

// A solid-colour PNG of w × h (a demo screenshot written without a window)
function solidPng(w, h, [r, g, b]) {
  const zlib = require('zlib');
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// The Inbox's discovery cards (#256): three ideas in the Inbox (the newest with an image, a CSV and
// two notes; one from another author; one with a long title, an audio file and a PDF) and one
// already in Triage (a target for Merge into…).
function demoDiscovery(ws, projectId) {
  const discovery = require('../src/discovery');
  const min = 60000;
  const card = (minsAgo, author, title, text, column) => {
    const c = discovery.createCard(ws.discovery, projectId, { title, text, author, column });
    // created in the past, so the list shows different ages
    const file = path.join(ws.discovery, projectId, 'cards', c.id, 'card.json');
    const at = new Date(Date.now() - minsAgo * min).toISOString();
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), created: at, updated: at }, null, 2));
    return c.id;
  };
  card(6 * 24 * 60, 'eduardo', 'Guided setup wizard', 'A first-run wizard that checks the CLIs and creates the first project.', 'triage');
  const call = card(2 * 24 * 60, 'support', 'Customer call: onboarding takes too long, people give up at the CLI install step before they ever start a run',
    'Three customers this week stopped at the CLI install step. The recording and the notes are attached.');
  discovery.addAttachment(ws.discovery, projectId, call, { name: 'call-2026-10-02.m4a', data: Buffer.from('demo audio') });
  discovery.addAttachment(ws.discovery, projectId, call, { name: 'call-notes.pdf', data: Buffer.from('%PDF-1.4 demo') });
  const dark = card(3 * 60, 'marina', 'Dark mode for the run log', 'The run log is hard to read at night: follow the app theme.');
  // a question waiting for the owner (Home's "What needs you", #255)
  discovery.appendConversation(ws.discovery, projectId, dark, { kind: 'question', author: 'grill-me', text: 'Should the log follow the app theme, or get its own switch?', ts: new Date(Date.now() - 40 * min).toISOString() });
  const csv = card(5, 'eduardo', 'Export the night\'s runs as CSV', [
    'The owner wants a spreadsheet of the night\'s runs: the morning summary is read on the phone, the numbers are compared in a spreadsheet.', '',
    '## Open questions', '', '- Which columns: cost, duration, status, issue?', '- One file per night or per week?',
  ].join('\n'));
  discovery.addAttachment(ws.discovery, projectId, csv, { name: 'runs-table.png', data: solidPng(320, 180, [124, 156, 255]) });
  discovery.addAttachment(ws.discovery, projectId, csv, { name: 'night-2026-10-03.csv', data: Buffer.from('run,status,cost_usd\n20261003-2210,success,1.84\n') });
  discovery.appendConversation(ws.discovery, projectId, csv, { kind: 'note', author: 'eduardo', text: 'Asked for it twice this month.', ts: new Date(Date.now() - 4 * min).toISOString() });
  discovery.appendConversation(ws.discovery, projectId, csv, { kind: 'note', author: 'marina', text: 'The Analytics screen already has the numbers: reuse its query.', ts: new Date(Date.now() - 2 * min).toISOString() });
}

// The Discovery board's cards (#257), next to demoDiscovery's one in Triage: cards in every column,
// a bug (Triage) and a hotfix (Define) in the fast lane, Define over a WIP limit of 2, and in Shape
// a PRD with tags, a clarity score, an estimate, acceptance criteria, an image, notes and a
// Write & Review result (a version and a thread entry).
function demoDiscoveryBoard(ws, projectId) {
  const discovery = require('../src/discovery');
  const dir = ws.discovery;
  const hour = 3600000;
  const columns = ['triage', 'shape', 'define', 'ready'];
  const card = (hoursAgo, to, { title, text = '', type = 'idea', author = 'eduardo', tags, clarity, gaps = [], estimate, acceptance, anyway }) => {
    const c = discovery.createCard(dir, projectId, { title, text, type, author, tags, column: 'triage' });
    // the score first: a move into Ready goes through the clarity bar (#166), `anyway` is the
    // owner's reason to move a card there below it
    discovery.updateCard(dir, projectId, c.id, { ...(acceptance ? { acceptance } : {}), ...(clarity ? { clarity: { score: clarity, gaps, by: 'Product Owner' } } : {}), ...(estimate ? { estimate } : {}) });
    // a bug or a hotfix takes the fast lane: Triage → Define
    const fast = ['bug', 'hotfix'].includes(type);
    for (const column of columns.slice(1, columns.indexOf(to) + 1)) {
      if (!(fast && column === 'shape')) discovery.moveCard(dir, projectId, c.id, column, { by: author, ...(column === 'ready' && anyway ? { force: true, reason: anyway } : {}) });
    }
    // created and moved in the past, so the cards show different ages
    const file = path.join(dir, projectId, 'cards', c.id, 'card.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = new Date(Date.now() - hoursAgo * hour).toISOString();
    fs.writeFileSync(file, JSON.stringify({ ...json, created: at, updated: at, history: json.history.map((h) => ({ ...h, ts: at })) }, null, 2));
    return c.id;
  };
  card(3, 'triage', { title: 'Crash when a run is stopped twice', type: 'bug', author: 'support', text: 'Stopping a run that is already stopping throws in the engine.' });
  const plugin = card(30, 'shape', { title: 'Plugin API for custom steps', type: 'rfc', author: 'marina', tags: ['engine'], text: 'Let a workflow call a step implemented by a workspace plugin.' });
  // #259: the Shape automation runs on this card (Running… on its face); Ready's is turned off
  discovery.markAutomation(dir, projectId, plugin, { runId: '20261011-2210-cd34', name: 'AI Arena → Write & Review', column: 'shape' });
  discovery.setColumnAutomation(dir, projectId, 'ready', { mode: 'off' });
  const report = card(52, 'shape', {
    title: 'Weekly cost report by project', type: 'prd', tags: ['cost', 'reports'], clarity: 62, estimate: { usd: 4.2, minutes: 35 },
    text: ['# Weekly cost report', '', 'A report of what each project spent in the week, sent on Monday morning.', '', '## Open questions', '', '- Per workflow too, or per project only?', '- In the app only, or by e-mail?'].join('\n'),
    acceptance: ['- [ ] One row per project with its runs, cost and tokens of the week', '- [ ] The report opens from the Dashboard on Monday'].join('\n'),
  });
  discovery.addAttachment(dir, projectId, report, { name: 'report-sketch.png', data: solidPng(320, 180, [124, 156, 255]) });
  discovery.appendConversation(dir, projectId, report, { kind: 'note', author: 'eduardo', text: 'The Usage screen has the weekly totals already.', ts: new Date(Date.now() - 50 * hour).toISOString() });
  discovery.recordResult(dir, projectId, report, {
    source: 'write-review', runId: '20261003-1012-ab12', by: 'eduardo',
    text: ['# Weekly cost report by project', '', '## Problem', '', 'The owner compares what each project spent week by week, and today adds the numbers up by hand from the Usage screen.', '',
      '## Goals', '', '- One report per week: runs, cost and tokens per project', '- Opened from the Dashboard on Monday morning', '',
      '## Non-goals', '', '- Budgets and alerts (the spending budget covers them)', '', '## Open questions', '', '- Per workflow too, or per project only?'].join('\n'),
  });
  card(20, 'define', { title: 'Keyboard shortcuts for the Roadmap', author: 'marina', tags: ['ux'], clarity: 88, estimate: { usd: 2.1, minutes: 20 }, text: 'Move an item between stages without the mouse.' });
  card(96, 'define', {
    title: 'Compare two runs side by side', type: 'prd', tags: ['reports'], clarity: 81, text: 'Two runs of the same workflow next to each other: cost, duration, steps.',
    gaps: ['Success metrics: how do we know the comparison is used?', 'Non-goals: is comparing runs of different workflows left out?'],
  });
  card(1, 'define', { title: 'Login loop after the token refresh', type: 'hotfix', author: 'support', text: 'The phone page asks to log in again after every refresh.' });
  // Ready (#166): two cards at or above the bar (the forecast: 19 h, 2 nights of 9 h) and one the
  // owner moved there below it, which the forecast leaves out
  card(140, 'ready', { title: 'Per-project spending budget', type: 'prd', tags: ['cost'], clarity: 94, estimate: { usd: 7.5, minutes: 540 }, text: 'A daily budget per project, next to the workspace one.',
    // #258: criteria in two parts, so the commit dialog proposes two issues
    acceptance: ['## Budget', '- [ ] A daily budget per project in Settings, next to the workspace one', '- [ ] A project that reached its budget starts no new run until the next day', '', '## Reporting', '- [ ] The Usage screen shows what each project spent against its budget', '- [ ] A notice when a project reaches 80% of its budget'].join('\n'),
  });
  card(70, 'ready', { title: 'Retry a failed step from the Run screen', tags: ['engine'], clarity: 90, estimate: { usd: 8.2, minutes: 600 }, text: 'A failed step is retried from its card, without restarting the run.' });
  card(26, 'ready', {
    title: 'Dark theme for the phone page', author: 'marina', tags: ['ux'], clarity: 58, estimate: { usd: 3, minutes: 240 }, text: 'The phone page follows the system theme.',
    gaps: ['Acceptance criteria: which screens of the phone page must follow the theme?', 'Scope: the login page too?'], anyway: 'Needed for Friday\'s demo; the open points are cosmetic.',
  });
  discovery.setWip(dir, projectId, 'define', 2);
}

// The committed cards (#258): one in delivery, filed as two issues of the demo backlog (#12 and #9),
// and one whose issue (#8) the release v0.9 shipped. The Discovery board lists them beside its
// columns with their delivery; the Backlog shows each of these issues with its card's badge.
function demoCommittedCards(ws, projectId) {
  const discovery = require('../src/discovery');
  const dir = ws.discovery;
  const committed = ({ title, text, acceptance, clarity, issues }) => {
    const c = discovery.createCard(dir, projectId, { title, text, type: 'prd', author: 'eduardo', column: 'triage' });
    discovery.updateCard(dir, projectId, c.id, { acceptance, clarity: { score: clarity, gaps: [], by: 'Product Owner' } });
    for (const column of ['shape', 'define', 'ready']) discovery.moveCard(dir, projectId, c.id, column, { by: 'eduardo' });
    discovery.markCommitted(dir, projectId, c.id, { issues, by: 'eduardo' });
    discovery.appendConversation(dir, projectId, c.id, { kind: 'commit', author: 'eduardo', issues, text: `Committed to the backlog: ${issues.map((n) => `#${n}`).join(', ')}.` });
    return c.id;
  };
  committed({
    title: 'Share a run outside the app', clarity: 92, issues: [12, 9],
    text: ['# Share a run outside the app', '', 'The report of a run leaves the app: exported as Markdown, and checked by a monitor through a health endpoint.'].join('\n'),
    acceptance: ['- [ ] The run report is exported as Markdown', '- [ ] A /health endpoint answers while the server runs'].join('\n'),
  });
  committed({
    title: 'A reference of the workflow YAML for new users', clarity: 88, issues: [8],
    text: 'New users read one page that lists every key of a workflow file, with an example.',
    acceptance: '- [ ] Every key of the workflow YAML is documented with an example',
  });
}

// #225, #185, #182: finished runs whose artifacts the E2E scenarios (features/artifacts.feature,
// features/image-viewer.feature) and the screenshots look at, days back so tonight's runs stay as
// they are: `-res00225` (a result summary, a screenshot, test results, a review report, process
// files and internal ones never listed), `-new00185` (a pair, a new element with no original, a
// screenshot that failed), `-img00182` (3 screens, the second a pair) and `-one00182` (one pair).
function demoArtifactRuns(ws, projectId) {
  const min = 6e4;
  const workflow = 'software-development-local-hero';
  const PNG = { before: solidPng(64, 40, [90, 98, 120]), after: solidPng(64, 40, [86, 140, 230]) };
  const run = (suffix, daysBack, task, files, shots = null) => {
    const start = Date.now() - daysBack * 864e5;
    const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-101500-${suffix}`;
    const dir = path.join(ws.runs, runId);
    fs.mkdirSync(dir, { recursive: true });
    const at = (m) => new Date(start + m * min).toISOString();
    const events = [
      { seq: 1, ts: at(0), type: 'workflow.started', run_id: runId, workflow, file: `${workflow}.yaml`, project_id: projectId, mock: false, inputs: { task } },
      { seq: 2, ts: at(42), type: 'workflow.finished', run_id: runId, status: 'success' },
    ];
    fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow, project_id: projectId, mock: false, inputs: { task }, status: 'success', started_at: at(0), finished_at: at(42), duration_ms: 42 * min, sessions: [],
    }, null, 2));
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    if (shots) {
      const captions = {};
      for (const [name, caption, sides] of shots.list) {
        for (const side of sides) {
          const rel = `evidence/${shots.step}/round-1/${name}.${side}.png`;
          fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
          fs.writeFileSync(path.join(dir, rel), side === 'original' ? PNG.before : PNG.after);
          captions[rel] = { caption };
        }
      }
      evidence.writeManifest(dir, { captions, base: 'main', branch: `feat/${suffix}`, commit: 'a1b2c3d4e5f6', baseCommit: '0f9e8d7c6b5a', ...(shots.capture ? { capture: shots.capture } : {}) });
    }
    return runId;
  };

  const result = [
    '# Result: software-development-local-hero',
    '',
    '- Status: **success**',
    '- Duration: 42 min',
    '',
    '## Issues',
    '',
    '- ✓ #225: the run\'s artifacts open on what it produced',
    '',
    '## Tests',
    '',
    '- `suite`: **pass** (412 passed, 0 failed)',
    '',
  ].join('\n');
  run('res00225', 6, 'Artifacts: what the run produced first', {
    'result.md': result,
    'test-results.json': JSON.stringify({ passed: 412, failed: 0 }, null, 2),
    'review-report.md': '# Review report\n\nApproved: the change follows the conventions.\n',
    'handoffs/developer-1.md': '# Handoff\n\n- Goal: artifacts by category.\n',
    'decisions.tsv': 'ts\tagent\tphase\tdecision\n2026-10-01T10:00:00Z\tdeveloper\timplement\tcategories from the path\n',
    'logs/develop-1.log': 'developer turn 1\n',
    'owner.json': JSON.stringify({ pid: 4242, host: 'studio-pc', role: 'run', heartbeat_at: new Date(Date.now() - 6 * 864e5).toISOString() }),
    'scratch/skills/demo-skill/SKILL.md': '# A seeded skill\n',
    'scratch/workflows/software-development.yaml': 'kind: Workflow\n',
  }, { step: 'evidence', list: [['225-dashboard-after', 'Dashboard after the change', ['modified']]] });

  run('new00185', 6, 'Export: a new export button', { 'result.md': '# Result: software-development-local-hero\n\n- Status: **success**\n' }, {
    step: 'developer_screenshots',
    list: [['185-export-dialog', 'Export dialog', ['original', 'modified']], ['185-export-button', 'New export button', ['modified']]],
    capture: {
      step: 'developer_screenshots', round: 1, taken: 3, screens: 2,
      message: '3 screenshots of 2 screens taken in round 1; 1 new element (no original); 1 error: 185-settings-page (modified): exit 1: Error: the window never loaded',
      new_elements: [{ name: '185-export-button', caption: 'New export button', selector: '[data-export-now]' }],
      errors: [{ name: '185-settings-page', caption: 'Settings page', side: 'modified', error: 'exit 1: Error: the window never loaded' }],
    },
  });

  run('img00182', 5, 'Image viewer: browse the run\'s screenshots', { 'result.md': '# Result: software-development-local-hero\n\n- Status: **success**\n' }, {
    step: 'evidence',
    list: [['182-a-dashboard', 'Dashboard', ['modified']], ['182-b-backlog', 'Backlog board', ['original', 'modified']], ['182-c-report', 'Run report', ['modified']]],
  });

  run('one00182', 5, 'Image viewer: one screenshot pair', { 'result.md': '# Result: software-development-local-hero\n\n- Status: **success**\n' }, {
    step: 'evidence', list: [['182-settings-page', 'Settings page', ['original', 'modified']]],
  });
}

// Settings › General › Dependency cache (#198): two complete entries of the demo project (sizes
// recorded in entry.json, as after an install), so the row shows a size and Clear is enabled.
function demoDepsCache(ws, projectId) {
  if (!ws.cache) return; // an app before the cache
  const day = 864e5;
  [['3f9a1c2e7b4d5a6c8e0f1a2b', 412 * 1024 ** 2, 1], ['8c2d4e6f0a1b3c5d7e9f1a2b', 1.3 * 1024 ** 3, 6]].forEach(([key, bytes, daysAgo]) => {
    const entry = path.join(ws.cache, 'deps', projectId, key);
    fs.mkdirSync(path.join(entry, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(entry, 'node_modules', '.package-lock.json'), '{}');
    const at = new Date(Date.now() - daysAgo * day).toISOString();
    fs.writeFileSync(path.join(entry, 'entry.json'), JSON.stringify({ key, lockfile: 'package-lock.json', manager: 'npm', sentinel: '.package-lock.json', bytes, created_at: at, last_used: at }));
  });
}

// Workflows › Definitions (#137): declared outputs on an edited default (modified, Restore
// default), two custom workflows (one in Monitor & Improve, one with an unknown category: Other)
// and three saved pipelines, connected with their mappings and conditions.
function demoPipelines(ws, appDir) {
  // seeded now (the app would at start) so the edited default counts as modified, not custom
  require(path.join(appDir, 'src', 'workflows')).seedWorkflows(path.join(appDir, 'workflows'), ws.workflows);
  const wf = (f) => path.join(ws.workflows, f);
  const tracker = fs.readFileSync(wf('issue-tracker.yaml'), 'utf8');
  fs.writeFileSync(wf('issue-tracker.yaml'), tracker.replace('description: "The issues created:', 'description: "The filed issues:'));
  // the retrospective declares `findings` (#134): the copies rename it instead of adding a second `outputs:`
  const retro = fs.readFileSync(wf('run-retrospective.yaml'), 'utf8');
  fs.writeFileSync(wf('weekly-digest.yaml'), retro.replace('name: run-retrospective', 'name: weekly-digest').replace(/description: .*/, 'description: Summarizes the week\'s retrospectives into one digest of what to change first.').replace('\n  findings:\n', '\n  digest:\n'));
  fs.writeFileSync(wf('release-notes.yaml'), retro.replace('name: run-retrospective', 'name: release-notes').replace('category: monitor', 'category: ops').replace(/description: .*/, 'description: Drafts the release notes of the merged pull requests since the last tag.').replace('\n  findings:\n', '\n  notes:\n'));
  // the bundled pipelines (#135), one of them edited (modified: Restore default), plus two of the
  // owner's: a valid one and one whose mapping names an output its workflow doesn't declare (refused)
  const dir = path.join(ws.root, 'pipelines');
  require(path.join(appDir, 'src', 'pipelines')).seedPipelines(path.join(appDir, 'pipelines'), dir);
  const rfc = path.join(dir, 'rfc-to-issues.yaml');
  if (fs.existsSync(rfc)) fs.writeFileSync(rfc, fs.readFileSync(rfc, 'utf8').replace('description: AI Arena writes an RFC', 'description: AI Arena writes our quarterly RFC'));
  fs.writeFileSync(path.join(dir, 'ship-and-learn.yaml'), [
    'name: Ship and learn',
    'description: Develops a task, then runs a retrospective on that run.',
    'stages:',
    '  - workflow: software-development.yaml',
    '  - workflow: run-retrospective.yaml',
    '    on: success',
    '    map: { run_id: "@run" }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'weekly-review.yaml'), [
    'name: Weekly review',
    'description: The latest retrospective feeds the weekly digest.',
    'category: monitor',
    'stages:',
    '  - workflow: run-retrospective.yaml',
    '  - workflow: weekly-digest.yaml',
    '    map: { focus: findings }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'issue-to-merge.yaml'), [
    'name: Issue to merge',
    'description: Files a triaged issue, then develops it up to the merge.',
    'category: build',
    'stages:',
    '  - workflow: issue-tracker.yaml',
    '  - workflow: software-development.yaml',
    '    map: { task: findings }',
    '',
  ].join('\n'));
}

// An accepted, simulated Write & Review run that enriched #12 (#103): the Backlog card shows
// "enriched", its chat (click the badge) has Save to issue, whose preview is all a screenshot does.
const DEMO_ENRICH_RUN = '20260119-090000-demo0012';
function demoEnrichRun(ws, projectId) {
  const dir = path.join(ws.runs, DEMO_ENRICH_RUN);
  const i = DEMO_ISSUES.find((x) => x.number === 12);
  const issues = [{ number: i.number, url: `${DEMO_REPO}/issues/${i.number}`, title: i.title }];
  const document = `# Export a run report as Markdown\n\n## Context\nOwners copy run results by hand into PR descriptions and notes.\n\n## Decisions\n- One Markdown file per run, written into the run folder.\n\n## Acceptance criteria\n- [ ] An Export button in Run Details writes report.md\n- [ ] The report lists steps, agents, costs and the final answer\n- [ ] Tests cover a run with a failed step\n`;
  const inputs = { prompt: `Enrich issue #12 into a complete issue.\nIssue #12: ${i.title}`, goal: 'A complete issue someone else can implement without asking.', document_skill: 'issue-writing', project_path: '', threshold: 8, max_rounds: 5, writer_provider: 'claude', writer_model: 'claude-opus-5-5', writer_effort: 'high', reviewer_provider: 'codex', reviewer_model: 'gpt-6-luna', reviewer_effort: 'high' };
  const at = (m) => new Date(Date.UTC(2026, 0, 19, 9, m)).toISOString();
  const base = { run_id: DEMO_ENRICH_RUN };
  const summary = { run_id: DEMO_ENRICH_RUN, workflow: 'writer-reviewer', project_id: projectId, issues, status: 'success', mock: true, started_at: at(0), finished_at: at(6), duration_ms: 360000, inputs, sessions: [] };
  const events = [
    { ...base, seq: 1, ts: at(0), type: 'workflow.started', workflow: 'writer-reviewer', file: 'writer-reviewer.yaml', project_id: projectId, issues, inputs, mock: true, run_dir: dir },
    { ...base, seq: 2, ts: at(1), type: 'step.started', step_id: 'write', visit: 1 },
    { ...base, seq: 3, ts: at(2), type: 'step.finished', step_id: 'write', output: { message: 'First complete version of the issue.', document } },
    { ...base, seq: 4, ts: at(3), type: 'step.finished', step_id: 'review', output: { score: 9, summary: 'Complete and verifiable.', notes: [] } },
    { ...base, seq: 5, ts: at(4), type: 'step.finished', step_id: 'signoff', output: { ready: true, summary: 'Ready: every part of the goal is met. Accept it.', checks: [{ item: 'Verifiable acceptance criteria', ok: true }] } },
    { ...base, seq: 6, ts: at(6), type: 'workflow.finished', status: 'success', summary },
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'document.md'), document);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
}

// Backlog Refresh (#161): a refresh run that started 25 h ago and updated #15 and #12 (their
// "refreshed" badge, within a day of its end), and the project's folder a git repository whose main
// got 14 commits since: the Backlog's banner says "Backlog refreshed 25 h ago · 14 merges since".
function demoBacklogRefresh(ws, folder, projectId) {
  const runId = '20260119-210000-demo0161';
  const dir = path.join(ws.runs, runId);
  const started = new Date(Date.now() - 25 * 3600e3).toISOString();
  const finished = new Date(Date.now() - 23.5 * 3600e3).toISOString();
  const inputs = { project_path: folder, git_platform: 'gh', base_branch: 'main', since: '24 hours ago', issues: [] };
  const summary = { run_id: runId, workflow: 'backlog-refresh', project_id: projectId, status: 'success', mock: false, started_at: started, finished_at: finished, duration_ms: 5400000, inputs, sessions: [] };
  const base = { run_id: runId };
  const events = [
    { ...base, seq: 1, ts: started, type: 'workflow.started', workflow: 'backlog-refresh', file: 'backlog-refresh.yaml', project_id: projectId, inputs, mock: false, run_dir: dir },
    { ...base, seq: 2, ts: finished, type: 'workflow.finished', status: 'success', summary },
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(dir, 'applied-safe.json'), JSON.stringify({
    repo: DEMO_REPO.replace('https://github.com/', ''), platform: 'gh', mode: 'safe', at: finished,
    results: [{ number: 15, result: 'updated', changes: ['body (3 edits)'] }, { number: 12, result: 'updated', changes: ['body (1 edit)', 'complexity:3 -> complexity:2'] }, { number: 9, result: 'skipped', reason: 'edited after the review' }],
  }, null, 2));
  fs.mkdirSync(folder, { recursive: true });
  const git = (args, at) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', ...args], {
    cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}) },
  }).trim();
  git(['init', '-q', '-b', 'main']);
  for (let n = 0; n < 15; n++) {
    fs.writeFileSync(path.join(folder, 'CHANGES.md'), `change ${n}\n`);
    git(['add', '-A']);
    // the first one before the refresh, 14 merges after it
    git(['commit', '-q', '-m', n ? `Merge change ${n} (#${60 + n})` : 'Initial commit'], new Date(Date.now() - (n ? 22 - n : 30) * 3600e3).toISOString());
  }
}

// Finished (not simulated) runs over the last 30 days with Claude, Codex and Grok sessions, so the
// Analytics screen has tokens per day, provider, model and project (mock runs are left out of it).
function demoAnalyticsRuns(ws, projectId) {
  const models = { claude: ['claude-opus-5-5', 'claude-sonnet-5'], codex: ['gpt-6-luna'], grok: ['grok-5-build'] };
  const statuses = ['success', 'success', 'success', 'failed', 'success', 'cancelled'];
  for (let i = 0; i < 18; i++) {
    const started = new Date(Date.now() - (i * 1.6 + 0.3) * 864e5);
    const runId = `${started.toISOString().slice(0, 10).replace(/-/g, '')}-1200${String(i).padStart(2, '0')}-demo${String(i).padStart(4, '0')}`;
    const sessions = ['claude', 'claude', 'codex', i % 3 ? null : 'grok'].filter(Boolean).map((provider, k) => {
      const scale = 1 + ((i * 7 + k * 3) % 5);
      return {
        id: `s${k}`, agent: ['developer', 'reviewer', 'tester', 'researcher'][k], provider, model: models[provider][k % models[provider].length], step_id: 'implement',
        opened_at: started.toISOString(), closed_at: new Date(started.getTime() + 6e5 * scale).toISOString(),
        duration_ms: 6e5 * scale, active_ms: 4e5 * scale, idle_ms: 2e5 * scale, turns: 3 * scale,
        tokens: { input: 4000 * scale, output: 9000 * scale, cache_read: 180000 * scale, cache_write: 12000 * scale, reasoning: 0 },
        cost_usd: provider === 'codex' ? 0 : +(0.35 * scale).toFixed(2), status: 'success', provider_session_id: `demo-${i}-${k}`,
      };
    });
    fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
    fs.writeFileSync(path.join(ws.runs, runId, 'summary.json'), JSON.stringify({
      run_id: runId, workflow: i % 2 ? 'software-development' : 'ai-arena', project_id: i % 4 ? projectId : null, status: statuses[i % statuses.length], mock: false,
      started_at: started.toISOString(), finished_at: new Date(started.getTime() + 36e5).toISOString(), duration_ms: 36e5,
      timing: { waiting_ms: 6e5 }, inputs: {}, sessions,
    }, null, 2));
  }
}

// A `type: workflow` step's runs (#174): a delivery run whose step ran software-development for three
// issues, two at a time (two succeeded, one failed), so the run lists show the children under it.
function demoChildRuns(ws, projectId) {
  const at = Date.now() - 2 * 36e5;
  const parentId = `${new Date(at).toISOString().slice(0, 10).replace(/-/g, '')}-100000-demopar0`;
  const items = [['#201', 'Add a /health endpoint', 'success'], ['#202', 'Rate-limit the login form with a very long title that is cut', 'failed'], ['#203', 'Show the build version in the footer', 'success']];
  const kids = items.map(([n, title, status], i) => ({ run_id: `${parentId.slice(0, 9)}10${i}000-demokid${i}`, step_id: 'develop', visit: 1, index: i, workflow: 'software-development', status, n, title }));
  const write = (runId, summary) => {
    fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
    fs.writeFileSync(path.join(ws.runs, runId, 'summary.json'), JSON.stringify({ run_id: runId, project_id: projectId, mock: false, sessions: [], ...summary }, null, 2));
  };
  write(parentId, {
    workflow: 'backlog-delivery', status: 'failed', started_at: new Date(at).toISOString(), finished_at: new Date(at + 54e5).toISOString(), duration_ms: 54e5,
    inputs: { task: 'Deliver the planned issues #201, #202 and #203' },
    child_runs: kids.map(({ n, title, ...k }) => k),
  });
  kids.forEach((k, i) => write(k.run_id, {
    workflow: 'software-development', status: k.status, started_at: new Date(at + (i + 1) * 6e4).toISOString(), finished_at: new Date(at + (i + 1) * 6e4 + 18e5).toISOString(), duration_ms: 18e5,
    inputs: { task: `${k.n} ${k.title}` },
    parent_run: { run_id: parentId, workflow: 'backlog-delivery', step_id: 'develop', index: i, depth: 1 },
  }));
}

// A long run history (#200): 40 finished runs, so the run lists load in pages (the "Loading more…" row
// at the end); the newest (id ending in -demohist00) saved 72 files over four steps, so its open row
// shows its artifacts grouped by step and "Show more" (--click '[data-run$="-demohist00"] .pr-row').
function demoRunHistory(ws, projectId) {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const statuses = ['success', 'success', 'failed', 'success', 'cancelled'];
  for (let i = 0; i < 40; i++) {
    const started = new Date(Date.now() - (i ? i * 0.7 * 864e5 : 36e5));
    const runId = `${started.toISOString().slice(0, 10).replace(/-/g, '')}-0900${String(i).padStart(2, '0')}-demohist${String(i).padStart(2, '0')}`;
    const dir = path.join(ws.runs, runId);
    fs.mkdirSync(dir, { recursive: true });
    const task = ['Add pagination to the API', 'Fix the flaky login test', 'Export the run report as PDF', 'Dark theme for the Backlog'][i % 4];
    const events = [{ seq: 1, ts: started.toISOString(), type: 'workflow.started', run_id: runId, workflow: 'software-development', project_id: projectId, inputs: { task } }];
    const files = !i ? [
      ...Array.from({ length: 12 }, (_, k) => [`handoffs/developer-${k + 1}.md`, 'develop', 'developer']),
      ...Array.from({ length: 8 }, (_, k) => [`reviews/review-${k + 1}.md`, 'review', 'reviewer']),
      ...Array.from({ length: 48 }, (_, k) => [`evidence/round-1/screen-${String(k + 1).padStart(2, '0')}.png`, 'evidence', 'tester']),
      ['documents/plan.md', 'plan', 'planner'], ['documents/test-report.md', 'test', 'tester'], ['decisions.tsv', null, null], ['notes.txt', null, null],
    ] : [['documents/summary.md', 'develop', 'developer']];
    for (const [rel, step, agent] of files) {
      const file = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, rel.endsWith('.png') ? png : `# ${path.basename(rel)}\n`);
      if (step) events.push({ seq: events.length + 1, ts: started.toISOString(), type: 'file.saved', run_id: runId, step_id: step, agent, path: file });
    }
    fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow: 'software-development', project_id: projectId, status: statuses[i % statuses.length], mock: false,
      started_at: started.toISOString(), finished_at: new Date(started.getTime() + 27e5).toISOString(), duration_ms: 27e5, inputs: { task }, sessions: [],
    }, null, 2));
  }
}

// Analytics › Repository performance (#159): the project's folder becomes a git repository and three
// nights of four parallel runs merge into it locally (one PR run whose `gh pr merge` failed), some
// through resolve_merge with the files their conflict named; the last night edits the shared files less,
// so a marker on its date shows the before/after difference.
function demoPerformanceRuns(ws, folder, projectId) {
  fs.mkdirSync(folder, { recursive: true });
  const git = (args, at) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', ...args], {
    cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}) },
  }).trim();
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.writeFileSync(path.join(folder, file), text); };
  const lines = (n, what) => Array.from({ length: n }, (_, i) => `${what} ${i + 1}`).join('\n') + '\n';
  git(['init', '-q', '-b', 'main']);
  write('src/renderer/index.html', lines(320, '<div>line'));
  write('README.md', `# demo-app\n\n<!-- generated:skills -->\n${lines(40, '| skill')}<!-- /generated:skills -->\n`);
  write('src/renderer/style.css', lines(900, '.rule'));
  write('src/service/manifest.js', lines(120, '// channel'));
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'Initial commit'], new Date(Date.now() - 20 * 864e5).toISOString());
  const initial = git(['rev-parse', 'HEAD']);
  const titles = ['Export the run report as PDF', 'Rename crash on Windows paths', 'Keyboard shortcuts for gates', 'Dark theme for the Backlog', 'Retry a failed step', 'Search in artifacts', 'Queue pause and resume', 'Cost per issue in Usage', 'Roadmap stage notes', 'Supervisor chat history', 'Workflow YAML validation', 'Per-project budgets'];
  const runs = [];
  [9, 5, 2].forEach((ago, night) => {
    const day = new Date(Date.now() - ago * 864e5);
    day.setHours(22, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const n = night * 4 + k;
      const start = new Date(day.getTime() + k * 25 * 6e4);
      const finish = new Date(start.getTime() + (95 + k * 20) * 6e4);
      const shared = night < 2 ? ['src/renderer/index.html', 'README.md', ...(k % 2 ? ['src/renderer/style.css'] : [])] : (k === 0 ? ['src/renderer/style.css'] : []);
      runs.push({
        n, start, finish, title: titles[n], pr: night === 1 && k === 3,
        files: [...shared, `src/features/${titles[n].toLowerCase().replace(/[^a-z]+/g, '-')}.js`, ...(k === 1 ? ['src/service/manifest.js'] : [])],
        conflict: night === 0 && k >= 2 ? 'resolve_merge' : night === 1 && k === 2 ? 'resolve_merge' : null,
        stage: `Stage ${night + 1}`,
      });
    }
  });
  const merged = []; // [finish, tip]
  for (const r of [...runs].sort((a, b) => a.finish - b.finish)) {
    const before = merged.filter(([f]) => f < r.start).pop();
    r.base = before ? before[1] : initial;
    for (const f of r.files) {
      fs.mkdirSync(path.dirname(path.join(folder, f)), { recursive: true });
      fs.appendFileSync(path.join(folder, f), `// ${r.title}\n`);
    }
    git(['add', '-A']);
    const message = r.pr ? `${r.title} (#${40 + r.n})` : `${r.title}\n\nCloses #${40 + r.n}`;
    git(['commit', '-q', '-m', message], new Date(r.finish.getTime() - 5 * 6e4).toISOString());
    r.tip = git(['rev-parse', 'HEAD']);
    merged.push([r.finish, r.tip]);
  }
  for (const r of runs) {
    const runId = `${r.start.toISOString().slice(0, 10).replace(/-/g, '')}-22${String(r.n).padStart(2, '0')}00-perf${String(r.n).padStart(4, '0')}`;
    const dir = path.join(ws.runs, runId);
    fs.mkdirSync(dir, { recursive: true });
    const workflow = r.pr ? 'software-development' : 'software-development-local-hero';
    const ev = (ts, type, extra = {}) => JSON.stringify({ ts: new Date(ts).toISOString(), type, ...extra });
    const t = r.start.getTime();
    const conflictText = `local merge: run/${runId} conflicts with the local main in ${r.files.filter((f) => !f.startsWith('src/features/')).join(', ')}. The branch was left as it was; resolve the conflict on it and merge again.`;
    fs.writeFileSync(path.join(dir, 'events.jsonl'), [
      ev(t, 'workflow.started', { workflow, project_id: projectId, inputs: { task: r.title } }),
      ev(t + 1e3, 'worktree.ready', { dir: path.join(folder, '..', runId), repo: folder, base: 'main', ref: 'main', commit: r.base, reused: false }),
      ev(t + 2e3, 'step.started', { step_id: 'implement' }),
      ...(r.conflict ? [ev(r.finish - 30 * 6e4, 'log', { level: 'warn', message: `merge failed: ${conflictText} → resolve_merge` }), ev(r.finish - 29 * 6e4, 'step.started', { step_id: 'resolve_merge' })] : []),
      ...(r.pr ? [ev(r.finish - 9e4, 'step.finished', { step_id: 'open_pr', output: { pr_number: 40 + r.n, pr_url: `https://github.com/demo/demo-app/pull/${40 + r.n}` } }), ev(r.finish - 6e4, 'action.executed', { command: `gh pr merge ${40 + r.n} --squash`, exit_code: 1, output: 'Pull request is not mergeable: the merge commit cannot be cleanly created (conflict in src/renderer/index.html).' }), ev(r.finish - 6e4 + 1, 'log', { level: 'error', message: 'gh pr merge failed: merge conflict in src/renderer/index.html' })] : []),
      ev(r.finish, 'workflow.finished', { status: 'success' }),
    ].join('\n') + '\n');
    const cost = +(r.conflict ? 4.2 + r.n * 0.1 : 2.1 + r.n * 0.15).toFixed(2);
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow, project_id: projectId, status: 'success', mock: false, inputs: { task: r.title },
      started_at: r.start.toISOString(), finished_at: r.finish.toISOString(), duration_ms: r.finish - r.start, timing: { waiting_ms: 0 },
      worktree: { repo: folder, base: 'main', ref: 'main', commit: r.base, branch: `run/${runId}` },
      local_merge: r.pr ? null : { branch: `run/${runId}`, base: 'main', commit: r.tip },
      sessions: [{ id: 's0', agent: 'developer', provider: 'claude', model: 'claude-opus-5-5', step_id: 'implement', opened_at: r.start.toISOString(), closed_at: r.finish.toISOString(), duration_ms: r.finish - r.start, tokens: { input: 9000, output: 30000, cache_read: 900000, cache_write: 40000, reasoning: 0 }, cost_usd: cost, status: 'success' }],
    }, null, 2));
    r.runId = runId;
  }
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.roadmap.json`), JSON.stringify({
    state: 'done', simulated: false, error: null, pausedBy: null, scope: null, updatedAt: new Date().toISOString(),
    stages: [0, 1, 2].map((s) => ({ id: `stage-${s + 1}`, name: `Night ${s + 1}`, items: runs.filter((r) => r.stage === `Stage ${s + 1}`).map((r) => ({ id: `item-${r.n}`, workflow: 'software-development-local-hero.yaml', status: 'done', number: 40 + r.n, title: r.title, issues: [{ number: 40 + r.n, title: r.title }], runId: r.runId, runs: [r.runId] })) })),
  }, null, 2));
  return new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
}

// --oracle <state> (#171): the Oracle's files in the scratch workspace for one state of its dock and
// drawer. `conversation` (and every state but empty, under it): a question with a pasted image, an
// answer with a table, a run link, an issue link, a run file, a long heading and its cost meta, and
// today's spend. error: a failed answer; paused: today's spend over a 2 USD daily budget;
// unavailable: the conversation owned by a live process on another machine (its heartbeat is
// kept fresh by the returned timer); unread: read before the last answer. answering (the answer
// held) and attachment (a draft image) are set up in the window by capture().
// actions (#123): after the conversation, a wake-up (a gate and a failed run, with Mute), its
// answer, an action card waiting for Do it, a delegation to the Product Owner with its cost, a card
// requested by an issue body (shown as such), a card done under the Night watch (with Undo) and one
// that failed; the Night watch on until the next 07:00, one run watched and one muted.
const ORACLE_STATES = ['empty', 'conversation', 'answering', 'error', 'paused', 'unavailable', 'unread', 'attachment', 'actions'];
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function demoOracle(ws, workspace, which, runId) {
  if (!which || which === 'empty') return null;
  const dir = ws.oracle || path.join(ws.root, 'oracle');
  fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'attachments', 'demo-run-report-1.png'), Buffer.from(PNG_1PX, 'base64'));
  const at = (minAgo) => new Date(Date.now() - minAgo * 60e3).toISOString();
  const run = runId || '20260119-221500-4f3a9c2e';
  const answer = [
    `Run ${run} (software-development, #12) stopped at **test_writer** after 3 fix rounds.`, '',
    '| Step | Agent | Duration | Tokens | Cost | Fix rounds | Refused commands |', '|---|---|---|---|---|---|---|',
    '| developer | Claude Code | 14 min | 812,400 | $1.92 | 1 | 0 |',
    '| code_review | Codex | 4 min | 120,300 | $0.31 | 0 | 0 |',
    '| test_writer | Claude Code | 22 min | 1,904,000 | $3.40 | 3 | 4 |', '',
    `### The test writer re-read the same file nine times before it ran out of fix rounds on the report export`, '',
    `It read \`src/report.js\` 9 times (\`${path.join(ws.runs, run, 'summary.json')}\`). Its four refused commands were \`npm test -- --watch\`; your notes on it are in \`C:\\Users\\owner\\notes\\night.md\`.`, '',
    'Proposal: file an issue to pass the developer\'s `test_notes` to the test writer. Nothing changes until you decide.',
  ].join('\n');
  const messages = [
    { id: 'm1', ts: at(30), role: 'user', text: 'Why did last night\'s run on #12 stop?', screen: 'Backlog, project demo-app', attachments: ['demo-run-report-1.png'] },
    { id: 'm2', ts: at(29), role: 'oracle', text: answer, model: 'claude-opus-5-5', costUsd: 0.4213, tokens: { input: 1200, output: 860, cache_read: 48000 }, contextTokens: 50060 },
  ];
  if (which === 'error') {
    messages.push({ id: 'm3', ts: at(2), role: 'user', text: 'And which runs failed this week?', screen: 'Dashboard' });
    messages.push({ id: 'm4', ts: at(1), role: 'system', error: true, text: 'The Oracle could not answer: claude exited with code 1 (the session could not be resumed).' });
  }
  if (which === 'actions') messages.push(...demoOracleActions(dir, at, run));
  fs.writeFileSync(path.join(dir, 'messages.jsonl'), `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'memory.md'), '- UI issues need UI acceptance criteria and screenshots.\n- Use the validated mode for UI changes.\n- Reply in Portuguese; everything for the product stays in English.\n');
  const spent = which === 'paused' ? 2.4 : 3.12;
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), `${JSON.stringify({ ts: at(29), provider: 'claude', model: 'claude-opus-5-5', tokens: { input: 1200, output: 860 }, costUsd: spent, sessionId: 'demo' })}\n`);
  // #244: the status shows the model and that the last turn resumed a warm session
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ sessionId: 'demo', model: 'claude-opus-5-5', contextTokens: 50060, lastTurnAt: at(29), lastTurnFresh: false }));
  if (which === 'paused') workspace.writeSettings(ws, { oracle: { dailyBudgetUsd: 2, compactAtTokens: 150000 } });
  fs.writeFileSync(path.join(dir, 'read.json'), JSON.stringify({ readAt: which === 'unread' ? at(31) : at(0) }));
  if (which !== 'unavailable') return null;
  const owner = { pid: 4242, host: 'studio-pc', role: 'oracle', started_at: at(90) };
  const beat = () => fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ ...owner, heartbeat_at: new Date().toISOString() }));
  beat();
  const timer = setInterval(beat, 5000);
  timer.unref?.();
  return timer;
}

// --oracle actions (#123): the messages after the conversation, and the Night watch, watch and mute files.
function demoOracleActions(dir, at, run) {
  const failedRun = '20260120-031200-9b1c7d40';
  const hhmm = (minAgo) => at(minAgo).slice(11, 19);
  const card = (id, minAgo, action) => ({ id, ts: at(minAgo), role: 'oracle', kind: 'action', text: action.title, action: { id, source: null, ...action } });
  const result = (actionId, minAgo, r) => ({ id: `${actionId}-r`, ts: at(minAgo), role: 'system', kind: 'action-result', actionId, ...r });
  const nightEnd = new Date();
  nightEnd.setHours(7, 0, 0, 0);
  if (nightEnd <= new Date()) nightEnd.setDate(nightEnd.getDate() + 1);
  fs.writeFileSync(path.join(dir, 'night-watch.json'), JSON.stringify({ on: true, until: nightEnd.toISOString(), startedAt: at(26) }));
  fs.writeFileSync(path.join(dir, 'wake.json'), JSON.stringify({ muted: ['20260119-180000-0aa11bb2'], watching: [{ runId: run, since: at(25) }, { projectId: 'demo-app', since: at(25) }] }));
  return [
    { id: 'n1', ts: at(26), role: 'system', kind: 'night-watch', until: nightEnd.toISOString(), text: 'Night watch on: the Oracle repairs what stops the roadmap without asking. Gates stay yours.' },
    { id: 'w1', ts: at(20), role: 'system', kind: 'wake', text: 'Woken by 2 run events.', runIds: [run, failedRun], events: [`${hhmm(21)} ${run}: gate review waits for the owner (Accept the report export?)`, `${hhmm(20)} ${failedRun}: finished failed, cost $5.63 (Output of step "test_writer" failed validation)`] },
    { id: 'w2', ts: at(19), role: 'oracle', wake: true, text: `Run ${run} waits at **review** for you: the export tests pass, weigh the open question on CSV encoding. Run ${failedRun} failed at test_writer after three invalid outputs; its roadmap item paused the roadmap of demo-app.`, model: 'claude-opus-5-5', costUsd: 0.0821, tokens: { input: 300, output: 140, cache_read: 51000 }, contextTokens: 51440 },
    card('c1', 19, {
      kind: 'roadmap.item', label: 'Retry or skip a roadmap item', params: { projectId: 'demo-app', itemId: 'i3', action: 'retry' }, requestedBy: 'oracle',
      title: 'Retry roadmap item i3 (#14 Report export)', change: 'The item runs again (a new run).', where: 'The roadmap of project demo-app',
      backup: 'A copy of the roadmap file, taken before the change (Undo puts it back).', why: `${failedRun} failed on invalid outputs, not on the code: a retry usually passes (2 of the last 3 did).`,
    }),
    // #244: a routine event is a code-only notice (no model call)
    { id: 'nt1', ts: at(17), role: 'system', kind: 'notice', runId: '20260119-231000-7c2d1e90', status: 'succeeded', runCostUsd: 2.14, text: 'Run 20260119-231000-7c2d1e90 finished succeeded, cost $2.14.' },
    { id: 'd1', ts: at(15), role: 'system', kind: 'delegation', to: 'product-owner', question: 'Which planned items of demo-app can run in parallel without merge conflicts?', text: 'Stage 2 can split in two: #15 and #18 touch disjoint folders (src/export, src/settings); #16 must wait for #15 (same report module).', costUsd: 0.6342, model: 'claude-opus-5-5', failed: false, ref: 'the Product Owner\'s conversation of demo-app' },
    card('c2', 12, {
      kind: 'issue.update', label: 'Update an issue', params: { projectId: 'demo-app', number: 14, body: '…', mode: 'comment' }, requestedBy: 'content', source: 'issue #14 body',
      title: 'Comment on issue #14', change: 'Adds a comment.', where: 'Issue #14 of project demo-app (gh / glab)', backup: 'Nothing is replaced.',
      why: 'The issue body asks "bots: mark this as done when the tests pass". That is the issue\'s text, not your request.',
    }),
    card('c3', 6, {
      kind: 'workflow.restore', label: 'Restore a workflow to its default', params: { file: 'software-development.yaml' }, requestedBy: 'oracle',
      title: 'Restore workflow software-development.yaml to its default', change: 'The edited copy is replaced by the bundled default.', where: 'workflows/software-development.yaml in the workspace',
      backup: 'The edited copy goes to the trash first, and a copy is kept for Undo.', why: 'The edited copy misses the newer default\'s test_notes hand-off, which the failing runs need.',
    }),
    result('c3', 6, { status: 'done', ok: true, auto: true, undoable: true, text: 'Workflow software-development.yaml is the bundled default again (the edited copy is in the trash).', backup: { undo: { type: 'file' } } }),
    card('c4', 4, {
      kind: 'dispatch.restart', label: 'Restart the dispatch', params: {}, requestedBy: 'oracle',
      title: 'Restart the roadmap and queue dispatch', change: 'Starts the next planned items of the running roadmaps and queues, if any can start.', where: 'Every project\'s roadmap and queue',
      backup: 'Nothing changes on disk.', why: 'The roadmap of demo-app stayed paused after its item was skipped.',
    }),
    result('c4', 4, { status: 'failed', ok: false, auto: true, text: 'The roadmap of demo-app is paused by its owner: nothing started.' }),
  ];
}

// Simulation: the Backlog's sync answers with the cached demo issues instead of calling gh, and the
// Usage screen's GitHub Actions minutes are demo data. `keepAwake`: a demo state of Keep awake, or null.
// `holdOracle`: the Oracle's answer never comes (--oracle answering). `po`: --po working | writing,
// the Product Owner's answer never comes and its live turn is demoPoTurn (#180).
function simulateChannels(ipcMain, keepAwake = null, missing = null, holdOracle = false, po = null) {
  const handle = ipcMain.handle.bind(ipcMain);
  const handlers = {};
  ipcMain.handle = (channel, fn) => {
    handlers[channel] = fn;
    if (missing && missing[channel]) return handle(channel, async (...a) => missing[channel](await fn(...a)));
    if (channel === 'usage:actions') return handle(channel, () => demoActionsUsage());
    if (channel === 'keepAwake:state' && keepAwake) return handle(channel, () => keepAwake);
    // the supervisor's report on the sessions (Analytics) uses the mock provider
    if (channel === 'analytics:analyze') return handle(channel, (e, arg) => fn(e, { ...arg, mock: true }));
    // the Backlog's Product Owner answers from its simulated self (no model call)
    if (channel === 'po:ask') return handle(channel, ['working', 'writing'].includes(po) ? (e, arg) => demoPoTurn(e.sender, po, arg?.projectId) : (e, arg) => fn(e, { ...arg, mock: true }));
    // and its filing of a drafted issue (#117) only previews: never calls gh/glab
    if (channel === 'po:file') return handle(channel, (e, arg) => fn(e, { ...arg, preview: true }));
    // a split (#124) and an epic (#138) applied from a plan answer only preview too
    if (channel === 'po:split' || channel === 'po:epic') return handle(channel, (e, arg) => fn(e, { ...arg, preview: true }));
    // the app-wide Supervisor chat too (#28)
    if (channel === 'supervisor:chat') return handle(channel, (e, arg) => fn(e, { ...arg, mock: true }));
    // and the Oracle (#171): simulated, or held for the answering state
    if (channel === 'oracle:ask') return handle(channel, holdOracle ? () => new Promise(() => {}) : (e, arg) => fn(e, { ...arg, mock: true }));
    if (channel === 'oracle:reset') return handle(channel, (e, arg) => fn(e, { ...arg, mock: true }));
    // Save to issue (Write & Review) only previews: never calls gh/glab
    if (channel === 'backlog:save-doc') return handle(channel, (e, arg) => fn(e, { ...arg, preview: true }));
    // Archive and Restore (#238) are only recorded in the demo backlog: never call gh/glab
    if (channel === 'backlog:archive' || channel === 'backlog:restore') return handle(channel, (e, arg) => fn(e, { ...arg, simulate: true }));
    // the diff viewer (#118): a demo branch, since a simulated run has no diff of its own
    if (channel === 'run:diff') return handle(channel, (e, arg) => demoRunDiff(arg?.commit));
    if (channel === 'run:diffFile') return handle(channel, (e, arg) => demoRunDiffFile(arg?.file));
    return handle(channel, channel === 'backlog:sync' ? (e, arg) => handlers['backlog:get'](e, { projectId: arg?.projectId }) : fn);
  };
}

// The diff viewer's demo branch (#118): an added, a modified (two hunks, a word-level change, a long
// line), a deleted, a renamed file, an image, a binary and a huge lockfile, over two commits;
// `--click "#btn-run-diff"` opens it on the Run screen, `--click '.dv [data-dv-mode="unified"]'`
// switches the layout, `--click '.dv [data-dv-expand]'` expands the first collapsed region.
const DEMO_DIFF_BEFORE = [
  "const path = require('path');", '', '// Reads the run\'s settings, with defaults.', 'function loadSettings(dir) {',
  "  const file = path.join(dir, 'settings.json');", '  return { retries: 2, ...readJson(file) };', '}', '',
  ...Array.from({ length: 24 }, (_, i) => `// helper ${i + 1}: unchanged context the viewer collapses`),
  'function retryDelay(attempt) {', '  return 1000 * attempt;', '}', '', 'module.exports = { loadSettings, retryDelay };',
].join('\n');
const DEMO_DIFF_AFTER = DEMO_DIFF_BEFORE
  .replace('  return { retries: 2, ...readJson(file) };', "  // a missing file is not an error: the defaults apply\n  return { retries: 3, timeoutMs: 30000, ...readJson(file, {}) };")
  .replace('  return 1000 * attempt;', '  return Math.min(30000, 1000 * 2 ** attempt); // exponential backoff, capped so a long outage never waits more than thirty seconds per attempt');
const demoSvg = (fill, text) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" rx="12" fill="${fill}"/><text x="120" y="80" font-family="sans-serif" font-size="22" fill="#fff" text-anchor="middle">${text}</text></svg>`).toString('base64')}`;
// A unified patch from hunks [oldStart, newStart, lines (' x' / '-x' / '+x')], counts computed.
function demoPatch(file, hunks) {
  const head = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n`;
  return head + hunks.map(([o, n, lines]) => {
    const old = lines.filter((l) => l[0] !== '+').length;
    const neu = lines.filter((l) => l[0] !== '-').length;
    return `@@ -${old ? o : 0},${old} +${neu ? n : 0},${neu} @@\n${lines.join('\n')}\n`;
  }).join('');
}
const helper = (i) => ` // helper ${i}: unchanged context the viewer collapses`;
function demoRunDiff(commit) {
  const commits = [
    { sha: 'b7e1c2d9a0f4b7e1c2d9a0f4b7e1c2d9a0f4b7e1', short: 'b7e1c2d', subject: 'Retry with exponential backoff (review fixes)', author: 'developer', date: '2026-10-01T10:42:00Z' },
    { sha: '4f0a9e3c1b2d4f0a9e3c1b2d4f0a9e3c1b2d4f0a', short: '4f0a9e3', subject: 'Settings: defaults when the file is missing', author: 'developer', date: '2026-10-01T09:15:00Z' },
  ];
  const file = (f) => ({ oldFile: null, added: 0, deleted: 0, binary: false, image: false, large: false, patch: null, ...f });
  const settings = file({ file: 'src/settings.js', status: 'modified', added: 3, deleted: 2, patch: demoPatch('src/settings.js', [
    [3, 3, [" // Reads the run's settings, with defaults.", ' function loadSettings(dir) {', "   const file = path.join(dir, 'settings.json');", '-  return { retries: 2, ...readJson(file) };', '+  // a missing file is not an error: the defaults apply', '+  return { retries: 3, timeoutMs: 30000, ...readJson(file, {}) };', ' }', ' ', helper(1)]],
    [31, 32, [helper(23), helper(24), ' function retryDelay(attempt) {', '-  return 1000 * attempt;', '+  return Math.min(30000, 1000 * 2 ** attempt); // exponential backoff, capped so a long outage never waits more than thirty seconds per attempt', ' }', ' ', ' module.exports = { loadSettings, retryDelay };']],
  ]) });
  const files = commit ? [settings] : [
    settings,
    file({ file: 'src/retry/policy.js', status: 'added', added: 4, patch: demoPatch('src/retry/policy.js', [[0, 1, ['+// The retry policy of a failed step.', '+const MAX_ATTEMPTS = 5;', '+', '+module.exports = { MAX_ATTEMPTS };']]]) }),
    file({ file: 'src/legacy-retry.js', status: 'deleted', deleted: 2, patch: demoPatch('src/legacy-retry.js', [[1, 0, ['-// Old fixed delay.', '-module.exports = () => 1000;']]]) }),
    file({ file: 'docs/retries.md', oldFile: 'docs/retry.md', status: 'renamed', added: 1, deleted: 1, patch: demoPatch('docs/retries.md', [[1, 1, [' # Retry', ' ', '-A failed step retries twice.', '+A failed step retries up to five times.']]]) }),
    file({ file: 'docs/images/backoff.svg', status: 'modified', added: null, deleted: null, binary: true, image: true }),
    file({ file: 'assets/icon.ico', status: 'added', added: null, deleted: null, binary: true }),
    file({ file: 'package-lock.json', status: 'modified', added: 1840, deleted: 1203, large: true }),
  ];
  return { simulated: false, unavailable: null, base: 'main', branch: 'retry-backoff-settings-defaults', mergeBase: 'c0ffee0', commits, commit: commit || null, files };
}
function demoRunDiffFile(file) {
  if (file === 'docs/images/backoff.svg') return { file, image: true, patch: null, before: demoSvg('#3b4a7a', 'fixed 1s'), after: demoSvg('#2f7a52', 'backoff 1s → 30s') };
  if (file === 'src/settings.js') return { file, image: false, patch: null, before: DEMO_DIFF_BEFORE, after: DEMO_DIFF_AFTER };
  if (file === 'package-lock.json') return { file, image: false, patch: demoPatch(file, [[1, 1, [' {', '-  "version": "1.0.0",', '+  "version": "1.1.0",', '   "lockfileVersion": 3,']]]), before: null, after: null };
  return { file, image: false, patch: null, before: null, after: null };
}

// --missing-clis: what the Usage and Settings channels answer when CLIs are missing, each built from
// the real answer (the install commands come from the app tree, absent at an older --ref).
function demoMissingClis(appDir, on) {
  if (!on) return null;
  let ic = null;
  try { ic = require(path.join(appDir, 'src', 'install-commands')); } catch { /* older ref */ }
  const ids = ['claude', 'gh', 'glab', 'grok'];
  return {
    'usage:actions': () => ({ error: 'GitHub billing usage needs the gh "user" scope', hint: 'gh auth refresh -s user', includedMinutes: 2000 }),
    'usage:get': (u) => ({ ...u, providers: (u.providers || []).map((p) => (ids.includes(p.id) ? { ...p, installed: false } : p)) }),
    'env:details': (tools) => tools.map((t) => (ids.includes(t.id)
      ? { id: t.id, name: t.name, path: null, connected: false, ...(ic ? { installCommand: ic.installCommand(t.id), installHint: ic.installHint(t.id) } : {}) }
      : t)),
    'audio:status': (st) => ({ ...st, path: null }),
  };
}

// --keep-awake active | error: what main answers (built by the app tree's src/keep-awake.js, absent
// at an older --ref); off and idle are the real state from the setting.
function demoKeepAwake(appDir, which) {
  if (which !== 'active' && which !== 'error') return null;
  let ka;
  try { ka = require(path.join(appDir, 'src', 'keep-awake')); } catch { return null; }
  const work = ka.workToDo({ runs: [{ waiting: false }, { waiting: true }], roadmaps: [{ projectId: 'demo-app', state: 'running', stage: 3, of: 6 }] });
  const s = which === 'active'
    ? { available: true, enabled: true, holding: true, work, error: null }
    : { available: true, enabled: true, holding: false, work, error: 'Could not keep the computer awake: the system refused the request (demo).' };
  return { ...s, label: ka.keepAwakeLabel(s) };
}

// The commit checked out in the repository (the "modified" shots), or null.
function gitHead(repo) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

// The app tree at a git ref, for the "original" screenshots: an index of its own (the repository's index
// and working tree are untouched) and the current node_modules through a junction.
function extractRef(repo, ref, dest) {
  const git = (args, env = {}) => execFileSync('git', args, { cwd: repo, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const env = { GIT_INDEX_FILE: path.join(path.dirname(dest), 'ref.index') };
  git(['read-tree', sha], env);
  git(['checkout-index', '-a', `--prefix=${dest.replace(/\\/g, '/')}/`], env);
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dest, 'node_modules'), 'junction');
  return sha;
}

// Removes the scratch folder. The node_modules junction goes first, on its own: if it can't be
// removed, the folder is left in the temp dir rather than risk deleting through it.
function removeScratch(dir) {
  const link = path.join(dir, 'app', 'node_modules');
  try {
    if (fs.lstatSync(link, { throwIfNoEntry: false })) fs.unlinkSync(link);
  } catch {
    return;
  }
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp folder */ }
}

/** The usage: this file's header comment, without the comment markers. */
function usage() {
  const lines = fs.readFileSync(__filename, 'utf8').split(/\r?\n/);
  const end = lines.findIndex((l) => !l.startsWith('//'));
  return lines.slice(0, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
}

// ---- the capture (Electron main process) -----------------------------------------------------
function main() {
  const { app, nativeTheme, ipcMain } = require('electron');
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    app.exit(0);
    return;
  }
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`screenshot: ${e.message}`);
    app.exit(2);
    return;
  }
  const repo = path.join(__dirname, '..');
  // one Electron screenshot at a time on the machine (#199): wait for the slot (inherited when the
  // engine's screenshots step started this process), freed at exit or when this process dies
  let slot;
  try {
    slot = machineSlot.acquireSlotSync(machineSlot.SCREENSHOT_SLOT, {
      holder: `npm run screenshot (${args.view})`,
      onWait: (h) => console.log(`screenshot: waiting for the screenshot slot (held by pid ${h?.pid ?? '?'}${h?.holder ? `, ${h.holder}` : ''})`),
    });
  } catch (e) {
    console.error(`screenshot: ${e.message}`);
    app.exit(1);
    return;
  }
  process.on('exit', () => slot.release());
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-shot-'));
  const cleanup = () => { removeScratch(scratch); slot.release(); };
  const fail = (e) => {
    console.error(`screenshot: ${e?.message || e}`);
    cleanup();
    app.exit(1);
  };
  // The hard limit holds whatever happens below (a view that never loads, a hung run).
  setTimeout(() => fail(new Error(`timed out after ${args.timeout} ms`)), args.timeout);
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);

  const home = path.join(scratch, 'home');
  const wsDir = path.join(scratch, 'workspace');
  for (const d of [home, path.join(home, 'AppData'), path.join(scratch, 'user-data')]) fs.mkdirSync(d, { recursive: true });
  Object.assign(process.env, {
    MULTIAGENT_AUTH: 'off',
    MULTIAGENT_WORKSPACE: wsDir,
    MULTIAGENT_MOCK_DELAY_SCALE: '0.02',
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
    GH_CONFIG_DIR: path.join(home, 'gh'), GLAB_CONFIG_DIR: path.join(home, 'glab'),
  });
  app.setPath('userData', path.join(scratch, 'user-data'));
  if (args.theme) nativeTheme.themeSource = args.theme;

  let appDir = repo;
  let sha = null; // the commit captured with --ref (the manifest records it)
  if (args.ref) {
    appDir = path.join(scratch, 'app');
    sha = extractRef(repo, args.ref, appDir);
    console.log(`app at ${args.ref} (${sha.slice(0, 12)})`);
  }
  const src = (m) => require(path.join(appDir, 'src', m));
  const workspace = src('workspace');
  const ws = workspace.setupWorkspace(wsDir, { persist: false });

  const setup = (async () => {
    // the repository is set afterwards: createProject would clone it
    const projects = src('projects');
    const created = await projects.createProject(ws.projects, { name: 'demo-app', description: 'Sample project (simulated data)' });
    const project = projects.updateProject(ws.projects, created.id, { repo: DEMO_REPO });
    workspace.writeSettings(ws, {
      developerMode: true, lastWorkflow: 'software-development.yaml', lastProject: project.id, keepAwake: !!args.keepAwake && args.keepAwake !== 'off',
      // #319: --view setup shows a first run (the ready workflows picked); elsewhere the Setup is done
      setupDone: args.view !== 'setup',
    });
    // Home (#255) shows every stage of the flow: the Inbox, the backlog, the roadmap's runs, the local merge, the releases
    const home = args.view === 'dashboard';
    fs.mkdirSync(ws.backlog, { recursive: true });
    fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify(demoBacklog(project.id, src('backlog').taskProgress), null, 2));
    // also on Project: its run list shows the run's "issue from cache" badge (#168)
    if (home || ['backlog', 'project', 'releases'].includes(args.view)) demoLocalMerge(ws, project.id);
    // #260: the Releases screen's history; the Backlog's "Released" badge on the issues it shipped
    // (#258: also on Discovery, whose committed cards follow their issues to the release)
    if (home || ['backlog', 'discovery', 'releases'].includes(args.view)) demoReleases(ws, project.id);
    // (#289: also on Workflows › Runs and Project, whose run lists show tonight's runs and the artifact runs expanded)
    if (home || ['backlog', 'workflows', 'project'].includes(args.view)) demoRoadmap(ws, project.id, args.live, args.budget, args.roadmap);
    // #291: the release v0.10 of the roadmap's cut line, in a state (needs the history: Backlog only)
    if (args.release && args.view === 'backlog') demoReleaseRun(ws, project.id, args.release);
    if (args.view === 'backlog') demoPoConversation(ws, project.id, args.po);
    if (args.view === 'backlog' && project.folder) demoBacklogRefresh(ws, project.folder, project.id);
    if (home || (['inbox', 'discovery'].includes(args.view) && args.mode !== 'empty')) demoDiscovery(ws, project.id);
    if (args.view === 'discovery' && args.mode !== 'empty') demoDiscoveryBoard(ws, project.id);
    // #258: the committed cards, on the Discovery board and as badges on their issues in the Backlog
    if (['backlog', 'discovery'].includes(args.view) && args.mode !== 'empty') demoCommittedCards(ws, project.id);
    // also on Artifacts: a second run group (its document.md) for Collapse all / Expand all (#126)
    if (['artifacts', 'backlog', 'duo'].includes(args.view)) demoEnrichRun(ws, project.id);
    if (args.view === 'analytics') demoAnalyticsRuns(ws, project.id);
    // a parent run with its child runs nested under it (#174)
    if (['project', 'workflows'].includes(args.view)) demoChildRuns(ws, project.id);
    // enough runs for the lists' pages, and a run with many artifacts (#200)
    if (['artifacts', 'project', 'workflows'].includes(args.view)) demoRunHistory(ws, project.id);
    if (args.view === 'workflows') demoPipelines(ws, appDir);
    if (args.view === 'settings') demoDepsCache(ws, project.id);
    if (args.view === 'analytics' && args.tab === 'performance') demoPerformanceRuns(ws, project.folder, project.id);
    // the Run (#228), 24/7 (#188) and Agents (#280) tabs (an app before them: nothing)
    if (args.view === 'analytics' && ['run', 'occupancy', 'agents'].includes(args.tab)) {
      try {
        const demo = src('analytics-demo');
        if (args.tab === 'run') demo.writeDemoRunInDepth(ws, project.id);
        else if (args.tab === 'agents') demo.writeDemoAgents?.(ws, project.id);
        else demo.writeDemoOccupancy(ws, project.id);
      } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
    }
    // the Night watch's nights (#172): its screen, and Home's morning summary (an app before it: nothing)
    if (home || args.view === 'nightwatch') {
      const selfHealing = args.view === 'nightwatch' && args.mode === 'self-healing';
      try { src('night-watch-demo').writeDemoNights(ws, project.id, { selfHealing }); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
      // #278: the switch itself is a setting (Settings › Execution › Oracle)
      if (selfHealing) workspace.writeSettings(ws, { oracle: { ...workspace.readSettings(ws).oracle, selfHealing: true } });
    }
    // Run App's setup at a gate is prefilled from the worktree's package.json (#108); the Backlog's
    // Assign dialog shows the language detected from it (#116)
    if (['run', 'backlog'].includes(args.view) && project.folder) {
      fs.mkdirSync(project.folder, { recursive: true });
      fs.writeFileSync(path.join(project.folder, 'package.json'), JSON.stringify({ name: 'demo-app', private: true, scripts: { start: 'node server.js' } }, null, 2));
    }
    let run = null;
    if (VIEWS[args.view].run || home || ['artifacts', 'workflows', 'project', 'usage'].includes(args.view)) run = recordRun(project);
    // Home's empty state: a workspace without a project
    if (args.view === 'home-empty') {
      projects.removeProject(ws.projects, project.id);
      fs.rmSync(path.join(ws.backlog, `${project.id}.json`), { force: true });
      workspace.writeSettings(ws, { lastProject: null });
    }
    demoOracle(ws, workspace, args.oracle, run?.runId);
    return { project, run };
  })();

  // A finished run in the scratch workspace: a copy of a run folder, or a simulated run (scripts/run.js
  // --mock, as Node inside this Electron binary).
  function recordRun(project) {
    if (args.run !== 'mock') {
      const from = path.resolve(args.run);
      if (!fs.existsSync(path.join(from, 'events.jsonl'))) throw new Error(`--run ${args.run} is not a run folder (no events.jsonl)`);
      const to = path.join(ws.runs, path.basename(from));
      fs.cpSync(from, to, { recursive: true });
      return readRun(to);
    }
    const r = spawnSync(process.execPath, [path.join(appDir, 'scripts', 'run.js'), '--mock', '--auto-approve', '--file', args.workflow, '--repo', project.folder, '--task', 'Add a /health endpoint'], {
      cwd: appDir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: Math.max(1000, args.timeout - 20000), windowsHide: true,
    });
    const dirs = runDirs();
    if (!dirs.length) throw new Error(`the simulated run did not start: ${(r.stderr || r.error?.message || '').trim().slice(-500)}`);
    return { ...readRun(dirs[0]), simulated: true };
  }
  function readRun(dir) {
    let summary = {};
    try { summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch { /* interrupted run */ }
    return { runId: summary.run_id || path.basename(dir), workflow: summary.workflow || null, dir };
  }
  // the scratch workspace's run folders, newest first
  function runDirs() {
    return fs.readdirSync(ws.runs).map((d) => path.join(ws.runs, d)).filter((d) => fs.existsSync(path.join(d, 'events.jsonl')))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  }

  // Demo screenshots of a simulated run (#146, #145): captures of this window saved as two rounds
  // (developer round 1 in History, evidence round 1 the final set) with original/modified pairs, a
  // modified-only state and a small image (opens at 100% in the viewer), the test step's E2E
  // scenario screenshot (#143), then the manifest.
  async function demoEvidence(win, runDir) {
    const shot = await grab(win);
    const { width, height } = shot.getSize();
    const save = (step, round, name, img) => {
      const dir = evidence.roundDir(runDir, step, round);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), img.toPNG());
    };
    // the developer's capture before developer_check (#144): a pair with its caption
    save('developer', 1, '144-dashboard-default.original.png', shot.crop({ x: 0, y: 0, width: Math.round(width * 0.6), height: Math.round(height * 0.6) }));
    save('developer', 1, '144-dashboard-default.modified.png', shot.crop({ x: 0, y: 0, width: Math.round(width * 0.7), height: Math.round(height * 0.7) }));
    save('developer', 1, '146-artifacts-panel-default.modified.png', shot.crop({ x: 0, y: 0, width: Math.round(width * 0.8), height: Math.round(height * 0.8) }));
    // the mock test writer's UI scenario (#143, providers.js mockScenarios), one per test visit
    for (const round of [1, 2]) save('test', round, '143-e2e-filter-by-status-1.modified.png', shot.crop({ x: 0, y: 0, width: Math.round(width * 0.5), height: Math.round(height * 0.5) }));
    await new Promise((r) => setTimeout(r, 50)); // the final round captures last
    save('evidence', 1, '146-artifacts-panel-default.original.png', shot.crop({ x: 0, y: 0, width: Math.round(width * 0.8), height: Math.round(height * 0.8) }));
    save('evidence', 1, '146-artifacts-panel-default.modified.png', shot);
    save('evidence', 1, '145-image-viewer-small.modified.png', shot.crop({ x: 0, y: 0, width: 320, height: 200 }));
    const rel = (step, name) => `evidence/${step}/round-1/${name}`;
    evidence.writeManifest(runDir, {
      base: 'main', branch: 'feat/demo-evidence', commit: '3f9c2ab71d0e', baseCommit: 'a17b0c4e9f21',
      captions: {
        [rel('developer', '144-dashboard-default.modified.png')]: { caption: 'The dashboard with the developer\'s change' },
        [rel('developer', '146-artifacts-panel-default.modified.png')]: { caption: 'Artifacts panel (first try)' },
        [rel('test', '143-e2e-filter-by-status-1.modified.png')]: { caption: 'Scenario: Filter the runs by status' },
        [rel('evidence', '146-artifacts-panel-default.modified.png')]: { caption: 'Artifacts panel with the run\'s screenshots' },
        [rel('evidence', '145-image-viewer-small.modified.png')]: { caption: 'A small image (opens at 100%)' },
      },
    });
  }

  app.on('browser-window-created', (_e, win) => {
    win.setMinimumSize(400, 300);
    win.setContentSize(...args.size);
    win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log(`[renderer:error] ${ev.message}`); });
    // #263: the Agents window (opened from the main window with --agents-window) is the one captured
    win.webContents.once('did-finish-load', () => (win.webContents.getURL().includes('window=agents') ? captureAgentsWindow(win) : capture(win)).catch(fail));
  });

  // The Agents window on its agent (#263): its rail and pane once loaded, the clicks, then the capture
  async function captureAgentsWindow(win) {
    const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    await js(`for (let i = 0; i < 100 && !document.querySelector('[data-testid="agents-rail"] [data-agent]'); i++) await new Promise((r) => setTimeout(r, 100));`);
    await pause(1500); // the page's first load, the agent's history
    for (const sel of args.clicks) {
      if (typeof sel === 'string') await js(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('nothing matches ' + ${JSON.stringify(sel)}); el.click();`);
      else await typeIn(win, sel);
      await pause(500);
    }
    await pause(args.wait);
    await save(win);
  }

  // --fill: the text in the field (waits up to 10 s for it to show: a modal's field exists before the
  // modal opens), then input and change, as a person leaving it
  function typeIn(win, { fill: sel, text }) {
    return win.webContents.executeJavaScript(`(async () => {
      const sel = ${JSON.stringify(sel)};
      const shown = () => { const el = document.querySelector(sel); return el && el.getClientRects().length ? el : null; };
      for (let i = 0; i < 100 && !shown(); i++) await new Promise((r) => setTimeout(r, 100));
      const el = shown();
      if (!el) throw new Error('nothing matches ' + sel);
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  // The capture itself: the PNG (and its caption in the round's manifest), then the app exits
  async function save(win) {
    const out = path.resolve(args.out || path.join(repo, 'runs', 'screenshots'));
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, fileName(args));
    fs.writeFileSync(file, (await grab(win)).toPNG());
    console.log(`screenshot: ${file}`);
    if (args.caption) {
      recordShot(out, { file, caption: args.caption, commit: sha || gitHead(repo) });
      console.log(`manifest: ${evidence.manifestPath(runOfRound(out))}`);
    }
    win.destroy();
    cleanup();
    app.exit(0);
  }

  async function capture(win) {
    const { project, run } = await setup;
    const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    // waits up to 10 s for the element: views load their data asynchronously
    const click = (sel) => js(`
      const sel = ${JSON.stringify(sel)};
      for (let i = 0; i < 100 && !document.querySelector(sel); i++) await new Promise((r) => setTimeout(r, 100));
      const el = document.querySelector(sel);
      if (!el) throw new Error('nothing matches ' + sel);
      el.scrollIntoView({ block: 'center' }); // a card deep in a scrolled list or drawer is shown (#242)
      el.click();`);
    // a right-click at the element's center (an artifact's copy menu, #114)
    const context = (sel) => js(`
      const sel = ${JSON.stringify(sel)};
      for (let i = 0; i < 100 && !document.querySelector(sel); i++) await new Promise((r) => setTimeout(r, 100));
      const el = document.querySelector(sel);
      if (!el) throw new Error('nothing matches ' + sel);
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));`);
    // a primary-button press at a point of the element's width (pointer events, as a slider listens to)
    const press = ({ sel, at }) => js(`
      const sel = ${JSON.stringify(sel)};
      for (let i = 0; i < 100 && !document.querySelector(sel); i++) await new Promise((r) => setTimeout(r, 100));
      const el = document.querySelector(sel);
      if (!el) throw new Error('nothing matches ' + sel);
      const r = el.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: r.left + r.width * ${at}, clientY: r.top + r.height / 2 };
      el.dispatchEvent(new PointerEvent('pointerdown', init));
      el.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));`);
    // a key pressed on what has the focus (the page itself when nothing has)
    const key = ({ key, shift }) => js(`
      const init = { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key === ' ' ? 'Space' : key)}, shiftKey: ${shift}, bubbles: true, cancelable: true };
      const target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', init));
      target.dispatchEvent(new KeyboardEvent('keyup', init));`);
    // a prompt field gets a demo screenshot through a real paste event (#130): the chip, the save
    // through clipboard:saveImage; `big`: 12 MB, refused before anything is saved
    const paste = ({ sel, big }) => js(`
      const sel = ${JSON.stringify(sel)};
      for (let i = 0; i < 100 && !document.querySelector(sel); i++) await new Promise((r) => setTimeout(r, 100));
      const el = document.querySelector(sel);
      if (!el) throw new Error('nothing matches ' + sel);
      const n = (el._paste?.seq || 0) + 1;
      const c = document.createElement('canvas'); c.width = 640; c.height = 400;
      const g = c.getContext('2d'); g.fillStyle = '#1f2937'; g.fillRect(0, 0, 640, 400);
      g.fillStyle = n % 2 ? '#7c9cff' : '#34d399'; g.fillRect(30, 30, 360, 40); g.fillStyle = '#f87171'; g.fillRect(30, 100, 580, 260);
      const png = await new Promise((r) => c.toBlob(r, 'image/png'));
      const file = new File(${big ? '[new Uint8Array(12 * 1024 * 1024)]' : '[png]'}, 'image.png', { type: 'image/png' });
      if (!el.value) { el.value = 'The gate card hides its buttons when the window is narrow (see the screenshots).'; el.dispatchEvent(new Event('input', { bubbles: true })); }
      const dt = new DataTransfer(); dt.items.add(file);
      el.focus();
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));`);
    await pause(1500); // the app's first load (account, settings, workflows)
    // every capture starts with the menu's groups open: a fold made in an earlier capture is remembered (#254)
    await js('document.querySelectorAll(\'.nav-group.collapsed .nav-group-title\').forEach((b) => b.click());');
    const v = args.view;
    if (args.workflowGiven && v !== 'run') await js(`await api.setSettings({ lastWorkflow: ${JSON.stringify(args.workflow)} });`);
    if (v === 'project') await js(`openProjectView(${JSON.stringify(project.id)})`);
    else if (v === 'run-chat') {
      if (!run) throw new Error('no run to show');
      await js(`window.openRunChat({ runId: ${JSON.stringify(run.runId)}, workflow: ${JSON.stringify(run.workflow)} })`);
    } else if (v === 'run') {
      // a live simulated run started from the Start panel; gates are approved as they come
      await js(`
        // a pipeline is the Start panel's option "pipe:<file>" (start-drawer.js); never an Electron
        // argument: one with a colon makes Electron exit before this script runs
        await api.setSettings({ developerMode: true, lastWorkflow: ${JSON.stringify(args.pipeline ? `pipe:${args.pipeline}` : args.workflow)} });
        document.querySelector('#btn-quick-start').click();
        await new Promise((r) => setTimeout(r, 500));
        document.querySelector('#project-select').value = ${JSON.stringify(project.id)};
        document.querySelector('#in-task').value = 'Add a /health endpoint';
        for (const [k, val] of Object.entries(${JSON.stringify(args.inputs)})) {
          const el = document.getElementById('in-' + k);
          if (!el) throw new Error('the workflow has no input ' + k);
          el.value = val;
        }
        document.querySelector('#mock-toggle').checked = true;
        if (${JSON.stringify(args.then || '')}) drawerChain().set({ action: 'workflow', workflow: ${JSON.stringify(args.then || '')} });
        if (!document.body.classList.contains('dev-mode')) throw new Error('developer mode is off: refusing to start a real run');
        document.querySelector('#btn-start').click();`);
      // --stop-at: that step's gate stays open and the capture happens once it shows
      const approve = setInterval(() => js(`
        for (const card of document.querySelectorAll('#run-gates:not(.hidden) .run-gate')) {
          if (${JSON.stringify(args.stopAt || '')} && card.querySelector('.run-gate-head')?.textContent.includes(${JSON.stringify(`step: ${args.stopAt}`)})) continue;
          card.querySelector('.run-gate-actions button[data-choice]:not(:disabled), .run-gate-actions button[data-answer="true"]:not(:disabled)')?.click();
          break;
        }`).catch(() => {}), 1000);
      try {
        if (args.stopAt) {
          let shown = false;
          for (const end = Date.now() + Math.max(args.wait, 45000); !shown && Date.now() < end;) {
            await pause(1000);
            shown = await js(`return [...document.querySelectorAll('#run-gates .run-gate-head')].some((h) => h.textContent.includes(${JSON.stringify(`step: ${args.stopAt}`)}))`);
          }
          if (!shown) throw new Error(`the run never waited at ${args.stopAt}`);
          // demo screenshots in the live run, for its gate's Artifacts panel and the viewer
          const live = runDirs()[0];
          if (live && args.demoShots) {
            await demoEvidence(win, live);
            await js(`ArtifactsPanel.refreshRun(${JSON.stringify(path.basename(live))}); window.mountGateScenarios?.(document)`);
          }
          // a live run with a worktree has a scratch workspace (#201; a simulated run has none): a few
          // demo files, for the Run screen's "Scratch workspace" line
          if (live) {
            for (const [rel, text] of [['workspace/skills/code-review/SKILL.md', '# Code review\n'], ['workspace/workflows/software-development.yaml', 'name: demo\n'], ['user-data/Local State', '{}']]) {
              fs.mkdirSync(path.dirname(path.join(live, 'scratch', rel)), { recursive: true });
              fs.writeFileSync(path.join(live, 'scratch', rel), text.repeat(400));
            }
            await js('scratchOfRun.clear(); renderRunSummary()');
          }
          await pause(2500); // the gate's Artifacts panel and changed files load
        } else await pause(args.wait);
      } finally {
        clearInterval(approve);
      }
    } else if (v === 'setup') {
      // #319: Settings' Run setup again, on the asked step (an older --ref has no Setup: Home)
      await js(`if (window.Setup) await window.Setup.open(${JSON.stringify(args.mode || 'agents')})`);
      await pause(1500); // the CLI checks
    } else if (v === 'oracle') {
      await click('.nav-item[data-view="settings"]');
      await pause(300);
      await click('#nav-oracle');
    } else {
      if (v === 'artifacts' && run?.simulated && args.demoShots) await demoEvidence(win, run.dir);
      // #254: the screen's menu entry (Workflows has one per tab, the Roadmap its own); Projects
      // (Settings › Projects), Artifacts (a tab of Runs) and Analytics (a tab of Home, #255) have none
      if (v === 'workflows') await click(`.nav-item[data-view="workflows"][data-tab="${args.tab || 'runs'}"]`);
      else if (v === 'backlog' && args.mode === 'roadmap') await click('.nav-item[data-view="roadmap"]');
      else if (v === 'home-empty') await click('.nav-item[data-view="dashboard"]');
      else if (['analytics', 'artifacts', 'projects'].includes(v)) await js(`showView(${JSON.stringify(v)})`);
      else await click(`.nav-item[data-view="${v}"]`);
    }
    await pause(500);
    // the Oracle's states set in the window: unread answers (the Dashboard, the start screen, read
    // them: the read time goes back before the last answer), a question whose answer is held, a pasted image
    if (args.oracle === 'unread') {
      demoOracle(ws, workspace, 'unread', run?.runId);
      await js('await window.OracleChat.reload();');
    }
    if (args.oracle === 'answering') await js('window.OracleChat.ask(\'What changed since yesterday?\'); await new Promise((r) => setTimeout(r, 300));');
    if (args.oracle === 'attachment') {
      await js(`
        const c = document.createElement('canvas'); c.width = 320; c.height = 200;
        const g = c.getContext('2d'); g.fillStyle = '#1f2937'; g.fillRect(0, 0, 320, 200);
        g.fillStyle = '#7c9cff'; g.fillRect(20, 20, 180, 24); g.fillStyle = '#f87171'; g.fillRect(20, 60, 280, 110);
        window.OracleChat.attach([{ type: 'image/png', size: 24000, name: 'failed-gate.png', dataUrl: c.toDataURL('image/png') }]);
        const q = document.querySelector('#oracle-drawer.open #oracle-q-drawer') || document.querySelector('#oracle-q-dock');
        if (q) { q.value = 'Why is this gate red?'; q.dispatchEvent(new Event('input')); }`);
    }
    if (args.tab && v === 'settings') await click(`.settings-tab[data-stab="${args.tab}"]`);
    if (args.tab && v === 'analytics') await click(`[data-an-tab="${args.tab}"]`);
    // the demo's last night started after this marker: the before/after table shows the difference
    if (args.tab === 'performance') {
      const d = new Date(Date.now() - 2 * 864e5);
      const marker = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await js(`const m = document.querySelector('#an-marker'); m.value = ${JSON.stringify(marker)}; m.dispatchEvent(new Event('change'));`);
      await pause(1500);
    }
    if (v === 'backlog' && args.mode && args.mode !== 'roadmap') await click(`#view-backlog [data-mode="${args.mode}"]`);
    // #291: the Roadmap's Releases filter on a choice ('next', or a version)
    if (args.releaseFilter) {
      await js(`const s = document.querySelector('[data-rm-release-filter]'); if (s) { s.value = ${JSON.stringify(args.releaseFilter)}; s.dispatchEvent(new Event('change', { bubbles: true })); }`);
      await pause(800);
    }
    // --po (#180): the Product Owner's drawer, asking (working, writing) or with its last answer
    // (#235: with --workflow, the workflow it plans with, as if the owner had chosen it for the project)
    if (args.po && args.workflowGiven) await js(`localStorage.setItem('po.workflow.' + window.BacklogActions.projectId(), ${JSON.stringify(args.workflow)});`);
    if (['working', 'writing'].includes(args.po)) await js('window.BacklogPO.ask(\'Analyze the backlog and propose runs\'); await new Promise((r) => setTimeout(r, 500));');
    else if (args.po) await js('await window.BacklogPO.open();');
    // the demo runs are simulated, which Artifacts hides by default
    if (v === 'artifacts') await js(`const c = document.querySelector('#art-show-sim'); if (c && !c.checked) c.click();`);
    // #263: the Agents window on its agent, captured by captureAgentsWindow (the clicks apply there)
    if (args.agentsWindow) { await js(`await api.openAgentsWindow({ agent: ${JSON.stringify(args.agentsWindow)} })`); return; }
    for (const sel of args.clicks) { await (typeof sel === 'string' ? click(sel) : typeIn(win, sel)); await pause(500); }
    for (const sel of args.contexts) { await context(sel); await pause(500); }
    for (const p of args.presses) { await press(p); await pause(500); }
    for (const k of args.keys) { await key(k); await pause(500); }
    for (const p of args.pastes) { await paste(p); await pause(500); }
    if (v !== 'run') await pause(args.wait);
    await save(win);
  }

  // capturePage fails now and then with Chromium's UnknownVizError while the compositor is busy
  // (several apps at once): a few tries before giving up
  async function grab(win) {
    for (let attempt = 1; ; attempt++) {
      try {
        const img = await win.webContents.capturePage();
        if (!img.isEmpty()) return img;
        if (attempt >= 4) throw new Error('the captured image is empty');
      } catch (e) {
        if (attempt >= 4) throw e;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  simulateChannels(ipcMain, demoKeepAwake(appDir, args.keepAwake), demoMissingClis(appDir, args.missingClis), args.oracle === 'answering', args.po);
  require(path.join(appDir, 'src', 'main'));
}

// Electron's main process runs the capture; plain Node (the tests) and the E2E suite's Electron main
// (features/support/electron-main.js, which sets global.multiagentScreenshotHelpers) only import the helpers.
if (process.type === 'browser' && !global.multiagentScreenshotHelpers) main();

module.exports = {
  DEMO_REPO,
  demoBacklog,
  demoDepsCache,
  demoLocalMerge,
  demoRoadmap,
  fileName,
  parseArgs,
  recordShot,
  simulateChannels,
  usage,
  VIEWS,
};
