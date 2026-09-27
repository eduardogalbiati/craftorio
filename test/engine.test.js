const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../src/engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const root = path.join(__dirname, '..');

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

test('loadWorkflow rejects a transition to an unknown step', () => {
  const tmp = path.join(os.tmpdir(), `wf-invalid-${process.pid}.yaml`);
  fs.writeFileSync(tmp, 'agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: s1\n    agent: a\n    transitions:\n      - { when: "true", goto: missing_step }\n');
  try {
    assert.throws(() => loadWorkflow(tmp), /unknown step "missing_step"/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('/goal + /loop: repeats the step, delegates the failure and passes on the result', { timeout: 60000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(__dirname, 'fixtures', 'loop-goal.yaml'),
    inputs: { repo_path: root },
    mock: true,
    runsDir,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      assert.deepEqual(ev.choices.map((c) => c.id), ['proceed', 'stop']);
      setImmediate(() => run.resolveApproval(ev.approval_id, 'proceed'));
    }
  });
  await run.start();

  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  // pending → failed → pending → success: 4 iterations and the goal is only met on the last one
  const goals = events.filter((e) => e.type === 'step.goal').map((e) => e.met);
  assert.deepEqual(goals, [false, false, false, true]);
  assert.ok(events.some((e) => e.type === 'step.goal' && /CI green on run \d{8}/.test(e.goal)), 'goal description rendered');

  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'ci').map((e) => e.prompt);
  assert.match(prompts[0], /\/goal: CI green/);
  assert.match(prompts[0], /\/loop: iteration 1/);
  assert.match(prompts[3], /\/loop: iteration 4/);
  // the iteration after the failure receives the result of the delegation to dev
  assert.match(prompts[2], /DELEGATE:dev/);
  assert.doesNotMatch(prompts[3], /DELEGATE/);

  const resolved = events.find((e) => e.type === 'approval.resolved');
  assert.equal(resolved.choice, 'proceed');
  // waits the /loop interval after the delegation too (CI needs to restart)
  assert.equal(events.filter((e) => e.type === 'step.waiting').length, 3);
});

test('fan-out: agents in parallel, step/agent skills and save_as', { timeout: 30000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(__dirname, 'fixtures', 'fanout.yaml'),
    inputs: {},
    mock: true,
    runsDir,
    skillsDirs: [path.join(__dirname, 'fixtures', 'skills')],
  });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();

  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const compete = finished.summary.steps.compete.output;
  assert.deepEqual(Object.keys(compete.results).sort(), ['a', 'b']);
  assert.deepEqual(compete.failed, []);
  // both sessions open before either one responds (parallel)
  const order = events.filter((e) => ['session.opened', 'session.message_received'].includes(e.type) && ['a', 'b'].includes(e.session?.agent))
    .map((e) => e.type);
  assert.deepEqual(order.slice(0, 2), ['session.opened', 'session.opened']);

  const sent = events.filter((e) => e.type === 'session.message_sent');
  const promptOf = (step) => sent.filter((e) => e.step_id === step).map((e) => e.prompt);
  // the step skill (name from an input) goes in each agent's prompt, with the support files
  for (const p of promptOf('compete')) {
    assert.match(p, /<skill name="demo"/);
    assert.match(p, /DEMO-RULE/);
    assert.match(p, /demo[\\/]rules[\\/]x\.md/);
  }
  assert.ok(promptOf('compete').some((p) => /i am a/.test(p)) && promptOf('compete').some((p) => /i am b/.test(p)));
  // the agent skill goes in the system prompt, together with system_prompt
  const [judge] = promptOf('judge');
  assert.match(judge, /<system>\nYou are the judge\.\n\n<skill name="demo"/);
  assert.match(judge, /P1=model-a;P2=model-b;/);

  assert.ok(fs.existsSync(path.join(run.runDir, 'out', 'a.md')));
  assert.ok(fs.existsSync(path.join(run.runDir, 'out', 'b.md')));
  assert.ok(fs.existsSync(path.join(run.runDir, 'final.md')));
  assert.equal(events.filter((e) => e.type === 'file.saved').length, 3);
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

test('a missing skill fails the run with a clear message', { timeout: 30000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'fanout.yaml'), inputs: { doc_skill: 'does-not-exist' }, mock: true, runsDir, skillsDirs: [] });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /Skill not found: "does-not-exist"/);
});

test('skills: `uses` loads dependencies first, once, and survives cycles', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-uses-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (id, uses) => {
    fs.mkdirSync(path.join(dir, id));
    fs.writeFileSync(path.join(dir, id, 'SKILL.md'), `---\nname: ${id}\ndescription: x\nuses: [${uses.join(', ')}]\n---\nbody ${id}\n`);
  };
  write('core', []);
  write('lang-a', ['core']);
  write('lang-b', ['core', 'lang-a']);
  write('cyc-1', ['cyc-2']);
  write('cyc-2', ['cyc-1']);
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'fanout.yaml'), inputs: {}, mock: true, runsDir: os.tmpdir(), skillsDirs: [dir] });
  assert.deepEqual(run.loadSkills(['lang-b', 'lang-a', '']).map((s) => s.name), ['core', 'lang-a', 'lang-b']);
  assert.deepEqual(run.loadSkills(['cyc-1']).map((s) => s.name), ['cyc-2', 'cyc-1']);
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

test('decision log: ```decisions blocks are appended to decisions.tsv', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'fanout.yaml'), inputs: {}, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  run.recordDecisions('dev', 'develop', 'no block here');
  assert.equal(fs.existsSync(path.join(run.runDir, 'decisions.tsv')), false);
  run.recordDecisions('dev', 'develop', 'Done.\n```decisions\nimplement | kept retries in client | 3 callers | client.ts | ok\n- fix\tskipped flaky test\tfails on main\trun 4812\tpending\n```\n```json\n{"a":1}\n```');
  const lines = fs.readFileSync(path.join(run.runDir, 'decisions.tsv'), 'utf8').trim().split('\n');
  assert.equal(lines[0], 'ts\tagent\tstep\tphase\tdecision\twhy\tevidence\tresult');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[1].split('\t').slice(1), ['dev', 'develop', 'implement', 'kept retries in client', '3 callers', 'client.ts', 'ok']);
  assert.deepEqual(lines[2].split('\t').slice(3), ['fix', 'skipped flaky test', 'fails on main', 'run 4812', 'pending']);
  assert.equal(events.find((e) => e.type === 'decision.logged').count, 2);
});
