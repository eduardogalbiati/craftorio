// #225 Artifacts: what the run produced first, filterable by type.
//
// Interface under test (new module, loaded inside each test):
//   src/domains/evidence/artifact-categories.js
//   - categorizeArtifact(artifact) → a new object with every field of `artifact` plus
//       category: 'result' | 'screenshots' | 'tests' | 'reports' | 'process' | 'internal'
//       kind:     'image' | 'markdown' | 'json' | 'log' | 'other'
//     artifact: { path, step?, agent?, event? }; path relative to the run folder (forward slashes;
//     Windows backslashes give the same answer); event: the event type that saved it
//     ('file.saved', 'handoff.saved'), when there is one. step and agent are kept as given.
//     Families: result.md → result; evidence/<step>/round-<n>/*.png (also *.original.png /
//     *.modified.png) → screenshots; e2e/* (scenarios.feature, scenarios.json, results JSON,
//     trace .zip) and coverage/* → tests; reports/* → reports; handoffs/*.md, decisions.tsv,
//     logs/*.log → process; scratch/**, owner.json, *.lock → internal.
//   - filterArtifacts(list, { show = 'produced', category?, kind? } = {}) → a new array of the
//     same items (each carries `category` and `kind`, e.g. categorizeArtifact's output):
//       show 'produced': result, screenshots, tests, reports; show 'all': those plus process;
//       internal is never returned; category / kind narrow it further;
//       ordered by category: result, screenshots, tests, reports, process (stable inside one).
//   src/runs.js runArtifacts(runDir) (existing): every entry also carries `category`; scratch/ and
//     owner.json (internal) are not returned; result.md is listed first.
//   src/run-artifacts.js runArtifactsAsync(runDir) (existing): the same `category` on each entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runs = require('../../src/runs');

const load = () => require('../../src/domains/evidence/artifact-categories');
const cat = (p, extra = {}) => load().categorizeArtifact({ path: p, ...extra }).category;

test('categorizeArtifact: anything under scratch/ (seeded skills, workflow YAMLs), owner.json and locks are internal', () => {
  assert.equal(cat('scratch/skills/x/SKILL.md'), 'internal');
  assert.equal(cat('scratch/workflows/a.yaml'), 'internal');
  assert.equal(cat('owner.json'), 'internal');
  assert.equal(cat('run.lock'), 'internal');
});

test('categorizeArtifact: logs, handoff notes and the decision log are process', () => {
  assert.equal(cat('logs/developer-1.log'), 'process');
  assert.equal(cat('handoffs/developer.md'), 'process');
  assert.equal(cat('decisions.tsv'), 'process');
});

test('categorizeArtifact: E2E scenarios, E2E results, a Playwright trace and the coverage summary are tests', () => {
  assert.equal(cat('e2e/scenarios.feature'), 'tests');
  assert.equal(cat('e2e/scenarios.json'), 'tests');
  assert.equal(cat('e2e/results.json'), 'tests');
  assert.equal(cat('e2e/trace.zip'), 'tests');
  assert.equal(cat('coverage/coverage-summary.md'), 'tests');
});

test('categorizeArtifact: evidence captures (original and modified) are screenshots, result.md is result, reports/ is reports', () => {
  assert.equal(cat('evidence/developer/round-1/161-backlog-refresh-now.modified.png'), 'screenshots');
  assert.equal(cat('evidence/developer/round-1/161-backlog-refresh-now.original.png'), 'screenshots');
  assert.equal(cat('result.md'), 'result');
  assert.equal(cat('reports/verification.md'), 'reports');
});

test('categorizeArtifact: a release run\'s release-summary.md is a report (#290)', () => {
  assert.equal(cat('release-summary.md'), 'reports');
});

test('categorizeArtifact: kind is image, markdown, json, log or other from the extension', () => {
  const kind = (p) => load().categorizeArtifact({ path: p }).kind;
  assert.equal(kind('evidence/developer/round-1/161-backlog-refresh-now.modified.png'), 'image');
  assert.equal(kind('result.md'), 'markdown');
  assert.equal(kind('e2e/scenarios.json'), 'json');
  assert.equal(kind('logs/developer-1.log'), 'log');
  assert.equal(kind('e2e/scenarios.feature'), 'other');
});

test('categorizeArtifact: keeps the step and agent of a saved artifact', () => {
  const a = load().categorizeArtifact({ path: 'handoffs/developer.md', step: 'develop', agent: 'developer', event: 'handoff.saved' });
  assert.equal(a.category, 'process');
  assert.equal(a.step, 'develop');
  assert.equal(a.agent, 'developer');
  assert.equal(a.path, 'handoffs/developer.md');
});

test('categorizeArtifact: Windows backslash paths categorize like forward-slash ones', () => {
  assert.equal(cat('scratch\\skills\\x\\SKILL.md'), 'internal');
  assert.equal(cat('logs\\developer-1.log'), 'process');
  assert.equal(cat('evidence\\developer\\round-1\\161-backlog-refresh-now.modified.png'), 'screenshots');
  assert.equal(cat('e2e\\scenarios.json'), 'tests');
});

// one artifact of every category, in a scrambled order
const MIXED = [
  'logs/developer-1.log',
  'scratch/skills/x/SKILL.md',
  'reports/verification.md',
  'handoffs/developer.md',
  'e2e/scenarios.json',
  'owner.json',
  'evidence/developer/round-1/161-backlog-refresh-now.modified.png',
  'result.md',
];

test('filterArtifacts: the default (produced) shows result, screenshots, tests and reports, in that order; no process, no internal', () => {
  const { categorizeArtifact, filterArtifacts } = load();
  const list = MIXED.map((p) => categorizeArtifact({ path: p }));
  assert.deepEqual(filterArtifacts(list).map((a) => a.path), [
    'result.md',
    'evidence/developer/round-1/161-backlog-refresh-now.modified.png',
    'e2e/scenarios.json',
    'reports/verification.md',
  ]);
  assert.deepEqual(filterArtifacts(list, { show: 'produced' }).map((a) => a.path), filterArtifacts(list).map((a) => a.path));
});

test('filterArtifacts: show all adds process after the produced categories and still never lists internal ones', () => {
  const { categorizeArtifact, filterArtifacts } = load();
  const list = MIXED.map((p) => categorizeArtifact({ path: p }));
  assert.deepEqual(filterArtifacts(list, { show: 'all' }).map((a) => a.path), [
    'result.md',
    'evidence/developer/round-1/161-backlog-refresh-now.modified.png',
    'e2e/scenarios.json',
    'reports/verification.md',
    'logs/developer-1.log',
    'handoffs/developer.md',
  ]);
});

test('filterArtifacts: a category or a kind narrows the list', () => {
  const { categorizeArtifact, filterArtifacts } = load();
  const list = MIXED.map((p) => categorizeArtifact({ path: p }));
  assert.deepEqual(filterArtifacts(list, { show: 'all', category: 'process' }).map((a) => a.path), ['logs/developer-1.log', 'handoffs/developer.md']);
  assert.deepEqual(filterArtifacts(list, { show: 'all', kind: 'image' }).map((a) => a.path), ['evidence/developer/round-1/161-backlog-refresh-now.modified.png']);
  assert.deepEqual(filterArtifacts(list, { category: 'internal' }), []);
});

// ---- runArtifacts (src/runs.js) on a real run folder --------------------------------------------

function runFolder(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'art-cat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = path.join(root, 'run');
  const files = {
    'scratch/skills/x/SKILL.md': '# skill',
    'scratch/workflows/a.yaml': 'kind: Workflow',
    'owner.json': '{}',
    'logs/developer-1.log': 'log',
    'handoffs/developer.md': '# handoff',
    'decisions.tsv': 'ts\tagent\n',
    'e2e/scenarios.json': '[]',
    'evidence/developer/round-1/161-backlog-refresh-now.modified.png': 'PNG',
    'result.md': '# Result',
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(run, rel)), { recursive: true });
    fs.writeFileSync(path.join(run, rel), text);
  }
  fs.writeFileSync(path.join(run, 'events.jsonl'), '');
  return run;
}
const relOf = (run, a) => path.relative(run, a.path).replace(/\\/g, '/');

test('runArtifacts: every artifact carries its category; scratch/ and owner.json are not returned', (t) => {
  const run = runFolder(t);
  const list = runs.runArtifacts(run);
  const by = Object.fromEntries(list.map((a) => [relOf(run, a), a.category]));
  assert.deepEqual(by, {
    'result.md': 'result',
    'evidence/developer/round-1/161-backlog-refresh-now.modified.png': 'screenshots',
    'e2e/scenarios.json': 'tests',
    'logs/developer-1.log': 'process',
    'handoffs/developer.md': 'process',
    'decisions.tsv': 'process',
  });
});

test('runArtifactsAsync (the indexed listing the Artifacts screen reads) carries the same categories, without internal files', async (t) => {
  const { runArtifactsAsync } = require('../../src/run-artifacts');
  const run = runFolder(t);
  const list = await runArtifactsAsync(run);
  const rels = list.map((a) => relOf(run, a));
  assert.ok(!rels.some((r) => r.startsWith('scratch/') || r === 'owner.json'));
  assert.equal(list.find((a) => relOf(run, a) === 'result.md').category, 'result');
  assert.equal(list.find((a) => relOf(run, a) === 'logs/developer-1.log').category, 'process');
});

test('runArtifacts: the run\'s result.md is listed first', (t) => {
  const run = runFolder(t);
  const list = runs.runArtifacts(run);
  assert.equal(relOf(run, list[0]), 'result.md');
  assert.equal(list[0].category, 'result');
});
