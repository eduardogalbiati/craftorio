const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../src/engine/workflow');
const evidence = require('../src/evidence');

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

// ---- outputs (#134): every bundled workflow declares the result contract the issue lists ---------
test('each bundled workflow declares its outputs: contract', () => {
  const outputsOf = (f) => Object.keys(loadWorkflow(path.join(root, 'workflows', f)).outputs || {}).sort();
  assert.deepEqual(outputsOf('issue-tracker.yaml'), ['issues']);
  assert.deepEqual(outputsOf('writer-reviewer.yaml'), ['document', 'issue']);
  assert.deepEqual(outputsOf('ai-arena.yaml'), ['document']);
  assert.deepEqual(outputsOf('software-development.yaml'), ['branch', 'issues', 'merged_commit', 'pr_url']);
  assert.deepEqual(outputsOf('software-development-local-hero.yaml'), ['branch', 'issues', 'merged_commit', 'pr_url']);
  assert.deepEqual(outputsOf('run-retrospective.yaml'), ['findings']);
});

test('computeOutputs: each declared output is the template rendered over the finished run, parsed for its type; empty or unparsable stays null (with a warning)', async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(__dirname, 'fixtures', 'outputs.yaml'), inputs: {}, mock: true, runsDir, mockSequences: { count: [7] },
  });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  fs.rmSync(runsDir, { recursive: true, force: true });
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(finished.outputs, { doc: '(simulated) items', total: 7, empty: null, broken: null });
  assert.deepEqual(finished.summary.outputs, finished.outputs);
  assert.ok(events.some((e) => e.type === 'log' && e.level === 'warn' && e.message.startsWith('Output broken could not be filled:')));
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
  // a step with an output_schema ends by requiring English, whatever the project's own instructions say
  assert.match(prompts[0], /written in English[\s\S]*whatever language the project instructions or the conversation use/);

  const resolved = events.find((e) => e.type === 'approval.resolved');
  assert.equal(resolved.choice, 'proceed');
  // waits the /loop interval after the delegation too (CI needs to restart)
  assert.equal(events.filter((e) => e.type === 'step.waiting').length, 3);
});

test('isPermissionDenial tells a tool call refused by the allowlist from a command that failed', () => {
  const { isPermissionDenial } = require('../src/engine/providers');
  const result = (output, is_error = true) => ({ kind: 'tool_result', id: 'x', output, is_error });
  assert.equal(isPermissionDenial(result('This command requires approval')), true);
  assert.equal(isPermissionDenial(result("Claude requested permissions to use PowerShell, but you haven't granted it yet.")), true);
  assert.equal(isPermissionDenial(result('Permission to use Bash with command gh pr view has been denied.')), true);
  assert.equal(isPermissionDenial(result('gh: Not Found (HTTP 404)')), false);
  assert.equal(isPermissionDenial(result('fatal: could not read from remote: permission denied (publickey)', false)), false);
  assert.equal(isPermissionDenial({ kind: 'text', text: 'This command requires approval' }), false);
});

async function runLoopBlocked(t, mockSequences) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'loop-blocked.yaml'), inputs: {}, mock: true, runsDir, mockSequences });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, false));
  });
  await run.start();
  return { run, events, finished: events.find((e) => e.type === 'workflow.finished') };
}

test('/loop: an agent whose tools are refused stops after 3 blocked iterations instead of polling until max_duration', { timeout: 60000 }, async (t) => {
  const { run, events, finished } = await runLoopBlocked(t, { permission_denials: { watch: 99 } });

  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'watch').length, 3);
  assert.equal(events.filter((e) => e.type === 'step.waiting').length, 2);
  assert.ok(events.some((e) => e.type === 'step.transition' && e.from === 'watch' && e.to === 'stuck'), 'goes to on_exhausted');
  assert.equal(finished.status, 'failed');

  const stop = events.find((e) => e.type === 'log' && e.kind === 'loop_blocked');
  assert.match(stop.message, /3 iterations in a row blocked/);
  // each turn refused 6 calls in a row: a warning the supervisor's timeline and the run chat show
  const warns = events.filter((e) => e.type === 'log' && e.kind === 'permission_denials');
  assert.equal(warns.length, 3);
  assert.equal(warns[0].level, 'warn');
  assert.equal(warns[0].denials, 6);
  assert.match(warns[0].message, /\[sitter\] 6 tool calls refused/);

  const rows = fs.readFileSync(path.join(run.runDir, 'decisions.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].slice(1, 4), ['orchestrator', 'watch', 'loop']);
  assert.equal(rows[0][4], 'stopped the /loop of watch → stuck');
  assert.match(rows[0][6], /refused: .*gh\.exe/);
  assert.equal(rows[0][7], 'stuck');

  // every token of those turns is waste in the run's context metrics
  const sitter = finished.summary.context.agents.sitter;
  assert.equal(sitter.per_turn.length, 3);
  assert.ok(sitter.per_turn.every((x) => x.waste));
  assert.equal(sitter.waste_tokens, sitter.tokens);
  assert.equal(finished.summary.context.waste_tokens, sitter.tokens);
});

test('/loop: an agent that gets past its refused tools keeps polling until the goal is met', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runLoopBlocked(t, { permission_denials: { watch: 2 }, state: ['waiting', 'waiting', 'waiting', 'waiting', 'ready'] });

  assert.equal(finished.status, 'success', finished.error);
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'watch').length, 5);
  assert.ok(!events.some((e) => e.kind === 'loop_blocked'));
  assert.ok(!events.some((e) => e.type === 'approval.requested'));
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

async function runConditionalAction(t, cleanup) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'conditional-action.yaml'), inputs: { cleanup }, mock: true, runsDir, skillsDirs: [] });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  return events.filter((e) => e.type === 'action.executed');
}

test('a transition action runs a skill script through skill_dir()', async (t) => {
  const actions = await runConditionalAction(t, true);
  assert.equal(actions.length, 1);
  const script = path.join(root, 'skills', 'pr-screenshots');
  assert.equal(actions[0].command, `node "${script}/publish.js" --cleanup`);
});

// ---- resolveInputs: a `type: boolean` input accepts a real boolean or its saved text (#133/#116) ---

test('resolveInputs (type: boolean): a real boolean, and the text forms a form/CLI/older saved input sends, all coerce; an unreadable one throws', () => {
  const file = path.join(__dirname, 'fixtures', 'conditional-action.yaml');
  const inputsOf = (cleanup) => new WorkflowRun({ file, inputs: { cleanup }, mock: true, runsDir: os.tmpdir(), skillsDirs: [] }).inputs.cleanup;
  for (const [given, expected] of [[true, true], [false, false], ['true', true], ['false', false], ['yes', true], ['no', false], ['', false]]) {
    assert.equal(inputsOf(given), expected, JSON.stringify(given));
  }
  assert.throws(() => inputsOf('maybe'), /Input "cleanup" must be true or false/);
});

test('software-development removes the PR screenshots on merge or close, only when some were posted', () => {
  const wf = loadWorkflow(path.join(root, 'workflows', 'software-development.yaml'));
  const action = (stepId, when) => wf.steps.find((s) => s.id === stepId).transitions.find((x) => x.when === when).action;
  const scope = (posted) => ({
    inputs: { git_platform: 'gh' },
    skill_dir: () => 'C:/skills/pr-screenshots',
    steps: { ci: { output: { pr_number: 12, pr_url: 'https://github.com/acme/app/pull/12', screenshots_posted: posted } } },
  });
  const cleanupCmd = 'node "C:/skills/pr-screenshots/publish.js" --cleanup --platform gh --pr-url https://github.com/acme/app/pull/12';
  assert.equal(render(action('approve_merge', 'approved'), scope(true)), `gh pr merge 12 --repo github.com/acme/app --squash --delete-branch && ${cleanupCmd}`);
  assert.equal(render(action('approve_merge', 'approved'), scope(false)), 'gh pr merge 12 --repo github.com/acme/app --squash --delete-branch');
  for (const when of ["output.state == 'merged'", "output.state == 'closed'"]) {
    assert.equal(render(action('pr_babysitter', when), scope(true)), cleanupCmd);
    assert.equal(render(action('pr_babysitter', when), scope(false)), '');
  }
});

test('a transition action that renders empty runs nothing', async (t) => {
  assert.deepEqual(await runConditionalAction(t, false), []);
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

test('on_error: a failing step records { error } and continues at the given step', { timeout: 30000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'on-error.yaml'), inputs: {}, mock: true, runsDir, skillsDirs: [] });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  assert.match(finished.summary.steps.check.output.error, /Skill not found/);
  assert.equal(finished.summary.steps.never.visits, 0);
  const prompt = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'after').prompt;
  assert.match(prompt, /check said .*Skill not found/);
});

test('schema retries resend the schema, and the task plus previous answer for ephemeral agents', () => {
  const run = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'on-error.yaml'), inputs: {}, mock: true, runsDir: os.tmpdir() });
  const schema = { type: 'object', required: ['verdict'] };
  const p = run.retryPrompt('a', 'ORIGINAL TASK', 'PREVIOUS ANSWER', schema, ['output.verdict: required']);
  assert.match(p, /ORIGINAL TASK/);
  assert.match(p, /<previous_answer>\nPREVIOUS ANSWER\n<\/previous_answer>/);
  assert.match(p, /"required": \[\s*"verdict"\s*\]/);
  assert.match(p, /in English/);
  run.wf.agents.a.session = 'persistent';
  const q = run.retryPrompt('a', 'ORIGINAL TASK', 'PREVIOUS ANSWER', schema, ['x']);
  assert.doesNotMatch(q, /ORIGINAL TASK|PREVIOUS ANSWER/); // the session already has them
  assert.match(q, /"verdict"/);
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

test('a human_approval gate with save_to_issue carries { choice, issue } only for a run about an issue', { timeout: 30000 }, async (t) => {
  const yaml = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: gate-save-issue }
agents:
  a: { provider: claude, model: m }
steps:
  - id: gate
    type: human_approval
    message: "ok?"
    choices:
      - { id: accept, label: Accept }
      - { id: stop, label: Stop }
    save_to_issue: accept
`;
  const { file } = tempWorkflow(t, yaml);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));

  const withIssue = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, issue: { number: 42, url: 'https://github.com/o/r/issues/42', title: 'T' } });
  const withIssueEvents = [];
  withIssue.on('event', (ev) => { withIssueEvents.push(ev); if (ev.type === 'approval.requested') setImmediate(() => withIssue.resolveApproval(ev.approval_id, 'accept')); });
  await withIssue.start();
  const gate1 = withIssueEvents.find((e) => e.type === 'approval.requested');
  assert.deepEqual(gate1.save_to_issue, { choice: 'accept', issue: { number: 42, url: 'https://github.com/o/r/issues/42', title: 'T' } });

  const withoutIssue = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  const withoutIssueEvents = [];
  withoutIssue.on('event', (ev) => { withoutIssueEvents.push(ev); if (ev.type === 'approval.requested') setImmediate(() => withoutIssue.resolveApproval(ev.approval_id, 'accept')); });
  await withoutIssue.start();
  const gate2 = withoutIssueEvents.find((e) => e.type === 'approval.requested');
  assert.equal('save_to_issue' in gate2, false, 'no issue on the run: nothing to save to');
});

test('resolveApproval: intent save_to_issue is recorded only when the answer is the gate\'s own save_to_issue choice', { timeout: 30000 }, async (t) => {
  const yaml = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: gate-save-issue-intent }
agents:
  a: { provider: claude, model: m }
steps:
  - id: gate
    type: human_approval
    message: "ok?"
    choices:
      - { id: accept, label: Accept }
      - { id: stop, label: Stop }
    save_to_issue: accept
`;
  const { file } = tempWorkflow(t, yaml);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const issue = { number: 7, url: 'https://github.com/o/r/issues/7', title: 'T' };

  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, issue });
  const events = [];
  run.on('event', (ev) => { events.push(ev); if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, 'accept', 'user', '', 'save_to_issue')); });
  await run.start();
  const resolved = events.find((e) => e.type === 'approval.resolved');
  assert.equal(resolved.choice, 'accept', 'the transition still runs off the plain choice');
  assert.equal(resolved.intent, 'save_to_issue');

  // the intent is dropped for any other answer, even on the same gate (never saves on "stop")
  const run2 = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, issue });
  const events2 = [];
  run2.on('event', (ev) => { events2.push(ev); if (ev.type === 'approval.requested') setImmediate(() => run2.resolveApproval(ev.approval_id, 'stop', 'user', '', 'save_to_issue')); });
  await run2.start();
  const resolved2 = events2.find((e) => e.type === 'approval.resolved');
  assert.equal(resolved2.choice, 'stop');
  assert.equal('intent' in resolved2, false);
});

test('a human_approval gate carries diff_base and work_dir only when the run has a work dir', { timeout: 30000 }, async (t) => {
  const yaml = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: gate-diff }
agents:
  a: { provider: claude, model: m }
steps:
  - id: gate
    type: human_approval
    diff_base: "origin/main"
    message: "ok?"
`;
  const { file } = tempWorkflow(t, yaml);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir }); // no repo_path, no orchestrator.worktree: no work dir
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  const gate = events.find((e) => e.type === 'approval.requested');
  assert.equal('diff_base' in gate, false);
  assert.equal('work_dir' in gate, false);
});

test('a human_approval gate with local_preview: true sets run_app even without a local_preview config; local_preview only with one', { timeout: 30000 }, async (t) => {
  const yaml = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: gate-run-app }
inputs:
  repo_path: { type: string, required: true }
agents:
  a: { provider: claude, model: m }
steps:
  - id: gate
    type: human_approval
    local_preview: true
    message: "ok?"
`;
  const { file } = tempWorkflow(t, yaml);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

  const noConfig = new WorkflowRun({ file, inputs: { repo_path: repoDir }, mock: true, runsDir });
  const noConfigEvents = [];
  noConfig.on('event', (ev) => { noConfigEvents.push(ev); if (ev.type === 'approval.requested') setImmediate(() => noConfig.resolveApproval(ev.approval_id, true)); });
  await noConfig.start();
  const gate1 = noConfigEvents.find((e) => e.type === 'approval.requested');
  assert.equal(gate1.run_app, true, 'Run App is offered even without a configured preview');
  assert.equal('local_preview' in gate1, false, 'nothing to run yet: no local_preview on the gate');

  const withConfig = new WorkflowRun({ file, inputs: { repo_path: repoDir }, mock: true, runsDir, localPreview: { command: 'npm start' } });
  const withConfigEvents = [];
  withConfig.on('event', (ev) => { withConfigEvents.push(ev); if (ev.type === 'approval.requested') setImmediate(() => withConfig.resolveApproval(ev.approval_id, true)); });
  await withConfig.start();
  const gate2 = withConfigEvents.find((e) => e.type === 'approval.requested');
  assert.equal(gate2.run_app, true);
  assert.deepEqual(gate2.local_preview, { command: 'npm start' });
});

test('a run records the time spent waiting at a human gate separately from agent time (summary.timing.gate_wait_ms)', { timeout: 30000 }, async (t) => {
  const yaml = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: gate-timing }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do it"
  - id: gate
    type: human_approval
    message: "ok?"
`;
  const { file } = tempWorkflow(t, yaml);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setTimeout(() => run.resolveApproval(ev.approval_id, true), 80);
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const { timing } = finished.summary;
  assert.ok(timing.gate_wait_ms >= 60, `waited ${timing.gate_wait_ms}ms at the gate`);
  assert.deepEqual(timing.gates.gate, { waits: 1, wait_ms: timing.gate_wait_ms });
  assert.ok(timing.duration_ms >= timing.gate_wait_ms);
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
  for (const f of ['software-development.yaml', 'software-development-local-hero.yaml', 'ai-arena.yaml', 'writer-reviewer.yaml', 'multi-model-review.yaml', 'run-retrospective.yaml', 'backlog-refresh.yaml']) {
    const wf = loadWorkflow(path.join(root, 'workflows', f));
    assert.ok(wf.groups?.length, `${f} has groups`);
    assert.deepEqual(wf.groups.flatMap((g) => g.steps).sort(), wf.steps.map((s) => s.id).sort(), f);
  }
});

// Full software-development flow in mock mode. Gates get `answers[step]` (default: approve /
// first choice), like --auto-approve. `answers[step]` (and `feedback[step]`) may be a list, one
// per visit to that gate (shifted as it is visited again; the last one repeats past the end).
async function runSoftwareDevelopment({ mockSequences, answers = {}, feedback = {}, inputs = {}, issues, file = 'software-development.yaml' }) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', file),
    inputs: { task: 'Engine test', repo_path: root, ...inputs },
    mock: true,
    runsDir,
    mockSequences,
    issues,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const a = answers[ev.step_id];
      const answer = Array.isArray(a) ? a.shift() ?? (ev.choices ? ev.choices[0].id : true) : a ?? (ev.choices ? ev.choices[0].id : true);
      const f = feedback[ev.step_id];
      const text = Array.isArray(f) ? f.shift() : f;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', text));
    }
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  fs.rmSync(runsDir, { recursive: true, force: true });
  return { events, finished, transitions };
}

test('software-development: a preview code failure goes to the developer, then ci → pr_babysitter → preview again', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { preview_status: ['failed', 'success'], failure_class: ['code'] },
  });
  assert.equal(finished.status, 'success', finished.error);
  const i = transitions.indexOf('deploy_test>ci');
  assert.ok(i >= 0, transitions.join(' '));
  assert.deepEqual(transitions.slice(i, i + 4), ['deploy_test>ci', 'ci>pr_babysitter', 'pr_babysitter>deploy_test', 'deploy_test>approve_merge']);
  assert.ok(events.some((e) => e.type === 'log' && e.message === 'deploy_test delegated to developer'));
  // the developer's fix reaches the CI Pusher
  const ciPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'ci').map((e) => e.prompt);
  assert.match(ciPrompts.at(-1), /The developer fixed a previous failure/);
  assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'preview_failed'), 'no human gate for a fixable failure');
  assert.equal(finished.summary.steps.deploy_test.visits, 2);
});

test('software-development: preview code failures stop at the human gate after 2 fix rounds', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { preview_status: ['failed'], failure_class: ['code'] },
    answers: { preview_failed: 'stop' },
  });
  assert.equal(transitions.filter((x) => x === 'deploy_test>ci').length, 2);
  assert.equal(events.filter((e) => e.type === 'log' && e.message === 'deploy_test delegated to developer').length, 2, 'no fix is asked once the limit is reached');
  assert.ok(transitions.includes('deploy_test>preview_failed'));
  // stop: the run failed (it did not deliver), not a success
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "preview_failed"/);
});

test('software-development: a preview infra failure goes to the gate; "retry" publishes again', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { preview_status: ['failed', 'success'], failure_class: ['infra'] },
    answers: { preview_failed: 'retry' },
  });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'preview_failed');
  assert.deepEqual(gate.choices.map((c) => c.id), ['retry', 'fix', 'stop']);
  assert.match(gate.message, /class: infra/);
  assert.ok(!transitions.includes('deploy_test>ci'), 'an infra failure is not sent to the developer');
  assert.deepEqual(transitions.filter((x) => /preview_failed|deploy_test>/.test(x)), ['deploy_test>preview_failed', 'preview_failed>deploy_test', 'deploy_test>approve_merge']);
});

test('software-development: an infra build failure skips the fix rounds; "retry" builds again', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { build_status: ['failed', 'success'], failure_class: ['infra'], preview_status: ['success'] },
    answers: { build_failed: 'retry' },
  });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'build_failed');
  assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'retry', 'stop']);
  assert.match(gate.message, /because of the environment, not the code/);
  assert.ok(!events.some((e) => e.type === 'log' && e.message === 'build delegated to developer'), 'no developer round for an infra failure');
  assert.deepEqual(transitions.filter((x) => /build_failed|^build>/.test(x)), ['build>build_failed', 'build_failed>build', 'build>evidence']);
});

test('software-development: a code build failure still goes to the developer first', { timeout: 120000 }, async () => {
  const { events, transitions } = await runSoftwareDevelopment({
    mockSequences: { build_status: ['failed', 'success'], failure_class: ['code'], preview_status: ['success'] },
  });
  assert.ok(events.some((e) => e.type === 'log' && e.message === 'build delegated to developer'));
  assert.ok(!transitions.includes('build>build_failed'));
});

test('software-development: rejecting the merge ends the run as cancelled; deploy_prod never ran, so merged_commit is empty', { timeout: 120000 }, async () => {
  const { finished } = await runSoftwareDevelopment({ mockSequences: { preview_status: ['success'] }, answers: { approve_merge: false } });
  assert.equal(finished.status, 'cancelled');
  assert.match(finished.error, /ended as cancelled at step "approve_merge" \(rejected\)/);
  assert.equal(finished.summary.steps.deploy_prod.visits, 0);
  // the template renders empty (no steps.deploy_prod.output): computeOutputs keeps an empty text as
  // null, like any other output the run never set (#134: still falsy, blockedReason treats it the same).
  assert.equal(finished.summary.outputs.merged_commit, null);
});

// #134 (fixed by 3a5e236): the squash merge's commit the deployer reads from the platform, never the
// branch's own last commit (develop.output.commit_sha), which is not what the base branch received.
test('software-development: merged_commit is the deploy step\'s merge_commit, not the branch\'s own commit_sha', { timeout: 120000 }, async () => {
  const wf = loadWorkflow(path.join(root, 'workflows', 'software-development.yaml'));
  assert.deepEqual(wf.steps.find((s) => s.id === 'deploy_prod').output_schema.required, ['deploy_status', 'merge_commit']);

  const { finished } = await runSoftwareDevelopment({ mockSequences: { preview_status: ['success'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(finished.summary.outputs.merged_commit, finished.summary.steps.deploy_prod.output.merge_commit);
  assert.notEqual(finished.summary.outputs.merged_commit, finished.summary.steps.develop.output.commit_sha);
});

const GROUP = [53, 65, 77].map((n) => ({ number: n, url: `https://github.com/o/r/issues/${n}`, title: `T${n}` }));

test('software-development: a run for several issues records them, and its PR/MR closes each one', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { preview_status: ['success'] }, issues: GROUP, inputs: { issues: GROUP.map((i) => i.url) },
  });
  assert.equal(finished.status, 'success', finished.error);
  const started = events.find((e) => e.type === 'workflow.started');
  assert.deepEqual(started.issues, GROUP);
  assert.deepEqual(finished.summary.issues, GROUP);
  assert.ok(!transitions.includes('develop>issue_not_done'), 'every issue was done');
  const prompt = (step) => events.find((e) => e.type === 'session.message_sent' && e.step_id === step).prompt;
  assert.match(prompt('develop'), /This run implements 3 issues together[\s\S]*issues\/53, https:\/\/github\.com\/o\/r\/issues\/65, https:\/\/github\.com\/o\/r\/issues\/77/);
  assert.match(prompt('code_review'), /check the spec axis per issue/);
  assert.match(prompt('verify_change'), /verify each one the developer did/);
  assert.match(prompt('ci'), /one line `Closes #<number>` per issue/);
});

test('software-development: an issue of the group that cannot be done stops at the owner\'s gate', { timeout: 120000 }, async () => {
  const group = { issues: GROUP, inputs: { issues: GROUP.map((i) => i.url).join('\n') } }; // a list typed in a form
  const stopped = await runSoftwareDevelopment({ ...group, mockSequences: { done: [false] }, answers: { issue_not_done: 'stop' } });
  const gate = stopped.events.find((e) => e.type === 'approval.requested' && e.step_id === 'issue_not_done');
  assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'stop']);
  assert.match(gate.message, /could not do every issue/);
  assert.equal(stopped.finished.status, 'failed');
  assert.deepEqual(stopped.events.find((e) => e.type === 'workflow.started').inputs.issues, GROUP.map((i) => i.url));

  // continue without it: asked once, even though later developer turns still report it
  const went = await runSoftwareDevelopment({ ...group, mockSequences: { done: [false], preview_status: ['success'], verdict: ['changes_requested', 'approved'] } });
  assert.equal(went.finished.status, 'success', went.finished.error);
  assert.deepEqual(went.transitions.filter((x) => /issue_not_done/.test(x)), ['develop>issue_not_done', 'issue_not_done>code_review']);
  assert.ok(went.transitions.filter((x) => x === 'code_review>develop').length >= 1);
  // a run for one issue never asks
  const single = await runSoftwareDevelopment({ mockSequences: { done: [false], preview_status: ['success'] }, issues: [GROUP[0]], inputs: { issue: GROUP[0].url } });
  assert.ok(!single.transitions.includes('develop>issue_not_done'));
});

// ---- #98: declared gaps (output.left_out) go back to develop, then to the owner, never straight
// to the review. Both software-development and its local-hero variant. --------------------------

test('#98: develop output_schema requires left_out, so an answer cannot skip it', () => {
  for (const file of ['software-development.yaml', 'software-development-local-hero.yaml']) {
    const wf = loadWorkflow(path.join(root, 'workflows', file));
    const develop = wf.steps.find((s) => s.id === 'develop');
    const output = { branch: 'b', summary: 's', files_changed: [], test_notes: 't', committed: true };
    assert.match(validateSchema(output, develop.output_schema).join(), /left_out: required/, file);
    assert.deepEqual(validateSchema({ ...output, left_out: [] }, develop.output_schema), [], file);
  }
});

test('#98: requirements_left_out is a human gate; neither a retry nor the supervisor can answer it', () => {
  for (const file of ['software-development.yaml', 'software-development-local-hero.yaml']) {
    const wf = loadWorkflow(path.join(root, 'workflows', file));
    const gate = wf.steps.find((s) => s.id === 'requirements_left_out');
    assert.equal(gate.type, 'human_approval', file);
    assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'stop'], file);
  }
});

for (const file of ['software-development.yaml', 'software-development-local-hero.yaml']) {
  // software-development also needs a successful preview to reach the end; local-hero has none
  const toEnd = file === 'software-development.yaml' ? { preview_status: ['success'] } : {};
  // only transitions where both ends are one of these three steps (hides the rest of the pipeline)
  const groupBy = (xs, re) => xs.filter((x) => re.test(x));
  const DEV_RE = /^(develop|requirements_left_out|code_review)>(develop|requirements_left_out|code_review)$/;

  test(`${file}: no declared gap goes straight develop > code_review`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
    // #160: the test writer's capabilities log line shows the Agent/Task tool is offered
    const log = events.find((e) => e.type === 'log' && e.kind === 'capabilities' && e.agent === 'test_writer');
    assert.match(log.message, /subagents: Agent\/Task tool offered/, file);
  });

  test(`${file}: a gap declared once sends the developer back before the review, never straight to code_review`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { left_out: [1, 0], verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>develop', 'develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
  });

  test(`${file}: a gap still open after one round stops at the owner's gate; "stop" ends the run failed, no review`, { timeout: 120000 }, async () => {
    const { transitions, finished, events } = await runSoftwareDevelopment({
      file, mockSequences: { left_out: [1, 1], ...toEnd }, answers: { requirements_left_out: 'stop' },
    });
    const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out');
    assert.deepEqual(gate.choices.map((c) => c.id), ['continue', 'stop']);
    assert.match(gate.message, /left these requirements of the task out, even after being sent back once/);
    assert.equal(finished.status, 'failed');
    assert.match(finished.error, /ended as failed at step "requirements_left_out"/);
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>develop', 'develop>requirements_left_out']);
  });

  test(`${file}: "continue" at the gate moves on to the review`, { timeout: 120000 }, async () => {
    const { transitions, finished } = await runSoftwareDevelopment({
      file, mockSequences: { left_out: [1, 1, 0], verdict: ['approved'], ...toEnd }, answers: { requirements_left_out: 'continue' },
    });
    assert.equal(finished.status, 'success', finished.error);
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>develop', 'develop>requirements_left_out', 'requirements_left_out>code_review']);
  });

  test(`${file}: a gap declared again on a review fix round goes back to the gate, not straight to the review`, { timeout: 120000 }, async () => {
    const { transitions, finished, events } = await runSoftwareDevelopment({
      file,
      mockSequences: { left_out: [1, 1, 1, 0], verdict: ['changes_requested', 'approved'], ...toEnd },
      answers: { requirements_left_out: 'continue' },
    });
    assert.equal(finished.status, 'success', finished.error);
    const gates = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out');
    assert.equal(gates.length, 2, transitions.join(' '));
    assert.ok(!transitions.includes('develop>code_review'), transitions.join(' '));
    assert.deepEqual(groupBy(transitions, DEV_RE), [
      'develop>develop', 'develop>requirements_left_out', 'requirements_left_out>code_review',
      'code_review>develop', 'develop>requirements_left_out', 'requirements_left_out>code_review',
    ]);
    // vars.accepted_gaps accumulates across both gate answers instead of being overwritten: both
    // accepted requirements show up (not just the latest one) by the second code_review visit
    const developPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
    assert.match(developPrompts[2], /do not list them again: \(simulated\) requirement;/);
    const reviewPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'code_review').map((e) => e.prompt);
    const accepted = reviewPrompts[1].match(/accepted that the run goes on without these requirements \(not blocking\): (.*)/)[1];
    assert.equal((accepted.match(/\(simulated\) requirement/g) || []).length, 2, accepted);
    // the two accepted requirements must stay distinguishable, not run together into one word
    assert.match(accepted, /requirement;\s+\(simulated\) requirement;|requirement,\s*\(simulated\) requirement;/, accepted);
  });

  // #173: the issue's Tests and Measure tasks are never the developer's, so declaring only those
  // (mockSequences.left_out_not_mine) never sends the run back nor stops it at the human gate.
  test(`${file}: declaring only the Tests and Measure tasks never returns to develop nor opens the gate`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { left_out_not_mine: true, verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
  });

  test(`${file}: a real gap still returns to develop and reaches the gate even with Tests/Measure also declared`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({
      file, mockSequences: { left_out: [1], left_out_not_mine: true, verdict: ['approved'], ...toEnd }, answers: { requirements_left_out: 'continue' },
    });
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>develop', 'develop>requirements_left_out', 'requirements_left_out>code_review']);
    const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out');
    assert.match(gate.message, /\(simulated\) requirement/);
    assert.ok(!/Tests|Measure/.test(gate.message), gate.message);
    const reviewPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'code_review').map((e) => e.prompt);
    const accepted = reviewPrompts.at(-1).match(/accepted that the run goes on without these requirements \(not blocking\): (.*)/)[1];
    assert.match(accepted, /\(simulated\) requirement/);
    assert.ok(!/Tests|Measure/.test(accepted), accepted);
  });

  test(`${file}: Tests/Measure never count toward the second visit's gap either, so a 2nd clean visit goes straight to the review`, { timeout: 120000 }, async () => {
    const { transitions, events } = await runSoftwareDevelopment({ file, mockSequences: { left_out: [1, 0], left_out_not_mine: true, verdict: ['approved'], ...toEnd } });
    assert.deepEqual(groupBy(transitions, DEV_RE), ['develop>develop', 'develop>code_review']);
    assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'requirements_left_out'));
    const developPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
    const listed = developPrompts[1].match(/so the review was not called:\n([\s\S]*?)\nFinish them/)[1];
    assert.match(listed, /\(simulated\) requirement/, listed);
    assert.ok(!/Tests|Measure/.test(listed), listed);
  });
}

// ---- #104: validated mode (mode input, developer_check gate) ------------------------------

test('software-development: validated mode stops at developer_check with the diff and worktree details; auto mode (the default) skips it', { timeout: 120000 }, async () => {
  const validated = await runSoftwareDevelopment({ inputs: { mode: 'validated' }, mockSequences: { preview_status: ['success'] } });
  assert.equal(validated.finished.status, 'success', validated.finished.error);
  // recorded on the run (Details): workflow.started carries every input, mode included
  assert.equal(validated.events.find((e) => e.type === 'workflow.started').inputs.mode, 'validated');
  const gate = validated.events.find((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.ok(gate, validated.transitions.join(' '));
  assert.equal(gate.diff_base, 'origin/main');
  assert.equal(gate.work_dir, root);
  assert.deepEqual(gate.choices.map((c) => c.id), ['approve', 'changes', 'stop']);
  assert.match(gate.message, /Try it before the review and the tests run/);
  assert.match(gate.message, /Files changed:/);
  // E2E scenarios (#143): the Dev/QA line is always there; the test step has not run yet here
  assert.match(gate.message, /Dev\/QA: read the E2E scenarios and the screenshots/);
  // #203: e2e_tests defaults to "write" (not "write_and_run"), so the test writer only writes them
  assert.match(gate.message, /E2E scenarios: none yet\. The test writer writes them after the code review; they show at the merge approval\./);
  assert.match(gate.feedback.label, /Your change request for the developer/);
  assert.deepEqual(validated.transitions.filter((x) => /developer_check|developer_screenshots/.test(x)), [
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
  ]);

  const auto = await runSoftwareDevelopment({ mockSequences: { preview_status: ['success'] } }); // mode defaults to "auto"
  assert.equal(auto.finished.status, 'success', auto.finished.error);
  assert.ok(!auto.events.some((e) => e.type === 'approval.requested' && e.step_id === 'developer_check'));
  assert.ok(auto.transitions.includes('develop>code_review'));
});

test('software-development: approve_merge\'s message shows the Dev/QA line and the test writer\'s E2E scenarios (#143)', { timeout: 120000 }, async () => {
  const { events, finished } = await runSoftwareDevelopment({ mockSequences: { preview_status: ['success'] } });
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'approve_merge');
  assert.ok(gate);
  assert.match(gate.message, /Dev\/QA: read the E2E scenarios and the screenshots/);
  // the test step's schema has no `passed` status (#199): the default mock scenarios
  // (src/engine/providers.js mockScenarios) are written, not run, whatever the visit
  assert.match(gate.message, /E2E scenarios \(written by the test writer, run at release\): 2 written, run at release/);
  assert.match(gate.message, /- written, run at release: Filter the runs by status/);
  assert.match(gate.message, /- written, run at release: An empty filter result explains itself/);
});

test('software-development: validated mode — Ask for changes sends the feedback to the developer and reopens developer_check; Approve then moves on to code_review', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    inputs: { mode: 'validated' },
    mockSequences: { preview_status: ['success'], verdict: ['approved'] },
    answers: { developer_check: ['changes', 'approve'] },
    feedback: { developer_check: ['Use snake_case for the new function.'] },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.filter((x) => /developer_check|developer_screenshots/.test(x)), [
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>develop',
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
  ]);
  const gates = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.equal(gates.length, 2);
  assert.match(gates[1].message, /your change request 1/);
  const resolved = events.filter((e) => e.type === 'approval.resolved' && e.feedback);
  assert.equal(resolved[0].feedback, 'Use snake_case for the new function.');
  const developPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
  assert.match(developPrompts[1], /The owner tried your change and asks for these changes \(change request 1\):/);
  assert.match(developPrompts[1], /Use snake_case for the new function\./);
});

test('software-development: validated mode — a review fix round does not reopen developer_check; validate_every_round makes it stop again', { timeout: 120000 }, async () => {
  const once = await runSoftwareDevelopment({
    inputs: { mode: 'validated' },
    mockSequences: { preview_status: ['success'], verdict: ['changes_requested', 'approved'] },
  });
  assert.equal(once.finished.status, 'success', once.finished.error);
  assert.deepEqual(once.transitions.filter((x) => /developer_check|developer_screenshots/.test(x)), [
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
  ]);
  assert.ok(once.transitions.includes('code_review>develop'));
  assert.equal(once.transitions.filter((x) => x === 'develop>code_review').length, 1, once.transitions.join(' '));

  const every = await runSoftwareDevelopment({
    inputs: { mode: 'validated', validate_every_round: 'true' },
    mockSequences: { preview_status: ['success'], verdict: ['changes_requested', 'approved'] },
  });
  assert.equal(every.finished.status, 'success', every.finished.error);
  assert.deepEqual(every.transitions.filter((x) => /developer_check|developer_screenshots/.test(x)), [
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
  ]);
});

test('software-development: validated mode — Stop ends the run as cancelled, the worktree kept to resume', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runSoftwareDevelopment({
    inputs: { mode: 'validated' }, mockSequences: { preview_status: ['success'] }, answers: { developer_check: 'stop' },
  });
  assert.equal(finished.status, 'cancelled');
  assert.match(finished.error, /ended as cancelled at step "developer_check"/);
  assert.ok(!transitions.includes('developer_check>code_review'));
});

// #144: developer_screenshots, right before developer_check, runs the develop step's `screenshots`
// list through captureScreenshots (src/engine/screenshot-step.js). A mock run never captures: its
// output says so (reason), and developer_check's message shows it.
test('software-development: developer_screenshots captures the developer\'s UI list as simulated in a mock run, reported at developer_check', { timeout: 120000 }, async () => {
  const { events, finished } = await runSoftwareDevelopment({
    inputs: { mode: 'validated' }, mockSequences: { preview_status: ['success'] },
  });
  assert.equal(finished.status, 'success', finished.error);
  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'developer_screenshots');
  assert.ok(step, events.map((e) => e.type).join(' '));
  assert.equal(step.output.kind, 'screenshots');
  assert.equal(step.output.taken, 0);
  assert.deepEqual(step.output.errors, []);
  assert.match(step.output.reason, /simulated run \(the app is not captured\)/);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.match(gate.message, /Screenshots: No screenshots: simulated run \(the app is not captured\)/);
});

// `type: run` inputs (run-retrospective): "latest", a real id, or refused before the run starts.
function runsWith(t, runs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-input-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [id, workflow] of runs) {
    fs.mkdirSync(path.join(dir, id));
    fs.writeFileSync(path.join(dir, id, 'events.jsonl'), `${JSON.stringify({ seq: 1, type: 'workflow.started', workflow })}\n`);
  }
  return dir;
}
const retro = (runsDir, runId) => new WorkflowRun({ file: path.join(root, 'workflows', 'run-retrospective.yaml'), inputs: { run_id: runId }, mock: true, runsDir, skillsDirs: [] });

test('a run input defaults to the latest run of another workflow', (t) => {
  const runsDir = runsWith(t, [
    ['20260927-101010-aaaaaaaa', 'software-development'],
    ['20260928-101010-bbbbbbbb', 'ai-arena'],
    ['20260929-101010-cccccccc', 'run-retrospective'], // a retrospective itself is skipped
  ]);
  assert.equal(retro(runsDir, undefined).inputs.run_id, '20260928-101010-bbbbbbbb');
  assert.equal(retro(runsDir, 'latest').inputs.run_id, '20260928-101010-bbbbbbbb');
  assert.equal(retro(runsDir, ' LAST ').inputs.run_id, '20260928-101010-bbbbbbbb');
  assert.equal(retro(runsDir, '20260927-101010-aaaaaaaa').inputs.run_id, '20260927-101010-aaaaaaaa');
});

test('a run input that is not a run id is refused before the run starts', (t) => {
  const runsDir = runsWith(t, [['20260927-101010-aaaaaaaa', 'software-development']]);
  assert.throws(() => retro(runsDir, 'analise o ultimo run'), /"analise o ultimo run" is not a run id\. .*or "latest"/);
  assert.throws(() => retro(runsDir, '../20260927-101010-aaaaaaaa'), /is not a run id/);
  assert.deepEqual(fs.readdirSync(runsDir), ['20260927-101010-aaaaaaaa']); // nothing was created
  assert.throws(() => retro(runsWith(t, []), 'latest'), /no run to use as "latest"/);
});

// ---------------------------------------------------------------------------
// writer-reviewer: the writer and the reviewer are picked at run time (templated agents)
async function runWriterReviewer({ inputs = {}, mockSequences, answers = {}, feedback = {} } = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'writer-reviewer.yaml'),
    inputs: { prompt: 'A one-page PRD', goal: 'Every requirement is testable', ...inputs },
    mock: true, runsDir, mockSequences,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      // answers[step]: a choice id, or a list of them (one per visit); feedback[step]: the text typed
      const a = answers[ev.step_id];
      const answer = Array.isArray(a) ? a.shift() ?? ev.choices[0].id : a ?? ev.choices[0].id;
      const f = feedback[ev.step_id];
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user', Array.isArray(f) ? f.shift() : f));
    }
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  const files = (rel) => fs.readFileSync(path.join(run.runDir, rel), 'utf8');
  return { run, events, finished, transitions, files, cleanup: () => fs.rmSync(runsDir, { recursive: true, force: true }) };
}

test('writer-reviewer: agents take provider, model and effort from the inputs', () => {
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'writer-reviewer.yaml'),
    inputs: { prompt: 'x', goal: 'y', writer_provider: 'grok', writer_model: 'grok-4.7', writer_effort: 'low' },
    mock: true, runsDir: os.tmpdir(),
  });
  assert.deepEqual(
    ['provider', 'model', 'effort'].map((k) => run.wf.agents.writer[k]),
    ['grok', 'grok-4.7', 'low'],
  );
  assert.equal(run.wf.agents.reviewer.provider, 'codex'); // default input
  assert.deepEqual(run.ctx.agents.writer, { provider: 'grok', model: 'grok-4.7' });
});

test('writer-reviewer: document_skill is loaded by the writer and the reviewer, not by the sign-off', { timeout: 60000 }, async () => {
  const { events, finished, cleanup } = await runWriterReviewer({ inputs: { document_skill: 'rfc-writing' }, mockSequences: { score: [9] } });
  try {
    assert.equal(finished.status, 'success', finished.error);
    const first = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step)[0].prompt;
    assert.match(first('write'), /<skill name="rfc-writing"/);
    assert.match(first('review'), /<skill name="rfc-writing"/);
    assert.doesNotMatch(first('signoff'), /<skill name="rfc-writing"/);
  } finally { cleanup(); }
});

test('writer-reviewer: an empty document_skill (the default) adds no skill to any agent', { timeout: 60000 }, async () => {
  const { events, finished, cleanup } = await runWriterReviewer({ mockSequences: { score: [9] } });
  try {
    assert.equal(finished.status, 'success', finished.error);
    for (const step of ['write', 'review', 'signoff']) {
      const first = events.filter((e) => e.type === 'session.message_sent' && e.step_id === step)[0].prompt;
      assert.doesNotMatch(first, /<skill name=/);
    }
  } finally { cleanup(); }
});

test('writer-reviewer: notes go back to the writer until the score passes, then the supervisor asks the user', { timeout: 60000 }, async () => {
  const { events, finished, transitions, files, cleanup } = await runWriterReviewer();
  try {
    assert.equal(finished.status, 'success', finished.error);
    // default mock scores 5.5, 7, 8.6 with threshold 8
    assert.deepEqual(transitions, ['write>review', 'review>write', 'write>review', 'review>write', 'write>review', 'review>signoff', 'signoff>decide', 'decide>end']);
    // save_as { path, content }: the document field only, one file per draft
    assert.match(files('document.md'), /^# Simulated document/);
    assert.equal(files('drafts/v3.md'), files('document.md'));
    const writes = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'write').map((e) => e.prompt);
    assert.match(writes[1], /scored draft v1 5\.5\/10/);
    assert.match(writes[1], /\[major\] Simulated note on the draft\./);
  } finally { cleanup(); }
});

test('writer-reviewer: when the rounds run out a human decides (templated loop limit)', { timeout: 60000 }, async () => {
  const { events, finished, transitions, cleanup } = await runWriterReviewer({
    inputs: { max_rounds: 2 }, mockSequences: { score: [4] }, answers: { out_of_rounds: 'stop' },
  });
  try {
    assert.equal(transitions.filter((t) => t === 'write>review').length, 2);
    assert.ok(transitions.includes('review>out_of_rounds'), transitions.join(' '));
    assert.ok(events.some((e) => e.type === 'approval.requested' && e.step_id === 'out_of_rounds'));
    assert.equal(finished.status, 'cancelled');
  } finally { cleanup(); }
});

test('writer-reviewer: the user sends the document back with instructions that reach every agent', { timeout: 60000 }, async () => {
  const { events, finished, transitions, cleanup } = await runWriterReviewer({
    mockSequences: { score: [9] },
    answers: { decide: ['revise', 'accept'] },
    feedback: { decide: ['Keep the pricing as an open question.', ''] },
  });
  try {
    assert.equal(finished.status, 'success', finished.error);
    assert.deepEqual(transitions, ['write>review', 'review>signoff', 'signoff>decide', 'decide>write', 'write>review', 'review>signoff', 'signoff>decide', 'decide>end']);
    const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'decide');
    assert.match(gate.feedback.label, /Instructions for the writer/);
    assert.equal(events.find((e) => e.type === 'approval.resolved').feedback, 'Keep the pricing as an open question.');
    const prompt = (step, i) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step)[i].prompt;
    // the writer knows the draft came back from the supervisor and the user
    assert.match(prompt('write', 1), /The supervisor checked draft v1/);
    assert.match(prompt('write', 1), /The user asked for another revision/);
    for (const [step, i] of [['write', 1], ['review', 1], ['signoff', 1]]) assert.match(prompt(step, i), /- Keep the pricing as an open question./, step);
    assert.doesNotMatch(prompt('review', 0), /decisions so far/);
    assert.equal(finished.summary.steps.decide.output.feedback, '');
  } finally { cleanup(); }
});

test('writer-reviewer simulation: the supervisor finds gaps and the user sends the draft back', { timeout: 60000 }, async () => {
  const { events, finished, transitions, cleanup } = await runWriterReviewer({
    mockSequences: { score: [9], ready: [false, true], ok: [false, true] },
    answers: { decide: ['revise', 'accept'] },
  });
  try {
    assert.equal(finished.status, 'success', finished.error);
    const signoffs = events.filter((e) => e.type === 'step.finished' && e.step_id === 'signoff').map((e) => e.output.ready);
    assert.deepEqual(signoffs, [false, true]);
    const asks = events.filter((e) => e.type === 'approval.requested' && e.step_id === 'decide').map((e) => e.message);
    assert.match(asks[0], /Some parts of the goal are not met yet/);
    assert.match(asks[1], /The document meets the goal/);
    assert.ok(transitions.includes('decide>write'));
  } finally { cleanup(); }
});

test('writer-reviewer simulation: invalid answers are asked again, then the supervisor steps in', { timeout: 60000 }, async () => {
  const { events, finished, cleanup } = await runWriterReviewer({ mockSequences: { score: [9], invalid_answers: { review: 3 } } });
  try {
    assert.equal(finished.status, 'success', finished.error);
    assert.equal(events.filter((e) => e.type === 'log' && /^Invalid output in review/.test(e.message)).length, 3);
    const decision = events.find((e) => e.type === 'supervisor.decision');
    assert.equal(decision.step_id, 'review');
    assert.equal(decision.action, 'retry');
    // after the supervisor's retry the review answers correctly and the run goes on
    assert.equal(events.filter((e) => e.type === 'step.finished' && e.step_id === 'review' && !e.error).length, 1);
  } finally { cleanup(); }
});

test('writer-reviewer: with a project the writer and the reviewer work in its folder, the drafts stay in the run', { timeout: 60000 }, async () => {
  const { run, events, finished, files, cleanup } = await runWriterReviewer({ inputs: { project_path: root }, mockSequences: { score: [9] } });
  try {
    assert.equal(finished.status, 'success', finished.error);
    const cwd = (agent) => finished.summary.sessions.find((s) => s.agent === agent).cwd;
    assert.equal(cwd('writer'), root);
    assert.equal(cwd('reviewer'), root);
    assert.equal(cwd('signoff'), run.runDir);
    assert.match(files('document.md'), /^# Simulated document/);
    const first = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'write').prompt;
    assert.match(first, /The current folder is the user's project/);
    assert.match(first, /Project: the current folder/);
  } finally { cleanup(); }
});

test('writer-reviewer: without a project the agents work in the run folder and are told they have no files', { timeout: 60000 }, async () => {
  const { run, events, finished, cleanup } = await runWriterReviewer({ mockSequences: { score: [9] } });
  try {
    assert.equal(finished.summary.sessions.find((s) => s.agent === 'writer').cwd, run.runDir);
    const first = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'write').prompt;
    assert.match(first, /you have no files, repository or web access/);
    assert.doesNotMatch(first, /Project: the current folder/);
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// ai-arena: up to five contender slots picked at run time; `enabled` leaves the unused ones out
function arenaRun(inputs = {}, mockSequences) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const cleanup = () => fs.rmSync(runsDir, { recursive: true, force: true });
  try {
    return { run: new WorkflowRun({ file: path.join(root, 'workflows', 'ai-arena.yaml'), inputs: { task: 'A PRD', ...inputs }, mock: true, runsDir, mockSequences }), cleanup };
  } catch (e) { cleanup(); throw e; }
}

test('ai-arena: contenders come from the inputs and a slot with provider none is left out', () => {
  const { run, cleanup } = arenaRun({ contender_2_provider: 'none', contender_5_provider: 'grok', contender_5_model: 'grok-4.7', contender_5_effort: 'low' });
  try {
    const compete = run.wf.steps.find((s) => s.id === 'compete');
    assert.deepEqual(compete.agents, ['contender_1', 'contender_3', 'contender_4', 'contender_5']);
    assert.deepEqual(run.wf.steps.find((s) => s.id === 'critique').agents, compete.agents);
    assert.equal(run.wf.agents.contender_2, undefined);
    assert.deepEqual(['provider', 'model', 'effort'].map((k) => run.wf.agents.contender_5[k]), ['grok', 'grok-4.7', 'low']);
    // defaults: four models, the 5th slot off
    const def = arenaRun();
    assert.deepEqual(def.run.wf.steps[0].agents, ['contender_1', 'contender_2', 'contender_3', 'contender_4']);
    assert.equal(def.run.wf.agents.contender_2.model, 'claude-sonnet-5-5');
    def.cleanup();
  } finally { cleanup(); }
});

test('agents.enabled: min_success is capped at the agents left, a disabled single agent or an empty fan-out fails', () => {
  const two = arenaRun({ contender_3_provider: 'none', contender_4_provider: 'none', contender_2_provider: 'none' });
  assert.equal(two.run.wf.steps[0].min_success, 1);
  two.cleanup();
  assert.throws(() => arenaRun({ contender_1_provider: 'none', contender_2_provider: 'none', contender_3_provider: 'none', contender_4_provider: 'none' }),
    /every agent of the fan-out is disabled/);
});

test('ai-arena simulation: 3 contenders compete, critique, the synthesis is verified and the user accepts', { timeout: 60000 }, async () => {
  const { run, cleanup } = arenaRun({ contender_4_provider: 'none', peer_review: 'yes' }, { verdict: ['issues', 'pass'] });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, 'accept', 'user'));
  });
  try {
    await run.start();
    const finished = events.find((e) => e.type === 'workflow.finished');
    assert.equal(finished.status, 'success', finished.error);
    const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
    assert.deepEqual(transitions, ['compete>critique', 'critique>synthesize', 'synthesize>verify', 'verify>synthesize', 'synthesize>verify', 'verify>review', 'review>end']);
    for (const a of ['contender_1', 'contender_2', 'contender_3']) assert.ok(fs.existsSync(path.join(run.runDir, 'arena', 'proposals', `${a}.md`)), a);
    assert.match(fs.readFileSync(path.join(run.runDir, 'arena', 'final.md'), 'utf8'), /^# Simulated document/);
    // no project: agents work in the run folder and nothing is copied elsewhere
    assert.ok(finished.summary.sessions.filter((s) => /^contender_/.test(s.agent)).every((s) => s.cwd === run.runDir));
    const gate = events.find((e) => e.type === 'approval.requested');
    assert.match(gate.message, /Proposal 1: \S+ \(contender \d\)/);
    assert.doesNotMatch(gate.message, /Copy in the project/);
    assert.ok(gate.feedback);
  } finally { cleanup(); }
});

test('the renderer shuffle (arena-shuffle.js) gives the same order as the engine filter', () => {
  const { shuffle, sha256Word } = require('../src/renderer/views/arena/arena-shuffle.js');
  const crypto = require('crypto');
  for (const seed of ['', 'abc', '20260929-150045-d112f7dc', 'ção ✓'.repeat(40)]) {
    assert.equal(sha256Word(seed), crypto.createHash('sha256').update(seed).digest().readUInt32BE(0), seed);
    const list = ['contender_1', 'contender_2', 'contender_3', 'contender_4', 'contender_5'];
    assert.deepEqual(shuffle(list, seed), render('{{ l | shuffle(s) | join(",") }}', { l: list, s: seed }).split(','));
  }
});

// ---------------------------------------------------------------------------
// backlog-refresh (#161): review -> apply safe fixes -> scope gate (decision gate) -> apply closes
function backlogRefreshRun(inputs = {}, mockSequences) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const cleanup = () => fs.rmSync(runsDir, { recursive: true, force: true });
  try {
    return { run: new WorkflowRun({ file: path.join(root, 'workflows', 'backlog-refresh.yaml'), inputs: { project_path: 'C:/proj', ...inputs }, mock: true, runsDir, mockSequences }), cleanup };
  } catch (e) { cleanup(); throw e; }
}

test('backlog-refresh: a mock run reaches the scope gate (a decision gate), the safe-mode apply.js action is skipped, and Apply runs the scope-mode action too', { timeout: 60000 }, async () => {
  const { run, cleanup } = backlogRefreshRun({ git_platform: 'gh' });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, 'apply', 'user'));
  });
  try {
    await run.start();
    const finished = events.find((e) => e.type === 'workflow.finished');
    assert.equal(finished.status, 'success', finished.error);
    const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
    assert.deepEqual(transitions, ['review>scope', 'scope>end']);
    const gate = events.find((e) => e.type === 'approval.requested');
    assert.deepEqual(gate.choices.map((c) => c.id), ['apply', 'skip']); // the supervisor never answers this gate
    const actions = events.filter((e) => e.type === 'action.executed');
    assert.equal(actions.length, 2); // safe mode before the gate, scope mode after Apply
    assert.ok(actions.every((a) => a.skipped), 'mock mode never runs the action');
    assert.match(actions[0].command, /apply\.js" --platform gh --mode safe --file ".*refresh\.json" --project "C:\/proj" --run-id /);
    assert.match(actions[1].command, /apply\.js" --platform gh --mode scope --file ".*refresh\.json" --project "C:\/proj" --run-id /);
  } finally { cleanup(); }
});

test('backlog-refresh: Skip at the scope gate ends the run without the scope-mode action; git_platform picks the glab command', { timeout: 60000 }, async () => {
  const { run, cleanup } = backlogRefreshRun({ git_platform: 'gl' });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, 'skip', 'user'));
  });
  try {
    await run.start();
    const finished = events.find((e) => e.type === 'workflow.finished');
    assert.equal(finished.status, 'success', finished.error);
    const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
    assert.deepEqual(transitions, ['review>scope', 'scope>end']);
    const actions = events.filter((e) => e.type === 'action.executed');
    assert.equal(actions.length, 1); // only the safe-mode action; Skip runs no scope-mode action
    assert.match(actions[0].command, /apply\.js" --platform gl --mode safe/);
  } finally { cleanup(); }
});

test('ai-arena: attached documents reach the contenders, the synthesizer and the verifier', async () => {
  const { run, cleanup } = arenaRun({ attachments: '===== Attached file: notes.md =====\nClinics close at 6 pm.', peer_review: 'no' });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, 'accept', 'user'));
  });
  try {
    await run.start();
    const prompts = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.prompt);
    for (const step of ['compete', 'synthesize', 'verify']) {
      assert.ok(prompts(step).length, step);
      for (const p of prompts(step)) assert.match(p, /Attached file: notes\.md =====\s+Clinics close at 6 pm\./, step);
    }
    const plain = arenaRun();
    assert.doesNotMatch(render(plain.run.wf.steps[0].prompt, { ...plain.run.ctx, agent: 'contender_1' }), /attached/i);
    plain.cleanup();
  } finally { cleanup(); }
});

test('document skills for the arena exist and have a structure and a rubric', () => {
  for (const id of ['prd-writing', 'adr-writing', 'rfc-writing', 'test-plan-writing', 'design-doc-writing', 'design-sketch']) {
    const text = fs.readFileSync(path.join(root, 'skills', id, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(`^---\r?\nname: ${id}\r?\n`), id);
    assert.match(text, /rubric/i, id);
  }
});

// ---- #160: sub-agents by default for code research (test_writer gets them too) ---------------

test('#160: test_writer gets subagents: true and the context-economy skill; the developer still has subagents: true', () => {
  for (const file of ['software-development.yaml', 'software-development-local-hero.yaml']) {
    const wf = loadWorkflow(path.join(root, 'workflows', file));
    assert.equal(wf.agents.test_writer.capabilities.subagents, true, file);
    assert.ok(wf.agents.test_writer.skills.includes('context-economy'), file);
    assert.equal(wf.agents.developer.capabilities.subagents, true, file);
  }
});

// ---- software-development-local-hero: local worktree, automatic local merge, no CI/PR --------

test('local hero workflow: no CI/PR/deploy, a local worktree, an automatic merge with a resolution path, a 40M context limit', () => {
  const wf = loadWorkflow(path.join(root, 'workflows', 'software-development-local-hero.yaml'));
  assert.equal(wf.orchestrator.worktree.remote, false);
  assert.equal(wf.orchestrator.limits.max_total_context, '40M');
  const ids = wf.steps.map((s) => s.id);
  for (const gone of ['ci', 'pr_babysitter', 'deploy_test', 'approve_merge', 'deploy_prod', 'approve_local_merge']) assert.ok(!ids.includes(gone), gone);
  assert.ok(!Object.keys(wf.agents).some((a) => ['ci_pusher', 'pr_babysitter', 'deployer'].includes(a)));
  const verify = wf.steps.find((s) => s.id === 'verify_change');
  assert.deepEqual(verify.transitions[0], { when: "output.verdict != 'not_verified'", merge: 'local', goto: 'end', on_error: 'resolve_merge' });
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
  assert.doesNotThrow(() => loadWorkflow(path.join(root, 'workflows', 'e2e-release.yaml')));
});

test('e2e-release workflow: a simulated run fails once, fixes it (developer, review), passes, and approves the merge', { timeout: 60000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'e2e-release.yaml'),
    inputs: { task: 'Release check', repo_path: root },
    mock: true, runsDir,
    mockSequences: { verdict: ['approved'] },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  fs.rmSync(runsDir, { recursive: true, force: true });
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const visited = events.filter((e) => e.type === 'step.finished').map((e) => e.step_id);
  assert.deepEqual(visited, ['e2e', 'fix', 'review', 'e2e', 'approve_fixes']);
  const e2eOutputs = events.filter((e) => e.type === 'step.finished' && e.step_id === 'e2e').map((e) => e.output);
  assert.deepEqual(e2eOutputs.map((o) => o.e2e_status), ['fail', 'pass']);
  // the developer only went through the fix loop once (max_rounds default: 2)
  assert.ok(!events.some((e) => e.type === 'approval.requested' && e.step_id === 'e2e_failed'));
});

test('local hero workflow: a simulated run merges right after verify_change and ends as success', { timeout: 120000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file: path.join(root, 'workflows', 'software-development-local-hero.yaml'), inputs: { task: 'Engine test', repo_path: root }, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  fs.rmSync(runsDir, { recursive: true, force: true });
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  assert.ok(transitions.includes('verify_change>end'), transitions.join(' '));
  // no gate on the way to the merge; in simulation the merge is skipped, never run
  assert.ok(!events.some((e) => e.type === 'approval.requested' && ['verify_change', 'resolve_merge', 'merge_blocked'].includes(e.step_id)));
  assert.ok(events.some((e) => e.type === 'action.executed' && e.command === 'merge: local' && e.skipped));
});

test('local hero workflow: validated mode stops at developer_check with a local diff_base (no origin/ prefix); auto mode skips it', { timeout: 120000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'software-development-local-hero.yaml'),
    inputs: { task: 'Engine test', repo_path: root, mode: 'validated' },
    mock: true, runsDir,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  fs.rmSync(runsDir, { recursive: true, force: true });
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'developer_check');
  assert.ok(gate);
  assert.equal(gate.diff_base, 'main');
  assert.equal(gate.work_dir, root);
  // E2E scenarios (#143): local-hero points "none yet" readers to the run's summary, not a merge gate
  assert.match(gate.message, /Dev\/QA: read the E2E scenarios and the screenshots/);
  // #203: e2e_tests defaults to "write" (not "write_and_run"), so the test writer only writes them
  assert.match(gate.message, /E2E scenarios: none yet\. The test writer writes them after the code review; they show in the run's summary\./);
  const transitions = events.filter((e) => e.type === 'step.transition').map((e) => `${e.from}>${e.to}`);
  assert.deepEqual(transitions.filter((x) => /developer_check|developer_screenshots/.test(x)), [
    'develop>developer_screenshots', 'developer_screenshots>developer_check', 'developer_check>code_review',
  ]);
});

// The `verify_failed` and `approve_merge`/`developer_check` gate templates rendered directly (no
// full mock run needed: `render` shares the engine's own template env, including `e2e_scenarios`).
test('local hero workflow: verify_failed\'s message has the Dev/QA line and the scenarios, or "none reported" without them', () => {
  const wf = loadWorkflow(path.join(root, 'workflows', 'software-development-local-hero.yaml'));
  const msg = wf.steps.find((s) => s.id === 'verify_failed').message;
  const scope = { steps: { verify_change: { output: { claim: 'The filter persists', evidence: 'It did not, on reload' } }, test: { output: null } } };
  const withoutScenarios = render(msg, scope);
  assert.match(withoutScenarios, /Dev\/QA: read the E2E scenarios and the screenshots/);
  assert.match(withoutScenarios, /E2E scenarios: none reported by the test writer\./);

  const withScenarios = render(msg, {
    ...scope,
    steps: { ...scope.steps, test: { output: { scenarios: [{ name: 'Filter the runs', status: 'passed' }, { name: 'Empty filter result', status: 'failed', reason: 'no message shown' }] } } },
  });
  assert.match(withScenarios, /E2E scenarios \(written by the test writer\): 1 passed · 1 failed/);
  assert.match(withScenarios, /- failed: Empty filter result \(no message shown\)/);
});

test('local hero workflow: a successful run saves <run>/e2e/scenarios.feature and scenarios.json; the test step reports them pending, never run (#199)', { timeout: 120000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file: path.join(root, 'workflows', 'software-development-local-hero.yaml'), inputs: { task: 'Engine test', repo_path: root }, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const testOutputs = events.filter((e) => e.type === 'step.finished' && e.step_id === 'test').map((e) => e.output);
  assert.equal(testOutputs.length, 2, 'tests_status fails once by default, then passes on retry');
  for (const output of testOutputs) {
    assert.ok(output.scenarios.length, 'the test step still reports scenarios');
    assert.ok(output.scenarios.every((s) => s.status === 'pending'), 'a development run writes scenarios, it never runs them (#199)');
  }

  assert.ok(events.some((e) => e.type === 'file.saved' && e.step_id === 'test' && /e2e[\\/]scenarios\.feature$/.test(e.path)));
  assert.match(fs.readFileSync(path.join(run.runDir, 'e2e', 'scenarios.feature'), 'utf8'), /# pending/);
  const saved = JSON.parse(fs.readFileSync(path.join(run.runDir, 'e2e', 'scenarios.json'), 'utf8'));
  assert.ok(saved.scenarios.every((s) => s.status === 'pending'));
  assert.equal(saved.counts.pending, saved.counts.total);
  fs.rmSync(runsDir, { recursive: true, force: true });
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

// A small workflow file in a temp folder; returns its path.
function tempWorkflow(t, yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yaml);
  return { dir, file };
}

async function runWith(file, { mock, answer, cwd }) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file, inputs: { task: 't', dir: cwd || '' }, mock, runsDir });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, answer(ev)));
  });
  await run.start();
  fs.rmSync(runsDir, { recursive: true, force: true });
  return { events, finished: events.find((e) => e.type === 'workflow.finished') };
}

// #144: a `type: screenshots` step (`from` a step whose output lists the screens) never blocks the
// gate after it, whatever the list looks like. The mock provider always returns a valid entry for a
// field named exactly `screenshots` with `items.properties.args` (src/engine/providers.js), so these
// two fixtures shape develop's output_schema around that: without `args` the mock's generic object
// filler produces a name the step rejects (a bad name, not a reserved option, but the same path:
// checkEntry's error ends up in the step's `errors`); without a `screenshots` property at all,
// develop's output simply has none (a change without UI).
test('a screenshots step: an invalid entry (bad name) from the previous step still reaches the gate, with the error in the output', async (t) => {
  const { file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: shots-bad-entry }
inputs:
  task: { type: string }
  dir: { type: string }
defaults:
  working_dir: "{{ inputs.dir }}"
agents:
  dev: { provider: claude, model: mock-model, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: implement
    output_schema:
      type: object
      properties:
        screenshots:
          type: array
          items:
            type: object
            properties:
              name: { type: string }
              caption: { type: string }
  - id: shots
    type: screenshots
    from: develop
    folder: ui
  - id: gate
    type: human_approval
    message: "{{ steps.shots.output.message }}"
    transitions:
      - when: "approved"
        goto: end
`);
  const { events, finished } = await runWith(file, { mock: true, answer: () => true });
  assert.equal(finished.status, 'success', finished.error);
  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'shots');
  assert.equal(step.output.taken, 0);
  assert.equal(step.output.errors.length, 1);
  assert.match(step.output.errors[0].error, /name must be a plain file name/);
  assert.match(step.output.reason, /no valid entry in the developer's list/);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'gate');
  assert.match(gate.message, /No screenshots: no valid entry in the developer's list; 1 error: .*name must be a plain file name/);
});

test('a screenshots step: an empty (no UI) list from the previous step skips the capture and still reaches the gate', async (t) => {
  const { file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: shots-empty }
inputs:
  task: { type: string }
  dir: { type: string }
defaults:
  working_dir: "{{ inputs.dir }}"
agents:
  dev: { provider: claude, model: mock-model, session: ephemeral }
steps:
  - id: develop
    agent: dev
    prompt: implement
    output_schema:
      type: object
      properties: {}
  - id: shots
    type: screenshots
    from: develop
    folder: ui
  - id: gate
    type: human_approval
    message: "{{ steps.shots.output.message }}"
    transitions:
      - when: "approved"
        goto: end
`);
  const { events, finished } = await runWith(file, { mock: true, answer: () => true });
  assert.equal(finished.status, 'success', finished.error);
  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'shots');
  assert.equal(step.output.taken, 0);
  assert.deepEqual(step.output.errors, []);
  assert.match(step.output.reason, /the developer listed no screens \(a change without UI\)/);
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'gate');
  assert.match(gate.message, /No screenshots: the developer listed no screens \(a change without UI\)/);
});

test('transition on_error: a failed action goes to the named step with action_error; without it the run fails', { timeout: 60000 }, async (t) => {
  const yaml = (onError) => `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: onerr }
inputs:
  task: { type: string }
  dir: { type: string }
defaults:
  working_dir: "{{ inputs.dir }}"
agents:
  a: { provider: claude, model: m }
steps:
  - id: gate
    type: human_approval
    message: go?
    transitions:
      - when: "approved"
        action: node -e "process.exit(3)"
        goto: end
${onError ? '        on_error: fixup\n' : ''}      - when: "rejected"
        goto: end
  - id: fixup
    type: human_approval
    message: "failed: {{ action_error.message }}"
    transitions:
      - when: "approved"
        goto: end
      - when: "rejected"
        goto: end
        status: failed
`;
  const { dir, file } = tempWorkflow(t, yaml(true));
  const routed = await runWith(file, { mock: false, cwd: dir, answer: () => true });
  assert.equal(routed.finished.status, 'success', routed.finished.error);
  const fix = routed.events.find((e) => e.type === 'approval.requested' && e.step_id === 'fixup');
  assert.match(fix.message, /failed: Action failed \(exit 3\)/);
  assert.ok(routed.events.some((e) => e.type === 'step.transition' && e.from === 'gate' && e.to === 'fixup' && e.when === 'on_error'));

  fs.writeFileSync(file, yaml(false));
  const failed = await runWith(file, { mock: false, cwd: dir, answer: () => true });
  assert.equal(failed.finished.status, 'failed');
  assert.match(failed.finished.error, /Action failed \(exit 3\)/);
});

test('max_total_context: the run pauses before the next agent turn; Continue grants another block, Stop cancels', { timeout: 60000 }, async (t) => {
  const { file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: ctx }
inputs:
  task: { type: string }
  dir: { type: string }
orchestrator:
  limits: { max_total_context: 1k }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: one
    agent: a
    prompt: first
  - id: two
    agent: a
    prompt: second
  - id: three
    agent: a
    prompt: third
`);
  const go = await runWith(file, { mock: true, answer: () => 'continue' });
  assert.equal(go.finished.status, 'success', go.finished.error);
  const pauses = go.events.filter((e) => e.type === 'approval.requested' && /context_limit$/.test(e.step_id));
  // the first turn runs (nothing read yet); each later turn is past the allowance and asks
  assert.ok(pauses.length >= 1, 'paused at least once');
  assert.equal(pauses[0].step_id, 'two:context_limit');
  assert.match(pauses[0].message, /past its limit of 0\.0M/);
  assert.deepEqual(pauses[0].choices.map((c) => c.id), ['continue', 'stop']);
  assert.ok(go.events.some((e) => e.type === 'limit.exceeded' && e.limit === 'max_total_context' && e.paused));

  const stop = await runWith(file, { mock: true, answer: () => 'stop' });
  assert.equal(stop.finished.status, 'cancelled');
  assert.ok(!stop.events.some((e) => e.type === 'step.started' && e.step_id === 'three'));
});

// ---- #174: `type: workflow` step - a child run, once or for each item of a list --------------
// Pure scheduling/templating pieces (validateWorkflowStep, resolveValue, itemFiles, schedule,
// file-overlap grouping, nesting depth) are unit-tested directly in test/workflow-step.test.js,
// with fake startChild promises. These tests exercise the real wiring through WorkflowRun: the
// events a `type: workflow` step emits, on_error/transitions reading output.status, a child's
// human gate blocking the parent, and the parent/child summary links.

async function until(fn, timeoutMs = 20000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const CHILD_ECHO_YAML = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: child-echo }
inputs:
  n: { type: number, default: 0 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "echo {{ inputs.n }}"
outputs:
  n:
    type: number
    value: "{{ inputs.n }}"
`;

// A single step with no on_error: the missing skill fails the step, and nothing catches it, so
// the whole child run ends failed (same mechanism as the fanout/on-error fixtures).
const CHILD_FAIL_YAML = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: child-fail }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    skills: [does-not-exist]
    prompt: "do it"
`;

const CHILD_GATE_YAML = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: child-gate }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do it"
  - id: review
    type: human_approval
    message: "ok?"
`;

test('type: workflow step: without foreach, the output is { status, run_id, outputs } from the child\'s declared outputs', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-once }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-echo.yaml
    inputs: { n: 7 }
`);
  fs.writeFileSync(path.join(dir, 'child-echo.yaml'), CHILD_ECHO_YAML);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'child');
  assert.equal(step.output.status, 'success');
  assert.ok(step.output.run_id);
  assert.deepEqual(step.output.outputs, { n: 7 });
});

test('type: workflow step: foreach runs one child per item, at most max_parallel at a time; outputs come back as an ordered list', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-foreach }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: children
    type: workflow
    workflow: child-echo.yaml
    inputs: { n: "{{ item }}" }
    foreach: [1, 2, 3]
    max_parallel: 2
`);
  fs.writeFileSync(path.join(dir, 'child-echo.yaml'), CHILD_ECHO_YAML);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  let active = 0;
  let peak = 0;
  for (const ev of events) {
    if (ev.type === 'workflow.child_started') { active++; peak = Math.max(peak, active); }
    if (ev.type === 'workflow.child_finished') active--;
  }
  assert.equal(peak, 2, 'never more than max_parallel children at once');
  assert.equal(events.filter((e) => e.type === 'workflow.child_started').length, 3);

  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'children');
  assert.equal(step.output.status, 'success');
  assert.deepEqual(step.output.outputs, [{ n: 1 }, { n: 2 }, { n: 3 }]);
  assert.equal(step.output.succeeded, 3);
  assert.equal(step.output.failed, 0);
  assert.deepEqual(run.childRuns.map((c) => c.status), ['success', 'success', 'success']);
  assert.deepEqual(finished.summary.child_runs.map((c) => c.step_id), ['children', 'children', 'children']);
});

test('on_error: a failing child workflow routes the step to its on_error step, with output.status failed', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-onerror }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-fail.yaml
    on_error: after
  - id: after
    agent: a
    prompt: "child failed: {{ steps.child.output.error }}"
`);
  fs.writeFileSync(path.join(dir, 'child-fail.yaml'), CHILD_FAIL_YAML);
  const { events, finished } = await runWith(file, { mock: true, answer: () => true, cwd: dir });
  assert.equal(finished.status, 'success', finished.error);
  const step = events.find((e) => e.type === 'step.finished' && e.step_id === 'child');
  assert.equal(step.output.status, 'failed');
  assert.equal(step.error, true);
  assert.ok(events.some((e) => e.type === 'step.transition' && e.from === 'child' && e.to === 'after' && e.when === 'on_error'));
  const sent = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'after');
  assert.match(sent.prompt, /child failed: Skill not found: "does-not-exist"/);
});

test('without on_error, a step\'s transitions can read output.status; without either, a failed child fails the run', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-transitions }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-fail.yaml
    transitions:
      - when: "status == 'failed'"
        goto: handle
      - when: "status == 'success'"
        goto: end
  - id: handle
    agent: a
    prompt: "handling: {{ steps.child.output.error }}"
`);
  fs.writeFileSync(path.join(dir, 'child-fail.yaml'), CHILD_FAIL_YAML);
  const { events, finished } = await runWith(file, { mock: true, answer: () => true, cwd: dir });
  assert.equal(finished.status, 'success', finished.error);
  assert.ok(events.some((e) => e.type === 'step.transition' && e.from === 'child' && e.to === 'handle'));
  const sent = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'handle');
  assert.match(sent.prompt, /handling: Skill not found: "does-not-exist"/);

  // neither on_error nor transitions: the run itself fails with the reason named
  fs.writeFileSync(file, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-no-handler }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-fail.yaml
`);
  const noHandler = await runWith(file, { mock: true, answer: () => true, cwd: dir });
  assert.equal(noHandler.finished.status, 'failed');
  assert.match(noHandler.finished.error, /the child workflow child-fail\.yaml ended failed/);
});

test('a child\'s human gate keeps the parent waiting; the parent never answers it, and never finishes the step', async (t) => {
  const { dir, file } = tempWorkflow(t, `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: parent-gate }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: child
    type: workflow
    workflow: child-gate.yaml
`);
  fs.writeFileSync(path.join(dir, 'child-gate.yaml'), CHILD_GATE_YAML);
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir });
  let child = null;
  const childEvents = [];
  run.on('child', (c) => {
    child = c;
    c.on('event', (ev) => childEvents.push(ev));
  });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  const startP = run.start();
  await until(() => child && childEvents.some((e) => e.type === 'approval.requested'));
  assert.equal(run.orchestrator.status, 'waiting');
  assert.ok(!events.some((e) => e.type === 'approval.requested'));
  assert.ok(!events.some((e) => e.type === 'step.finished' && e.step_id === 'child'));

  const gateEv = childEvents.find((e) => e.type === 'approval.requested');
  child.resolveApproval(gateEv.approval_id, true);
  await startP;
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
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

test('software-development: a failing suite goes back to the test writer once with the failures, then passes; summary.suite_runs counts the engine\'s runs', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['fail', 'pass'] } },
  });
  assert.equal(finished.status, 'success', finished.error);
  const i = transitions.indexOf('test>suite');
  assert.deepEqual(transitions.slice(i, i + 4), ['test>suite', 'suite>test', 'test>suite', 'suite>build'], transitions.join(' '));
  const testPrompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'test').map((e) => e.prompt);
  assert.equal(testPrompts.length, 2);
  assert.match(testPrompts[1], /The orchestrator ran the whole suite after your last step and it failed/);
  assert.match(testPrompts[1], /simulated failing test/);
  assert.deepEqual(finished.summary.suite_runs, { engine: 2, agents: 0 });
});

test('software-development: pre-existing suite failures never loop back to the test writer', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], preexisting_failures: true, suite: { suite: ['preexisting'] } },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(transitions.filter((x) => /^(test|suite)>/.test(x)), ['test>suite', 'suite>build']);
  assert.deepEqual(finished.summary.suite_runs, { engine: 1, agents: 0 });
});

test('software-development: a suite that cannot run (blocked) goes straight to test_failed', { timeout: 120000 }, async () => {
  const { finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['blocked'] } },
    answers: { test_failed: false },
  });
  assert.deepEqual(transitions.filter((x) => /^(test|suite)>/.test(x)), ['test>suite', 'suite>test_failed']);
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /ended as failed at step "test_failed"/);
});

test('software-development: a suite that keeps failing exhausts its 2 retries (3 rounds total) and stops at test_failed, with the failures in the gate message', { timeout: 120000 }, async () => {
  const { events, finished, transitions } = await runSoftwareDevelopment({
    mockSequences: { verdict: ['approved'], tests_status: ['pass'], suite: { suite: ['fail'] } },
    answers: { test_failed: false },
  });
  assert.deepEqual(transitions.filter((x) => /^(test|suite)>/.test(x)), ['test>suite', 'suite>test', 'test>suite', 'suite>test', 'test>suite', 'suite>test_failed']);
  assert.equal(finished.status, 'failed');
  const gate = events.find((e) => e.type === 'approval.requested' && e.step_id === 'test_failed');
  assert.match(gate.message, /still fails after 3 round/);
  assert.match(gate.message, /simulated failing test/);
});

test('software-development: unit_tests \'run_existing\' with a failing suite delegates to the developer instead of the test writer', { timeout: 120000 }, async () => {
  const { events, transitions } = await runSoftwareDevelopment({
    inputs: { unit_tests: 'run_existing', e2e_tests: 'off' },
    mockSequences: { verdict: ['approved'], preview_status: ['success'], suite: { suite: ['fail', 'pass'] } },
  });
  assert.deepEqual(transitions.filter((x) => /^(code_review|test|suite)>/.test(x)), ['code_review>suite', 'suite>suite', 'suite>build']);
  assert.ok(events.some((e) => e.type === 'log' && e.message === 'suite delegated to developer'));
  assert.ok(!events.some((e) => e.type === 'session.message_sent' && e.step_id === 'test'), 'the test writer never runs with unit_tests: run_existing + e2e_tests: off');
});

// ---- #203: unit_tests x e2e_tests -----------------------------------------------------------

for (const unit_tests of ['write_and_run', 'run_existing', 'off']) {
  for (const e2e_tests of ['off', 'write', 'write_and_run']) {
    const testVisited = e2e_tests !== 'off' || unit_tests === 'write_and_run';
    const suiteVisited = unit_tests !== 'off';
    test(`software-development: unit_tests=${unit_tests} x e2e_tests=${e2e_tests}: test visited=${testVisited}, suite visited=${suiteVisited}`, { timeout: 120000 }, async () => {
      const { finished } = await runSoftwareDevelopment({
        inputs: { unit_tests, e2e_tests },
        mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } },
      });
      assert.equal(finished.status, 'success', finished.error);
      assert.equal(finished.summary.steps.test.visits > 0, testVisited, 'test step');
      assert.equal(finished.summary.steps.suite.visits > 0, suiteVisited, 'suite step');
    });
  }
}

test('software-development: the test writer\'s skills follow unit_tests / e2e_tests (no unit skill unless write_and_run, no e2e skill when off)', { timeout: 120000 }, async () => {
  const firstTestPrompt = (events) => events.find((e) => e.type === 'session.message_sent' && e.step_id === 'test').prompt;

  const both = await runSoftwareDevelopment({
    inputs: { unit_tests: 'write_and_run', e2e_tests: 'write' },
    mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } },
  });
  const bothPrompt = firstTestPrompt(both.events);
  assert.match(bothPrompt, /<skill name="unit-test-writer-js"/);
  assert.match(bothPrompt, /<skill name="e2e-test-writer-js"/);

  const unitOnly = await runSoftwareDevelopment({
    inputs: { unit_tests: 'write_and_run', e2e_tests: 'off' },
    mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } },
  });
  const unitOnlyPrompt = firstTestPrompt(unitOnly.events);
  assert.match(unitOnlyPrompt, /<skill name="unit-test-writer-js"/);
  assert.doesNotMatch(unitOnlyPrompt, /<skill name="e2e-test-writer-js"/);

  const e2eOnly = await runSoftwareDevelopment({
    inputs: { unit_tests: 'run_existing', e2e_tests: 'write' },
    mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } },
  });
  const e2eOnlyPrompt = firstTestPrompt(e2eOnly.events);
  assert.doesNotMatch(e2eOnlyPrompt, /<skill name="unit-test-writer-js"/, 'run_existing never loads the unit-test-writer skill');
  assert.match(e2eOnlyPrompt, /<skill name="e2e-test-writer-js"/);
});

test('software-development: tests_plan records whether a value is the workflow default or chosen for this run', { timeout: 120000 }, async () => {
  const def = await runSoftwareDevelopment({ mockSequences: { verdict: ['approved'], preview_status: ['success'], tests_status: ['pass'], suite: { suite: ['pass'] } } });
  const planOf = (f, k) => f.summary.tests_plan.find((p) => p.input === k);
  assert.equal(planOf(def.finished, 'unit_tests').source, 'workflow default');
  assert.equal(planOf(def.finished, 'unit_tests').value, 'write_and_run');
  const startedPlan = def.events.find((e) => e.type === 'workflow.started').tests_plan;
  assert.equal(planOf({ summary: { tests_plan: startedPlan } }, 'unit_tests').source, 'workflow default');

  const chosen = await runSoftwareDevelopment({
    inputs: { unit_tests: 'off', e2e_tests: 'off' },
    mockSequences: { verdict: ['approved'], preview_status: ['success'] },
  });
  assert.equal(planOf(chosen.finished, 'unit_tests').source, 'chosen for this run');
  assert.equal(planOf(chosen.finished, 'unit_tests').value_label, 'Off');
});
