// Screenshot seed of a project's screen (--view project, opened with openProjectView): the local merge
// (its run list's "issue from cache" badge, #168), the demo roadmap's runs (#289: tonight's runs and
// the artifact runs expanded), child runs, a long run history and a simulated run.
// #354: --tab overview | conflicts | architecture | refactor opens that tab of the page. The Conflict
// map tab (conflicts) reads a demo git repository with three nights of merged runs (views/analytics.js)
// and the saved conflict map (views/backlog.js); a row opened: --click "[data-testid=project-conflict-row]".
// Its states, --mode: not-git (the folder is a plain folder), no-runs (a git repository no run
// merged into), loading (analytics:performance never answers).
// #356: the Architecture tab (architecture) reads a demo repository in two languages (JavaScript and
// Python, months of commits, a pair that changes together) with two saved Oracle reports (the latest
// with a new and a kept finding, the previous one's gone finding) and six real runs since. Its
// states, --mode: not-git, never (no report), empty (a repository with no commit), analyzing
// (architecture:analyze never answers) and error (it fails), the last two after a click on Analyze.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { demoPerformanceRuns } = require('./analytics');
const { demoConflictMap } = require('./backlog');
const { demoLocalMerge } = require('./releases');
const { demoRoadmap } = require('./roadmap');
const { demoChildRuns, demoRunHistory } = require('./workflows');

const jsBody = (n) => `function discount(total) {\n  return total > 100 ? total * 0.9 : total;\n}\n${Array.from({ length: n }, (_, i) => `const rate${i} = ${i};`).join('\n')}\nmodule.exports = { discount };\n`;
const pyBody = (n) => `def discount(total):\n    return total * 0.9 if total > 100 else total\n${Array.from({ length: n }, (_, i) => `RATE_${i} = ${i}`).join('\n')}\n`;
const ARCH_COMMITS = [
  ['2026-05-04', 'Add billing, the API and the export', { 'src/billing.js': jsBody(20), 'src/api.js': jsBody(8), 'tools/export.py': pyBody(10), 'README.md': '# demo-app\n' }],
  ['2026-06-02', 'Change the discount rule', { 'src/billing.js': jsBody(40), 'tools/export.py': pyBody(14) }],
  ['2026-07-07', 'Grow billing', { 'src/billing.js': jsBody(60), 'src/api.js': jsBody(12) }],
  ['2026-08-11', 'Discount for partners', { 'src/billing.js': jsBody(90), 'tools/export.py': pyBody(20) }],
  ['2026-09-15', 'Export in CSV', { 'tools/export.py': pyBody(30), 'src/billing.js': jsBody(120) }],
];

const finding = (kind, title, files, severity, evidence, refactor) => ({ kind, title, files, severity, evidence, refactor });
const DUPLICATED = finding('duplicated-rule', 'Discount rule duplicated in the API and the export', [{ path: 'src/billing.js', lines: '1-3' }, { path: 'tools/export.py', lines: '1-2' }], 'medium', 'Both files apply 10% off above 100; they changed together in 4 of 4 commits.', 'Keep the rule in one module the export calls.');

// The two saved reports (the steps' shape, src/oracle-architecture.js saveReport) and six real runs since
function demoArchitectureReports(ws, projectId, head) {
  const dir = path.join(ws.root, 'architecture', projectId);
  fs.mkdirSync(dir, { recursive: true });
  const save = (date, costUsd, report) => {
    const id = date.replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, date, project_id: projectId, head, costUsd, tokens: { input: 9100, output: 2900 }, simulated: false, report }, null, 2));
  };
  save('2026-09-20T09:00:00.000Z', 0.38, {
    summary: 'Billing grows in one file; the export script keeps its own copy of the rules.',
    areas: [{ area: 'src', verdict: 'billing.js holds every rule.' }],
    findings: [DUPLICATED, finding('test-gap', 'No test pins the export', [{ path: 'tools/export.py', lines: '1-30' }], 'low', 'No test file names the export.', 'Add characterization tests for the CSV export.')],
  });
  save('2026-10-01T09:00:00.000Z', 0.42, {
    summary: 'Billing rules are split between the API and the export script.',
    areas: [{ area: 'src', verdict: 'The API holds the billing rules.' }, { area: 'tools', verdict: 'The export repeats one of them.' }],
    findings: [DUPLICATED, finding('oversized-unit', 'billing.js grows with every pricing change', [{ path: 'src/billing.js', lines: '1-124' }], 'high', '124 lines, changed in 4 of the last 4 months: the top hotspot.', 'Split partner pricing out of billing.js into its own module.')],
  });
  for (let i = 1; i <= 6; i++) {
    const runId = `20261002-0${i}0000-arch000${i}`;
    const runDir = path.join(ws.runs, runId);
    const startedAt = `2026-10-0${i + 1}T10:00:00.000Z`;
    const finishedAt = `2026-10-0${i + 1}T10:30:00.000Z`;
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), [
      { type: 'workflow.started', ts: startedAt, run_id: runId, seq: 1, workflow: 'software-development', project_id: projectId },
      { type: 'workflow.finished', ts: finishedAt, run_id: runId, seq: 2, status: 'success' },
    ].map((e) => JSON.stringify(e)).join('\n'));
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ workflow: 'software-development', status: 'success', mock: false, project_id: projectId, started_at: startedAt, finished_at: finishedAt, sessions: [] }));
  }
}

// A repository in two languages, its history on main → its head commit
function demoArchitectureRepo(folder, commits = ARCH_COMMITS) {
  const git = (a, date) => execFileSync('git', ['-C', folder, '-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'core.autocrlf=false', ...a], { stdio: 'pipe', env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } });
  git(['init', '-q', '-b', 'main']);
  for (const [day, message, files] of commits) {
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
      fs.writeFileSync(path.join(folder, rel), text);
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', message], `${day}T10:00:00Z`);
  }
  return commits.length ? String(git(['rev-parse', 'HEAD'])).trim() : null;
}

// #372: a saved city plan that only covers src/: tools/export.py matches no district (50% of the
// drawn files, and a new top-level folder), so the tab advises "Refresh the map"
function demoCityPlan(ws, projectId) {
  const dir = path.join(ws.root, 'architecture', projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'city-plan.json'), JSON.stringify({
    version: 1, project: 'demo-app', summary: 'The billing API and its export tools (simulated data).',
    zones: [{ id: 'core', name: 'Billing core', kind: 'industrial', purpose: 'The billing rules.' }],
    districts: [{ id: 'billing', name: 'Billing rules', zone: 'core', purpose: 'Prices and discounts.', include: ['/src/**'] }],
  }, null, 2));
}

function seedArchitecture(args, ws, project) {
  if (args.mode === 'not-git') return;
  const head = demoArchitectureRepo(project.folder, args.mode === 'empty' ? [] : ARCH_COMMITS);
  if (head && args.mode !== 'never') demoArchitectureReports(ws, project.id, { commit: head, date: '2026-09-15T10:00:00Z' });
  if (args.mode === 'map-refresh') demoCityPlan(ws, project.id);
}

function seed({ args, ws, project }) {
  demoLocalMerge(ws, project.id);
  demoRoadmap(ws, project.id, args.live, args.budget, args.roadmap);
  demoChildRuns(ws, project.id);
  demoRunHistory(ws, project.id);
  if (args.tab === 'architecture') return seedArchitecture(args, ws, project);
  if (args.tab !== 'conflicts' || args.mode === 'not-git') return;
  if (args.mode === 'no-runs') {
    const git = (a) => execFileSync('git', ['-C', project.folder, ...a], { stdio: 'pipe' });
    git(['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(project.folder, 'README.md'), '# demo-app\n');
    git(['add', '-A']);
    git(['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', 'commit', '-q', '-m', 'Initial commit']);
    return;
  }
  demoPerformanceRuns(ws, project.folder, project.id);
  fs.mkdirSync(ws.backlog, { recursive: true });
  demoConflictMap(ws, project.id);
}

const open = ({ js, project }) => js(`openProjectView(${JSON.stringify(project.id)})`);

async function afterOpen({ args, click }) {
  if (!args.tab) return;
  // the tab's first read never ends: its loading state stays on screen
  if (args.tab === 'conflicts' && args.mode === 'loading') {
    const { ipcMain } = require('electron');
    ipcMain.removeHandler('analytics:performance');
    ipcMain.handle('analytics:performance', () => new Promise(() => {}));
  }
  // #356: the analysis never ends (its progress stays on screen) or fails with the Oracle's error
  const analysis = { analyzing: () => new Promise(() => {}), error: () => { throw new Error('The Oracle\'s answer is not a valid architecture report: report.summary: required.'); } }[args.mode];
  if (args.tab === 'architecture' && analysis) {
    const { ipcMain } = require('electron');
    ipcMain.removeHandler('architecture:analyze');
    ipcMain.handle('architecture:analyze', analysis);
  }
  await click(`[data-pv-tab="${args.tab}"]`);
  if (args.tab === 'architecture' && analysis) await click('[data-testid="architecture-analyze"]');
}

module.exports = {
  afterOpen,
  modes: ['analyzing', 'empty', 'error', 'loading', 'map-refresh', 'never', 'no-runs', 'not-git'],
  open,
  run: true,
  seed,
  tabs: ['overview', 'conflicts', 'architecture', 'refactor'],
};
