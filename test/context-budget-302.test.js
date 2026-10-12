// Acceptance tests for #302: a request budget per turn (`max_requests`). A turn that reaches it is
// cut (claude -p --max-turns), wraps up with one handoff-only request in the same CLI session, and
// the same step visit continues in a fresh session from that note; a cap stops a looping turn.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

const FIXTURE = path.join(__dirname, 'fixtures', 'context-budget.yaml');
const argAfter = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function mockRun(t, { file = FIXTURE, mockSequences = {} } = {}) {
  const runsDir = tmp(t, 'budget-runs-');
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, mockSequences });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const sessionIds = (agent) => events.filter((e) => e.type === 'session.opened' && e.session.agent === agent).map((e) => e.session_id);
  const ofSession = (type, id) => events.filter((e) => e.type === type && e.session_id === id);
  return { run, events, finished, sessionIds, ofSession };
}

test('loadWorkflow validates max_requests on an agent and in defaults', (t) => {
  const dir = tmp(t, 'budget-load-');
  const load = (agent, extra = '') => {
    const f = path.join(dir, `wf-${Math.random().toString(36).slice(2)}.yaml`);
    fs.writeFileSync(f, `${extra}agents:\n  a: ${agent}\nsteps:\n  - { id: s, agent: a, prompt: x }\n`);
    return () => loadWorkflow(f);
  };
  assert.doesNotThrow(load('{ provider: claude, model: m, max_requests: 40 }'));
  assert.doesNotThrow(load('{ provider: claude, model: m }', 'defaults:\n  max_requests: 40\n'));
  assert.doesNotThrow(load('{ provider: claude, model: m, max_requests: "{{ inputs.budget }}" }'), 'a templated value is checked at run time');
  assert.throws(load('{ provider: claude, model: m, max_requests: lots }'), /max_requests/);
  assert.throws(load('{ provider: claude, model: m, max_requests: 0 }'), /max_requests/);
  assert.throws(load('{ provider: claude, model: m, max_requests: -5 }'), /max_requests/);
  assert.throws(load('{ provider: claude, model: m }', 'defaults:\n  max_requests: many\n'), /defaults: max_requests/);
});

test('ai-development-local-hero sets a request budget for the developer', () => {
  const wf = loadWorkflow(path.join(__dirname, '..', 'workflows', 'ai-development-local-hero.yaml'));
  const budget = wf.agents.developer.max_requests ?? wf.defaults?.max_requests;
  assert.notEqual(budget, undefined, 'the developer has a max_requests');
  assert.ok(String(budget).includes('{{') || Number(budget) > 0, `max_requests: ${budget}`);
});

test('claude-code gets --max-turns <max_requests>; an agent without a budget gets no --max-turns', { timeout: 30000 }, async (t) => {
  const dir = tmp(t, 'budget-cli-');
  // the "CLI" is node + a fake that calls no model: lift the simulation-only guard for this test
  const saved = {};
  for (const k of ['MULTIAGENT_SIMULATION_ONLY', 'MULTIAGENT_WORKSPACE', 'MULTIAGENT_USER_DATA']) { saved[k] = process.env[k]; delete process.env[k]; }
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v !== undefined) process.env[k] = v; } });
  const fake = path.join(__dirname, 'fixtures', 'fake-claude.js').replace(/\\/g, '/');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${fake}", "-p"] }`,
    'agents:',
    '  dev: { provider: claude, model: fake, session: handoff, max_requests: 7, capabilities: { tools: [read] } }',
    '  other: { provider: claude, model: fake, session: handoff, capabilities: { tools: [read] } }',
    'steps:',
    '  - { id: work, agent: dev, prompt: "Do it." }',
    '  - { id: more, agent: other, prompt: "Do more." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, runsDir: path.join(dir, 'runs') });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const spawns = events.filter((e) => e.type === 'session.stream' && e.item.kind === 'spawn').map((e) => e.item.args);
  assert.equal(spawns.length, 2);
  assert.equal(argAfter(spawns[0], '--max-turns'), '7');
  assert.equal(spawns[1].includes('--max-turns'), false);
});

test('Codex and Grok cannot enforce max_requests: the run log says so, and the turns still run', { timeout: 60000 }, async (t) => {
  const dir = tmp(t, 'budget-other-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    '  claude: { type: claude-code, command: claude, args: ["-p"] }',
    '  codex: { type: codex-cli, command: codex, args: [exec] }',
    '  grok: { type: grok-cli, command: grok }',
    'defaults:',
    '  max_requests: 40',
    'agents:',
    '  cdx: { provider: codex, model: m, session: handoff, capabilities: { tools: [read] } }',
    '  grk: { provider: grok, model: m, session: handoff, capabilities: { tools: [read] } }',
    '  cld: { provider: claude, model: m, session: handoff, capabilities: { tools: [read] } }',
    'steps:',
    '  - { id: a, agent: cdx, prompt: "x" }',
    '  - { id: b, agent: grk, prompt: "x" }',
    '  - { id: c, agent: cld, prompt: "x" }',
  ].join('\n'));
  const { events, finished } = await mockRun(t, { file });
  assert.equal(finished.status, 'success', finished.error);
  const budgetNotes = (agent) => events.filter((e) => e.type === 'log' && e.agent === agent
    && /max_requests/.test(e.message || '') && /not enforce/i.test(e.message || '')).length;
  assert.ok(budgetNotes('cdx') >= 1, 'codex: max_requests noted as not enforceable');
  assert.ok(budgetNotes('grk') >= 1, 'grok: max_requests noted as not enforceable');
  assert.equal(budgetNotes('cld'), 0, 'claude enforces it: no note');
});

test('a turn cut by its request budget wraps up in the same session and the visit continues in a fresh one', { timeout: 60000 }, async (t) => {
  const { run, events, finished, sessionIds, ofSession } = await mockRun(t, { mockSequences: { request_budget: { develop: 1 } } });
  assert.equal(finished.status, 'success', finished.error);

  const ids = sessionIds('developer');
  assert.equal(ids.length, 2, 'the cut session and the continuation');
  const [cutId, nextId] = ids;

  // the cut turn: marked, with its request count, then one wrap-up request in the same session
  const cutReceived = ofSession('session.message_received', cutId);
  assert.ok(cutReceived.length >= 1);
  assert.equal(cutReceived[0].cut, true);
  assert.equal(cutReceived[0].requests, 40);
  const cutSent = ofSession('session.message_sent', cutId);
  assert.equal(cutSent.length, 2, 'the step prompt, then the wrap-up request, nothing more');
  assert.match(cutSent[1].prompt, /```handoff/);
  assert.match(cutSent[1].prompt, /commit/i);

  // the continuation: the same visit, a fresh session started from the note, with the notice
  const nextSent = ofSession('session.message_sent', nextId);
  assert.equal(nextSent.length, 1);
  assert.match(nextSent[0].prompt, /continued after 40 requests/);
  assert.match(nextSent[0].prompt, /simulated goal of this agent/, 'the wrap-up note is in the prompt');
  assert.equal(ofSession('session.message_received', nextId).some((e) => e.cut), false);

  // one visit, one finished step: not a retry, not a failed attempt, not a stall
  assert.equal(events.filter((e) => e.type === 'step.started' && e.step_id === 'develop').length, 1);
  const done = events.filter((e) => e.type === 'step.finished' && e.step_id === 'develop');
  assert.equal(done.length, 1);
  assert.equal(Boolean(done[0].error), false);
  assert.equal(events.some((e) => e.type === 'log' && /attempt \d+\/\d+ failed/.test(e.message || '')), false);
  assert.equal(events.some((e) => e.type === 'log' && (e.kind === 'attempt_summary' || e.kind === 'stall')), false);

  // the budget is logged
  const budget = events.filter((e) => e.type === 'log' && e.kind === 'context_budget');
  assert.equal(budget.length, 1);
  assert.equal(budget[0].agent, 'developer');
  assert.equal(budget[0].step_id, 'develop');
  assert.equal(budget[0].requests, 40);
  assert.equal(typeof budget[0].context_peak, 'number');

  // the wrap-up note and the continuation's note: same step visit, the second one with -2
  const files = fs.readdirSync(path.join(run.runDir, 'handoffs')).sort();
  assert.ok(files.includes('develop-v1-developer.md'), files.join(', '));
  assert.ok(files.includes('develop-v1-developer-2.md'), files.join(', '));

  // summary.context: two fresh sessions of the developer, both in visit 1 of develop
  const dev = finished.summary.context.agents.developer;
  assert.equal(dev.fresh_sessions, 2);
  assert.equal(dev.per_turn.filter((p) => p.step === 'develop' && p.visit === 1).length, 2);
});

test('the cut turn counts its wrap-up request: tokens and cost of both requests of the cut session', { timeout: 60000 }, async (t) => {
  const { run, finished } = await mockRun(t, { mockSequences: { request_budget: { develop: 1 } } });
  assert.equal(finished.status, 'success', finished.error);
  // the mock's cut turn: 1500 in + 400 out + 40 requests × 20k cached = 801,900 tokens, $0.05;
  // its wrap-up (2nd request of that conversation): 200 + 150 + 50k cached = 50,350 tokens, $0.001
  const cut = finished.summary.context.agents.developer.per_turn.filter((p) => p.cut);
  assert.equal(cut.length, 1);
  assert.equal(cut[0].tokens, 852250);
  const rec = run.turnLog.filter((r) => r.cut);
  assert.equal(rec.length, 1);
  assert.equal(+rec[0].cost_usd.toFixed(4), 0.051);
});

test('a persistent agent cut by its budget continues in a fresh session, which its next turn then keeps', { timeout: 60000 }, async (t) => {
  const dir = tmp(t, 'budget-persistent-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    '  claude: { type: claude-code, command: claude, args: ["-p"] }',
    'agents:',
    '  developer: { provider: claude, model: m, session: persistent, max_requests: 40, capabilities: { tools: [read] } }',
    'steps:',
    '  - { id: develop, agent: developer, supervise: false, prompt: "Implement." }',
    '  - { id: polish, agent: developer, supervise: false, prompt: "Polish." }',
  ].join('\n'));
  const { finished, sessionIds, ofSession } = await mockRun(t, { file, mockSequences: { request_budget: { develop: 1 } } });
  assert.equal(finished.status, 'success', finished.error);
  const ids = sessionIds('developer');
  assert.equal(ids.length, 2, 'the cut session, then one fresh session for the rest of the run');
  const [cutId, nextId] = ids;
  assert.equal(ofSession('session.message_sent', cutId).length, 2, 'the cut session gets only its prompt and the wrap-up');
  const nextSent = ofSession('session.message_sent', nextId);
  assert.equal(nextSent.length, 2, 'the continuation of develop, then polish in the same session');
  assert.match(nextSent[0].prompt, /continued after 40 requests/);
  assert.match(nextSent[0].prompt, /simulated goal of this agent/);
  assert.match(nextSent[1].prompt, /Polish\./);
});

test('Stop pressed during the wrap-up: the run is cancelled and no continuation starts', { timeout: 60000 }, async (t) => {
  const runsDir = tmp(t, 'budget-stop-');
  const run = new WorkflowRun({ file: FIXTURE, inputs: {}, mock: true, runsDir, mockSequences: { request_budget: { develop: 1 } } });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'session.message_sent' && /request budget/.test(ev.prompt || '')) run.stop();
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(events.some((e) => e.type === 'session.message_sent' && /request budget/.test(e.prompt || '')), true, 'the wrap-up was sent');
  assert.notEqual(finished.status, 'success');
  assert.match(`${finished.status} ${finished.error}`, /cancel/i);
  assert.equal(events.filter((e) => e.type === 'session.opened' && e.session.agent === 'developer').length, 1, 'no continuation session');
  assert.equal(events.some((e) => e.type === 'session.message_sent' && /continued after/.test(e.prompt || '')), false);
  assert.equal(events.some((e) => e.type === 'handoff.saved'), false, 'no note saved for the visit');
});

test('a visit whose turns keep hitting the budget fails after the third cut',{ timeout: 60000 }, async (t) => {
  const { events, finished, sessionIds } = await mockRun(t, { mockSequences: { request_budget: { develop: 99 } } });
  assert.notEqual(finished.status, 'success');
  const cuts = events.filter((e) => e.type === 'session.message_received' && e.cut === true);
  assert.equal(cuts.length, 3);
  assert.equal(sessionIds('developer').length, 3, 'no fourth session after the cap');
  const errors = events.map((e) => [e.error, e.message].filter((x) => typeof x === 'string').join(' ')).join('\n');
  assert.match(errors, /the budget was reached 3 times/);
});
