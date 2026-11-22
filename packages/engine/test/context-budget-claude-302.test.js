// Internal details of #302 through a fake Claude Code CLI: an error_max_turns result is a cut, not a
// failed attempt; the wrap-up resumes the same CLI session with a small --max-turns; the continuation
// starts a fresh CLI session.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');

const argAfter = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

// One run of a one-step workflow whose "CLI" is node + a fake that calls no model (the
// simulation-only guard is lifted for the test). agent: the YAML flow map of the agent `dev`.
async function fakeRun(t, fixture, agent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-claude-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const saved = {};
  for (const k of ['CRAFTORIO_SIMULATION_ONLY', 'CRAFTORIO_WORKSPACE', 'CRAFTORIO_USER_DATA']) { saved[k] = process.env[k]; delete process.env[k]; }
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v !== undefined) process.env[k] = v; } });
  const fake = path.join(__dirname, 'fixtures', fixture).replace(/\\/g, '/');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${fake}", "-p"], resume_args: ["--resume", "{{ session_id }}"] }`,
    'agents:',
    `  dev: ${agent}`,
    'steps:',
    '  - { id: work, agent: dev, supervise: false, prompt: "Do it." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, runsDir: path.join(dir, 'runs') });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const spawns = events.filter((e) => e.type === 'session.stream' && e.item.kind === 'spawn').map((e) => e.item.args);
  return { events, finished, spawns };
}

test('claude-code: an error_max_turns result is cut, wrapped up over --resume, and continued in a fresh CLI session', { timeout: 30000 }, async (t) => {
  const { events, finished, spawns } = await fakeRun(t, 'fake-claude-max-turns.js', '{ provider: claude, model: fake, session: handoff, max_requests: 3, capabilities: { tools: [read] } }');
  assert.equal(finished.status, 'success', finished.error);

  assert.equal(spawns.length, 3, 'the cut turn, its wrap-up, the continuation');
  assert.equal(argAfter(spawns[0], '--max-turns'), '3');
  assert.equal(argAfter(spawns[1], '--resume'), '00000000-0000-4000-8000-000000000001');
  assert.equal(spawns[1].filter((a) => a === '--max-turns').length, 1, 'one --max-turns on the wrap-up');
  assert.equal(argAfter(spawns[1], '--max-turns'), '10');
  assert.equal(spawns[2].includes('--resume'), false);

  const cut = events.find((e) => e.type === 'session.message_received' && e.cut);
  assert.equal(cut.requests, 3);
  assert.equal(events.some((e) => e.type === 'log' && /attempt \d+\/\d+ failed/.test(e.message || '')), false);
  const per = finished.summary.context.agents.dev.per_turn;
  assert.deepEqual(per.map((p) => Boolean(p.cut)), [true, false]);
});

test('claude-code: a --max-turns of the agent\'s own cli_args (no max_requests) still fails the attempt, with no wrap-up', { timeout: 30000 }, async (t) => {
  const { events, finished, spawns } = await fakeRun(t, 'fake-claude-max-turns.js', '{ provider: claude, model: fake, session: handoff, cli_args: ["--max-turns", "5"], capabilities: { tools: [read] } }');
  assert.notEqual(finished.status, 'success');
  assert.equal(spawns.length, 1, 'no wrap-up, no continuation');
  assert.equal(argAfter(spawns[0], '--max-turns'), '5');
  const failed = events.filter((e) => e.type === 'log' && /attempt 1\/1 failed/.test(e.message || ''));
  assert.equal(failed.length, 1);
  assert.match(failed[0].message, /error_max_turns/);
  assert.equal(events.some((e) => e.type === 'log' && e.kind === 'context_budget'), false);
  assert.equal(events.some((e) => e.type === 'session.message_received' && e.cut), false);
});

test('claude-code: a wrap-up that runs out of its own requests leaves the fallback note, and the step still continues', { timeout: 30000 }, async (t) => {
  const { events, finished, spawns } = await fakeRun(t, 'fake-claude-wrapup-cut.js', '{ provider: claude, model: fake, session: handoff, max_requests: 3, capabilities: { tools: [read] } }');
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(spawns.length, 3, 'the cut turn, its wrap-up, the continuation');
  const saved = events.filter((e) => e.type === 'handoff.saved');
  assert.ok(saved.length >= 1);
  assert.equal(saved[0].fallback, true, 'the wrap-up wrote no note: the engine saves its own');
  const continued = events.filter((e) => e.type === 'session.message_sent' && /continued after 3 requests/.test(e.prompt || ''));
  assert.equal(continued.length, 1);
  assert.match(continued[0].prompt, /No handoff note/);
  assert.equal(events.filter((e) => e.type === 'log' && e.kind === 'context_budget').length, 1, 'the wrap-up\'s own cut is not a second budget cut');
});
