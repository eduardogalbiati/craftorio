// UI screenshots for tests and PRs: opens one screen of the app with simulated data, saves a PNG and
// quits by itself. The caller only chooses what to show; it never writes its own Electron script.
// Beside each PNG it writes `<name>.checks.json` (#387, scripts/screenshot/checks.js): axe-core's
// color-contrast and target-size results and the visible native controls, for the UI review.
//
//   npx electron scripts/screenshot.js --view <view> [options]      (or: npm run screenshot -- ...)
//
//   --view <name>      a seed module of scripts/screenshot/views/ (#249): dashboard, sessions, projects, project, backlog, roadmap, artifacts, workflows, agents,
//                      skills, usage, analytics, oracle, nightwatch, settings, duo, arena, inbox,
//                      discovery, run-chat, run, home-empty, setup
//                      (default dashboard, the menu's Home (#255: the flow strip, "What needs you" and
//                      "Today" on demo data; its Analytics tab: --view analytics; home-empty: Home in a
//                      new workspace, no project and no run: how to start); projects: the Projects screen; roadmap: the
//                      same as backlog --mode roadmap; the Supervisor's drawer: --view workflows --click
//                      "[data-testid=supervisor-fab]"; a folded menu group: --click ".nav-group[data-group=workflows]
//                      .nav-group-title"; oracle: Settings with the Oracle's drawer open from its
//                      header button; Home shows its docked panel; nightwatch (#172): two
//                      replayed nights, src/domains/night/night-watch-demo.js, also Home's morning
//                      summary; its turn-on form: --click "#nw-switch", the permissions' Save /
//                      Cancel: --click ".nw-perm-check[data-perm=skip]")
//   --oracle <state>   the Oracle's demo state (#171), on any view: empty | conversation | answering |
//                      error | paused | unavailable | unread | attachment | actions (#123: wake-up,
//                      cards, delegation, Night watch on; its form: --oracle conversation --click
//                      "#oracle-dock [data-oracle-night]") (unread: on a view other
//                      than the Dashboard, whose panel reads the answers; the Edit form of its
//                      memory: --click "#oracle-dock [data-oracle-memory]")
//   --tab <name>       settings: general | agents | execution | phone | about; workflows: runs | definitions | builder | pipelines;
//                      project: overview | conflicts | architecture | refactor (conflicts --mode loading | no-runs | not-git;
//                      architecture --mode map-refresh: a saved city plan that covers part of the files, #372;
//                      architecture --mode city: the project city of #373, a demo repository with a city plan;
//                      architecture --mode city-agents: that city with two simulated runs in progress on it, #374;
//                      architecture --mode city-issue: that city with an issue's impact preview (cited, the Product Owner's, a new file), #375;
//                      architecture --mode city-stage: that city with a roadmap stage's footprint (two items sharing a file), #375;
//                      architecture --mode city-large: the city of this repository itself with the POC's plan, #382;
//                      architecture --mode city-release: that city at release 1.1.1 in grey, release 1.1.2 in colour, #376;
//                      architecture --mode large: a latest report of the shared large-project fixture, 60 findings, #387;
//                      architecture --mode facts-large: the Facts view of this repository itself with those 60 findings on its own files, #386);
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
//                      health" disabled; the last stage's item simulated) | pausing (#391: running,
//                      simulated, "Pausing after stage 2" with Cancel pause; --click "[data-rm=pause]"
//                      opens the Pause menu) | parked (#395: the item waiting at the developer's gate
//                      parked, "Parked at Developer check" and the bar's "1 parked at a gate")
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
//                      --click "[data-home-act=run]" --paste "#in-request" --paste "#in-request"
//   --paste-big <css>  the same with a 12 MB image: the red "Image too large" chip
//                      (--workflow on a view other than run: the workflow the Start drawer opens on)
//   --theme <t>        dark | light | system: the theme Electron reports (prefers-color-scheme)
//   --lang <code>      the interface language (#329): en | pt-BR, a language with a catalog in packages/shared/i18n/
//   --size <WxH>       window content size (default 1400x900)
//   --ref <git ref>    captures the app as it is at this ref (e.g. main, for the "original" shots)
//   --out <dir>        output folder (default runs/screenshots); --name <file> without .png
//                      (run evidence: --out <run_dir>/evidence/<step>/round-<n> --name <issue>-<screen>-<state>)
//   --side <s>         original | modified: saves <name>.<side>.png, the two images of a pair
//                      (default original with --ref, modified with --caption, else no suffix)
//   --caption <text>   records this shot with its caption and commit in <run_dir>/evidence/manifest.json
//                      (src/domains/evidence/evidence.js): needs --out <run_dir>/evidence/<step>/round-<n>
//   --wait <ms>        extra time before the capture (default 1500; run: 20000)
//   --timeout <ms>     hard limit: the app exits with code 1 after it (default 90000)
//
// Always a scratch workspace in the temp folder, removed at the end: simulated runs only
// (MULTIAGENT_AUTH=off, developer mode on), no sign-in, and HOME/USERPROFILE/APPDATA/GH_CONFIG_DIR
// point inside it, so the screens never show this machine's CLI sessions, usage or accounts. Demo
// data: a project `demo-app` with a few issues (the Backlog's sync never calls gh), then what the
// view's seed module writes (#249): one file per view, scripts/screenshot/views/<view>.js, found by
// this runner, with the view's tabs, modes, options, demo data and how its screen opens; a new screen
// or state adds or edits its own seed file, never this runner. Shared helpers (the demo issues, run
// folders with events stamped with run_id and seq, demo screenshots) are in
// scripts/screenshot/helpers.js, the simulated channels in scripts/screenshot/channels.js and the
// --oracle states in scripts/screenshot/oracle.js. The Artifacts view and the live run of
// `run --stop-at` get demo screenshots (two rounds, an original/modified pair) for the Artifacts panel
// and the image viewer, e.g.
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
const evidence = require('../src/domains/evidence/evidence');
const I18n = require('@multiagent/shared/i18n');
const machineSlot = require('../src/engine/machine-slot');
const {
  demoKeepAwake,
  demoMissingClis,
  simulateChannels,
} = require('./screenshot/channels');
const { writeChecks } = require('./screenshot/checks');
const { DEMO_REPO, demoBacklog } = require('./screenshot/helpers');
const { demoOracle, ORACLE_STATES } = require('./screenshot/oracle');

// #263: the agents the Agents window can open on (--agents-window)
const AGENTS_WINDOW_AGENTS = ['oracle', 'product-owner', 'supervisor'];
// The views (#249): one seed module per file of scripts/screenshot/views/, named after the view.
// What a seed module exports, all optional:
//   tabs, modes      what --tab and --mode take on the view
//   options          { <option>: [values] }: options only this view takes (e.g. --live), checked here
//   alias            { view, mode }: the view is another one in a mode (roadmap: the Backlog's)
//   run: true        a finished run is recorded after the seed (a simulated one, or --run's copy)
//   live: true       the view starts its own live run (a longer --wait; --stop-at and --input apply)
//   seed(ctx)        writes its demo data before the app loads; ctx: { appDir, args, project, projects,
//                    src, workspace, ws } (src(m): the app's module, from the --ref tree too)
//   open(page)       opens the screen (default: its menu entry, .nav-item[data-view=<view>]); page:
//                    { args, click, grab, js, pause, project, run, runDirs, win }
//   afterOpen(page)  then sets what is on the screen (a tab, a mode, a drawer), after the --oracle states
const VIEWS_DIR = path.join(__dirname, 'screenshot', 'views');
// #394: the seed modules of a folder, keyed by view name (a test passes a folder of its own)
const loadViews = (dir) => Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
  .map((f) => [f.slice(0, -3), require(path.join(dir, f))]));
const VIEWS = loadViews(VIEWS_DIR);
const THEMES = ['dark', 'light', 'system'];
const KEEP_AWAKE = ['off', 'idle', 'active', 'error'];

// #329 --lang <code>: the interface language of the capture, one with a catalog (packages/shared/i18n/).
// Taken out of argv here so parseArgs does not grow (scripts/code-health.js); sets a.lang.
function takeLang(argv, a) {
  const rest = [...argv];
  const at = rest.indexOf('--lang');
  if (at < 0) return rest;
  const lang = rest[at + 1];
  const known = I18n.languages();
  if (!known.includes(lang)) throw new Error(`--lang takes ${known.join(' | ')}`);
  rest.splice(at, 2);
  a.lang = lang;
  return rest;
}

function parseArgs(argv, views = VIEWS) {
  const a = { view: 'dashboard', tab: null, mode: null, run: 'mock', workflow: 'software-development.yaml', clicks: [], contexts: [], presses: [], keys: [], pastes: [], inputs: {}, stopAt: null, keepAwake: null, theme: null, size: [1400, 900], ref: null, out: null, name: null, side: null, caption: null, wait: null, timeout: 90000, demoShots: true, lang: null };
  argv = takeLang(argv, a);
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
  let v = views[a.view];
  if (!v) throw new Error(`Unknown view: ${a.view}. Views: ${Object.keys(views).join(', ')}`);
  if (a.tab && !v.tabs?.includes(a.tab)) throw new Error(`--tab ${a.tab} does not apply to ${a.view}${v.tabs ? ` (tabs: ${v.tabs.join(', ')})` : ''}`);
  if (a.mode && !v.modes?.includes(a.mode)) throw new Error(`--mode ${a.mode} does not apply to ${a.view}${v.modes ? ` (modes: ${v.modes.join(', ')})` : ''}`);
  // a view drawn as another one in a mode (#254: the Roadmap screen, the Backlog in its roadmap mode)
  if (v.alias) { Object.assign(a, v.alias); v = views[a.view]; }
  if (a.theme && !THEMES.includes(a.theme)) throw new Error(`--theme takes ${THEMES.join(' | ')}`);
  if (a.keepAwake && !KEEP_AWAKE.includes(a.keepAwake)) throw new Error(`--keep-awake takes ${KEEP_AWAKE.join(' | ')}`);
  if (a.oracle && !ORACLE_STATES.includes(a.oracle)) throw new Error(`--oracle takes ${ORACLE_STATES.join(' | ')}`);
  // the options a view takes on its own (its seed module's `options`), only on that view
  for (const [name, view] of Object.entries(views)) {
    for (const [option, values] of Object.entries(view.options || {})) {
      if (a[option] == null) continue;
      if (!values.includes(a[option])) throw new Error(`--${option} takes ${values.join(' | ')}`);
      if (a.view !== name) throw new Error(`--${option} applies to --view ${name}`);
    }
  }
  if ((a.stopAt || Object.keys(a.inputs).length) && !v.live) throw new Error('--stop-at and --input apply to --view run');
  a.wait ??= v.live ? 20000 : 1500;
  a.name ??= [a.agentsWindow ? `agents-window-${a.agentsWindow}` : a.view, a.tab, a.mode, a.oracle && `oracle-${a.oracle}`, a.po && `po-${a.po}`, a.theme, a.lang].filter(Boolean).join('-');
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
    // app:info's `screenshot`: the Findings button (#361) is hidden unless the setting is on
    MULTIAGENT_SCREENSHOT: '1',
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
  const workspace = src('domains/workspace/workspace');
  const ws = workspace.setupWorkspace(wsDir, { persist: false });

  const view = VIEWS[args.view];
  const setup = (async () => {
    // the repository is set afterwards: createProject would clone it
    const projects = src('domains/project/projects');
    const created = await projects.createProject(ws.projects, { name: 'demo-app', description: 'Sample project (simulated data)' });
    const project = projects.updateProject(ws.projects, created.id, { repo: DEMO_REPO });
    workspace.writeSettings(ws, {
      developerMode: true, lastWorkflow: 'software-development.yaml', lastProject: project.id, keepAwake: !!args.keepAwake && args.keepAwake !== 'off',
      // the Setup is done (#319: the setup view's seed shows a first run)
      setupDone: true,
      // #329: the interface language, English unless --lang says otherwise (never the machine's)
      language: { ...workspace.DEFAULT_SETTINGS.language, interface: args.lang || 'en' },
    });
    fs.mkdirSync(ws.backlog, { recursive: true });
    fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify(demoBacklog(project.id, src('domains/backlog/backlog').taskProgress), null, 2));
    // the view's demo data (its seed module), then the finished run it lists
    if (view.seed) await view.seed({ appDir, args, project, projects, src, workspace, ws });
    const run = view.run ? recordRun(project) : null;
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
    // #387: axe-core and the native-control scan on the same state, beside the PNG
    await writeChecks(win.webContents, file);
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
    const page = { args, click, grab: () => grab(win), js, pause, project, run, runDirs, win };
    if (args.workflowGiven && !view.live) await js(`await api.setSettings({ lastWorkflow: ${JSON.stringify(args.workflow)} });`);
    // the view's seed module opens its screen, else its menu entry (#254)
    await (view.open ? view.open(page) : click(`.nav-item[data-view="${args.view}"]`));
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
    // then what the view sets on its screen: a tab, a mode, a drawer
    if (view.afterOpen) await view.afterOpen(page);
    // #263: the Agents window on its agent, captured by captureAgentsWindow (the clicks apply there)
    if (args.agentsWindow) { await js(`await api.openAgentsWindow({ agent: ${JSON.stringify(args.agentsWindow)} })`); return; }
    for (const sel of args.clicks) { await (typeof sel === 'string' ? click(sel) : typeIn(win, sel)); await pause(500); }
    for (const sel of args.contexts) { await context(sel); await pause(500); }
    for (const p of args.presses) { await press(p); await pause(500); }
    for (const k of args.keys) { await key(k); await pause(500); }
    for (const p of args.pastes) { await paste(p); await pause(500); }
    if (!view.live) await pause(args.wait);
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
  require(path.join(appDir, 'src', 'host', 'main'));
}

// Electron's main process runs the capture; plain Node (the tests) and the E2E suite's Electron main
// (features/support/electron-main.js, which sets global.multiagentScreenshotHelpers) only import the helpers.
if (process.type === 'browser' && !global.multiagentScreenshotHelpers) main();

// re-exported for the E2E suite's demo workspace (features/support/app.js)
const { demoDepsCache } = require('./screenshot/views/settings');
const { demoLocalMerge } = require('./screenshot/views/releases');
const { demoRoadmap } = require('./screenshot/views/roadmap');

module.exports = {
  DEMO_REPO,
  demoBacklog,
  demoDepsCache,
  demoLocalMerge,
  demoRoadmap,
  fileName,
  loadViews,
  parseArgs,
  recordShot,
  simulateChannels,
  usage,
  VIEWS,
};
