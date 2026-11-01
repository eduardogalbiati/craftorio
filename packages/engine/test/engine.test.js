const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../engine/workflow');
const evidence = require('../domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root, until } = require('./engine-helpers');

test('extractJson takes the last ```json block of the response', () => {
  const text = 'before\n```json\n{"a":1}\n```\nmiddle\n```json\n{"a":2}\n```\nend';
  assert.deepEqual(extractJson(text), { a: 2 });
});
test('extractJson accepts bare JSON and fails without JSON', () => {
  assert.deepEqual(extractJson('result: {"ok": true}'), { ok: true });
  assert.throws(() => extractJson('no json here'), /No valid JSON block/);
});
test('validateSchema reports type, enum and required fields', () => {
  const schema = {
    type: 'object',
    required: ['state', 'n'],
    properties: { state: { type: 'string', enum: ['a', 'b'] }, n: { type: 'integer' } },
  };
  assert.deepEqual(validateSchema({ state: 'a', n: 1 }, schema), []);
  const errs = validateSchema({ state: 'x', n: 1.5 }, schema);
  assert.equal(errs.length, 2);
  assert.match(errs.join(), /not in/);
  assert.match(validateSchema({}, schema).join(), /state: required/);
});
test('evalExpr evaluates comparisons, in and and', () => {
  assert.equal(evalExpr("output.state in ['merged','closed']", { output: { state: 'merged' } }), true);
  assert.equal(evalExpr("output.state in ['merged','closed']", { output: { state: 'open' } }), false);
  assert.equal(evalExpr('output.ok and output.n == 0', { output: { ok: true, n: 0 } }), true);
});
test('every workflow in workflows/ is valid', () => {
  for (const f of fs.readdirSync(path.join(root, 'workflows'))) {
    assert.doesNotThrow(() => loadWorkflow(path.join(root, 'workflows', f)), f);
  }
});
// ---- outputs (#134): every bundled workflow declares the result contract the issue lists ---------
test('each bundled workflow declares its outputs: contract', () => {
  const outputsOf = (f) => Object.keys(loadWorkflow(path.join(root, 'workflows', f)).outputs || {}).sort();
  assert.deepEqual(outputsOf('issue-tracker.yaml'), ['issues']);
  assert.deepEqual(outputsOf('writer-reviewer.yaml'), ['document', 'issue']);
  assert.deepEqual(outputsOf('ai-arena.yaml'), ['document']);
  assert.deepEqual(outputsOf('feature.yaml'), ['branch', 'issues', 'merged_commit', 'pr_url']);
  assert.deepEqual(outputsOf('retrospective.yaml'), ['findings']);
});
test('loadWorkflow rejects a transition to an unknown step', () => {
  const tmp = path.join(os.tmpdir(), `wf-invalid-${process.pid}.yaml`);
  fs.writeFileSync(tmp, 'agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: s1\n    agent: a\n    transitions:\n      - { when: "true", goto: missing_step }\n');
  try {
    assert.throws(() => loadWorkflow(tmp), /unknown step "missing_step"/);
  } finally {
    fs.unlinkSync(tmp);
  }
});
test('isPermissionDenial tells a tool call refused by the allowlist from a command that failed', () => {
  const { isPermissionDenial } = require('../engine/providers');
  const result = (output, is_error = true) => ({ kind: 'tool_result', id: 'x', output, is_error });
  assert.equal(isPermissionDenial(result('This command requires approval')), true);
  assert.equal(isPermissionDenial(result("Claude requested permissions to use PowerShell, but you haven't granted it yet.")), true);
  assert.equal(isPermissionDenial(result('Permission to use Bash with command gh pr view has been denied.')), true);
  assert.equal(isPermissionDenial(result('gh: Not Found (HTTP 404)')), false);
  assert.equal(isPermissionDenial(result('fatal: could not read from remote: permission denied (publickey)', false)), false);
  assert.equal(isPermissionDenial({ kind: 'text', text: 'This command requires approval' }), false);
});
test('loadWorkflow validates fan-out', () => {
  const tmp = path.join(os.tmpdir(), `wf-fanout-${process.pid}.yaml`);
  const write = (step) => fs.writeFileSync(tmp, `agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: s1\n${step}`);
  try {
    write('    agents: [a, x]\n');
    assert.throws(() => loadWorkflow(tmp), /unknown agent "x"/);
    write('    agents: []\n');
    assert.throws(() => loadWorkflow(tmp), /non-empty list/);
    write('    agents: [a]\n    goal: { until: "true" }\n');
    assert.throws(() => loadWorkflow(tmp), /goal is not supported/);
  } finally {
    fs.unlinkSync(tmp);
  }
});
test('shuffle filter is deterministic per seed and keeps every item', () => {
  const t = '{% for n in xs | shuffle(seed) %}{{ n }},{% endfor %}';
  const xs = ['a', 'b', 'c', 'd'];
  const once = render(t, { xs, seed: 'run-1' });
  assert.equal(render(t, { xs, seed: 'run-1' }), once);
  assert.deepEqual(once.split(',').filter(Boolean).sort(), xs);
  const orders = new Set(Array.from({ length: 20 }, (_, i) => render(t, { xs, seed: `run-${i}` })));
  assert.ok(orders.size > 5, 'different seeds give different orders');
  assert.deepEqual(xs, ['a', 'b', 'c', 'd'], 'input not mutated');
});
test('github_repo filter turns a PR URL into HOST/OWNER/REPO for gh --repo', () => {
  const t = '{{ url | github_repo }}';
  assert.equal(render(t, { url: 'https://github.com/owner/repo/pull/123' }), 'github.com/owner/repo');
  assert.equal(render(t, { url: 'https://ghe.acme.io/my-org/my.repo_2/pull/7/files' }), 'ghe.acme.io/my-org/my.repo_2');
});
test('github_repo filter rejects values that are not a PR URL, so nothing reaches the shell', () => {
  const t = '{{ url | github_repo }}';
  for (const url of [
    'https://github.com/owner/repo/pull/1; rm -rf ~',
    'https://github.com/owner/repo$(whoami)/pull/1',
    'https://github.com/owner/repo/pull/1 & calc',
    'github.com/owner/repo/pull/1',
    'https://github.com/owner/repo/issues/1',
    '',
  ]) assert.throws(() => render(t, { url }), /not a GitHub pull request URL/, url);
});
test('pr_url filter passes GitHub PR and GitLab MR URLs and rejects anything else', () => {
  const t = '{{ url | pr_url }}';
  assert.equal(render(t, { url: 'https://github.com/owner/repo/pull/12' }), 'https://github.com/owner/repo/pull/12');
  assert.equal(render(t, { url: 'https://gitlab.example.com/group/sub/app/-/merge_requests/5' }), 'https://gitlab.example.com/group/sub/app/-/merge_requests/5');
  for (const url of [
    'https://github.com/owner/repo/pull/1 && calc',
    'https://gitlab.com/g/app/-/merge_requests/1"; whoami',
    'https://github.com/owner/repo/issues/1',
    '',
  ]) assert.throws(() => render(t, { url }), /not a pull\/merge request URL/, url);
});
// #173: a declared gap (`left_out`) led by "Tests" or "Measure" is the test writer's or the
// owner's task, never the developer's: developer_gaps drops it before the return-to-develop and
// requirements_left_out gate conditions see the list.
test('developer_gaps filter drops Tests/Measure entries, keeps real gaps', () => {
  const t = '{{ gaps | developer_gaps | to_json }}';
  const dropped = [
    '**Tests**: unit tests of the change',
    'Measure: real before/after runs',
    '- [ ] **Measure**: count requirements_left_out gates',
    'Tests',
    'Measurement (owner)',
  ];
  const kept = [
    'Test coverage of X',
    'Testsuite fix',
    'Guard in the engine',
    'Add the retry option',
  ];
  const gaps = [...dropped, ...kept].map((requirement) => ({ requirement, reason: 'r' }));
  const result = JSON.parse(render(t, { gaps }));
  assert.deepEqual(result.map((g) => g.requirement), kept);
  assert.equal(render(t, { gaps: 'not-an-array' }), '[]');
  assert.equal(render(t, { gaps: undefined }), '[]');
});
test('loadWorkflow validates a transition status (end outcome)', () => {
  const tmp = path.join(os.tmpdir(), `wf-status-${process.pid}.yaml`);
  const write = (t) => fs.writeFileSync(tmp, `agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: s1\n    agent: a\n    transitions:\n      - ${t}\n`);
  try {
    write('{ when: "true", goto: end, status: failed }');
    assert.doesNotThrow(() => loadWorkflow(tmp));
    write('{ when: "true", goto: s1, max_visits: 1, on_exhausted: end, status: cancelled }');
    assert.doesNotThrow(() => loadWorkflow(tmp));
    write('{ when: "true", goto: end, status: broken }');
    assert.throws(() => loadWorkflow(tmp), /status must be one of success, failed, cancelled/);
    write('{ when: "true", goto: s1, status: failed }');
    assert.throws(() => loadWorkflow(tmp), /only applies when the transition ends the run/);
  } finally {
    fs.unlinkSync(tmp);
  }
});
test('loadWorkflow validates local_preview and diff_base: human_approval steps only, diff_base must be a non-empty ref', () => {
  const onAgentStep = (field) => `agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: s1\n    agent: a\n    prompt: "do it"\n    ${field}\n`;
  const onGate = (field) => `agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: g\n    type: human_approval\n    message: "ok?"\n    ${field}\n`;
  const tmp = path.join(os.tmpdir(), `wf-gate-${process.pid}.yaml`);
  const write = (text) => fs.writeFileSync(tmp, text);
  try {
    write(onAgentStep('local_preview: true'));
    assert.throws(() => loadWorkflow(tmp), /local_preview must be true or false, on a human_approval step/);
    write(onAgentStep('diff_base: "origin/main"'));
    assert.throws(() => loadWorkflow(tmp), /diff_base must be a ref \(e\.g\. "origin\/\{\{ inputs\.base_branch \}\}"\), on a human_approval step/);

    write(onGate('local_preview: "yes"'));
    assert.throws(() => loadWorkflow(tmp), /local_preview must be true or false/);
    write(onGate('diff_base: 3'));
    assert.throws(() => loadWorkflow(tmp), /diff_base must be a ref/);
    write(onGate('diff_base: "   "'));
    assert.throws(() => loadWorkflow(tmp), /diff_base must be a ref/);

    write(onGate('diff_base: "origin/{{ inputs.base_branch }}"\n    local_preview: true'));
    assert.doesNotThrow(() => loadWorkflow(tmp));
  } finally {
    fs.unlinkSync(tmp);
  }
});
// ---- #125: save_to_issue on a human_approval gate ("Accept and save to issue #n") ----------------

test('loadWorkflow validates save_to_issue: human_approval steps only, and must name one of the step\'s own choices', () => {
  const onAgentStep = `agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: s1\n    agent: a\n    prompt: "do it"\n    save_to_issue: accept\n`;
  const onGate = (choice) => `agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: g\n    type: human_approval\n    message: "ok?"\n    choices:\n      - { id: accept, label: Accept }\n      - { id: stop, label: Stop }\n    save_to_issue: ${choice}\n`;
  const tmp = path.join(os.tmpdir(), `wf-save-issue-${process.pid}.yaml`);
  try {
    fs.writeFileSync(tmp, onAgentStep);
    assert.throws(() => loadWorkflow(tmp), /save_to_issue must be the id of one of the step's choices \(e\.g\. accept\), on a human_approval step/);

    fs.writeFileSync(tmp, onGate('revise')); // not one of the gate's own choices
    assert.throws(() => loadWorkflow(tmp), /save_to_issue must be the id of one of the step's choices/);

    fs.writeFileSync(tmp, onGate('accept'));
    assert.doesNotThrow(() => loadWorkflow(tmp));
  } finally {
    fs.unlinkSync(tmp);
  }
});
test('loadWorkflow validates groups: known steps, one group per step, unique names', () => {
  const tmp = path.join(os.tmpdir(), `wf-groups-${process.pid}.yaml`);
  const write = (groups) => fs.writeFileSync(tmp, `agents: { a: { provider: claude, model: m } }\n${groups}steps:\n  - id: s1\n    agent: a\n  - id: s2\n    agent: a\n`);
  try {
    write('');
    assert.equal(loadWorkflow(tmp).groups, undefined);
    write('groups:\n  - { name: Build, steps: [s1, s2] }\n');
    assert.deepEqual(loadWorkflow(tmp).groups, [{ name: 'Build', steps: ['s1', 's2'] }]);
    write('groups:\n  - { name: Build, steps: [s1, nope] }\n');
    assert.throws(() => loadWorkflow(tmp), /Group "Build" references unknown step "nope"/);
    write('groups:\n  - { name: Build, steps: [s1] }\n  - { name: Test, steps: [s2, s1] }\n');
    assert.throws(() => loadWorkflow(tmp), /Step "s1" is in two groups: "Build" and "Test"/);
    write('groups:\n  - { name: Build, steps: [s1] }\n  - { name: Build, steps: [s2] }\n');
    assert.throws(() => loadWorkflow(tmp), /Group "Build" is defined twice/);
    write('groups:\n  - { name: Build, steps: [] }\n');
    assert.throws(() => loadWorkflow(tmp), /non-empty list/);
    write('groups: { Build: [s1] }\n');
    assert.throws(() => loadWorkflow(tmp), /groups must be a list/);
  } finally {
    fs.unlinkSync(tmp);
  }
});
test('the bundled workflows group every step', () => {
  for (const f of ['feature.yaml', 'fix.yaml', 'release.yaml', 'ai-arena.yaml', 'writer-reviewer.yaml', 'retrospective.yaml', 'backlog-refresh.yaml']) {
    const wf = loadWorkflow(path.join(root, 'workflows', f));
    assert.ok(wf.groups?.length, `${f} has groups`);
    assert.deepEqual(wf.groups.flatMap((g) => g.steps).sort(), wf.steps.map((s) => s.id).sort(), f);
  }
});
test('loadWorkflow validates a `type: workflow` step: agent present, missing workflow, and a workflow naming itself', () => {
  const tmp = path.join(os.tmpdir(), `wf-workflow-step-${process.pid}.yaml`);
  const onStep = (extra) => `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: wf-workflow-step-${process.pid} }
agents: { a: { provider: claude, model: m } }
steps:
  - id: child
    type: workflow
    ${extra}
`;
  fs.writeFileSync(tmp, onStep('agent: a\n    workflow: other.yaml'));
  try { assert.throws(() => loadWorkflow(tmp), /has no agent/); } finally { fs.rmSync(tmp, { force: true }); }
  fs.writeFileSync(tmp, onStep('inputs: {}'));
  try { assert.throws(() => loadWorkflow(tmp), /workflow must name/); } finally { fs.rmSync(tmp, { force: true }); }
  fs.writeFileSync(tmp, onStep(`workflow: ${path.basename(tmp)}`));
  try { assert.throws(() => loadWorkflow(tmp), /cannot run itself/); } finally { fs.rmSync(tmp, { force: true }); }
});
// =============================================================================
// #177: a `type: suite` step runs the project's whole suite once per round, without an agent.
// suite-step.js's own parsing/detection is in test/engine-suite-step.test.js; these tests cover
// the engine's wiring (validation, mockSequences.suite, transitions, summary.suite_runs).
// =============================================================================

test('loadWorkflow validates a `type: suite` step: no agent, command must be a string, timeout a duration', () => {
  const tmp = path.join(os.tmpdir(), `wf-suite-step-${process.pid}.yaml`);
  const onStep = (extra) => `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: wf-suite-step-${process.pid} }
agents: { a: { provider: claude, model: m } }
steps:
  - id: suite
    type: suite
    ${extra}
`;
  try {
    fs.writeFileSync(tmp, onStep('agent: a'));
    assert.throws(() => loadWorkflow(tmp), /a suite step has no agent/);
    fs.writeFileSync(tmp, onStep('command: 42'));
    assert.throws(() => loadWorkflow(tmp), /command must be a string/);
    fs.writeFileSync(tmp, onStep('timeout: not-a-duration'));
    assert.throws(() => loadWorkflow(tmp), /timeout must be a duration/);
    fs.writeFileSync(tmp, onStep('command: "npm test"\n    timeout: 30m'));
    assert.doesNotThrow(() => loadWorkflow(tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
test('loadWorkflow validates `full_suite`: only "warn", and only on an agent step', () => {
  const tmp = path.join(os.tmpdir(), `wf-full-suite-${process.pid}.yaml`);
  const onStep = (type, full_suite) => `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: wf-full-suite-${process.pid} }
agents: { a: { provider: claude, model: m } }
steps:
  - id: s1
    ${type === 'suite' ? 'type: suite' : 'agent: a'}
    full_suite: ${full_suite}
`;
  try {
    fs.writeFileSync(tmp, onStep('agent', 'nope'));
    assert.throws(() => loadWorkflow(tmp), /full_suite must be "warn"/);
    fs.writeFileSync(tmp, onStep('suite', 'warn'));
    assert.throws(() => loadWorkflow(tmp), /full_suite must be "warn"/); // not on a suite step
    fs.writeFileSync(tmp, onStep('agent', 'warn'));
    assert.doesNotThrow(() => loadWorkflow(tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('loadWorkflow validates a suite step\'s scope: affected (#212), failed (#324) or full, nothing else', () => {
  const tmp = path.join(os.tmpdir(), `wf-suite-scope-${process.pid}.yaml`);
  const suite = (scope) => `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: wf-suite-scope-${process.pid} }
agents: { a: { provider: claude, model: m } }
steps:
  - id: s1
    type: suite
    scope: ${scope}
`;
  try {
    fs.writeFileSync(tmp, suite('partial'));
    assert.throws(() => loadWorkflow(tmp), /scope must be affected, failed or full/);
    fs.writeFileSync(tmp, suite('affected'));
    assert.doesNotThrow(() => loadWorkflow(tmp));
    fs.writeFileSync(tmp, suite('failed'));
    assert.doesNotThrow(() => loadWorkflow(tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
