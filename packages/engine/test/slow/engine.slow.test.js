const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../../engine/workflow');
const evidence = require('../../domains/evidence/evidence');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';
const { root, runLoopBlocked, runConditionalAction, tempWorkflow, until } = require('../engine-helpers');

test('computeOutputs: each declared output is the template rendered over the finished run, parsed for its type; empty or unparsable stays null (with a warning)', async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(__dirname, '..', 'fixtures', 'outputs.yaml'), inputs: {}, mock: true, runsDir, mockSequences: { count: [7] },
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
test('/goal + /loop: repeats the step, delegates the failure and passes on the result', { timeout: 60000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(__dirname, '..', 'fixtures', 'loop-goal.yaml'),
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
    file: path.join(__dirname, '..', 'fixtures', 'fanout.yaml'),
    inputs: {},
    mock: true,
    runsDir,
    skillsDirs: [path.join(__dirname, '..', 'fixtures', 'skills')],
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
test('a missing skill fails the run with a clear message', { timeout: 30000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({ file: path.join(__dirname, '..', 'fixtures', 'fanout.yaml'), inputs: { doc_skill: 'does-not-exist' }, mock: true, runsDir, skillsDirs: [] });
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
  const run = new WorkflowRun({ file: path.join(__dirname, '..', 'fixtures', 'fanout.yaml'), inputs: {}, mock: true, runsDir: os.tmpdir(), skillsDirs: [dir] });
  assert.deepEqual(run.loadSkills(['lang-b', 'lang-a', '']).map((s) => s.name), ['core', 'lang-a', 'lang-b']);
  assert.deepEqual(run.loadSkills(['cyc-1']).map((s) => s.name), ['cyc-2', 'cyc-1']);
});
test('a transition action runs a skill script through skill_dir()', async (t) => {
  const actions = await runConditionalAction(t, true);
  assert.equal(actions.length, 1);
  const script = path.join(root, 'skills', 'pr-screenshots');
  assert.equal(actions[0].command, `node "${script}/publish.js" --cleanup`);
});
// ---- resolveInputs: a `type: boolean` input accepts a real boolean or its saved text (#133/#116) ---

test('resolveInputs (type: boolean): a real boolean, and the text forms a form/CLI/older saved input sends, all coerce; an unreadable one throws', () => {
  const file = path.join(__dirname, '..', 'fixtures', 'conditional-action.yaml');
  const inputsOf = (cleanup) => new WorkflowRun({ file, inputs: { cleanup }, mock: true, runsDir: os.tmpdir(), skillsDirs: [] }).inputs.cleanup;
  for (const [given, expected] of [[true, true], [false, false], ['true', true], ['false', false], ['yes', true], ['no', false], ['', false]]) {
    assert.equal(inputsOf(given), expected, JSON.stringify(given));
  }
  assert.throws(() => inputsOf('maybe'), /Input "cleanup" must be true or false/);
});
test('a transition action that renders empty runs nothing', async (t) => {
  assert.deepEqual(await runConditionalAction(t, false), []);
});
test('decision log: ```decisions blocks are appended to decisions.tsv', (t) => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: path.join(__dirname, '..', 'fixtures', 'fanout.yaml'), inputs: {}, mock: true, runsDir });
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
  const run = new WorkflowRun({ file: path.join(__dirname, '..', 'fixtures', 'on-error.yaml'), inputs: {}, mock: true, runsDir, skillsDirs: [] });
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
  const run = new WorkflowRun({ file: path.join(__dirname, '..', 'fixtures', 'on-error.yaml'), inputs: {}, mock: true, runsDir: os.tmpdir() });
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
  // agent turns must take longer than the gate's wait for "duration_ms >= gate_wait_ms" to mean anything: this test keeps the scale above the file's 0.02
  const scale = process.env.CRAFTORIO_MOCK_DELAY_SCALE;
  process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.05';
  t.after(() => { process.env.CRAFTORIO_MOCK_DELAY_SCALE = scale; });
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
