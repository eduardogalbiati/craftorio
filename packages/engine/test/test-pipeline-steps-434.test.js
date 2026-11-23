// The test → suite → test_failed → build → build_failed → evidence → verify_change block of the
// development workflow (#434). #630: software-development, software-development-local-hero and
// ai-development-local-hero became aliases of feature.yaml, so the block is pinned there (the
// golden of the three old files went with them).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');
const { root } = require('./engine-helpers');

const BLOCK = ['test', 'suite', 'test_failed', 'build', 'build_failed', 'evidence', 'verify_change'];

const load = (name) => loadWorkflow(path.join(root, 'workflows', `${name}.yaml`));
const gotos = (step) => (step.transitions || []).flatMap((t) => [t.goto, t.on_exhausted]).filter(Boolean);

test('feature: the test pipeline steps are contiguous, with e2e / heal / check_failed after the suite', () => {
  const ids = load('feature').steps.map((s) => s.id);
  const start = ids.indexOf('test');
  assert.deepEqual(ids.filter((id) => BLOCK.includes(id)), BLOCK);
  // #30: check_environment (the rule checks could not run here) sits next to check_failed
  assert.deepEqual(ids.slice(start, start + 10), ['test', 'suite', 'e2e', 'heal', 'check_failed', 'check_environment', 'test_failed', 'build', 'build_failed', 'evidence']);
  assert.equal(ids[ids.indexOf('verify_change') + 1], 'verify_failed');
});

test('feature: loads without warnings about the pipeline steps', () => {
  const warnings = (load('feature').warnings || []).map(String).filter((w) => BLOCK.some((id) => w.includes(`"${id}"`)));
  assert.deepEqual(warnings, []);
});

test('feature: the steps outside the block that route into it', () => {
  const wf = load('feature');
  const into = {};
  for (const step of wf.steps) {
    if (BLOCK.includes(step.id)) continue;
    const targets = [...new Set(gotos(step).filter((g) => BLOCK.includes(g)))].sort();
    if (targets.length) into[step.id] = targets;
  }
  assert.deepEqual(into.code_review, ['build', 'suite', 'test']);
  assert.deepEqual(into.human_review, ['build', 'suite', 'test']);
});

test('feature: the block leaves only to e2e, ci, push_main, verify_failed and end', () => {
  const wf = load('feature');
  const out = new Set();
  for (const id of BLOCK) {
    const step = wf.steps.find((s) => s.id === id);
    for (const g of gotos(step)) if (!BLOCK.includes(g)) out.add(g);
    for (const c of step.choices || []) if (c.goto && !BLOCK.includes(c.goto)) out.add(c.goto);
  }
  assert.deepEqual([...out].sort(), ['ci', 'e2e', 'end', 'push_main', 'verify_failed']);
});

test('feature: the test prompt checks pre-existing failures on the local base, not origin/', () => {
  const step = load('feature').steps.find((s) => s.id === 'test');
  assert.match(step.prompt, /pre-existing failures/);
  assert.doesNotMatch(step.prompt, /fails on\n`origin\//);
});

test('loadWorkflow rejects a step that points to an unknown step', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-434-'));
  try {
    const file = path.join(dir, 'wf.yaml');
    fs.writeFileSync(file, [
      'name: pinned',
      'agents:',
      '  dev: { provider: mock }',
      'steps:',
      '  - id: a',
      '    agent: dev',
      '    prompt: hi',
      '    transitions:',
      '      - when: "true"',
      '        goto: nowhere',
      '',
    ].join('\n'));
    assert.throws(() => loadWorkflow(file), /Step "a" points to unknown step "nowhere"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
