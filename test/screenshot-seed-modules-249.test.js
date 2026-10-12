// #249: each screenshot seed module (scripts/screenshot/views/<view>.js) run against a scratch
// workspace in plain Node, after the same base the runner writes (a demo project, the settings with
// the Setup done): every seed runs without Electron, the events it writes carry run_id and seq, and
// the setup view's seed is the only one that turns the Setup back to a first run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEMO_REPO, demoBacklog, parseArgs, VIEWS } = require('../scripts/screenshot');

const appDir = path.join(__dirname, '..');
const src = (m) => require(path.join(appDir, 'src', m));
const workspace = src('workspace');
const projects = src('projects');

// the runner's base workspace (scripts/screenshot.js main()), then the view's seed
async function seedView(t, argv) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-view-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const ws = workspace.setupWorkspace(path.join(scratch, 'workspace'), { persist: false });
  const args = parseArgs(argv);
  const created = await projects.createProject(ws.projects, { name: 'demo-app', description: 'Sample project (simulated data)' });
  const project = projects.updateProject(ws.projects, created.id, { repo: DEMO_REPO });
  workspace.writeSettings(ws, { developerMode: true, lastWorkflow: 'software-development.yaml', lastProject: project.id, setupDone: true });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify(demoBacklog(project.id, src('backlog').taskProgress), null, 2));
  const view = VIEWS[args.view];
  if (view.seed) await view.seed({ appDir, args, project, projects, src, workspace, ws });
  return { ws, project };
}

function seededEvents(ws) {
  const out = [];
  if (!fs.existsSync(ws.runs)) return out;
  for (const id of fs.readdirSync(ws.runs)) {
    const file = path.join(ws.runs, id, 'events.jsonl');
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
    lines.forEach((l, i) => out.push({ run: id, line: i + 1, event: JSON.parse(l) }));
  }
  return out;
}

test('--view setup: its seed leaves the Setup not done, the runner\'s other settings kept', async (t) => {
  const { ws, project } = await seedView(t, ['--view', 'setup']);
  const settings = workspace.readSettings(ws);
  assert.equal(settings.setupDone, false);
  assert.equal(settings.lastProject, project.id);
  assert.equal(settings.developerMode, true);
});

test('--view dashboard: the Setup stays done (only the setup view shows a first run)', async (t) => {
  const { ws } = await seedView(t, ['--view', 'dashboard']);
  assert.equal(workspace.readSettings(ws).setupDone, true);
});

test('the release run and the roadmap\'s runs are seeded with events (the run_id / seq checks below see data)', async (t) => {
  // --release (#291) is drawn on the Backlog's roadmap
  for (const argv of [['--view', 'backlog', '--mode', 'roadmap', '--release', 'held'], ['--view', 'roadmap']]) {
    const { ws } = await seedView(t, argv);
    const events = seededEvents(ws);
    assert.ok(events.length > 0, `${argv.join(' ')} wrote no events`);
    assert.deepEqual(events.filter(({ event }) => !event.run_id || !Number.isInteger(event.seq)).map(({ run, line }) => `${run}:${line}`), []);
  }
});

// every view, each of its tabs and modes (the cases test/screenshot.test.js captures) and each value
// of its view-only options (--live, --po, --roadmap, --release…)
const CASES = Object.entries(VIEWS).flatMap(([name, v]) => [
  ['--view', name],
  ...(v.tabs || []).map((tab) => ['--view', name, '--tab', tab]),
  ...(v.modes || []).map((mode) => ['--view', name, '--mode', mode]),
  ...Object.entries(v.options || {}).flatMap(([opt, values]) => values.map((value) => ['--view', name, `--${opt}`, value])),
]);

for (const argv of CASES) {
  test(`${argv.join(' ')}: its seed runs in plain Node and every event it writes has run_id and seq`, async (t) => {
    const { ws } = await seedView(t, argv);
    const bad = seededEvents(ws)
      .filter(({ event }) => typeof event.run_id !== 'string' || !event.run_id || !Number.isInteger(event.seq))
      .map(({ run, line, event }) => `${run}/events.jsonl:${line} ${event.type}`);
    assert.deepEqual(bad, []);
  });
}
