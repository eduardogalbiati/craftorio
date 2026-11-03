// Visual builder (packages/engine/domains/workflow/workflow-builder.js): the YAML it writes loads and runs in the engine
// unchanged, reads back into the same spec, and workflows it can't draw are reported.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const builder = require('../../domains/workflow/workflow-builder');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');

const root = path.join(__dirname, '..', '..', '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfb-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const agentDesk = (id, extra = {}) => ({
  id, kind: 'agent', brief: `Do the ${id} part.`, context: true, access: 'read',
  agent: { source: 'custom', agentId: null, name: '', appearance: null, provider: 'claude', model: 'claude-opus-5-5', effort: 'high', system_prompt: `You are the ${id} agent.`, skills: [] },
  ...extra,
});

const SPEC = {
  name: 'Plan and build',
  description: 'A planner, a gate and a builder.',
  category: 'build',
  steps: [
    agentDesk('plan', { agent: { ...agentDesk('plan').agent, source: 'agent', agentId: 'architect', name: 'Architect', appearance: { body: '#123456', shell: '#FFFFFF', visor: '#000000', glow: '#ABCDEF', eyes: 'bars', emblem: 'gear' }, skills: ['code-review'] } }),
    { id: 'check_plan', kind: 'gate', reviewer: 'human', message: 'Is the plan good?', onReject: 'plan' },
    agentDesk('build', { access: 'edit', agent: { ...agentDesk('build').agent, provider: 'codex', model: 'gpt-6-luna', effort: 'medium' } }),
    agentDesk('wildcard', { context: false, agent: { ...agentDesk('wildcard').agent, source: 'random', system_prompt: '' } }),
  ],
};

function save(t, spec, base) {
  const file = path.join(tmp(t), builder.fileNameFor(spec.name));
  fs.writeFileSync(file, builder.toYaml(spec, base));
  return file;
}

test('toYaml writes a workflow the engine loads, and fromWorkflow reads the same spec back', (t) => {
  const file = save(t, SPEC);
  assert.equal(path.basename(file), 'plan-and-build.yaml');
  const wf = loadWorkflow(file);
  assert.deepEqual(wf.steps.map((s) => s.id), ['plan', 'check_plan', 'build', 'wildcard']);
  assert.equal(wf.agents.build.provider, 'codex');
  assert.equal(wf.agents.build.effort, 'medium');
  assert.deepEqual(wf.agents.build.capabilities, builder.ACCESS.edit);
  assert.equal(wf.agents.wildcard.persona, 'random');
  assert.deepEqual(wf.agents.plan.skills, ['code-review']);
  assert.match(wf.steps[2].prompt, /steps\.plan\.output\.text/);
  assert.equal(wf.steps[3].prompt.trim(), 'Do the wildcard part.'); // no context
  assert.deepEqual(wf.steps[1].transitions, [{ when: 'approved', goto: 'build' }, { when: 'true', goto: 'plan' }]);

  const { spec, problems } = builder.fromWorkflow(wf);
  assert.deepEqual(problems, []);
  assert.deepEqual(spec, SPEC);
});

test('a gate that stops ends the run as cancelled; the last gate approves to the end', (t) => {
  const spec = { ...SPEC, steps: [agentDesk('a'), { id: 'ok', kind: 'gate', message: 'Fine?', onReject: 'stop' }] };
  const wf = loadWorkflow(save(t, spec));
  assert.deepEqual(wf.steps[1].transitions, [{ when: 'approved', goto: 'end' }, { when: 'true', goto: 'end', status: 'cancelled' }]);
  assert.deepEqual(builder.fromWorkflow(wf).spec.steps[1].onReject, 'stop');
});

test('validateSpec lists every problem at once', () => {
  assert.throws(() => builder.validateSpec({ name: '', steps: [] }), /name[\s\S]*at least one desk/);
  const bad = { name: 'x', steps: [agentDesk('a'), agentDesk('a'), { id: 'g', kind: 'gate', message: 'm', onReject: 'later' }, agentDesk('later'), agentDesk('End')] };
  bad.steps[0] = { ...bad.steps[0], agent: { ...bad.steps[0].agent, effort: 'max', model: '' } };
  assert.throws(() => builder.validateSpec(bad), (e) => {
    for (const re of [/already uses this id/, /"if rejected"/, /pick the model/, /pick the effort/, /id must start/]) assert.match(e.message, re);
    return true;
  });
});

test('editing keeps what the builder does not touch (providers, defaults, orchestrator)', (t) => {
  const base = yaml.load(builder.toYaml(SPEC));
  base.defaults.timeout = '90m';
  base.orchestrator.model = 'claude-sonnet-5-5';
  const wf = loadWorkflow(save(t, { ...SPEC, description: 'changed' }, base));
  assert.equal(wf.defaults.timeout, '90m');
  assert.equal(wf.orchestrator.model, 'claude-sonnet-5-5');
  assert.equal(wf.metadata.description, 'changed');
});

test('the bundled workflows use features the builder does not draw', () => {
  for (const f of fs.readdirSync(path.join(root, 'workflows')).filter((x) => x.endsWith('.yaml'))) {
    const { problems } = builder.fromWorkflow(loadWorkflow(path.join(root, 'workflows', f)));
    assert.ok(problems.length, `${f} should not open in the builder`);
  }
});

test('a hand-edited prompt or a loop is reported', (t) => {
  const wf = loadWorkflow(save(t, SPEC));
  wf.steps[0].prompt = 'something else';
  assert.deepEqual(builder.fromWorkflow(wf).problems, ['hand-edited prompt of "plan"']);
  wf.steps[2].transitions = [{ when: 'true', goto: 'plan' }];
  assert.ok(builder.fromWorkflow(wf).problems.includes('"transitions" on step "build"'));
});

test('a saved workflow runs in the engine; the random desk becomes one of the user\'s agents', async (t) => {
  const dir = tmp(t);
  const file = save(t, SPEC);
  const personas = [{ id: 'poet', name: 'Poet', prompt: 'You write in verse.', skills: ['prd-writing', 'gone'] }];
  const run = new WorkflowRun({ file, inputs: { task: 'Build a thing' }, mock: true, runsDir: dir, personas });
  assert.match(run.wf.agents.wildcard.system_prompt, /^You write in verse\./);
  assert.deepEqual(run.wf.agents.wildcard.skills, ['prd-writing']); // a skill that no longer exists is left out
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(events.filter((e) => e.type === 'step.started').map((e) => e.step_id), ['plan', 'check_plan', 'build', 'wildcard']);
  assert.deepEqual(events.find((e) => e.type === 'workflow.started').personas, { wildcard: { id: 'poet', name: 'Poet' } });
  assert.ok(events.some((e) => e.type === 'log' && /random agent "Poet"/.test(e.message)));
  assert.ok(events.some((e) => e.type === 'log' && e.level === 'warn' && /not found, left out: gone/.test(e.message)));
  // a resumed run keeps the pick
  const again = new WorkflowRun({ file, inputs: { task: 'x' }, mock: true, runsDir: dir, personas: [{ id: 'other', name: 'Other', prompt: 'p' }, ...personas], resume: { runId: 'r', fromStep: 'wildcard', personas: { wildcard: { id: 'poet' } } } });
  assert.equal(again.personas.wildcard.id, 'poet');
});

test('persona must be "random"', (t) => {
  const file = path.join(tmp(t), 'x.yaml');
  fs.writeFileSync(file, 'agents:\n  a: { provider: claude, model: m, persona: someone }\nsteps:\n  - { id: s, agent: a, prompt: p }\n');
  assert.throws(() => loadWorkflow(file), /persona must be "random"/);
});

test('effort "default" leaves the effort out (the CLI default) and reads back as default', (t) => {
  const spec = { ...SPEC, steps: [agentDesk('a', { agent: { ...agentDesk('a').agent, effort: 'default' } })] };
  const wf = loadWorkflow(save(t, spec));
  assert.equal(wf.agents.a.effort, undefined);
  assert.equal(builder.fromWorkflow(wf).spec.steps[0].agent.effort, 'default');
});

// #648: writer-reviewer left workflows/ (an alias of write-doc); its last copy, a fixture, stays the
// hand-written workflow with loops, schemas and choices these builder tests read
const LEGACY_WRITER_REVIEWER = path.join(__dirname, '..', 'fixtures', 'legacy', 'writer-reviewer.yaml');

test('describeWorkflow shows any workflow; patchWorkflow changes only agents and prompts', (t) => {
  const file = LEGACY_WRITER_REVIEWER;
  const doc = loadWorkflow(file);
  const spec = builder.describeWorkflow(doc);
  assert.equal(spec.fixed, true);
  const review = spec.steps.find((s) => s.id === 'review');
  assert.ok(review.badges.includes('/loop') && review.badges.includes('schema'));
  assert.deepEqual(spec.agents.writer.templated, { provider: '{{ inputs.writer_provider }}', model: '{{ inputs.writer_model }}', effort: '{{ inputs.writer_effort }}' });
  assert.ok(spec.steps.find((s) => s.id === 'decide').badges.some((b) => b.startsWith('choices:')));

  spec.agents.signoff = { ...spec.agents.signoff, provider: 'codex', model: 'gpt-6-luna', effort: 'default', skills: ['prd-writing'], system_prompt: 'You check documents.' };
  spec.agents.writer.model = 'ignored'; // templated: never written
  spec.steps.find((s) => s.id === 'signoff').brief = 'Check it.';
  const text = builder.patchWorkflow(doc, spec, builder.leadingComments(fs.readFileSync(file, 'utf8')));
  assert.match(text, /^# =+\n# Workflow: Writer & Reviewer/);
  const out = path.join(tmp(t), 'wr.yaml');
  fs.writeFileSync(out, text);
  const wf = loadWorkflow(out);
  assert.equal(wf.providers[wf.agents.signoff.provider].type, 'codex-cli');
  assert.equal(wf.agents.signoff.model, 'gpt-6-luna');
  assert.equal(wf.agents.signoff.effort, undefined);
  assert.deepEqual(wf.agents.signoff.skills, ['prd-writing']);
  assert.equal(wf.agents.writer.model, '{{ inputs.writer_model }}');
  assert.equal(wf.steps.find((s) => s.id === 'signoff').prompt, 'Check it.\n');
  // the rest is untouched: loops, schemas, choices
  assert.deepEqual(wf.steps.find((s) => s.id === 'review').transitions, doc.steps.find((s) => s.id === 'review').transitions);
  assert.deepEqual(wf.steps.find((s) => s.id === 'decide').choices, doc.steps.find((s) => s.id === 'decide').choices);
});

test('cloneText renames the workflow and keeps its comments', () => {
  // #630: multi-model-review.yaml became an alias of feature.yaml; fix.yaml is a bundled file with comments
  const text = fs.readFileSync(path.join(root, 'workflows', 'fix.yaml'), 'utf8');
  const out = builder.cloneText(text, 'fix-copy');
  assert.equal(yaml.load(out).metadata.name, 'fix-copy');
  assert.equal(out.replace('fix-copy', 'fix'), text);
});

// A desk, an AI check that can send the work back (2 rounds), then a human gate.
const AI_SPEC = {
  name: 'Checked build',
  description: '',
  category: 'build',
  steps: [
    agentDesk('build'),
    {
      id: 'check', kind: 'gate', reviewer: 'ai', message: 'The change has tests.', onReject: 'build', maxRounds: 2,
      agent: { source: 'custom', agentId: null, name: '', appearance: null, provider: 'codex', model: 'gpt-6-luna', effort: 'high', system_prompt: 'You are a strict reviewer.', skills: [] },
    },
    { id: 'ship', kind: 'gate', reviewer: 'human', message: 'Ship it?', onReject: 'stop' },
  ],
};

test('an AI gate is an agent step with an approved/notes schema that can send the work back', (t) => {
  const wf = loadWorkflow(save(t, AI_SPEC));
  const check = wf.steps[1];
  assert.equal(check.agent, 'check');
  assert.deepEqual(check.output_schema, builder.AI_SCHEMA);
  assert.deepEqual(check.transitions, [
    { when: 'output.approved', goto: 'ship' },
    { when: 'true', goto: 'build', loop: { name: 'check_rounds', max_iterations: 2, on_exhausted: 'end' }, status: 'failed' },
  ]);
  assert.match(check.prompt, /The change has tests\.[\s\S]*steps\.build\.output\.text/);
  assert.deepEqual(wf.agents.check.capabilities, builder.ACCESS.read);
  // the desk it sends back to gets its notes
  assert.match(wf.steps[0].prompt, /steps\.check\.output\.notes/);
  const back = builder.fromWorkflow(wf);
  assert.deepEqual(back.problems, []);
  assert.deepEqual(back.spec, AI_SPEC);
});

test('an AI gate that rejects sends the work back with its notes, then the run goes on', async (t) => {
  const dir = tmp(t);
  const run = new WorkflowRun({ file: save(t, AI_SPEC), inputs: { task: 'Add a feature' }, mock: true, runsDir: dir, mockSequences: { approved: [false, true] } });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(events.filter((e) => e.type === 'step.started').map((e) => e.step_id), ['build', 'check', 'build', 'check', 'ship']);
});

test('an AI gate that keeps rejecting ends the run as failed after its rounds', async (t) => {
  const dir = tmp(t);
  const run = new WorkflowRun({ file: save(t, AI_SPEC), inputs: { task: 'Add a feature' }, mock: true, runsDir: dir, mockSequences: { approved: [false, false, false, false] } });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  assert.equal(events.find((e) => e.type === 'workflow.finished').status, 'failed');
  assert.ok(!events.some((e) => e.type === 'approval.requested'), 'never reaches the human gate');
});

// #245: a desk's (or agent's) display name, the readable name the screens show instead of its id
const displayDoc = () => loadWorkflow(LEGACY_WRITER_REVIEWER);
const withDisplay = (spec, { agent, step }) => ({
  ...spec,
  agents: { ...spec.agents, writer: { ...spec.agents.writer, display: agent } },
  steps: spec.steps.map((s) => (s.id === 'out_of_rounds' ? { ...s, display: step } : s)),
});

test('#245 patchWorkflow writes an agent\'s and a step\'s display, and an emptied display removes the field', () => {
  const doc = displayDoc();
  const spec = builder.describeWorkflow(doc);
  assert.equal(spec.agents.writer.display, '');
  const named = yaml.load(builder.patchWorkflow(doc, withDisplay(spec, { agent: 'Author', step: 'Out of review rounds' })));
  assert.equal(named.agents.writer.display, 'Author');
  assert.equal(named.steps.find((s) => s.id === 'out_of_rounds').display, 'Out of review rounds');
  assert.equal(named.steps.find((s) => s.id === 'write').display, undefined, 'a step without one gets none');
  assert.equal(builder.describeWorkflow(named).agents.writer.display, 'Author');

  const cleared = yaml.load(builder.patchWorkflow(named, withDisplay(builder.describeWorkflow(named), { agent: '', step: '   ' })));
  assert.ok(!('display' in cleared.agents.writer));
  assert.ok(!('display' in cleared.steps.find((s) => s.id === 'out_of_rounds')));
});

test('#245 patchWorkflow refuses a display over 40 characters, naming the agent or the step', () => {
  const doc = displayDoc();
  const spec = builder.describeWorkflow(doc);
  assert.doesNotThrow(() => builder.patchWorkflow(doc, withDisplay(spec, { agent: 'a'.repeat(40) })));
  assert.throws(() => builder.patchWorkflow(doc, withDisplay(spec, { agent: 'a'.repeat(41) })), /writer.*40 characters/);
  assert.throws(() => builder.patchWorkflow(doc, withDisplay(spec, { step: 'b'.repeat(41) })), /out_of_rounds.*40 characters/);
});

test('#245 a desk\'s display is saved on its step, loads in the engine and reads back; over 40 characters is refused', (t) => {
  const spec = { ...SPEC, steps: SPEC.steps.map((s) => (s.id === 'check_plan' ? { ...s, display: 'Plan approval' } : s.id === 'build' ? { ...s, display: 'Build it' } : s)) };
  const wf = loadWorkflow(save(t, spec));
  assert.equal(wf.steps.find((s) => s.id === 'check_plan').display, 'Plan approval');
  assert.equal(wf.steps.find((s) => s.id === 'build').display, 'Build it');
  assert.equal(wf.steps.find((s) => s.id === 'plan').display, undefined);
  const back = builder.fromWorkflow(wf);
  assert.deepEqual(back.problems, []);
  assert.deepEqual(back.spec, spec);

  const tooLong = { ...SPEC, steps: SPEC.steps.map((s) => (s.id === 'build' ? { ...s, display: 'x'.repeat(41) } : s)) };
  assert.throws(() => builder.validateSpec(tooLong), /"build".*at most 40 characters/);
});
