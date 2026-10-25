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
// #373: --mode city switches the tab to its City view, on a bigger demo repository (four folders, 31
// more files) with a city plan: four zones of different kinds, five districts, a landmark and a port.
// #374: --mode city-agents is that city with two simulated runs in progress on it (architecture:agents
// answers demoCityAgents): agents on a roof and at a door, a crane, the trails, a new building and a
// collision risk.
// #375: --mode city-issue is that city with an open issue's impact preview ("Show on the map": the
// files its body cites, the Product Owner's group, a new file expected in a district, the header with
// the counts and the Danger Zone share); --mode city-stage shows a roadmap stage's footprint ("Show the
// stage on the map": each item its colour, a building two items would change in red).
// #376: --mode city-release is that city at release 1.1.1 in grey with release 1.1.2 in colour ("Show
// on the map" of a release: a new file, changes on the ramp, a removed guide, a renamed script, the
// header with the two-tag picker and the issue filter).
// #382: --mode city-large is the City view at a real scale: the project is this repository itself
// (the checkout the screenshot runs from, about 1,400 drawn files) with the proof of concept's city
// plan (poc/project-map/plans/multiagent-orchestrator.city-plan.json), the one the POC's overview
// drew, so the two can be compared side by side. Its facts come from the checkout's git history.
// #387: --mode large is the Architecture tab with a latest report of production-like volume (the
// 60 findings and seven areas of the shared largeProjectFixture, helpers.js).
// #386: --mode facts-large is the Facts view at a real scale: the project is this repository itself
// (about 1,400 files, its languages and Danger Zone from the checkout's git history) with those 60
// findings moved onto its largest source files, so their scores use its Danger Zone.
// #360: --mode seeds is the Architecture tab scrolled to its Seeds section: churn-complexity's result
// (stale: commits since its run), two seeds never run and dependency-map with a tool (runs free); open
// the result with --click "[data-testid=seed-open-churn-complexity]". --mode seeds-running and
// seeds-error click Run on quality-gate-report (seeds:run never answers, or fails).
// #357: the Refactor tab (refactor) on the Architecture demo: five proposals ranked by the Product
// Owner (one filed and planned, one done that left the Danger Zone, one not improved, one dismissed:
// --click "[data-testid=refactor-filter-dismissed]"), the cadence on with "next in 4 runs". Its states,
// --mode: never (no Architecture report), empty (a report, no proposal), prioritizing
// (refactor:prioritize never answers) and error (it fails), the last two after a click on prioritize.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { largeProjectFixture } = require('../helpers');
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

// The two saved reports (the steps' shape, packages/engine/domains/oracle/oracle-architecture.js saveReport) and six real runs since
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

// #373: a bigger city: four folders of files of growing size, then a city plan with a landmark and a port
const cityFile = (n) => `${Array.from({ length: n }, (_, i) => `function step${i}(x) {\n  return x > ${i} ? x - ${i} : x + ${i};\n}`).join('\n')}\nmodule.exports = {};\n`;
const CITY_FOLDERS = { 'packages/engine/engine': 9, 'apps/desktop/renderer/views': 12, 'docs/guides': 6, 'scripts/build': 4 };
const CITY_COMMITS = [
  ...ARCH_COMMITS,
  ['2026-09-22', 'Grow the engine and the views', Object.fromEntries(Object.entries(CITY_FOLDERS).flatMap(([dir, n]) => Array.from({ length: n }, (_, i) => [
    `${dir}/${dir.startsWith('docs') ? `guide-${i}.md` : `part-${i}.js`}`, dir.startsWith('docs') ? `# Guide ${i}\n${'Text.\n'.repeat(4 + i * 3)}` : cityFile(2 + ((i * 7) % 11)),
  ])))],
  ['2026-09-29', 'Tune the engine', { 'packages/engine/engine/part-0.js': cityFile(16), 'packages/engine/engine/part-3.js': cityFile(12), 'apps/desktop/renderer/views/part-1.js': cityFile(14) }],
];
const CITY_PLAN = {
  version: 1, project: 'demo-app', summary: 'Billing, its engine and views, with the export and the docs.',
  zones: [
    { id: 'core', name: 'Core', kind: 'industrial', purpose: 'Billing and the engine.' },
    { id: 'ui', name: 'Interface', kind: 'commercial', purpose: 'What people see.' },
    { id: 'tooling', name: 'Tooling', kind: 'workshop', purpose: 'Build and export scripts.' },
    { id: 'books', name: 'Library', kind: 'library', purpose: 'Docs.' },
  ],
  districts: [
    { id: 'billing', name: 'Billing', zone: 'core', include: ['src/billing.js', 'src/api.js'] },
    { id: 'engine', name: 'Engine', zone: 'core', include: ['packages/engine/engine/**'] },
    { id: 'views', name: 'Views', zone: 'ui', include: ['apps/desktop/renderer/**'] },
    { id: 'scripts', name: 'Scripts', zone: 'tooling', include: ['scripts/**', 'tools/**'] },
    { id: 'guides', name: 'Guides', zone: 'books', include: ['docs/**', 'README.md'] },
  ],
  landmarks: [{ path: 'src/billing.js', label: 'Billing rules' }],
  ports: [{ id: 'payments', name: 'Payments API', via: ['src/api.js', 'src/billing.js'] }],
};

// #374: two runs in progress on the city (architecture:agents' answer, simulated data): a developer
// changing an engine file (its building has uncommitted changes: a crane), a reviewer reading the
// billing rules, a second run's developer writing a file the city does not have yet, and both runs
// changing src/billing.js (a collision risk)
const agentAt = (session_id, agent, step, p, kind, provider, model) => ({ session_id, agent, step, provider, model, tool: kind === 'change' ? 'Edit' : 'Read', kind, path: p, ts: '2026-10-13T10:05:00.000Z' });
const demoCityAgents = (projectId) => ({
  projectId,
  runs: [
    {
      id: '20261013-100000-c1ty0001', workflow: 'software-development', colour: '#e4572e',
      agents: [
        agentAt('s-dev-1', 'developer', 'implement', 'packages/engine/engine/part-3.js', 'change', 'claude', 'claude-opus-5-5'),
        agentAt('s-rev-1', 'reviewer', 'code_review', 'src/billing.js', 'read', 'codex', 'gpt-5.5'),
      ],
      trail: ['src/billing.js', 'packages/engine/engine/part-0.js', 'packages/engine/engine/part-3.js'],
      dirty: ['packages/engine/engine/part-3.js'],
    },
    {
      id: '20261013-101500-c1ty0002', workflow: 'software-development', colour: '#4c9be8',
      agents: [agentAt('s-dev-2', 'developer', 'implement', 'apps/desktop/renderer/views/part-new.js', 'change', 'claude', 'claude-sonnet-5-5')],
      trail: ['src/billing.js', 'apps/desktop/renderer/views/part-1.js', 'apps/desktop/renderer/views/part-new.js'],
      dirty: [],
    },
  ],
  collisions: [{ path: 'src/billing.js', runs: ['20261013-100000-c1ty0001', '20261013-101500-c1ty0002'] }],
});

// #375: an open issue's impact preview (its body cites two city files, `file:line-line` (#427) and a
// plain path, and its `## Expected files` section (#429) names one of them and a file the city does not
// have yet, expected in Views; the Product Owner's saved group adds an engine file), and a roadmap
// stage of two items that would both change src/billing.js (simulated data)
const DEMO_IMPACT_ISSUE = {
  number: 412, title: 'Apply the loyalty discount to the invoice totals', runs: [],
  body: 'The discount rule lives in `src/billing.js:42-58`; the totals come from packages/engine/engine/part-3.js.\n\n## Expected files\n\n- `src/billing.js`: the discount rule\n- `apps/desktop/renderer/views/part-new.js` (new): the loyalty badge\n',
};
const DEMO_IMPACT_PO = [{ role: 'po', answer: { summary: 'One group.', groups: [{ issues: [412], workflow: 'software-development.yaml', reason: 'Billing rules.', files: ['src/billing.js', 'packages/engine/engine/part-0.js'] }], conflicts: [], enrich: [] } }];
const DEMO_IMPACT_STAGE = {
  name: 'Billing fixes',
  items: [
    { id: 'it-412', number: 412, title: 'Apply the loyalty discount', body: 'Change `src/billing.js` and `packages/engine/engine/part-0.js`.' },
    { id: 'it-413', number: 413, title: 'Round the export totals', body: 'Round in `src/billing.js`, document it in `docs/guides/guide-1.md`.' },
    { id: 'it-414', number: 414, title: 'Faster invoice list', body: 'Paginate `apps/desktop/renderer/views/part-1.js`.' },
  ],
};

// #376: release 1.1.2 after 1.1.1 (the city's head) on simulated data: a new view (#21), the engine
// and billing changed by a few and many lines (#22), a guide removed and a script renamed (#23)
const RELEASE_COMMITS = [
  ['2026-10-06', 'Add the invoice view (#21)', { 'apps/desktop/renderer/views/invoice.js': cityFile(9) }],
  ['2026-10-07', 'Faster engine, partner prices (#22)', { 'packages/engine/engine/part-2.js': cityFile(14), 'packages/engine/engine/part-5.js': cityFile(6), 'src/billing.js': jsBody(220) }],
];
function demoReleaseCity(folder) {
  const git = (a, date) => execFileSync('git', ['-C', folder, '-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'core.autocrlf=false', '-c', 'tag.gpgSign=false', ...a], { stdio: 'pipe', env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } });
  git(['tag', '1.1.1']);
  for (const [day, message, files] of RELEASE_COMMITS) {
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
      fs.writeFileSync(path.join(folder, rel), text);
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', message], `${day}T10:00:00Z`);
  }
  git(['rm', '-q', 'docs/guides/guide-5.md']);
  git(['mv', 'scripts/build/part-1.js', 'scripts/build/bundle.js']);
  git(['commit', '-q', '-m', 'Drop the old guide, name the bundle script (#23)'], '2026-10-08T10:00:00Z');
  git(['tag', '1.1.2']);
}

const LARGE_PLAN = path.join('poc', 'project-map', 'plans', 'multiagent-orchestrator.city-plan.json');

// #387: --mode large, the Architecture tab at a real scale: the latest report holds the 60 findings of
// the shared large-project fixture (scripts/screenshot/helpers.js), over its seven areas
function demoLargeReport(ws, projectId, head, targets = null) {
  const { files, findings } = largeProjectFixture();
  const areas = [...new Set(files.map((f) => f.path.split('/').slice(0, 2).join('/')))]
    .map((area) => ({ area, verdict: `${files.filter((f) => f.path.startsWith(`${area}/`)).length} files; ${findings.filter((x) => x.files[0].path.startsWith(`${area}/`)).length} findings.` }));
  // #386: the findings on the project's own files (its Danger Zone scores them)
  const placed = targets ? findings.map((f, i) => ({ ...f, files: [{ ...f.files[0], path: targets[i % targets.length] }] })) : findings;
  const id = '2026-10-10T09-00-00-000Z';
  fs.mkdirSync(path.join(ws.root, 'architecture', projectId), { recursive: true });
  fs.writeFileSync(path.join(ws.root, 'architecture', projectId, `${id}.json`), JSON.stringify({
    id, date: '2026-10-10T09:00:00.000Z', project_id: projectId, head, costUsd: 1.84, tokens: { input: 64000, output: 9800 }, simulated: false,
    report: { summary: `${files.length} files in ${areas.length} areas; the engine and the views carry most of the findings.`, areas, findings: placed },
  }, null, 2));
}

// #386: the checkout's largest JavaScript files under src/, the likeliest Danger Zone
function largestSourceFiles(dir, count) {
  const listed = execFileSync('git', ['-C', dir, 'ls-files', 'src'], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.js'));
  const size = (f) => { try { return fs.statSync(path.join(dir, f)).size; } catch { return 0; } };
  return listed.map((f) => [f, size(f)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, count).map(([f]) => f);
}

// #360: a churn-complexity result run on the first demo commit (so the seed is stale by the commits
// since), the first two seeds never run, and dependency-map available as the project's tool
const DEMO_SEED_FILES = [['src/billing.js', 9, 14], ['src/api.js', 6, 5], ['tools/export.py', 3, 4], ['README.md', 2, 1]];
function demoSeedResult() {
  const max = { churn: 10, complexity: 15 };
  const dots = DEMO_SEED_FILES.map(([file, churn, complexity]) => {
    const x = 40 + (churn / max.churn) * 320;
    const y = 220 - (complexity / max.complexity) * 190;
    return `<circle cx="${x}" cy="${y}" r="7" fill="${churn > 5 && complexity > 5 ? '#e5484d' : '#4c8bf5'}"/><text x="${x + 10}" y="${y + 4}">${file}</text>`;
  }).join('');
  const rows = DEMO_SEED_FILES.map(([f, c, x]) => `<tr><td>${f}</td><td>${c}</td><td>${x}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:13px system-ui,sans-serif;margin:16px;color:#1d2433}svg text{font-size:11px}table{border-collapse:collapse;margin-top:12px}td,th{padding:4px 10px;border-bottom:1px solid #dde}</style></head><body><h2>Churn against complexity</h2><p>4 files measured at the latest commit; 1 in the Danger Zone (src/billing.js).</p><svg width="480" height="250"><line x1="40" y1="220" x2="460" y2="220" stroke="#889"/><line x1="40" y1="20" x2="40" y2="220" stroke="#889"/><text x="400" y="240">commits</text><text x="4" y="16">complexity</text>${dots}</svg><table><tr><th>File</th><th>Commits</th><th>Complexity</th></tr>${rows}</table></body></html>`;
  const model = { files: DEMO_SEED_FILES.map(([file, churn, complexity]) => ({ churn, complexity, file })), measured: 'indentation depth (no complexity tool installed)' };
  return { html, model };
}

function demoSeeds(ws, project, firstCommit) {
  const date = '2026-10-12T09-30-00-000Z';
  const dir = path.join(ws.root, 'architecture', project.id, 'seeds', 'churn-complexity', date);
  const { html, model } = demoSeedResult();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.html'), html);
  fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify(model, null, 2));
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ source: 'oracle', costUsd: 0.38, tokens: { input: 21000, output: 4200 }, simulated: false, head: firstCommit, date, at: '2026-10-12T09:30:00.000Z', seed: 'churn-complexity', project_id: project.id, report: null }, null, 2));
}

function seedArchitecture(args, ws, project, { appDir, projects }) {
  if (args.mode === 'not-git') return;
  if (args.mode === 'facts-large') { // #386: this repository, with the 60 findings on its own files
    projects.updateProject(ws.projects, project.id, { folder: appDir });
    const commit = execFileSync('git', ['-C', appDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    demoLargeReport(ws, project.id, { commit, date: '2026-10-10T09:00:00Z' }, largestSourceFiles(appDir, 40));
    return;
  }
  if (args.mode === 'city-large') { // #382: this repository, with the POC's plan
    projects.updateProject(ws.projects, project.id, { folder: appDir });
    const plan = JSON.parse(fs.readFileSync(path.join(appDir, LARGE_PLAN), 'utf8'));
    require('@multiagent/engine/domains/oracle/oracle-architecture').writePlan(path.join(ws.root, 'architecture'), project.id, plan, '2026-10-01T09:00:00.000Z');
    return;
  }
  const city = ['city', 'city-agents', 'city-issue', 'city-release', 'city-stage'].includes(args.mode);
  const commits = args.mode === 'empty' ? [] : city ? CITY_COMMITS : ARCH_COMMITS;
  const head = demoArchitectureRepo(project.folder, commits);
  if (args.mode === 'city-release') demoReleaseCity(project.folder);
  if (head && args.mode !== 'never') demoArchitectureReports(ws, project.id, { commit: head, date: '2026-09-15T10:00:00Z' });
  if (head && args.mode === 'large') demoLargeReport(ws, project.id, { commit: head, date: '2026-09-15T10:00:00Z' });
  if (args.mode === 'map-refresh') demoCityPlan(ws, project.id);
  if (city) require('@multiagent/engine/domains/oracle/oracle-architecture').writePlan(path.join(ws.root, 'architecture'), project.id, CITY_PLAN, '2026-10-01T09:00:00.000Z');
  if (head && args.mode?.startsWith('seeds')) {
    const first = execFileSync('git', ['-C', project.folder, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).trim().split('\n')[0];
    demoSeeds(ws, project, first);
    projects.updateProject(ws.projects, project.id, { seedTools: { 'dependency-map': 'node tools/dependency-map.js --json' } });
  }
}

// #357: the Refactor tab's proposals on the Architecture demo (the roadmap's #10 planned, #11 done),
// the Product Owner's ranking and the cadence on with 6 of its runs counted ("next in 4 runs")
function demoRefactor(ws, projectId) {
  const runs = require('@multiagent/engine/domains/run/runs');
  const cadence = require('@multiagent/engine/domains/refactor/refactor-cadence');
  const dir = path.join(ws.root, 'refactor', projectId);
  const at = (days) => new Date(Date.now() - days * 864e5).toISOString();
  const arch = (id, f, extra) => ({ id, source: 'architecture', key: `demo:${id}`, reportId: 'demo-report-2', kind: f.kind, title: f.title, files: f.files, evidence: f.evidence, severity: f.severity, refactor: f.refactor, createdAt: at(20), status: 'proposed', ...extra });
  const owner = (id, target, improvement, extra) => ({ id, source: 'owner', key: `demo:${id}`, title: improvement, target, improvement, evidence: 'Hotspot rank 2, in the Danger Zone since July.', files: [target], createdAt: at(12), status: 'proposed', ...extra });
  const proposals = [
    arch('architecture-demo-1', DUPLICATED, { rank: 1, complexity: 2, rankReason: 'Highest Danger Zone score, and no unfinished roadmap item touches its files.', issue: 10, before: { quadrant: 'danger-zone', score: 82, file: 'src/billing.js', at: at(2) } }),
    arch('architecture-demo-2', finding('god-module', 'Billing module holds 120 rate constants and the discount rule', [{ path: 'src/billing.js' }], 'high', 'The file grew in each of its 5 commits; 120 constants sit next to the rule.', 'Move the rates to a data file the rule reads.'), { rank: 2, complexity: 3, rankReason: 'Same hotspot as #1: after it, to avoid a conflict in src/billing.js.' }),
    owner('owner-demo-3', 'src/api.js', 'Split the request parsing out of the API handlers', { rank: 3, complexity: 1, rankReason: 'Small and isolated: a cheap win on a busy file.', issue: 11, before: { quadrant: 'danger-zone', score: 64, file: 'src/api.js', at: at(9) }, outcome: { leftDangerZone: true, scoreDrop: 33, improved: true, after: { quadrant: 'healthy', score: 31 }, at: at(8) } }),
    owner('owner-demo-4', 'tools/export.py', 'Give the export one entry point per format with a very long title that is cut at the edge of the row', { rank: 4, complexity: 4, rankReason: 'Low churn: little value until the export changes again.', issue: 21, before: { quadrant: 'danger-zone', score: 58, file: 'tools/export.py', at: at(30) }, outcome: { leftDangerZone: false, scoreDrop: 0, improved: false, after: { quadrant: 'danger-zone', score: 58 }, at: at(28) } }),
    arch('architecture-demo-5', finding('naming', 'Export constants shout', [{ path: 'tools/export.py' }], 'low', 'RATE_0 to RATE_29 in upper case.', 'Rename them in snake case.'), { status: 'dismissed', dismissReason: 'Generated code, never edited by hand', dismissedAt: at(3) }),
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'proposals.json'), JSON.stringify({ proposals }, null, 2));
  const ranking = proposals.filter((p) => p.rank).map((p) => ({ id: p.id, rank: p.rank, reason: p.rankReason, complexity: p.complexity }));
  fs.writeFileSync(path.join(dir, 'ranking.json'), JSON.stringify({ at: at(1), costUsd: 0.18, ranking }, null, 2));
  // the cadence counts from the 7th latest real run: 6 counted, "next in 4 runs"
  const project = { id: projectId };
  const list = runs.listRuns(ws.runs);
  const ends = list.filter((r) => r.projectId === projectId && !r.mock && r.finishedAt).map((r) => r.finishedAt).sort().reverse();
  const since = ends[6] || null;
  const every = Math.min(cadence.CADENCE_MAX, Math.max(cadence.CADENCE_MIN, cadence.countedRuns(list, project, since) + 4));
  fs.writeFileSync(path.join(dir, 'cadence.json'), JSON.stringify({ on: true, every, since }, null, 2));
}

function seed({ appDir, args, projects, ws, project }) {
  demoLocalMerge(ws, project.id);
  demoRoadmap(ws, project.id, args.live, args.budget, args.roadmap);
  demoChildRuns(ws, project.id);
  demoRunHistory(ws, project.id);
  if (args.tab === 'architecture') return seedArchitecture(args, ws, project, { appDir, projects });
  if (args.tab === 'refactor') {
    seedArchitecture({ mode: args.mode === 'never' ? 'never' : null }, ws, project, { appDir, projects });
    if (args.mode !== 'never' && args.mode !== 'empty') demoRefactor(ws, project.id);
    return;
  }
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

// #360: a seed's run that never ends, or fails with the Oracle's error
function stubSeedRun(mode) {
  const seedRun = { 'seeds-running': () => new Promise(() => {}), 'seeds-error': () => { throw new Error('The Oracle\'s answer has no JSON block: nothing was saved.'); } }[mode];
  if (!seedRun) return false;
  const { ipcMain } = require('electron');
  ipcMain.removeHandler('seeds:run');
  ipcMain.handle('seeds:run', seedRun);
  return true;
}

// #360: the Seeds section in view; a stubbed run starts with the estimate's confirm accepted
async function showSeeds({ click, js, seedRun }) {
  if (seedRun) {
    await js('window.confirm = () => true');
    await click('[data-testid="seed-run-quality-gate-report"]');
  }
  await js('document.querySelector(\'[data-testid="seeds-section"]\')?.scrollIntoView()');
}

function stubChannel(channel, handler) {
  const { ipcMain } = require('electron');
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}

// The Architecture tab's modes: the stubs before the tab opens, then the clicks once it is open
function stubArchitecture(mode) {
  // #356, #381: "Analyze this project" starts a run that never ends (its state stays on screen) or
  // fails to start with the Oracle's error
  const analysis = { analyzing: () => ({ runId: '20261013-215046-bc771765' }), error: () => { throw new Error('The Oracle refused the analysis: the daily budget is reached (US$ 5.00 of US$ 5.00).'); } }[mode];
  if (analysis) stubChannel('run:start', analysis);
  if (mode === 'city-agents') stubChannel('architecture:agents', (_e, arg) => demoCityAgents(arg && arg.projectId));
  // #375: the Product Owner's saved answers hold the issue's group (read, never asked)
  if (mode === 'city-issue') stubChannel('po:history', () => DEMO_IMPACT_PO);
  return { analysis: Boolean(analysis), seedRun: stubSeedRun(mode) };
}

async function showArchitecture({ mode, click, js, project, analysis, seedRun }) {
  if (analysis) await click('[data-testid="architecture-analyze"]');
  if (mode?.startsWith('seeds')) await showSeeds({ click, js, seedRun });
  if (['city', 'city-agents', 'city-issue', 'city-large', 'city-release', 'city-stage'].includes(mode)) await click('[data-testid="architecture-mode-city"]');
  // #375: "Show on the map" of an issue, "Show the stage on the map" of a roadmap stage
  const pid = JSON.stringify(project.id);
  if (mode === 'city-issue') await js(`ProjectCityImpact.showIssue(${pid}, ${JSON.stringify(DEMO_IMPACT_ISSUE)})`);
  if (mode === 'city-stage') await js(`ProjectCityImpact.showStage(${pid}, ${JSON.stringify(DEMO_IMPACT_STAGE)})`);
  // #376: "Show on the map" of release 1.1.2
  if (mode === 'city-release') await js(`ProjectCityRelease.showRelease(${pid}, { from: '1.1.1', to: '1.1.2' })`);
}

// #357: "Ask the Product Owner to prioritize" never answers (its state stays on screen) or fails
function stubRefactor(mode) {
  const ranking = { prioritizing: () => new Promise(() => {}), error: () => { throw new Error('The Product Owner refused the ranking: the daily budget is reached (US$ 5.00 of US$ 5.00).'); } }[mode];
  if (ranking) stubChannel('refactor:prioritize', ranking);
  return Boolean(ranking);
}

async function afterOpen({ args, click, js, project }) {
  if (!args.tab) return;
  // the tab's first read never ends: its loading state stays on screen
  if (args.tab === 'conflicts' && args.mode === 'loading') stubChannel('analytics:performance', () => new Promise(() => {}));
  const architecture = args.tab === 'architecture' && stubArchitecture(args.mode);
  const ranking = args.tab === 'refactor' && stubRefactor(args.mode);
  await click(`[data-pv-tab="${args.tab}"]`);
  if (ranking) await click('[data-testid="refactor-prioritize"]');
  if (architecture) await showArchitecture({ mode: args.mode, click, js, project, ...architecture });
}

module.exports = {
  afterOpen,
  modes: ['analyzing', 'city', 'city-agents', 'city-issue', 'city-large', 'city-release', 'city-stage', 'empty', 'error', 'facts-large', 'large', 'loading', 'map-refresh', 'never', 'no-runs', 'not-git', 'prioritizing', 'seeds', 'seeds-error', 'seeds-running'],
  open,
  run: true,
  seed,
  tabs: ['overview', 'conflicts', 'architecture', 'refactor'],
};
