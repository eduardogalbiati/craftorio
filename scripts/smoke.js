// UI smoke test: opens the app, starts the workflow in mock mode, approves the
// gates automatically and saves a screenshot.
// Usage: npx electron scripts/smoke.js <output.png> [--lang pt-BR]
//        npx electron scripts/smoke.js --startup-budget     the startup budget (#389), below
//        npx electron scripts/smoke.js --phone-gates <out-dir>  gates-only page, simulated data
//
// Never calls a real model: MULTIAGENT_SIMULATION_ONLY=1 makes the engine refuse real runs, the app
// opens a fresh temporary workspace (never the user's) with Developer mode on, and the script fails
// unless every session of the run was simulated. Write UI checks as scripts like this one, never as
// a hand-written script that launches apps/desktop/host/main directly.
//
// --startup-budget (#389): the scratch workspace gets STARTUP_RUNS runs (indexed by an older
// READ_VERSION, as after an update) and a CLI home of STARTUP_SESSIONS Claude Code transcripts. The
// app opens twice: as it is, then reloaded with the usage widget in machine scope (the cold scan of
// the transcripts). Each channel's synchronous time in the main process is measured, the main
// process's longest stall (what blocks it after a channel's first await too), and the time from the
// window's creation (then from the reload) to Home's overview on screen. Fails when a first paint
// takes over FIRST_PAINT_MS, a channel blocks the main process over CHANNEL_MS, or anything stalls
// it over STALL_MS.

if (process.argv.includes('--phone-gates')) {
  require('./smoke-phone-gates').run();
  return;
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, ipcMain } = require('electron');
process.env.MULTIAGENT_SIMULATION_ONLY = '1';
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.2';
const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-smoke-ws-'));
process.env.MULTIAGENT_WORKSPACE = wsDir; // scratch workspace, no workspace dialog
// a scratch user data folder too (never the dev app's: its account session and engine connection stay untouched)
process.env.MULTIAGENT_USER_DATA = path.join(wsDir, 'user-data');
fs.mkdirSync(process.env.MULTIAGENT_USER_DATA, { recursive: true });
// --lang <code> (#329): the interface language (a code of packages/shared/i18n/), English by default
// whatever the computer's language, so the checks keep their English selectors
const langAt = process.argv.indexOf('--lang');
const lang = (langAt >= 0 && process.argv[langAt + 1]) || 'en';
app.commandLine.appendSwitch('lang', lang === 'en' ? 'en-US' : lang);
// a workspace already set up: the first-run Setup (#319) would cover the run in the screenshot
fs.writeFileSync(path.join(wsDir, 'settings.json'), JSON.stringify({ setupDone: true, language: { interface: lang } }));

const budget = process.argv.includes('--startup-budget');
const STARTUP_RUNS = 300;
const STARTUP_SESSIONS = 2000;
const FIRST_PAINT_MS = 3000;
const CHANNEL_MS = 200;
// any stall of the main process (the window's own loading counts: 130-210 ms measured on Windows)
const STALL_MS = 500;
const channelTimes = new Map(); // channel → [ms of each call's synchronous part]
const calls = []; // { channel, at, syncMs, answerMs } of every call, in order
if (budget) {
  seedStartupWorkspace();
  // each handler's synchronous part is the time the main process is blocked by the call
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) => handle(channel, (...args) => {
    const t0 = performance.now();
    const call = { channel, at: Date.now(), syncMs: 0, answerMs: null };
    calls.push(call);
    try {
      const out = fn(...args);
      if (out && typeof out.then === 'function') out.then(() => { call.answerMs = performance.now() - t0; }, () => { call.answerMs = performance.now() - t0; });
      else call.answerMs = performance.now() - t0;
      return out;
    } finally {
      call.syncMs = performance.now() - t0;
      if (!channelTimes.has(channel)) channelTimes.set(channel, []);
      channelTimes.get(channel).push(call.syncMs);
    }
  });
}
require('@craftorio/desktop/host/main');

// The screens the desktop composition ships (apps/desktop/composition.js): the UI kit's views and each
// front's, read through scripts/source-tree.js, so the smoke fails when a shipped screen does not load.
function composedViews() {
  const tree = require('./source-tree');
  const root = path.join(__dirname, '..');
  const kit = tree.uiKit(root);
  return [...(kit ? tree.viewsOf(root, kit.dir) : []), ...tree.composition(root, 'apps/desktop').fronts.flatMap((f) => tree.viewsOf(root, f.dir))];
}

const out = process.argv.find((a) => a.endsWith('.png')) || path.join(__dirname, '..', 'runs', 'smoke.png');
setTimeout(() => { console.error('smoke: timed out'); app.exit(1); }, budget ? 180000 : 90000);

// The runs (each a finished simulated run with a summary) and a CLI home with Claude Code transcripts;
// the run index is built, then left as an older READ_VERSION would have left it.
function seedStartupWorkspace() {
  const jl = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
  const runsDir = path.join(wsDir, 'runs');
  for (let i = 0; i < STARTUP_RUNS; i++) {
    const id = `20260901-${String(i).padStart(6, '0')}-seed`;
    const dir = path.join(runsDir, id);
    const started = new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString();
    const finished = new Date(Date.UTC(2026, 8, 1, 0, i, 30)).toISOString();
    const status = i % 10 === 0 ? 'failed' : 'success';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), jl(
      { ts: started, type: 'workflow.started', workflow: 'writer-reviewer', file: 'writer-reviewer.yaml', inputs: { task: `Seeded task ${i}` }, mock: true },
      { ts: finished, type: 'workflow.finished', status, ...(status === 'failed' ? { error: 'seeded failure' } : {}) },
    ));
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: id, workflow: 'writer-reviewer', status, started_at: started, finished_at: finished, duration_ms: 30000, inputs: { task: `Seeded task ${i}` }, sessions: [], mock: true,
    }));
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-smoke-home-'));
  const projects = path.join(home, 'projects', 'C--seed');
  fs.mkdirSync(projects, { recursive: true });
  for (let f = 0; f < STARTUP_SESSIONS; f++) {
    const lines = [{ type: 'user', sessionId: `seed-${f}`, timestamp: '2026-09-27T09:00:00Z', message: { content: 'hello' } }];
    for (let m = 0; m < 20; m++) {
      lines.push({ type: 'assistant', sessionId: `seed-${f}`, requestId: `r-${f}-${m}`, timestamp: '2026-09-27T09:00:01Z', message: { id: `m-${f}-${m}`, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 20 } } });
    }
    fs.writeFileSync(path.join(projects, `seed-${f}.jsonl`), jl(...lines));
  }
  process.env.CLAUDE_CONFIG_DIR = home;
  process.env.CODEX_HOME = path.join(home, 'codex');
  const ws = { root: wsDir, runs: runsDir, backlog: path.join(wsDir, 'backlog'), index: path.join(wsDir, 'index.db') };
  const { openStore } = require('@craftorio/engine/domains/workspace/store');
  const runs = require('@craftorio/engine/domains/run/runs');
  const store = openStore(ws);
  runs.listRuns(runsDir);
  for (const [, row] of store.runEntries()) store.putRun(row.info, String(row.sig).replace(/\|[^|]*$/, '|an-older-reading'), null);
  store.close();
  console.log(`startup budget: seeded ${STARTUP_RUNS} runs and ${STARTUP_SESSIONS} CLI transcripts`);
}

// ms from `since` until Home's overview is on screen
async function homeShown(js, since) {
  for (const deadline = Date.now() + 60000; Date.now() < deadline;) {
    if (await js(`!!document.querySelector('[data-testid="home-flow-strip"], [data-testid="home-empty"]')`)) return Date.now() - since;
    await new Promise((r) => setTimeout(r, 25));
  }
  return Infinity;
}

async function startupBudget(win, createdAt) {
  const js = (code) => win.webContents.executeJavaScript(code);
  const problems = [];
  // the calls asked before Home showed: when (from `since`), how long they blocked, when they answered
  const timeline = (since, paint) => {
    for (const c of calls.filter((x) => x.at >= since && x.at - since <= paint)) {
      console.log(`  +${String(c.at - since).padStart(5)} ms  ${c.channel}: blocked ${Math.round(c.syncMs)} ms, answered in ${c.answerMs == null ? '(pending)' : `${Math.round(c.answerMs)} ms`}`);
    }
  };
  // the main process's longest stall: whatever blocks it after a channel's first await shows here
  let last = performance.now();
  let maxGap = 0;
  const gaps = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last - 10); last = now; }, 10);
  const firstPaint = await homeShown(js, createdAt);
  console.log(`startup budget: first paint (Home) ${firstPaint} ms after the window was created`);
  timeline(createdAt, firstPaint);
  // the owner's case: the usage widget in machine scope, its transcripts never scanned yet
  await js(`localStorage.setItem('multiagent.usageScope', 'machine')`);
  const reloadAt = Date.now();
  win.webContents.reload();
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  const loadedMs = Date.now() - reloadAt;
  const secondPaint = await homeShown(js, reloadAt);
  console.log(`startup budget: first paint after a reload in machine scope ${secondPaint} ms (page loaded in ${loadedMs} ms)`);
  timeline(reloadAt, secondPaint);
  // until the usage widget has its figures (its scan runs in the worker meanwhile)
  for (const deadline = Date.now() + 60000; Date.now() < deadline;) {
    if (await js(`document.querySelector('[data-testid="usage-widget"]')?.getAttribute('aria-busy') !== 'true'`)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`startup budget: usage widget loaded ${Date.now() - reloadAt} ms after the reload`);
  clearInterval(gaps);
  console.log(`startup budget: the main process's longest stall ${Math.round(maxGap)} ms`);
  if (maxGap > STALL_MS) problems.push(`the main process stalled ${Math.round(maxGap)} ms (budget ${STALL_MS} ms)`);
  for (const [name, ms] of [['first paint', firstPaint], ['first paint after the reload', secondPaint]]) {
    if (ms > FIRST_PAINT_MS) problems.push(`${name}: ${ms} ms (budget ${FIRST_PAINT_MS} ms)`);
  }
  const rows = [...channelTimes].map(([channel, times]) => ({ channel, calls: times.length, maxMs: Math.round(Math.max(...times)) })).sort((a, b) => b.maxMs - a.maxMs);
  for (const r of rows.slice(0, 15)) console.log(`  ${String(r.maxMs).padStart(5)} ms  ${r.channel} (${r.calls} calls)`);
  for (const r of rows) if (r.maxMs > CHANNEL_MS) problems.push(`${r.channel} blocked the main process ${r.maxMs} ms (budget ${CHANNEL_MS} ms)`);
  if (problems.length) { console.error('startup budget: FAILED\n  ' + problems.join('\n  ')); app.exit(1); return; }
  console.log('startup budget: ok');
  app.quit();
}

// Every session of every run in the scratch workspace, with its provider: all must be 'mock' (the
// orchestrator's is 'engine', the deterministic walk, which calls no model).
function realSessions() {
  const runsDir = path.join(wsDir, 'runs');
  const found = [];
  for (const run of fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : []) {
    const dir = path.join(runsDir, run, 'sessions');
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        const provider = line.trim() && JSON.parse(line).session?.provider;
        if (provider && provider !== 'mock' && provider !== 'engine') found.push(`${run}/${f}: ${provider}`);
      }
    }
  }
  return found;
}

app.on('browser-window-created', (_e, win) => {
  const createdAt = Date.now();
  // Electron 35+: the details come in the event object
  win.webContents.on('console-message', (ev) => console.log(`[renderer:${ev.level}] ${ev.message}`));
  if (budget) {
    win.webContents.once('did-finish-load', () => startupBudget(win, createdAt).catch((e) => { console.error('smoke:', e); app.exit(1); }));
    return;
  }
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    await new Promise((r) => setTimeout(r, 1500));
    // Registers this repository as a project, opens the "Start" panel and launches the workflow.
    const repo = JSON.stringify(path.join(__dirname, '..'));
    await js(`(async () => {
      const p = await api.createProject({ name: 'multiagent', folder: ${repo} });
      await api.setSettings({ developerMode: true, lastWorkflow: 'software-development.yaml' });
      openDrawer(); // #412: Start left the top bar
      await new Promise((r) => setTimeout(r, 500));
      document.querySelector('#project-select').value = p.id;
      document.querySelector('#in-task').value = 'Add a /health endpoint';
      document.querySelector('#mock-toggle').checked = true;
      if (!document.body.classList.contains('dev-mode')) throw new Error('developer mode is off: refusing to start a real run');
      document.querySelector('#btn-start').click();
    })()`);
    const timer = setInterval(() => js(`document.querySelector('#run-gates:not(.hidden) .run-gate-actions button[data-choice]:not(:disabled), #run-gates:not(.hidden) button[data-answer=\"true\"]:not(:disabled)')?.click()`), 1000);
    setTimeout(() => finish().catch((e) => { console.error('smoke:', e); app.exit(1); }), 45000);
    async function finish() {
      clearInterval(timer);
      await js(`document.querySelectorAll('.session-card')[1]?.click()`);
      await new Promise((r) => setTimeout(r, 500));
      const img = await win.webContents.capturePage();
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, img.toPNG());
      console.log('screenshot:', out);
      console.log('status:', await js(`document.querySelector('[data-testid=run-screen-status]').textContent`), '| error:', await js(`document.querySelector('#start-error').textContent`));
      const real = realSessions();
      if (real.length) { console.error('smoke: sessions that were not simulated:', real); app.exit(1); return; }
      // phase 3 of the reorganisation study: every screen of the app's composition registered (the
      // UI kit's and each shipped front's views/<view>/ folders, scripts/source-tree.js)
      const ids = await js('ViewRegistry.ids()');
      const missing = composedViews().filter((v) => !ids.includes(v));
      if (missing.length) { console.error('smoke: screens of the composition that did not register:', missing); app.exit(1); return; }
      console.log(`screens: ${ids.length} registered, the composition's ${composedViews().length} among them`);
      console.log('sessions: all simulated (mock)');
      app.quit();
    }
  });
});
