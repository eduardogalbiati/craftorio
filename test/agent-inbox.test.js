// Agent inboxes (#240): src/agent-inbox.js handle(), the one place every owner's request runs. Its
// owner is given as plain functions (record, perform, ask), so these tests record in memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const agentInbox = require('../src/agent-inbox');

// An owner whose history is an array; `perform` and `ask` are the test's.
function owner({ perform = async () => ({ text: 'done' }), ask = async () => { throw new Error('no model here'); } } = {}) {
  const history = [];
  let n = 0;
  return {
    history,
    opts: {
      kinds: ['roadmap.add', 'plan'],
      judgment: ['plan'],
      role: 'po',
      record: (m) => { const stored = { ts: `2026-10-04T16:10:0${n++}.000Z`, ...m }; history.push(stored); return stored; },
      perform,
      ask,
    },
  };
}

test('a mechanical request is recorded, run, and its result recorded at US$ 0 with no model', async () => {
  const o = owner({ perform: async (kind, params) => ({ text: `#${params.issues[0]} in stage 3` }) });
  const out = await agentInbox.handle({ kind: 'roadmap.add', params: { issues: [189] }, reason: 'ready to build', from: 'oracle', ref: 'm1' }, o.opts);

  assert.equal(out.ok, true);
  assert.equal(out.costUsd, 0);
  assert.equal(o.history.length, 2);
  const [request, result] = o.history;
  assert.equal(request.role, 'request');
  assert.equal(request.text, 'Request from the Oracle: roadmap.add (ready to build)');
  assert.deepEqual(request.request, { from: 'oracle', kind: 'roadmap.add', ref: 'm1' });
  assert.equal(result.role, 'po');
  assert.equal(result.text, 'Done: #189 in stage 3');
  assert.equal(result.costUsd, 0);
  assert.equal('model' in result, false);
  assert.equal(out.ownerTs, result.ts);
  assert.equal(out.text, 'Done: #189 in stage 3');
});

test('a mechanical request that throws is recorded as Failed with its error, ok false, never a throw', async () => {
  const o = owner({ perform: async () => { throw new Error('Issue #7 is archived.'); } });
  const out = await agentInbox.handle({ kind: 'roadmap.add', params: { issues: [7] }, reason: 'r', from: 'oracle', ref: 'm2' }, o.opts);

  assert.equal(out.ok, false);
  assert.equal(out.error, 'Issue #7 is archived.');
  assert.equal(out.costUsd, 0);
  const result = o.history.at(-1);
  assert.equal(result.text, 'Failed: Issue #7 is archived.');
  assert.ok(result.error);
  assert.equal(result.costUsd, 0);
  assert.equal(out.ownerTs, result.ts);
});

test('a kind outside the closed list is refused, recorded, and names the kinds the owner takes', async () => {
  const o = owner({ perform: async () => { throw new Error('must not run'); } });
  const out = await agentInbox.handle({ kind: 'run.stop', params: { runId: 'x' }, from: 'oracle', ref: 'm3' }, o.opts);

  assert.equal(out.ok, false);
  assert.match(out.error, /run\.stop/);
  assert.match(out.error, /roadmap\.add, plan/);
  assert.doesNotMatch(out.error, /must not run/);
  assert.equal(o.history.length, 2);
  assert.equal(o.history[0].role, 'request');
  assert.ok(o.history[1].error);
});

test('a judgment request reports the model\'s answer and its cost, without a second result message', async () => {
  const o = owner();
  o.opts.ask = async (params, request) => {
    const m = o.opts.record({ role: 'po', text: 'Stage 2 first.', request, model: 'claude-opus-5-5', costUsd: 0.42, answer: {} });
    return { message: m };
  };
  const out = await agentInbox.handle({ kind: 'plan', params: { question: 'Re-plan #1 and #2' }, reason: 'stale', from: 'oracle', ref: 'm4' }, o.opts);

  assert.equal(out.ok, true);
  assert.equal(out.costUsd, 0.42);
  assert.equal(out.model, 'claude-opus-5-5');
  assert.equal(out.text, 'Stage 2 first.');
  assert.equal(o.history.length, 2, 'the request and the model\'s answer');
  assert.equal(out.ownerTs, o.history[1].ts);
});

test('a judgment request whose model call throws is recorded as Failed at US$ 0', async () => {
  const o = owner({ ask: async () => { throw new Error('Ask a question.'); } });
  const out = await agentInbox.handle({ kind: 'plan', params: {}, from: 'oracle', ref: 'm5' }, o.opts);

  assert.equal(out.ok, false);
  assert.equal(out.error, 'Ask a question.');
  assert.equal(out.costUsd, 0);
  assert.equal(o.history.at(-1).text, 'Failed: Ask a question.');
});

test('a request without a ref still links its request and result by one generated ref', async () => {
  const o = owner();
  const out = await agentInbox.handle({ kind: 'roadmap.add', params: { issues: [1] }, from: 'oracle' }, o.opts);

  assert.ok(out.ref);
  assert.deepEqual(o.history.map((m) => m.request.ref), [out.ref, out.ref]);
});

test('the request line names its sender: the Oracle, another named agent, or another agent', () => {
  assert.equal(agentInbox.requestText({ from: 'oracle', kind: 'run.stop', reason: 'it loops' }), 'Request from the Oracle: run.stop (it loops)');
  assert.equal(agentInbox.requestText({ from: 'night-watch', kind: 'run.stop' }), 'Request from the night-watch: run.stop');
  assert.equal(agentInbox.senderName(''), 'another agent');
});
