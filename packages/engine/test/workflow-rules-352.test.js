// #352: the workflow loader's field checks as a rule table (packages/engine/engine/run/field-rules.js, `FIELD_RULES`)
// applied by a small interpreter, instead of one function of complexity 188.
// Seams: loadWorkflow (the error snapshot: test/fixtures/workflow-errors-352.json, recorded from the
// loader before the change, one case per kind of rule: required, type, template, applies-to,
// cross-field, reference, order), scripts/code-health.js (analyzeSource, COMPLEXITY_EXCEPTIONS),
// scripts/docs.js's main (`npm run docs` writes docs/agents/engine/field-reference.md from the table).
// The table and the reference are loaded inside each test: they do not exist before the change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');

const root = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const CASES = JSON.parse(read('packages/engine/test/fixtures/workflow-errors-352.json'));
const REFERENCE = path.join('docs', 'agents', 'engine', 'field-reference.md');
const loadRules = () => require('../engine/run/field-rules');

// What loadWorkflow says for a YAML text: null when it loads, else its error message
function errorOf(dir, text) {
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, text);
  try { loadWorkflow(file); return null; } catch (e) { return e.message; }
}

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

for (const kind of [...new Set(CASES.map((c) => c.kind))]) {
  test(`#352 loadWorkflow answers every "${kind}" case of the snapshot as it did before the rule table`, (t) => {
    const dir = tmpDir(t, 'rules-352-');
    const wrong = CASES.filter((c) => c.kind === kind)
      .map((c) => ({ name: c.name, expected: c.error, actual: errorOf(dir, c.yaml) }))
      .filter((r) => r.expected !== r.actual)
      .map((r) => `${r.name}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`);
    assert.deepEqual(wrong, []);
  });
}

test('#352 the snapshot covers every kind of rule, valid workflows and the order of several errors', () => {
  const kinds = new Set(CASES.map((c) => c.kind));
  for (const k of ['valid', 'required', 'type', 'template', 'applies-to', 'cross-field', 'reference', 'order']) {
    assert.equal(kinds.has(k), true, `a "${k}" case`);
  }
});

test('#352 every bundled workflow still loads without an error', (t) => {
  const dir = tmpDir(t, 'rules-352-bundled-');
  const wrong = fs.readdirSync(path.join(root, 'workflows')).filter((f) => /\.ya?ml$/.test(f))
    .map((f) => [f, errorOf(dir, read(path.join('workflows', f)))])
    .filter(([, e]) => e !== null)
    .map(([f, e]) => `${f}: ${e}`);
  assert.deepEqual(wrong, []);
});

test('#352 loadWorkflow is within the code-health limit and leaves the exception list', () => {
  const { analyzeSource, COMPLEXITY_EXCEPTIONS, MAX_COMPLEXITY } = require('../../../scripts/code-health');
  const file = 'packages/engine/engine/run/load.js';
  const fn = analyzeSource(read(file), file).find((f) => f.name === 'loadWorkflow');
  assert.equal(Boolean(fn), true, 'loadWorkflow is still a function of packages/engine/engine/run/load.js');
  assert.ok(fn.complexity <= MAX_COMPLEXITY, `loadWorkflow complexity ${fn.complexity}, limit ${MAX_COMPLEXITY}`);
  assert.deepEqual(Object.keys(COMPLEXITY_EXCEPTIONS).filter((k) => k.startsWith(`${file}:`)), []);
});

test('#352 the change adds no function above the limit to the exception list (engine and docs script)', () => {
  const { COMPLEXITY_EXCEPTIONS } = require('../../../scripts/code-health');
  // the engine's and the docs script's exceptions before #352, loadWorkflow excepted
  const before = new Set([
    'packages/engine/engine/deps-cache.js:ensureDeps',
    'packages/engine/engine/providers.js:mockValue',
    'packages/engine/engine/providers.js:runMock',
    'packages/engine/engine/run/gates.js:requestApproval',
    'packages/engine/engine/run/machine-steps.js:suiteRound',
    'packages/engine/engine/run/sessions.js:agentTurn',
    'packages/engine/engine/run/transitions.js:finishStep',
    'packages/engine/engine/run/transitions.js:pollStep',
    'packages/engine/engine/run/turns.js:invokeTurn',
    'packages/engine/engine/screenshot-step.js:captureScreenshots',
    // #695: moved from scripts/layers.js (same function, same complexity) to be shared by the engine
    'packages/engine/engine/source-text.js:withoutComments',
    // #109: moved from suite-step.js (same function, same complexity) next to the cargo test reader
    'packages/engine/engine/suite-failures.js:parseFailures',
    'packages/engine/engine/suite-step.js:checkOnBase',
    'packages/engine/engine/suite-step.js:parseFailures',
    'packages/engine/engine/suite-step.js:runSuite',
    'packages/engine/engine/workflow.js:constructor',
    'packages/engine/engine/workflow.js:runStep',
    'packages/engine/engine/worktree.js:cleanupWorktrees',
  ]);
  const added = Object.keys(COMPLEXITY_EXCEPTIONS)
    .filter((k) => k.startsWith('packages/engine/engine/') || k.startsWith('scripts/docs.js:'))
    .filter((k) => !before.has(k));
  assert.deepEqual(added, []);
});

test('#352 FIELD_RULES lists each checked field once with where it applies, its type, template, required and message', () => {
  const { FIELD_RULES } = loadRules();
  assert.equal(Array.isArray(FIELD_RULES), true, 'FIELD_RULES is an array');
  // the loader checks more than 40 fields of agents, steps, transitions and the orchestrator
  assert.ok(FIELD_RULES.length >= 30, `entries: ${FIELD_RULES.length}`);
  const bad = FIELD_RULES.filter((r) => !(
    typeof r.field === 'string' && r.field
    && r.appliesTo !== undefined && r.appliesTo !== null
    && typeof r.type === 'string' && r.type
    && typeof r.template === 'boolean'
    && typeof r.required === 'boolean'
    && typeof r.message === 'string' && r.message
  )).map((r) => JSON.stringify(r));
  assert.deepEqual(bad, []);
});

test('#352 the table holds the per-field rules the issue names: human_approval-only fields, agent-step-only fields and template fields', () => {
  const { FIELD_RULES } = loadRules();
  const fields = FIELD_RULES.map((r) => r.field);
  // a field path such as "steps[].local_preview" or "step.local_preview": its last segment
  const has = (name) => fields.some((f) => f.split(/[.[\]/]+/).filter(Boolean).pop() === name);
  for (const name of ['local_preview', 'diff_base', 'summary', 'recommend', 'approve_label', 'protect_files', 'test_map', 'full_suite', 'max_context', 'max_requests', 'scope']) {
    assert.equal(has(name), true, `an entry for ${name}`);
  }
  assert.ok(FIELD_RULES.some((r) => r.template === true), 'some entries accept a template');
  assert.ok(FIELD_RULES.some((r) => r.template === false), 'some entries refuse a template');
});

test('#352 npm run docs writes the field reference from the table: one row per entry, with its applies-to, type and template', (t) => {
  const { FIELD_RULES } = loadRules();
  const { main } = require('../../../scripts/docs.js');
  const tmp = tmpDir(t, 'rules-352-docs-');
  fs.cpSync(path.join(root, 'skills'), path.join(tmp, 'skills'), { recursive: true });
  fs.cpSync(path.join(root, 'docs'), path.join(tmp, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(root, 'README.md'), path.join(tmp, 'README.md'));
  fs.rmSync(path.join(tmp, REFERENCE), { force: true });
  assert.equal(main([], tmp), 0);
  assert.equal(fs.existsSync(path.join(tmp, REFERENCE)), true, `${REFERENCE} written`);
  const ref = fs.readFileSync(path.join(tmp, REFERENCE), 'utf8').replace(/\r\n/g, '\n');
  const header = ref.split('\n').find((l) => l.startsWith('|')) || '';
  for (const col of [/field/i, /applies to/i, /type/i, /template/i]) assert.match(header, col);
  const rows = ref.split('\n').filter((l) => l.startsWith('|'));
  const missing = FIELD_RULES.filter((r) => !rows.some((row) => row.includes(r.field))).map((r) => r.field);
  assert.deepEqual(missing, []);
  assert.ok(rows.length >= FIELD_RULES.length + 2, `rows ${rows.length} for ${FIELD_RULES.length} entries (plus header and separator)`);
});

test('#352 the generated field reference is gitignored like the code map', () => {
  const ignored = read('.gitignore').split('\n').map((l) => l.trim());
  assert.equal(ignored.includes('docs/agents/engine/field-reference.md'), true);
});

test('#352 agents-and-steps.md points to the generated field reference', () => {
  assert.match(read('docs/agents/engine/agents-and-steps.md'), /field-reference\.md/);
});
