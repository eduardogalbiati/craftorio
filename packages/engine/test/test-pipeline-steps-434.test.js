// Characterization of the test → suite → test_failed → build → build_failed → evidence →
// verify_change block the three development workflows share (#434), pinned before it moves
// into a fragment: loadWorkflow must keep returning the same steps, in the same place, with the
// same prompts, schemas and transitions. Golden: test/fixtures/test-pipeline-steps-434.json.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');
const { root } = require('./engine-helpers');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'test-pipeline-steps-434.json'), 'utf8'));
const BLOCK = ['test', 'suite', 'test_failed', 'build', 'build_failed', 'evidence', 'verify_change'];
const WORKFLOWS = ['software-development', 'software-development-local-hero', 'ai-development-local-hero'];

const load = (name) => loadWorkflow(path.join(root, 'workflows', `${name}.yaml`));
// A plain JSON copy: compares what the steps say, not object identity or hidden properties.
const plain = (value) => JSON.parse(JSON.stringify(value));
const gotos = (step) => (step.transitions || []).flatMap((t) => [t.goto, t.on_exhausted]).filter(Boolean);

for (const name of WORKFLOWS) {
  test(`${name}: loads the whole step list in the same order`, () => {
    assert.deepEqual(load(name).steps.map((s) => s.id), golden[name].order);
  });

  test(`${name}: the test pipeline steps are contiguous and in the shared order`, () => {
    const ids = load(name).steps.map((s) => s.id);
    const start = ids.indexOf('test');
    const block = ids.filter((id) => BLOCK.includes(id));
    assert.deepEqual(block, BLOCK);
    if (name === 'ai-development-local-hero') {
      // ai-dev keeps its own e2e / heal / check_failed steps between suite and test_failed.
      assert.deepEqual(ids.slice(start, start + 9), ['test', 'suite', 'e2e', 'heal', 'check_failed', 'test_failed', 'build', 'build_failed', 'evidence']);
    } else {
      assert.deepEqual(ids.slice(start, start + BLOCK.length), BLOCK);
    }
    assert.equal(ids[ids.indexOf('verify_change') + 1], 'verify_failed');
  });

  for (const id of BLOCK) {
    test(`${name}: step ${id} keeps its prompt, schema and transitions`, () => {
      const step = load(name).steps.find((s) => s.id === id);
      assert.equal(step === undefined, false, `step ${id} is missing`);
      assert.deepEqual(plain(step), golden[name].steps[BLOCK.indexOf(id)]);
    });
  }

  test(`${name}: loads without warnings about the pipeline steps`, () => {
    const warnings = (load(name).warnings || []).map(String).filter((w) => BLOCK.some((id) => w.includes(`"${id}"`)));
    assert.deepEqual(warnings, []);
  });
}

test('software-development: the steps outside the block that route into it', () => {
  const wf = load('software-development');
  const into = {};
  for (const step of wf.steps) {
    if (BLOCK.includes(step.id)) continue;
    const targets = [...new Set(gotos(step).filter((g) => BLOCK.includes(g)))];
    if (targets.length) into[step.id] = targets;
  }
  assert.deepEqual(into, { code_review: ['build', 'suite', 'test'], human_review: ['build', 'suite', 'test'] });
});

test('software-development: the block leaves only to develop, ci, verify_failed and end', () => {
  const wf = load('software-development');
  const out = new Set();
  for (const id of BLOCK) {
    const step = wf.steps.find((s) => s.id === id);
    for (const g of gotos(step)) if (!BLOCK.includes(g)) out.add(g);
    for (const c of step.choices || []) if (c.goto && !BLOCK.includes(c.goto)) out.add(c.goto);
  }
  assert.deepEqual([...out].sort(), ['ci', 'develop', 'end', 'verify_failed']);
});

test('software-development: the test prompt checks pre-existing failures on origin/<base_branch>', () => {
  const step = load('software-development').steps.find((s) => s.id === 'test');
  assert.match(step.prompt, /first check whether the same test fails on\n`origin\/\{\{ inputs\.base_branch \}\}`/);
  assert.match(step.prompt, /\{\{ base_worktree_dir or "a temporary worktree of the base" \}\}/);
});

test('the local-hero workflows check pre-existing failures on the local base, not origin/', () => {
  for (const name of ['software-development-local-hero', 'ai-development-local-hero']) {
    const step = load(name).steps.find((s) => s.id === 'test');
    assert.match(step.prompt, /pre-existing failures/, name);
    assert.doesNotMatch(step.prompt, /fails on\n`origin\//, name);
  }
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
