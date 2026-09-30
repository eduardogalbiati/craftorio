// UI screenshots for tests and PRs: opens one screen of the app with simulated data, saves a PNG and
// quits by itself. The caller only chooses what to show; it never writes its own Electron script.
//
//   npx electron scripts/screenshot.js --view <view> [options]      (or: npm run screenshot -- ...)
//
//   --view <name>      dashboard, sessions, projects, project, backlog, artifacts, workflows, agents,
//                      skills, usage, settings, duo, arena, run-chat, run (default dashboard)
//   --tab <name>       settings: general | agents | execution | about; workflows: runs | definitions
//   --mode <name>      backlog: list | kanban
//   --run <mock|dir>   run-chat: a simulated software-development run (default) or a copy of a run folder
//   --workflow <file>  the workflow of the simulated run (default software-development.yaml)
//   --click <css>      clicks this element once the view is open (repeatable, in order)
//   --theme <t>        dark | light | system: the theme Electron reports (prefers-color-scheme)
//   --size <WxH>       window content size (default 1400x900)
//   --ref <git ref>    captures the app as it is at this ref (e.g. origin/main, for "before" shots)
//   --out <dir>        output folder (default runs/screenshots); --name <file> without .png
//   --caption <text>   adds/replaces this shot in <out>/screenshots.json ({ path, caption, before })
//   --before <file>    with --caption: the "before" PNG of the same screen, in <out>
//   --wait <ms>        extra time before the capture (default 1500; run: 20000)
//   --timeout <ms>     hard limit: the app exits with code 1 after it (default 90000)
//
// Always a scratch workspace in the temp folder, removed at the end: simulated runs only
// (MULTIAGENT_AUTH=off, developer mode on), no sign-in, and HOME/USERPROFILE/APPDATA/GH_CONFIG_DIR
// point inside it, so the screens never show this machine's CLI sessions, usage or accounts. Demo
// data: a project `demo-app` with a few issues (the Backlog's sync never calls gh) and, for the
// views that list runs, one simulated run.
// Prints `screenshot: <path>` and exits 0, or exits 1 with the error.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const VIEWS = {
  dashboard: {}, sessions: {}, projects: {}, project: {}, artifacts: {}, agents: {}, skills: {}, usage: {}, duo: {}, arena: {},
  backlog: { modes: ['list', 'kanban'] },
  workflows: { tabs: ['runs', 'definitions'] },
  settings: { tabs: ['general', 'agents', 'execution', 'about'] },
  'run-chat': { run: true },
  run: { live: true },
};
const THEMES = ['dark', 'light', 'system'];

function parseArgs(argv) {
  const a = { view: 'dashboard', tab: null, mode: null, run: 'mock', workflow: 'software-development.yaml', clicks: [], theme: null, size: [1400, 900], ref: null, out: null, name: null, caption: null, before: null, wait: null, timeout: 90000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    const ms = () => { const v = Number(next()); if (!Number.isFinite(v) || v < 0) throw new Error(`${k} takes milliseconds`); return v; };
    if (k === '--view') a.view = next();
    else if (k === '--tab') a.tab = next();
    else if (k === '--mode') a.mode = next();
    else if (k === '--run') a.run = next();
    else if (k === '--workflow') a.workflow = next();
    else if (k === '--click') a.clicks.push(next());
    else if (k === '--theme') a.theme = next();
    else if (k === '--size') {
      const m = /^(\d+)x(\d+)$/i.exec(next());
      if (!m) throw new Error('--size takes WIDTHxHEIGHT, e.g. 1400x900');
      a.size = [+m[1], +m[2]];
    } else if (k === '--ref') a.ref = next();
    else if (k === '--out') a.out = next();
    else if (k === '--name') a.name = next();
    else if (k === '--caption') a.caption = next();
    else if (k === '--before') a.before = next();
    else if (k === '--wait') a.wait = ms();
    else if (k === '--timeout') a.timeout = ms();
    else throw new Error(`Unknown argument: ${k}`);
  }
  const v = VIEWS[a.view];
  if (!v) throw new Error(`Unknown view: ${a.view}. Views: ${Object.keys(VIEWS).join(', ')}`);
  if (a.tab && !v.tabs?.includes(a.tab)) throw new Error(`--tab ${a.tab} does not apply to ${a.view}${v.tabs ? ` (tabs: ${v.tabs.join(', ')})` : ''}`);
  if (a.mode && !v.modes?.includes(a.mode)) throw new Error(`--mode ${a.mode} does not apply to ${a.view}${v.modes ? ` (modes: ${v.modes.join(', ')})` : ''}`);
  if (a.theme && !THEMES.includes(a.theme)) throw new Error(`--theme takes ${THEMES.join(' | ')}`);
  a.wait ??= v.live ? 20000 : 1500;
  a.name ??= [a.view, a.tab, a.mode, a.theme].filter(Boolean).join('-');
  if (!/^[\w.-]+$/.test(a.name)) throw new Error(`--name must be a plain file name: ${a.name}`);
  if (a.before && !a.caption) throw new Error('--before needs --caption');
  return a;
}

/** Adds or replaces (same path) a shot in <dir>/screenshots.json; returns the list. */
function recordShot(dir, { path: file, caption, before }) {
  const manifest = path.join(dir, 'screenshots.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch { /* first shot */ }
  if (!Array.isArray(list)) list = [];
  const entry = { path: file, caption, ...(before ? { before } : {}) };
  const at = list.findIndex((s) => s.path === file);
  if (at < 0) list.push(entry); else list[at] = entry;
  fs.writeFileSync(manifest, `${JSON.stringify(list, null, 2)}\n`);
  return list;
}

// ---- simulated data ------------------------------------------------------------------------
const DEMO_REPO = 'https://github.com/example/demo-app';
const DEMO_ISSUES = [
  { number: 12, title: 'Export a run report as Markdown', state: 'open', labels: [{ name: 'enhancement', color: '#a2eeef' }], body: '- [x] Report layout\n- [ ] Export button\n- [ ] Tests' },
  { number: 11, title: 'Crash when the workspace folder is renamed', state: 'open', labels: [{ name: 'bug', color: '#d73a4a' }], body: 'Steps to reproduce: rename the folder while the app is open.' },
  { number: 10, title: 'Dark scrollbars in the terminal dock', state: 'open', labels: [{ name: 'ui', color: '#c5def5' }], body: '' },
  { number: 9, title: 'Add a /health endpoint', state: 'open', labels: [{ name: 'enhancement', color: '#a2eeef' }], body: '- [ ] Endpoint\n- [ ] Docs' },
  { number: 8, title: 'Document the workflow YAML', state: 'closed', labels: [{ name: 'docs', color: '#0075ca' }], body: '' },
];

function demoBacklog(projectId, taskProgress) {
  const day = (n) => new Date(Date.UTC(2026, 0, 20 - n, 12)).toISOString();
  const issues = DEMO_ISSUES.map((i, n) => ({
    ...i, url: `${DEMO_REPO}/issues/${i.number}`, author: 'octocat', assignees: [],
    tasks: taskProgress(i.body), createdAt: day(n + 3), updatedAt: day(n),
  }));
  return { projectId, platform: 'github', repo: DEMO_REPO, syncedAt: new Date().toISOString(), issues };
}

// Demo GitHub Actions minutes (Usage): near the quota, as in the month that motivated the monitor.
function demoActionsUsage() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const item = (sku, quantity, price) => ({ date, product: 'actions', sku, unitType: 'minutes', quantity, grossAmount: quantity * price, netAmount: 0 });
  const { summarizeActionsUsage } = require('../src/actions-usage'); // only apps that have the channel ask
  return { login: 'demo-user', ...summarizeActionsUsage({ usageItems: [item('Actions Linux', 353, 0.008), item('Actions Windows', 560, 0.016), item('Actions macOS', 35, 0.08)] }, { includedMinutes: 2000, now }) };
}

// Simulation: the Backlog's sync answers with the cached demo issues instead of calling gh, and the
// Usage screen's GitHub Actions minutes are demo data.
function simulateChannels(ipcMain) {
  const handle = ipcMain.handle.bind(ipcMain);
  const handlers = {};
  ipcMain.handle = (channel, fn) => {
    handlers[channel] = fn;
    if (channel === 'usage:actions') return handle(channel, () => demoActionsUsage());
    return handle(channel, channel === 'backlog:sync' ? (e, arg) => handlers['backlog:get'](e, { projectId: arg?.projectId }) : fn);
  };
}

// The app tree at a git ref, for "before" screenshots: an index of its own (the repository's index
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

// ---- the capture (Electron main process) -----------------------------------------------------
function main() {
  const { app, nativeTheme, ipcMain } = require('electron');
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`screenshot: ${e.message}`);
    app.exit(2);
    return;
  }
  const repo = path.join(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-shot-'));
  const cleanup = () => removeScratch(scratch);
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
  if (args.ref) {
    appDir = path.join(scratch, 'app');
    const sha = extractRef(repo, args.ref, appDir);
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
    workspace.writeSettings(ws, { developerMode: true, lastWorkflow: 'software-development.yaml', lastProject: project.id });
    fs.mkdirSync(ws.backlog, { recursive: true });
    fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify(demoBacklog(project.id, src('backlog').taskProgress), null, 2));
    let run = null;
    if (VIEWS[args.view].run || ['artifacts', 'workflows', 'project', 'usage', 'dashboard'].includes(args.view)) run = recordRun(project);
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
    const dirs = fs.readdirSync(ws.runs).map((d) => path.join(ws.runs, d)).filter((d) => fs.existsSync(path.join(d, 'events.jsonl')));
    if (!dirs.length) throw new Error(`the simulated run did not start: ${(r.stderr || r.error?.message || '').trim().slice(-500)}`);
    return readRun(dirs[0]);
  }
  function readRun(dir) {
    let summary = {};
    try { summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch { /* interrupted run */ }
    return { runId: summary.run_id || path.basename(dir), workflow: summary.workflow || null };
  }

  app.on('browser-window-created', (_e, win) => {
    win.setMinimumSize(400, 300);
    win.setContentSize(...args.size);
    win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log(`[renderer:error] ${ev.message}`); });
    win.webContents.once('did-finish-load', () => capture(win).catch(fail));
  });

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
      el.click();`);
    await pause(1500); // the app's first load (account, settings, workflows)
    const v = args.view;
    if (v === 'project') await js(`openProjectView(${JSON.stringify(project.id)})`);
    else if (v === 'run-chat') {
      if (!run) throw new Error('no run to show');
      await js(`window.openRunChat({ runId: ${JSON.stringify(run.runId)}, workflow: ${JSON.stringify(run.workflow)} })`);
    } else if (v === 'run') {
      // a live simulated run started from the Start panel; gates are approved as they come
      await js(`
        await api.setSettings({ developerMode: true, lastWorkflow: ${JSON.stringify(args.workflow)} });
        document.querySelector('#btn-quick-start').click();
        await new Promise((r) => setTimeout(r, 500));
        document.querySelector('#project-select').value = ${JSON.stringify(project.id)};
        document.querySelector('#in-task').value = 'Add a /health endpoint';
        document.querySelector('#mock-toggle').checked = true;
        if (!document.body.classList.contains('dev-mode')) throw new Error('developer mode is off: refusing to start a real run');
        document.querySelector('#btn-start').click();`);
      const approve = setInterval(() => js(`(document.querySelector('#approval-modal:not(.hidden) #approval-choices:not(.hidden) button') || document.querySelector('#approval-modal:not(.hidden) #btn-approve'))?.click()`).catch(() => {}), 1000);
      await pause(args.wait);
      clearInterval(approve);
    } else await click(`.nav-item[data-view="${v}"]`);
    await pause(500);
    if (args.tab && v === 'settings') await click(`.settings-tab[data-stab="${args.tab}"]`);
    if (args.tab && v === 'workflows') await click(`[data-wtab="${args.tab}"]`);
    if (args.mode) await click(`#view-backlog [data-mode="${args.mode}"]`);
    // the demo runs are simulated, which Artifacts hides by default
    if (v === 'artifacts') await js(`const c = document.querySelector('#art-show-sim'); if (c && !c.checked) c.click();`);
    for (const sel of args.clicks) { await click(sel); await pause(500); }
    if (v !== 'run') await pause(args.wait);

    const out = path.resolve(args.out || path.join(repo, 'runs', 'screenshots'));
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `${args.name}.png`);
    fs.writeFileSync(file, (await grab(win)).toPNG());
    console.log(`screenshot: ${file}`);
    if (args.caption) {
      if (args.before && !fs.existsSync(path.join(out, args.before))) throw new Error(`--before ${args.before} is not in ${out}`);
      recordShot(out, { path: path.basename(file), caption: args.caption, before: args.before });
      console.log(`manifest: ${path.join(out, 'screenshots.json')}`);
    }
    win.destroy();
    cleanup();
    app.exit(0);
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

  simulateChannels(ipcMain);
  require(path.join(appDir, 'src', 'main'));
}

// Electron's main process runs the capture; plain Node (the tests) only imports the helpers.
if (process.type === 'browser') main();

module.exports = { parseArgs, recordShot, VIEWS };
