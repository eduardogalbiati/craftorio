const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeResumeService } = require('./helpers');

// #93: sessionView carries tokens for a live run and a recorded one.
test('the agents table carries each session\'s tokens, live while the run goes and from disk once recorded', async (t) => {
  const { service, api } = makeResumeService(t);
  let live;
  let liveP = Promise.resolve();
  const finished = new Promise((resolve) => {
    service.events.on('run:event', (ev) => {
      if (ev.type === 'session.message_received' && ev.session.agent === 'a' && !live) {
        liveP = api['runs:list']().then((list) => { live = list.runs.find((r) => r.status === 'running')?.sessions.find((s) => s.agent === 'a'); });
      }
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
      if (ev.type === 'workflow.finished') resolve();
    });
  });
  const { runId } = await api['run:start']({ file: 'fixture-resume.yaml', inputs: {}, mock: true });
  await finished;
  await liveP;

  assert.ok(live?.tokens, 'a live session already carries its tokens');
  assert.equal(live.tokens.total, live.tokens.input + live.tokens.output + live.tokens.cache_read + live.tokens.cache_write, 'reasoning is not counted twice');

  const recorded = (await api['runs:list']()).runs.find((r) => r.runId === runId).sessions.find((s) => s.agent === 'a');
  assert.ok(recorded.tokens.total > 0, 'the finished run still carries the tokens, read back from disk');
  assert.deepEqual(Object.keys(recorded.tokens).sort(), ['cache_read', 'cache_write', 'input', 'output', 'reasoning', 'total'].sort());
});

test('a session with no tokens shows null; non-numeric token values never become NaN', async (t) => {
  const { api, service } = makeResumeService(t);
  const ws = service.workspace();
  const runId = '20260101-000000-tokens0001';
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'fixture-resume', file: 'fixture-resume.yaml', status: 'success', mock: true,
    started_at: '2026-01-01T00:00:00Z', finished_at: '2026-01-01T00:05:00Z', inputs: {},
    sessions: [
      { id: 's1', agent: 'orchestrator', provider: 'mock', model: 'm', status: 'closed', turns: 0, cost_usd: 0 }, // no tokens field
      { id: 's2', agent: 'a', provider: 'mock', model: 'm', status: 'closed', turns: 1, cost_usd: 0,
        tokens: { input: '12', output: null, cache_read: undefined, cache_write: NaN, reasoning: 5 } },
    ],
  }));

  const sessions = (await api['runs:list']()).runs.find((r) => r.runId === runId).sessions;
  assert.equal(sessions.find((s) => s.agent === 'orchestrator').tokens, null);
  assert.deepEqual(sessions.find((s) => s.agent === 'a').tokens, { input: 12, output: 0, cache_read: 0, cache_write: 0, reasoning: 5, total: 12 });
});
