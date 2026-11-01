const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../engine/workflow');
const evidence = require('../domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root } = require('./engine-helpers');

// ---- software-development-local-hero: local worktree, automatic local merge, no CI/PR --------

test('local hero workflow: no CI/PR/deploy, a local worktree, an automatic merge with a resolution path, a 40M context limit', () => {
  const wf = loadWorkflow(path.join(root, 'workflows', 'feature.yaml'));
  // #630: local (no fetch) in Local mode, the fetched origin/<base> in Remote mode
  assert.equal(render(String(wf.orchestrator.worktree.remote), { inputs: { mode: 'local' } }), 'false');
  assert.equal(render(String(wf.orchestrator.worktree.remote), { inputs: { mode: 'remote' } }), 'true');
  assert.equal(wf.orchestrator.limits.max_total_context, '40M');
  const ids = wf.steps.map((s) => s.id);
  // #630: feature's Remote mode has ci / ci_failed / pr_review (and the ci_pusher); Local mode merges, then push_main
  for (const gone of ['pr_babysitter', 'deploy_test', 'approve_merge', 'deploy_prod', 'approve_local_merge']) assert.ok(!ids.includes(gone), gone);
  assert.ok(!Object.keys(wf.agents).some((a) => ['pr_babysitter', 'deployer'].includes(a)));
  const verify = wf.steps.find((s) => s.id === 'verify_change');
  assert.deepEqual(verify.transitions.find((t) => t.merge === 'local'), { when: "output.verdict != 'not_verified'", merge: 'local', goto: 'push_main', on_error: 'resolve_merge' });
  assert.equal(wf.steps.find((s) => s.id === 'resolve_merge').agent, 'developer');

  const tmp = path.join(os.tmpdir(), `merge-local-${process.pid}.yaml`);
  const write = (merge, { worktree = true, limit = '' } = {}) => fs.writeFileSync(tmp, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: m }
${worktree ? 'orchestrator:\n  worktree: { repo: ".", base: main, remote: false }\n' : ''}${limit ? `  limits: { max_total_context: ${limit} }\n` : ''}agents:
  a: { provider: claude, model: m }
steps:
  - id: gate
    type: human_approval
    message: ok?
    transitions:
      - when: "approved"
        merge: ${merge}
        goto: end
        on_error: nowhere
      - when: "rejected"
        goto: end
`);
  try {
    write('remote');
    assert.throws(() => loadWorkflow(tmp), /points to unknown step "nowhere"|merge must be "local"/);
    fs.writeFileSync(tmp, fs.readFileSync(tmp, 'utf8').replace('on_error: nowhere', 'on_error: gate'));
    assert.throws(() => loadWorkflow(tmp), /merge must be "local"/);
    write('local', { worktree: false });
    fs.writeFileSync(tmp, fs.readFileSync(tmp, 'utf8').replace('on_error: nowhere', 'on_error: gate'));
    assert.throws(() => loadWorkflow(tmp), /merge: local needs orchestrator.worktree/);
    write('local', { limit: 'lots' });
    fs.writeFileSync(tmp, fs.readFileSync(tmp, 'utf8').replace('on_error: nowhere', 'on_error: gate'));
    assert.throws(() => loadWorkflow(tmp), /max_total_context must be a token count/);
  } finally {
    fs.unlinkSync(tmp);
  }
});
// ---- #198: base_worktree (the test writer's temporary checkout of the base, from the shared cache) --

test('loadWorkflow validates base_worktree: boolean, on an agent step only, needs orchestrator.worktree', () => {
  const tmp = path.join(os.tmpdir(), `wf-base-worktree-${process.pid}.yaml`);
  const write = (extra, { worktree = true } = {}) => fs.writeFileSync(tmp, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: m }
${worktree ? 'orchestrator:\n  worktree: { repo: ".", base: main }\n' : ''}agents:
  a: { provider: claude, model: m }
steps:
  - id: s1
    agent: a
    prompt: do it
    ${extra}
`);
  try {
    write('base_worktree: "yes"');
    assert.throws(() => loadWorkflow(tmp), /base_worktree must be true or false, on an agent step of a workflow with orchestrator\.worktree/);
    write('base_worktree: true', { worktree: false });
    assert.throws(() => loadWorkflow(tmp), /base_worktree must be true or false, on an agent step of a workflow with orchestrator\.worktree/);
    write('base_worktree: true');
    assert.doesNotThrow(() => loadWorkflow(tmp));
    write('base_worktree: false');
    assert.doesNotThrow(() => loadWorkflow(tmp));
  } finally {
    fs.unlinkSync(tmp);
  }
});
test('loadWorkflow rejects base_worktree on a human_approval (gate) step', () => {
  const tmp = path.join(os.tmpdir(), `wf-base-worktree-gate-${process.pid}.yaml`);
  fs.writeFileSync(tmp, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: m }
orchestrator:
  worktree: { repo: ".", base: main }
agents:
  a: { provider: claude, model: m }
steps:
  - id: g
    type: human_approval
    message: ok?
    base_worktree: true
`);
  try {
    assert.throws(() => loadWorkflow(tmp), /base_worktree must be true or false, on an agent step of a workflow with orchestrator\.worktree/);
  } finally {
    fs.unlinkSync(tmp);
  }
});
test('e2e-release.yaml loads', () => {
  assert.doesNotThrow(() => loadWorkflow(path.join(root, 'workflows', 'release.yaml')));
});
// The `verify_failed` and `approve_merge`/`developer_check` gate templates rendered directly (no
// full mock run needed: `render` shares the engine's own template env, including `e2e_scenarios`).
test('local hero workflow: verify_failed\'s message has the Dev/QA line and the scenarios, or "none reported" without them', () => {
  const wf = loadWorkflow(path.join(root, 'workflows', 'feature.yaml'));
  const msg = wf.steps.find((s) => s.id === 'verify_failed').message;
  const scope = { steps: { verify_change: { output: { claim: 'The filter persists', evidence: 'It did not, on reload' } }, acceptance_tests: { output: null } } };
  const withoutScenarios = render(msg, scope);
  assert.match(withoutScenarios, /Dev\/QA: read the E2E scenarios and the screenshots/);
  assert.match(withoutScenarios, /E2E scenarios: none reported by the test writer\./);

  const withScenarios = render(msg, {
    ...scope,
    steps: { ...scope.steps, acceptance_tests: { output: { scenarios: [{ name: 'Filter the runs', status: 'passed' }, { name: 'Empty filter result', status: 'failed', reason: 'no message shown' }] } } },
  });
  assert.match(withScenarios, /E2E scenarios \(written by the test writer\): 1 passed · 1 failed/);
  assert.match(withScenarios, /- failed: Empty filter result \(no message shown\)/);
});
test('recordEvidence captions an E2E scenario\'s screenshots "Scenario: <name>", an explicit screenshots[].caption winning on the same file (#143)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recordEvidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const putFile = (rel) => {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'PNG');
  };
  putFile('evidence/test/round-1/143-e2e-filter-by-status-1.modified.png');
  putFile('evidence/test/round-1/143-e2e-empty-result-1.modified.png');

  const run = Object.create(WorkflowRun.prototype);
  Object.assign(run, { runDir: dir, worktree: null, worktreeHead: () => null, worktreeBranch: () => null, emitEvent: () => {} });

  run.recordEvidence({ id: 'test' }, { visits: 1 }, {
    scenarios: [
      { name: 'Filter the runs by status', status: 'passed', screenshots: ['143-e2e-filter-by-status-1.modified.png'] },
      { name: 'An empty filter result explains itself', status: 'failed', screenshots: ['evidence/test/round-1/143-e2e-empty-result-1.modified.png'] },
    ],
    screenshots: [{ path: '143-e2e-filter-by-status-1.modified.png', caption: 'Explicit caption wins' }],
  });

  const manifest = JSON.parse(fs.readFileSync(evidence.manifestPath(dir), 'utf8'));
  const byPath = Object.fromEntries(manifest.images.map((i) => [i.path, i.caption]));
  assert.equal(byPath['evidence/test/round-1/143-e2e-filter-by-status-1.modified.png'], 'Explicit caption wins');
  assert.equal(byPath['evidence/test/round-1/143-e2e-empty-result-1.modified.png'], 'Scenario: An empty filter result explains itself');
});
