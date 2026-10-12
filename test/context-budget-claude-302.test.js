// Internal details of #302 through a fake Claude Code CLI: an error_max_turns result is a cut, not a
// failed attempt; the wrap-up resumes the same CLI session with a small --max-turns; the continuation
// starts a fresh CLI session.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');

const argAfter = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

test('claude-code: an error_max_turns result is cut, wrapped up over --resume, and continued in a fresh CLI session', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-claude-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // the "CLI" is node + a fake that calls no model: lift the simulation-only guard for this test
  const saved = {};
  for (const k of ['MULTIAGENT_SIMULATION_ONLY', 'MULTIAGENT_WORKSPACE', 'MULTIAGENT_USER_DATA']) { saved[k] = process.env[k]; delete process.env[k]; }
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v !== undefined) process.env[k] = v; } });
  const fake = path.join(__dirname, 'fixtures', 'fake-claude-max-turns.js').replace(/\\/g, '/');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${fake}", "-p"], resume_args: ["--resume", "{{ session_id }}"] }`,
    'agents:',
    '  dev: { provider: claude, model: fake, session: handoff, max_requests: 3, capabilities: { tools: [read] } }',
    'steps:',
    '  - { id: work, agent: dev, prompt: "Do it." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, runsDir: path.join(dir, 'runs') });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const spawns = events.filter((e) => e.type === 'session.stream' && e.item.kind === 'spawn').map((e) => e.item.args);
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
