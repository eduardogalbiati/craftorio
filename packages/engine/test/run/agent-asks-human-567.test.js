// #567: an agent asks for a human as a structured output (12-Factor Agents, factor 7). On a step that
// opts in (`ask_human: true`), an answer whose `needs_human` has a `question` (optional `options`
// [{ id, label }] and `default`) opens a human gate on that step (kind decision, `by: 'agent'` on
// approval.requested); the answer goes back to the same agent's next turn as `human_answer`, the step
// runs again and its transitions run only after the answering turn. Covers, through WorkflowRun and
// loadWorkflow: the opt-in field, the gate, the answer in each session mode, the supervisor never
// answering it, a resume asking again, the stall rule (two questions in a row) and the mock provider's
// `mockSequences.needs_human: { <step>: n }`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow } = require('../../engine/workflow');
const root = path.join(__dirname, '..', '..', '..', '..');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = process.env.CRAFTORIO_MOCK_DELAY_SCALE || '0.05';
process.env.CRAFTORIO_SIMULATION_ONLY = '1'; // tests never call real models

function writeTmp(t, yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-human-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yaml);
  return { dir, file };
}

function makeRun(t, yaml, opts = {}) {
  const { dir, file } = writeTmp(t, yaml);
  return new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), ...opts });
}

// Replaces every agent's answer (a queue of plain objects, JSON-encoded) and the supervisor's
// decisions; returns each agent's prompts, in order.
function script(run, agentOutputs, decisions = []) {
  const calls = {};
  run.sendToAgent = async (agent, prompt) => {
    if (agent === 'supervisor') {
      (calls.supervisor ??= []).push(prompt);
      const d = decisions.shift() || { explanation: 'give up', action: 'escalate' };
      return { text: '```json\n' + JSON.stringify(d) + '\n```' };
    }
    (calls[agent] ??= []).push(prompt);
    const out = agentOutputs[agent].shift();
    return { text: '```json\n' + JSON.stringify(out) + '\n```' };
  };
  return calls;
}

// Runs to the end; `answer(ev, events)` returns [answer, feedback] for each gate (default: approve).
async function run(r, answer = () => [true, '']) {
  const events = [];
  r.on('event', (e) => {
    events.push(e);
    if (e.type === 'approval.requested') {
      const [a, fb] = answer(e, events);
      setImmediate(() => r.resolveApproval(e.approval_id, a, 'user', fb));
    }
  });
  await r.start();
  return { events, finished: events.find((e) => e.type === 'workflow.finished') };
}

const QUESTION = {
  question: 'Which database should the cache use?',
  options: [{ id: 'pg', label: 'Postgres' }, { id: 'sqlite', label: 'SQLite' }],
  default: 'sqlite',
};

function askWF({ session = 'ephemeral', askHuman = 'ask_human: true', supervisor = '', prompt = 'write the cache' } = {}) {
  return `
apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-ask-human }
${supervisor ? `orchestrator:\n  supervisor: { ${supervisor} }\n` : ''}agents:
  a: { provider: claude, model: m, session: ${session} }
steps:
  - id: write
    agent: a
    ${askHuman}
    prompt: "${prompt}"
    output_schema:
      type: object
      required: [status]
      properties:
        status: { type: string, enum: [done, failed] }
        summary: { type: string }
    transitions:
      - { when: "output.status == 'done'", goto: after }
      - { when: "output.status == 'failed'", goto: end, status: failed }
  - id: after
    agent: a
    prompt: "after"
`;
}

const agentGates = (events) => events.filter((e) => e.type === 'approval.requested' && e.by === 'agent');
const starts = (events, id) => events.filter((e) => e.type === 'step.started' && e.step_id === id);

// ---- the opt-in field (field-rules.js / load.js) -------------------------------------------------

test('#567 loadWorkflow: ask_human is a true/false field of an agent step', (t) => {
  assert.doesNotThrow(() => loadWorkflow(writeTmp(t, askWF()).file));
  assert.throws(() => loadWorkflow(writeTmp(t, askWF({ askHuman: 'ask_human: "yes"' })).file), /ask_human/);
  const onGate = `agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: g\n    type: human_approval\n    message: x\n    ask_human: true\n    transitions: [{ when: approved, goto: end }]\n`;
  assert.throws(() => loadWorkflow(writeTmp(t, onGate).file), /ask_human/);
});

// ---- the gate --------------------------------------------------------------------------------------

test('#567 an opted-in step that answers needs_human opens a gate with the question, the options and free text, by the agent', async (t) => {
  const r = makeRun(t, askWF());
  script(r, { a: [{ status: 'done', needs_human: QUESTION }, { status: 'done' }, {}] });
  const { events, finished } = await run(r, () => ['pg', 'prod already runs it']);
  assert.equal(finished.status, 'success', finished.error);
  const gates = agentGates(events);
  assert.equal(gates.length, 1);
  const g = gates[0];
  assert.equal(g.step_id, 'write');
  assert.match(String(g.message), /Which database should the cache use\?/);
  assert.equal(g.agent, 'a');
  assert.deepEqual((g.choices || []).map((c) => c.id).filter((id) => id === 'pg' || id === 'sqlite'), ['pg', 'sqlite']);
  assert.equal((g.choices || []).find((c) => c.id === 'pg')?.label, 'Postgres');
  assert.equal(!!g.feedback, true, 'the gate takes free-text feedback');
});

test('#567 the transitions run only after the answering turn; the step runs again (one more visit)', async (t) => {
  const r = makeRun(t, askWF());
  script(r, { a: [{ status: 'done', needs_human: QUESTION }, { status: 'done' }, {}] });
  const { events, finished } = await run(r, () => ['sqlite', '']);
  assert.equal(finished.status, 'success', finished.error);
  const gateAt = events.findIndex((e) => e.type === 'approval.requested' && e.by === 'agent');
  const resolvedAt = events.findIndex((e) => e.type === 'approval.resolved');
  const afterAt = events.findIndex((e) => e.type === 'step.started' && e.step_id === 'after');
  assert.ok(gateAt >= 0, 'the agent gate opened');
  assert.ok(afterAt > resolvedAt, 'the next step starts only after the gate is answered');
  assert.equal(starts(events, 'write').length, 2);
  assert.equal(starts(events, 'after').length, 1);
});

test('#567 the answer reaches the next turn as human_answer; the asking turn\'s other outputs stay in steps.<id>.output', async (t) => {
  const prompt = 'write the cache [{{ human_answer.choice }}|{{ human_answer.feedback }}] prev={{ steps.write.output.summary }}';
  const r = makeRun(t, askWF({ prompt }));
  const calls = script(r, { a: [{ status: 'done', summary: 'draft one', needs_human: QUESTION }, { status: 'done' }, {}] });
  const { finished } = await run(r, () => ['pg', 'prod already runs it']);
  assert.equal(finished.status, 'success', finished.error);
  assert.match(calls.a[1], /\[pg\|prod already runs it\]/);
  assert.match(calls.a[1], /prev=draft one/);
});

for (const session of ['persistent', 'handoff', 'ephemeral']) {
  test(`#567 the chosen option and the owner's text reach the agent's next turn (session: ${session})`, async (t) => {
    const r = makeRun(t, askWF({ session }));
    const calls = script(r, { a: [{ status: 'done', needs_human: QUESTION }, { status: 'done' }, {}] });
    const { finished } = await run(r, () => ['pg', 'prod already runs it']);
    assert.equal(finished.status, 'success', finished.error);
    assert.equal(calls.a.length >= 2, true);
    assert.match(calls.a[1], /prod already runs it/);
    assert.match(calls.a[1], /\bpg\b|Postgres/);
  });
}

// ---- never automated ---------------------------------------------------------------------------------

test('#567 the supervisor on call never answers an agent\'s question: the owner does', async (t) => {
  const r = makeRun(t, askWF({ supervisor: 'enabled: true, on_call: true, max_interventions: 2, max_total: 10' }));
  script(r, { a: [{ status: 'done', needs_human: QUESTION }, { status: 'done' }, {}] }, [{ explanation: 'pick the default', action: 'continue' }]);
  const { events, finished } = await run(r, () => ['pg', '']);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(agentGates(events).length, 1);
  assert.equal(events.some((e) => e.type === 'supervisor.started'), false);
  const resolved = events.filter((e) => e.type === 'approval.resolved' && e.step_id === 'write');
  assert.deepEqual(resolved.map((e) => [e.by, e.choice]), [['user', 'pg']]);
});

test('#567 a run resumed at the asking step asks the question again: the earlier question is never taken as answered', async (t) => {
  const r = makeRun(t, askWF(), {
    resume: { runId: 'prev', fromStep: 'write', steps: { write: { output: { status: 'done', needs_human: QUESTION }, visits: 1 } }, sessions: {}, handoffs: {} },
  });
  script(r, { a: [{ status: 'done', needs_human: QUESTION }, { status: 'done' }, {}] });
  const { events, finished } = await run(r, () => ['sqlite', '']);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(agentGates(events).length, 1);
  assert.equal(events.filter((e) => e.type === 'approval.resolved' && e.by === 'user').length, 1);
});

// ---- stalls ------------------------------------------------------------------------------------------

test('#567 one question is not a stall, even with same_output: 2 and the same other fields', async (t) => {
  const r = makeRun(t, askWF({ supervisor: 'enabled: true, on_call: true, max_interventions: 2, max_total: 10, stall: { same_output: 2 }' }));
  script(r, { a: [{ status: 'done', needs_human: QUESTION }, { status: 'done' }, {}] });
  const { events, finished } = await run(r, () => ['pg', '']);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(agentGates(events).length, 1);
  assert.equal(events.some((e) => e.type === 'log' && e.kind === 'stall'), false);
  assert.equal(events.some((e) => e.type === 'supervisor.started'), false);
});

test('#567 two questions in a row are a stall; the supervisor\'s "continue" gives the agent its default, recorded as the supervisor\'s', async (t) => {
  const r = makeRun(t, askWF({ supervisor: 'enabled: true, on_call: true, max_interventions: 2, max_total: 10' }));
  const calls = script(
    r,
    { a: [{ status: 'done', needs_human: QUESTION }, { status: 'done', needs_human: QUESTION }, { status: 'done' }, {}] },
    [{ explanation: 'The agent keeps asking the same thing; its default is safe.', action: 'continue' }],
  );
  const { events, finished } = await run(r, () => ['pg', 'first answer']);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(agentGates(events).length, 1, 'the second question does not open a second gate');
  const stall = events.find((e) => e.type === 'log' && e.kind === 'stall');
  assert.equal(stall?.step_id, 'write');
  const started = events.find((e) => e.type === 'supervisor.started');
  assert.equal(started?.kind, 'stall');
  assert.equal(events.find((e) => e.type === 'supervisor.decision')?.action, 'continue');
  assert.equal(events.filter((e) => e.type === 'approval.resolved' && e.by === 'user').length, 1, 'the default is never recorded as the owner\'s answer');
  assert.match(calls.a[2], /\bsqlite\b|SQLite/);
  assert.equal(starts(events, 'write').length, 3);
});

// ---- off by default ----------------------------------------------------------------------------------

test('#567 a step without ask_human treats needs_human as an ordinary field: a warn, no gate', async (t) => {
  const r = makeRun(t, askWF({ askHuman: '' }));
  script(r, { a: [{ status: 'done', needs_human: QUESTION }, {}] });
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(events.some((e) => e.type === 'approval.requested'), false);
  assert.equal(starts(events, 'write').length, 1);
  assert.equal(events.some((e) => e.type === 'log' && e.level === 'warn' && /needs_human/.test(String(e.message)) && /write/.test(String(e.message))), true);
});

// ---- simulation ----------------------------------------------------------------------------------------

test('#567 mockSequences.needs_human: { write: 1 } makes the mock provider ask on the first visit only', async (t) => {
  const r = makeRun(t, askWF(), { mockSequences: { needs_human: { write: 1 } } });
  const { events, finished } = await run(r, (e) => [(e.choices || [])[0]?.id ?? true, 'go on']);
  assert.equal(finished.status, 'success', finished.error);
  const gates = agentGates(events);
  assert.equal(gates.length, 1);
  assert.equal(gates[0].step_id, 'write');
  assert.equal(String(gates[0].message).trim().length > 0, true);
  assert.equal(starts(events, 'write').length, 2);
});

test('#567 without a sequence the mock provider never asks, even on an ask_human step', async (t) => {
  const r = makeRun(t, askWF());
  const { events, finished } = await run(r);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(agentGates(events).length, 0);
  assert.equal(starts(events, 'write').length, 1);
});

// ---- after the review: shapes and edges -----------------------------------------------------------

test('#567 loadWorkflow: ask_human needs a single agent and an output_schema', (t) => {
  const noSchema = `agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: w\n    agent: a\n    ask_human: true\n    prompt: x\n`;
  assert.throws(() => loadWorkflow(writeTmp(t, noSchema).file), /ask_human needs a single agent and an output_schema/);
  const fanOut = `agents: { a: { provider: claude, model: m }, b: { provider: claude, model: m } }\nsteps:\n  - id: w\n    agents: [a, b]\n    ask_human: true\n    prompt: x\n    output_schema: { type: object, properties: { s: { type: string } } }\n`;
  assert.throws(() => loadWorkflow(writeTmp(t, fanOut).file), /ask_human needs a single agent/);
});

test('#567 a question without options: one answer choice, the owner\'s text reaches the next turn; a plain yes takes the agent\'s default', async (t) => {
  const r = makeRun(t, askWF({ prompt: 'write [{{ human_answer.choice }}|{{ human_answer.feedback }}]' }));
  const calls = script(r, { a: [
    { status: 'done', needs_human: { question: 'Which port?' } },
    { status: 'done', needs_human: { question: 'Keep the old flag?', default: 'keep' } },
    { status: 'done' }, {},
  ] });
  let n = 0;
  const { events, finished } = await run(r, (e) => (n++ === 0 ? [e.choices[0].id, 'use 8080'] : [true, '']));
  assert.equal(finished.status, 'success', finished.error);
  const gates = agentGates(events);
  assert.equal(gates.length, 2);
  assert.equal(gates[0].choices.length, 1);
  assert.equal(!!gates[0].feedback, true);
  assert.match(calls.a[1], /use 8080/);
  assert.match(calls.a[2], /\[keep\|\]/);
});

test('#567 the agent\'s gate is listed by pendingGates with who asked and its default (a reloaded window or the phone rebuilds it)', async (t) => {
  const r = makeRun(t, askWF());
  script(r, { a: [{ status: 'done', needs_human: QUESTION }, { status: 'done' }, {}] });
  let pending = null;
  r.on('event', (e) => {
    if (e.type !== 'approval.requested') return;
    pending = r.pendingGates().map((g) => ({ step_id: g.step_id, by: g.by, agent: g.agent, default: g.default, kind: g.kind }));
    setImmediate(() => r.resolveApproval(e.approval_id, 'pg', 'user', ''));
  });
  await r.start();
  assert.deepEqual(pending, [{ step_id: 'write', by: 'agent', agent: 'a', default: 'sqlite', kind: 'decision' }]);
});

test('#567 two questions in a row with the supervisor answering user_action: the second gate opens for the owner', async (t) => {
  const r = makeRun(t, askWF({ supervisor: 'enabled: true, on_call: true, max_interventions: 2, max_total: 10' }));
  const calls = script(
    r,
    { a: [{ status: 'done', needs_human: QUESTION }, { status: 'done', needs_human: QUESTION }, { status: 'done' }, {}] },
    [{ explanation: 'Only the owner knows.', action: 'user_action', user_action: 'answer the question' }],
  );
  let n = 0;
  const { events, finished } = await run(r, () => (n++ === 0 ? ['pg', ''] : ['sqlite', 'second answer']));
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(agentGates(events).length, 2);
  assert.equal(events.find((e) => e.type === 'supervisor.decision')?.action, 'user_action');
  assert.deepEqual(events.filter((e) => e.type === 'approval.resolved' && e.step_id === 'write').map((e) => [e.by, e.choice]), [['user', 'pg'], ['user', 'sqlite']]);
  assert.match(calls.a[2], /second answer/);
});

test('#567 two questions in a row without a supervisor: a stall is logged and the owner is asked again', async (t) => {
  const r = makeRun(t, askWF());
  script(r, { a: [{ status: 'done', needs_human: QUESTION }, { status: 'done', needs_human: QUESTION }, { status: 'done' }, {}] });
  const { events, finished } = await run(r, () => ['pg', '']);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(agentGates(events).length, 2);
  assert.equal(events.find((e) => e.type === 'log' && e.kind === 'stall')?.step_id, 'write');
  assert.equal(events.some((e) => e.type === 'supervisor.started'), false);
});

test('#567 the bundled feature workflow opts in its develop step, never its read-only reviewer', () => {
  // #630: software-development.yaml is an alias of feature.yaml
  const wf = loadWorkflow(path.join(root, 'workflows', 'feature.yaml'));
  const step = (id) => wf.steps.find((s) => s.id === id);
  assert.equal(step('develop')?.ask_human, true);
  assert.equal(!!step('code_review')?.ask_human, false);
});
