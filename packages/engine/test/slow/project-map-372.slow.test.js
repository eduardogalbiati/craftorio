// #372: whole simulated runs of the Project map workflow (workflows/analyze-project.yaml since #631): facts →
// plan (the mock cartographer) → validate → save → analyze (#381: no gate in the default auto mode,
// the Oracle's simulated report saved after the plan; the gate only in validated mode), on a git
// repository in a temp folder and a temp workspace. The cheaper checks are in
// test/project-map-372.test.js (the contract is in its header). The workflow is loaded inside each
// run (tests first).
//
// Contract assumed by these runs (besides the header of test/project-map-372.test.js):
// - The run is started for a project: WorkflowRun's `projectId` (also given as the input
//   `project_id`) and the input `repo_path` (the project's folder). The workspace is the runs
//   folder's parent (as the engine's other steps take it: path.dirname(path.dirname(runDir))).
// - The mock cartographer answers `mockSequences.city_plan[visit - 1]` (the last one repeats) as its
//   plan; without it, a plan that passes the validation.
// - facts runs for real in a simulation too (git ls-files of repo_path, no model): its output has
//   `folders` and `manifests` (treeCounts / manifestsOf of the tracked files).
// - A refresh: the project already has a saved plan (<workspace>/architecture/<project id>/
//   city-plan.json). The cartographer's prompt starts from it, the plan validated and saved is
//   refreshPlan(current, answered), and the gate's message (or report) shows the districts added and
//   removed and the coverage before and after as whole percents (75%, 100%).
// - save writes <workspace>/architecture/<project id>/city-plan.json the way architecture:savePlan
//   does (the replaced plan goes to city-plan-history/).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');
const { Recorder } = require('../../engine/recorder');
const projects = require('../../domains/project/projects');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'analyze-project.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

// 12 drawn files in 4 areas, plus 2 root files every plan here ignores ('/*')
const FILES = [
  'docs/a.md', 'docs/b.md', 'docs/c.md',
  'src/engine/gates.js', 'src/engine/queue.js', 'src/engine/run.js',
  'src/ui/app.js', 'src/ui/board.js', 'src/ui/list.js',
  'test/gates.test.js', 'test/queue.test.js', 'test/run.test.js',
];

function makeRepo(t) {
  const dir = tmp(t, 'project-map-repo-');
  git(dir, 'init', '-q');
  for (const rel of [...FILES, 'package.json', 'README.md']) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rel === 'package.json' ? '{ "name": "fixture", "version": "1.0.0" }\n' : `// ${rel}\n`);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

const district = (id, name, zone, include) => ({ id, name, zone, purpose: `The ${name}.`, include, exclude: [] });
const zone = (id, name, kind) => ({ id, name, kind, purpose: `The ${name}.` });

function plan({ zones, districts, summary = 'A fixture repository.' }) {
  return { version: 1, project: 'fixture', summary, ignore: ['/*'], zones, districts, landmarks: [{ path: 'src/engine/run.js', label: 'The run loop' }], ports: [], evidence: ['package.json'] };
}

// every drawn file matches a district: coverage 100%
const VALID = plan({
  zones: [zone('core', 'Core', 'industrial'), zone('ui', 'UI', 'commercial'), zone('campus', 'Campus', 'campus'), zone('books', 'Books', 'library')],
  districts: [
    district('engine', 'Engine', 'core', ['/src/engine/**']),
    district('views', 'Views', 'ui', ['/src/ui/**']),
    district('tests', 'Tests', 'campus', ['/test/**']),
    district('docs', 'Docs', 'books', ['/docs/**']),
  ],
});

// only the engine: 3 of 12 drawn files, coverage 25% (src/ui/app.js among the unmatched)
const INVALID = plan({
  zones: [zone('core', 'Core', 'industrial')],
  districts: [district('engine', 'Engine', 'core', ['/src/engine/**'])],
});

// A mock run recorded as the app records it. Gates are approved (first choice), or rejected (last
// choice) when `reject` is true. `savedPlan`: the project's plan before the run (a refresh).
async function runMap(t, { mockSequences = {}, savedPlan = null, reject = false, inputs = {} } = {}) {
  const repo = makeRepo(t);
  const ws = tmp(t, 'project-map-ws-');
  const runsDir = path.join(ws, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const project = await projects.createProject(path.join(ws, 'projects'), { name: 'map-372', folder: repo });
  const archDir = path.join(ws, 'architecture', project.id);
  if (savedPlan) {
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(path.join(archDir, 'city-plan.json'), `${JSON.stringify(savedPlan, null, 2)}\n`);
  }
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { repo_path: repo, project_id: project.id, ...inputs },
    mock: true,
    runsDir,
    projectId: project.id,
    mockSequences,
  });
  const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
  const events = [];
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const choices = ev.choices || [];
      const answer = choices.length ? choices[reject ? choices.length - 1 : 0].id : !reject;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user'));
    }
  });
  await run.start();
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const visits = (id) => events.filter((e) => e.type === 'step.started' && e.step_id === id).length;
  const promptsOf = (id) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === id).map((e) => String(e.prompt || ''));
  const outputOf = (id) => events.filter((e) => e.type === 'step.finished' && e.step_id === id).map((e) => e.output).pop();
  const gates = events.filter((e) => e.type === 'approval.requested');
  const savedFile = path.join(archDir, 'city-plan.json');
  const saved = () => JSON.parse(fs.readFileSync(savedFile, 'utf8'));
  return { events, transitions, visits, promptsOf, outputOf, gates, finished: events.find((e) => e.type === 'workflow.finished'), runDir: run.runDir, archDir, savedFile, saved };
}

const ids = (xs) => xs.map((x) => x.id).sort().join(',');
const count = (xs, x) => xs.filter((y) => y === x).length;

test('#381 project map: a valid plan goes facts → plan → validate → save → analyze with no gate, the plan and the report are saved', { timeout: 120000 }, async (t) => {
  const r = await runMap(t, { mockSequences: { city_plan: [VALID] } });
  assert.equal(r.finished.status, 'success', r.finished.error);
  for (const tr of ['facts>plan', 'plan>validate', 'validate>save', 'save>analyze', 'analyze>end']) assert.ok(r.transitions.includes(tr), `${tr} in ${r.transitions.join(', ')}`);
  assert.equal(r.visits('plan'), 1, 'one plan round');
  assert.equal(r.gates.length, 0, 'no gate in auto mode');
  assert.equal(r.visits('gate'), 0);
  assert.ok(fs.existsSync(r.savedFile), 'architecture/<project>/city-plan.json');
  const saved = r.saved();
  assert.equal(saved.project, 'fixture');
  assert.equal(ids(saved.districts), 'docs,engine,tests,views');
  // the Oracle's report, simulated (no model), saved next to the plan as architecture:analyze saves it
  const reports = fs.readdirSync(r.archDir).filter((f) => f.endsWith('.json') && f !== 'city-plan.json');
  assert.equal(reports.length, 1, `one report in ${fs.readdirSync(r.archDir).join(', ')}`);
  const report = JSON.parse(fs.readFileSync(path.join(r.archDir, reports[0]), 'utf8'));
  assert.equal(report.simulated, true);
  assert.ok(report.report && typeof report.report.summary === 'string', 'a report with a summary');
  const out = r.outputOf('analyze');
  assert.equal(out.simulated, true);
  assert.equal(out.report_id, report.id);
});

test('#381 project map: validated mode shows the plan at a gate before it is saved; approved, the analysis follows', { timeout: 120000 }, async (t) => {
  const r = await runMap(t, { mockSequences: { city_plan: [VALID] }, inputs: { mode: 'validated' } });
  assert.equal(r.finished.status, 'success', r.finished.error);
  for (const tr of ['validate>gate', 'gate>save', 'save>analyze']) assert.ok(r.transitions.includes(tr), `${tr} in ${r.transitions.join(', ')}`);
  assert.equal(r.gates.length, 1, 'one gate: the plan\'s');
  const [gate] = r.gates;
  const shown = `${gate.message || ''}\n${gate.report || ''}\n${JSON.stringify(gate.brief || {})}`;
  for (const name of ['Engine', 'Views', 'Tests', 'Docs']) assert.ok(shown.includes(name), `the district ${name} is shown`);
  assert.match(shown, /coverage/i, 'the validation');
  assert.ok(fs.existsSync(r.savedFile), 'the plan is saved once approved');
});

test('#381 project map: validated mode, rejected: nothing is saved and nothing is analysed', { timeout: 120000 }, async (t) => {
  const r = await runMap(t, { mockSequences: { city_plan: [VALID] }, inputs: { mode: 'validated' }, reject: true });
  assert.equal(r.finished.status, 'cancelled', r.transitions.join(', '));
  assert.equal(r.visits('save'), 0);
  assert.equal(r.visits('analyze'), 0);
  assert.equal(fs.existsSync(r.savedFile), false, 'nothing saved');
});

test('#381 project map: with the analysis off the run ends after the plan is saved', { timeout: 120000 }, async (t) => {
  const r = await runMap(t, { mockSequences: { city_plan: [VALID] }, inputs: { analyze: false } });
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.ok(r.transitions.includes('save>end'), r.transitions.join(', '));
  assert.equal(r.visits('analyze'), 0);
  assert.deepEqual(fs.readdirSync(r.archDir).filter((f) => f.endsWith('.json')), ['city-plan.json'], 'the plan only');
});

test('#372 project map: the facts step counts the tree by folder and finds the manifests', { timeout: 120000 }, async (t) => {
  const r = await runMap(t, { mockSequences: { city_plan: [VALID] } });
  assert.equal(r.finished.status, 'success', r.finished.error);
  const facts = r.outputOf('facts');
  assert.ok(facts, 'the facts step finished with an output');
  assert.equal(facts.folders.src, 6);
  assert.equal(facts.folders['src/engine'], 3);
  assert.equal(facts.folders['(root)'], 2);
  assert.equal(facts.manifests.join(','), 'package.json');
});

test('#372 project map: a plan that fails the validation takes one more round with the report, then passes', { timeout: 120000 }, async (t) => {
  const r = await runMap(t, { mockSequences: { city_plan: [INVALID, VALID] } });
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.equal(count(r.transitions, 'validate>plan'), 1, r.transitions.join(', '));
  assert.equal(r.visits('plan'), 2);
  assert.equal(r.visits('validate'), 2);
  assert.ok(r.transitions.includes('validate>save'));
  // the second round is told why: the coverage and an unmatched file
  const second = r.promptsOf('plan')[1] || '';
  assert.match(second, /coverage/i);
  assert.ok(second.includes('src/ui/app.js'), 'an unmatched file is named');
  assert.equal(ids(r.saved().districts), 'docs,engine,tests,views', 'the valid plan is the one saved');
});

test('#372 project map: an invalid plan every time fails the run after 2 more rounds, shows the report and saves nothing', { timeout: 120000 }, async (t) => {
  const r = await runMap(t, { mockSequences: { city_plan: [INVALID] }, reject: true });
  assert.equal(r.finished.status, 'failed', r.transitions.join(', '));
  assert.equal(count(r.transitions, 'validate>plan'), 2, r.transitions.join(', '));
  assert.equal(r.visits('plan'), 3);
  assert.equal(r.visits('gate'), 0, 'the plan gate never opens');
  assert.equal(r.visits('save'), 0);
  assert.equal(fs.existsSync(r.savedFile), false, 'nothing saved');
  const resultMd = path.join(r.runDir, 'result.md');
  const shown = [r.finished.error || '', ...r.gates.map((g) => `${g.message || ''}\n${g.report || ''}`), fs.existsSync(resultMd) ? fs.readFileSync(resultMd, 'utf8') : ''].join('\n');
  assert.match(shown, /coverage/i, 'the validation report is shown');
});

// ---------- a refresh ----------

const CURRENT = plan({
  summary: 'Before the refresh.',
  zones: [zone('core', 'Core (owner)', 'industrial'), zone('ui', 'Screens', 'commercial'), zone('books', 'Books', 'library')],
  districts: [
    district('engine', 'Run machine (owner)', 'core', ['/src/engine/**']),
    district('views', 'Views', 'ui', ['/src/ui/**']),
    district('docs', 'Docs', 'books', ['/docs/**']),
  ],
});

// the cartographer renames what the owner named and adds the tests
const PROPOSED = plan({
  summary: 'After the refresh.',
  zones: [zone('core', 'Core logic', 'industrial'), zone('ui', 'UI', 'commercial'), zone('books', 'Books', 'library'), zone('campus', 'Campus', 'campus')],
  districts: [
    district('engine', 'Engine', 'core', ['/src/engine/**']),
    district('views', 'View layer', 'ui', ['/src/ui/**']),
    district('docs', 'Docs', 'books', ['/docs/**']),
    district('tests', 'Tests', 'campus', ['/test/**']),
  ],
});

test('#372 project map: a refresh starts from the current plan, keeps its ids and the names the owner edited, and adds districts', { timeout: 120000 }, async (t) => {
  const r = await runMap(t, { savedPlan: CURRENT, mockSequences: { city_plan: [PROPOSED] } });
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.ok((r.promptsOf('plan')[0] || '').includes('Run machine (owner)'), 'the cartographer starts from the current plan');
  const saved = r.saved();
  assert.equal(ids(saved.districts), 'docs,engine,tests,views');
  assert.equal(saved.districts.find((d) => d.id === 'engine').name, 'Run machine (owner)');
  assert.equal(saved.districts.find((d) => d.id === 'views').name, 'Views');
  assert.equal(saved.zones.find((z) => z.id === 'core').name, 'Core (owner)');
  assert.equal(saved.districts.find((d) => d.id === 'tests').name, 'Tests');
  // saved as architecture:savePlan saves: the plan it replaced is kept
  assert.equal(fs.readdirSync(path.join(r.archDir, 'city-plan-history')).length, 1);
});

test('#372 project map: the refresh gate (validated mode) shows the districts added and the coverage before and after', { timeout: 120000 }, async (t) => {
  const r = await runMap(t, { savedPlan: CURRENT, mockSequences: { city_plan: [PROPOSED] }, inputs: { mode: 'validated' } });
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.equal(r.gates.length, 1);
  const shown = `${r.gates[0].message || ''}\n${r.gates[0].report || ''}`;
  assert.match(shown, /added/i);
  assert.ok(shown.includes('tests'), 'the added district');
  assert.match(shown, /removed/i);
  assert.ok(shown.includes('75%'), 'the coverage before (9 of 12 files)');
  assert.ok(shown.includes('100%'), 'the coverage after');
});
