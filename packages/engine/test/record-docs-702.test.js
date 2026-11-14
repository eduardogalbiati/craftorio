// #702: the post-flow sdlc-record records a successful Code & Build run in the work item's documents,
// without a model. Acceptance tests written before the code, on the new module
// packages/engine/engine/record-docs-step.js (the engine's `type: record_docs` step calls it).
// The interface these tests assume (the issue fixes the behaviour, not the names):
// - recordDocs(repoDir, { item, run, merged_commit, pr_url, issues, evidence }) → (a promise of)
//   { kind: 'record_docs', status, commit, files, problems }, where
//   - run: the Code & Build run's id; issues: [{ number, title, url }] the run implemented;
//   - evidence: the run's `evidence` output, { suite: { status, passed, failed }, e2e: { status, passed,
//     failed }, screenshots: [{ path, caption }] (absolute paths, pairs named
//     `<issue>-<screen>-<state>.original.png` / `.modified.png`), axe: [{ id, impact, ... }] };
//   - the plan's `## Progress` row of the run's step (its issue number in the Step cell, or the first
//     row not done) gets Status `done`, the run id and the merged commit (or the PR);
//   - test.md and test.pt-BR.md get one row with the run id, the unit and E2E counts, the screenshots
//     taken or the reason none were, the axe findings (no empty cell); test.md `status: collecting`;
//   - the screenshot files are copied to docs/work/<item>/images/;
//   - every Progress row done → plan.md front matter `status: built`;
//   - DocModel's lint runs before ONE commit; a document that fails it is not committed (problems
//     listed, or an error thrown).
// The module is loaded inside each test: it does not exist before the change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeRepo } = require('./repo-workflow-fixtures-485');
const DocModel = require('@multiagent/shared/doc-model');

const load = () => require('../engine/record-docs-step');

const fm = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;

// a plan whose Progress has `rows` ([step, status]); `risks: false` drops a section DocModel's lint requires
function plan(rows, { risks = true } = {}) {
  return `${fm({ item: 'demo', stage: 'plan', status: 'accepted', date: '2026-11-01', translation: 'plan.pt-BR.md' })}
# Plan: demo

## Files that change

- \`src/app.js\`: the code.

## Order of work

${rows.map(([step], i) => `${i + 1}. ${step}.`).join('\n')}
${risks ? '\n## Risks\n\nNone found.\n' : ''}
## Proof

The unit tests.

## Progress

| Step | Status | Run | Commit / PR |
|---|---|---|---|
${rows.map(([step, status, run, commit], i) => `| ${i + 1}. ${step} | ${status} | ${run || '—'} | ${commit || '—'} |`).join('\n')}
`;
}
function planPt(rows, { risks = true } = {}) {
  return `${fm({ item: 'demo', stage: 'plan', status: 'accepted', date: '2026-11-01', source: 'plan.md' })}
# Plano: demo

## Arquivos que mudam

- \`src/app.js\`: o código.

## Ordem do trabalho

${rows.map(([step], i) => `${i + 1}. ${step}.`).join('\n')}
${risks ? '\n## Riscos\n\nNenhum.\n' : ''}
## Prova

Os testes unitários.

## Progresso

| Passo | Status | Run | Commit / PR |
|---|---|---|---|
${rows.map(([step, status, run, commit], i) => `| ${i + 1}. ${step} | ${status === 'done' ? 'feito' : 'pendente'} | ${run || '—'} | ${commit || '—'} |`).join('\n')}
`;
}
const TEST_MD = `${fm({ item: 'demo', stage: 'test', status: 'not started', date: '2026-11-01', translation: 'test.pt-BR.md' })}
# Test: demo evidence

## Suite and tests

| Run | Unit | E2E | Result |
|---|---|---|---|
| — | — | — | nothing yet |

## Before and after screenshots

None yet.
`;
const TEST_PT = `${fm({ item: 'demo', stage: 'test', status: 'not started', date: '2026-11-01', source: 'test.md' })}
# Test: evidência do demo

## Suíte e testes

| Run | Unit | E2E | Resultado |
|---|---|---|---|
| — | — | — | ainda nada |

## Screenshots de antes e depois

Nenhum ainda.
`;

const TWO_ROWS = [['Step one (#11)', 'done', 'run-1', 'aaaaaaa'], ['Step two (#12)', 'pending']];
const THREE_ROWS = [...TWO_ROWS, ['Step three (#13)', 'pending']];
const ISSUES = [{ number: 12, title: 'Step two', url: 'https://github.com/o/r/issues/12' }];
const RUN = 'run-702-abc';

// opts: `risks` (plan), `noTest` (no test.md / test.pt-BR.md yet), `files` (more committed files)
function repo(t, rows, opts = {}) {
  const r = makeRepo(t, {
    'src/app.js': 'module.exports = 1;\n',
    'docs/work/demo/plan.md': plan(rows, opts),
    'docs/work/demo/plan.pt-BR.md': planPt(rows, opts),
    ...(opts.noTest ? {} : { 'docs/work/demo/test.md': TEST_MD, 'docs/work/demo/test.pt-BR.md': TEST_PT }),
    ...(opts.files || {}),
  });
  r.git('config', 'user.name', 't');
  r.git('config', 'user.email', 't@t');
  r.write({ 'src/app.js': 'module.exports = 2;\n' });
  const merged = r.commit('feat: step two (#12)');
  return { ...r, merged };
}

function evidenceDir(t, names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-702-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return names.map((n) => { const f = path.join(dir, n); fs.writeFileSync(f, `png ${n}`); return { path: f, caption: n }; });
}

const evidence = (extra = {}) => ({
  suite: { status: 'pass', passed: 120, failed: 0 },
  e2e: { status: 'pass', passed: 3, failed: 0 },
  screenshots: [],
  axe: [],
  ...extra,
});

const read = (r, rel) => fs.readFileSync(path.join(r.dir, ...rel.split('/')), 'utf8');
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const rowOf = (text, needle) => text.split('\n').find((l) => /^\s*\|/.test(l) && l.includes(needle)) || '';
const record = (r, ev, issues = ISSUES) => load().recordDocs(r.dir, { item: 'demo', run: RUN, merged_commit: r.merged, pr_url: '', issues, evidence: ev });

test('#702 record_docs: the run\'s Progress row gets done, the run id and the merged commit; the done row stays', async (t) => {
  const r = repo(t, THREE_ROWS);
  await record(r, evidence());
  const text = read(r, 'docs/work/demo/plan.md');
  const row = cells(rowOf(text, 'Step two'));
  assert.deepEqual([row[1], row[2], (row[3] || '').includes(r.merged.slice(0, 7))], ['done', RUN, true]);
  assert.deepEqual(cells(rowOf(text, 'Step one')).slice(1), ['done', 'run-1', 'aaaaaaa']);
  assert.equal(cells(rowOf(text, 'Step three'))[1], 'pending');
});

test('#702 record_docs: test.md and test.pt-BR.md each get a row with the run id and the unit and E2E counts', async (t) => {
  const r = repo(t, THREE_ROWS);
  await record(r, evidence());
  const en = rowOf(read(r, 'docs/work/demo/test.md'), RUN);
  const pt = rowOf(read(r, 'docs/work/demo/test.pt-BR.md'), RUN);
  assert.deepEqual([en !== '', /\b120\b/.test(en), /\b3\b/.test(en)], [true, true, true], `test.md row: ${en}`);
  assert.deepEqual([pt !== '', /\b120\b/.test(pt), /\b3\b/.test(pt)], [true, true, true], `test.pt-BR.md row: ${pt}`);
});

test('#702 record_docs: a run with 0 screenshots writes the reason, never an empty cell, in its test.md row', async (t) => {
  const r = repo(t, THREE_ROWS);
  await record(r, evidence({ screenshots: [] }));
  const row = cells(rowOf(read(r, 'docs/work/demo/test.md'), RUN));
  const empty = row.filter((c) => c === '' || /^[-—–]$/.test(c));
  assert.deepEqual([row.length >= 5, empty.length], [true, 0], `the row: | ${row.join(' | ')} |`);
});

test('#702 record_docs: test.md front matter becomes `status: collecting`', async (t) => {
  const r = repo(t, THREE_ROWS);
  await record(r, evidence());
  assert.equal(DocModel.frontMatter(read(r, 'docs/work/demo/test.md')).status, 'collecting');
});

test('#702 record_docs: the final screenshot pairs are copied to the item\'s images/ and the axe findings written', async (t) => {
  const r = repo(t, THREE_ROWS);
  const shots = evidenceDir(t, ['12-login-empty.original.png', '12-login-empty.modified.png']);
  await record(r, evidence({ screenshots: shots, axe: [{ id: 'color-contrast', impact: 'serious', nodes: 1 }] }));
  const images = path.join(r.dir, 'docs', 'work', 'demo', 'images');
  const copied = fs.existsSync(images) ? fs.readdirSync(images).filter((f) => /^12-login-empty\.(original|modified)\.png$/.test(f)).sort() : [];
  assert.deepEqual(copied, ['12-login-empty.modified.png', '12-login-empty.original.png']);
  assert.equal(read(r, 'docs/work/demo/test.md').includes('color-contrast'), true);
});

test('#702 record_docs: the last Progress row done (N of N) sets plan.md `status: built`', async (t) => {
  const r = repo(t, TWO_ROWS);
  await record(r, evidence());
  assert.equal(DocModel.frontMatter(read(r, 'docs/work/demo/plan.md')).status, 'built');
});

test('#702 record_docs: N-1 of N rows done leaves the plan `accepted`', async (t) => {
  const r = repo(t, THREE_ROWS);
  await record(r, evidence());
  assert.equal(DocModel.frontMatter(read(r, 'docs/work/demo/plan.md')).status, 'accepted');
});

test('#702 record_docs: one commit holds plan.md and test.md, nothing left uncommitted', async (t) => {
  const r = repo(t, THREE_ROWS);
  const before = r.head();
  await record(r, evidence());
  const files = r.git('show', '--name-only', '--format=', 'HEAD').split('\n').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual([
    r.head() !== before,
    r.git('rev-list', '--count', `${before}..HEAD`),
    files.includes('docs/work/demo/plan.md'),
    files.includes('docs/work/demo/test.md'),
    r.git('status', '--porcelain'),
  ], [true, '1', true, true, '']);
});

test('#702 record_docs: a plan that fails DocModel\'s lint is not committed', async (t) => {
  const r = repo(t, THREE_ROWS, { risks: false });
  const before = r.head();
  // the module and its function exist (a missing module must not pass as a refused commit)
  assert.equal(typeof load().recordDocs, 'function');
  let out = null;
  let threw = false;
  try { out = await record(r, evidence()); } catch { threw = true; }
  const problems = out && Array.isArray(out.problems) ? out.problems.length : 0;
  assert.deepEqual([r.head() === before, threw || problems > 0], [true, true]);
});

// ---- review round 2: the skeleton, the images' names, the stage's date, the engine step ----------------

test('#702 record_docs: an item with no test.md yet gets the EN and pt-BR skeleton, with the run\'s row, in one commit', async (t) => {
  const r = repo(t, THREE_ROWS, { noTest: true });
  const before = r.head();
  const out = await record(r, evidence());
  const en = read(r, 'docs/work/demo/test.md');
  const pt = read(r, 'docs/work/demo/test.pt-BR.md');
  const files = r.git('show', '--name-only', '--format=', 'HEAD').split('\n').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual([out.status, out.problems.length], ['recorded', 0], JSON.stringify(out.problems));
  assert.deepEqual([
    DocModel.frontMatter(en).status, DocModel.frontMatter(en).stage, DocModel.frontMatter(pt).source,
    rowOf(en, RUN) !== '', rowOf(pt, RUN) !== '',
  ], ['collecting', 'test', 'test.md', true, true]);
  assert.deepEqual([
    r.git('rev-list', '--count', `${before}..HEAD`),
    files.includes('docs/work/demo/test.md'), files.includes('docs/work/demo/test.pt-BR.md'), files.includes('docs/work/demo/plan.md'),
    r.git('status', '--porcelain'),
  ], ['1', true, true, true, '']);
});

test('#702 record_docs: a screenshot whose name images/ already holds with other content is copied as <run>-<name>', async (t) => {
  const NAME = '12-login-empty.original.png';
  const r = repo(t, THREE_ROWS, { files: { [`docs/work/demo/images/${NAME}`]: 'an older run\'s image' } });
  const shots = evidenceDir(t, [NAME]);
  await record(r, evidence({ screenshots: shots }));
  const images = path.join(r.dir, 'docs', 'work', 'demo', 'images');
  const renamed = `${RUN}-${NAME}`;
  assert.deepEqual([
    fs.readFileSync(path.join(images, NAME), 'utf8'),
    fs.existsSync(path.join(images, renamed)) ? fs.readFileSync(path.join(images, renamed), 'utf8') : null,
    read(r, 'docs/work/demo/test.md').includes(`images/${renamed}`),
  ], ['an older run\'s image', `png ${NAME}`, true]);
});

test('#702 record_docs: a screenshot identical to the one images/ already holds keeps its name', async (t) => {
  const NAME = '12-login-empty.original.png';
  const r = repo(t, THREE_ROWS, { files: { [`docs/work/demo/images/${NAME}`]: `png ${NAME}` } });
  await record(r, evidence({ screenshots: evidenceDir(t, [NAME]) }));
  const images = fs.readdirSync(path.join(r.dir, 'docs', 'work', 'demo', 'images')).sort();
  assert.deepEqual(images, [NAME]);
});

test('#702 recordStage: a test.md without `date` gets one, its status set, and DocModel\'s lint passes', async (t) => {
  const noDate = (text) => text.replace('date: 2026-11-01\n', '').replace('status: not started', 'status: collecting');
  const r = repo(t, TWO_ROWS, { noTest: true, files: { 'docs/work/demo/test.md': noDate(TEST_MD), 'docs/work/demo/test.pt-BR.md': noDate(TEST_PT) } });
  assert.equal(DocModel.frontMatter(read(r, 'docs/work/demo/test.md')).date, undefined, 'the fixture has no date');
  const before = r.head();
  const out = await load().recordStage(r.dir, { item: 'demo', status: 'in review', summary: 'Suite 120 passed, E2E 3 passed.' });
  const front = DocModel.frontMatter(read(r, 'docs/work/demo/test.md'));
  assert.deepEqual([out.status, out.problems.length, front.status, /^\d{4}-\d{2}-\d{2}$/.test(String(front.date)), r.head() !== before],
    ['recorded', 0, 'in review', true, true], JSON.stringify(out.problems));
});

// the engine's `type: record_docs` step (machine-steps.js runRecordDocsStep), called on WorkflowRun.prototype
// with a small run state, as release-rounds-internals-324-325.test.js does
function stepState(t, r, inputs, { simulated = false } = {}) {
  const machineActions = require('../engine/machine-actions');
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-702-'));
  t.after(() => fs.rmSync(runs, { recursive: true, force: true }));
  const events = [];
  const state = {
    mock: simulated, machine: simulated ? machineActions.simulated() : machineActions.real(), runId: 'sdlc-run-1',
    runDir: path.join(runs, 'sdlc-run-1'), worktree: { repo: r.dir, base: 'main' }, ctx: { worktree_dir: r.dir, inputs },
    emitEvent: (type, data) => events.push({ type, ...data }),
  };
  return { state, events, runs };
}
const runStep = (state, step = { id: 'record', type: 'record_docs' }) => {
  const { WorkflowRun } = require('../engine/workflow');
  return WorkflowRun.prototype.runRecordDocsStep.call(state, step);
};

test('#702 record_docs step: records from the chained inputs (run, merged_commit, evidence), screenshots found in the run\'s folder, on its own branch', async (t) => {
  const r = repo(t, THREE_ROWS);
  r.git('checkout', '-q', '--detach'); // a run's worktree is detached
  const inputs = {
    item: 'demo', run: 'cb-run-1', merged_commit: r.merged, pr_url: '', issues: ISSUES,
    evidence: evidence({ suite: { status: 'pass', passed: 77, failed: 0 }, screenshots: [{ path: 'evidence/12-a.modified.png', caption: 'A' }] }),
    task: 'a task text that names 999 tests', retrospective: true,
  };
  const { state, events, runs } = stepState(t, r, inputs);
  fs.mkdirSync(path.join(runs, 'cb-run-1', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(runs, 'cb-run-1', 'evidence', '12-a.modified.png'), 'png a');
  const out = await runStep(state);
  const row = rowOf(read(r, 'docs/work/demo/test.md'), 'cb-run-1');
  assert.deepEqual([
    out.status, /\b77\b/.test(row), /\b999\b/.test(row),
    fs.existsSync(path.join(r.dir, 'docs', 'work', 'demo', 'images', '12-a.modified.png')),
    r.git('rev-parse', '--abbrev-ref', 'HEAD'),
    events.filter((e) => e.type === 'log' && e.kind === 'record_docs').length,
  ], ['recorded', true, false, true, 'sdlc-record/demo-sdlc-run-1', 1], row);
});

test('#702 record_docs step: a simulated run writes nothing and says what it would record', async (t) => {
  const r = repo(t, THREE_ROWS);
  const before = r.head();
  const { state } = stepState(t, r, { item: 'demo', run: 'cb-run-1', merged_commit: r.merged, evidence: evidence() }, { simulated: true });
  const out = await runStep(state);
  assert.deepEqual([out.status, r.head() === before, r.git('status', '--porcelain'), /demo/.test(String(out.message))], ['skipped', true, '', true]);
});
