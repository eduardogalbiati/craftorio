const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, takeHandoff, parseTokens } = require('../src/engine/workflow');
const { Recorder } = require('../src/engine/recorder');
const supervisor = require('../src/supervisor');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const FIXTURE = path.join(__dirname, 'fixtures', 'handoff.yaml');
const VERDICTS = { verdict: ['changes_requested', 'changes_requested', 'approved'] };

async function runFixture(t, opts = {}) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  const run = new WorkflowRun({ file: FIXTURE, inputs: {}, mock: true, runsDir, mockSequences: VERDICTS, ...opts });
  const rec = new Recorder(run.runDir);
  const events = [];
  run.on('event', (ev) => { rec.write(ev); events.push(ev); });
  await run.start(); // the recorder writes events.jsonl synchronously (#262): complete here
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const sessionsOf = (agent) => events.filter((e) => e.type === 'session.opened' && e.session.agent === agent);
  const sentBy = (agent) => {
    const ids = new Set(sessionsOf(agent).map((e) => e.session_id));
    return events.filter((e) => e.type === 'session.message_sent' && ids.has(e.session_id));
  };
  return { run, events, finished, sessionsOf, sentBy };
}

test('takeHandoff removes the last ```handoff block from an answer; parseTokens reads 150k', () => {
  const [text, note] = takeHandoff('Done.\n\n```handoff\n- Goal: x\n```\n\n```json\n{"a":1}\n```');
  assert.equal(note, '- Goal: x');
  assert.equal(text, 'Done.\n\n```json\n{"a":1}\n```');
  assert.deepEqual(takeHandoff('no note'), ['no note', null]);
  assert.equal(parseTokens('150k'), 150000);
  assert.equal(parseTokens('1.2m'), 1200000);
  assert.equal(parseTokens(90000), 90000);
  assert.equal(parseTokens('lots'), null);
});

test('handoff sessions: every turn is a fresh session that starts from the agent\'s latest note', { timeout: 60000 }, async (t) => {
  const { run, events, sessionsOf, sentBy } = await runFixture(t);

  assert.equal(sessionsOf('developer').length, 3, 'one session per turn');
  assert.ok(sessionsOf('developer').every((e) => e.session.mode === 'handoff'));
  const prompts = sentBy('developer').map((e) => e.prompt);
  assert.equal(prompts.length, 3);
  assert.ok(!prompts[0].includes('<handoff_note>'), 'the first turn has no note yet');
  for (const p of prompts.slice(1)) {
    assert.match(p, /^<system>\nYou are the developer\./, 'a fresh session gets the system prompt again');
    assert.match(p, /<handoff_note>\n- Goal: simulated goal/);
    assert.match(p, /\(step develop, visit \d\)/);
  }
  assert.ok(prompts.every((p) => p.includes('write a ```handoff block')), 'every turn asks for a note');
  assert.ok(prompts.every((p) => p.includes('Write the note in English')), 'the note is asked for in English, whatever the project or the conversation use');

  // the answers come back without the note; the notes are files in the run, one per turn
  for (const e of events.filter((x) => x.type === 'session.message_received')) assert.ok(!e.text.includes('```handoff'));
  const files = fs.readdirSync(path.join(run.runDir, 'handoffs')).sort();
  assert.deepEqual(files, ['develop-v1-developer.md', 'develop-v2-developer.md', 'develop-v3-developer.md', 'review-v1-reviewer.md', 'review-v2-reviewer.md', 'review-v3-reviewer.md']);
  assert.match(fs.readFileSync(path.join(run.runDir, 'handoffs', 'develop-v2-developer.md'), 'utf8'), /^# Handoff note: developer\n\n_Step develop, visit 2/);
  assert.equal(events.filter((e) => e.type === 'handoff.saved').length, 6);
});

test('persistent with max_context: the turn after one that ends above it starts a fresh session with the note', { timeout: 60000 }, async (t) => {
  const { events, finished, sessionsOf, sentBy } = await runFixture(t);

  // mock context: 20k at the start of a conversation, +30k per turn, peak +20k → turn 2 peaks at 70k > 60k
  assert.equal(sessionsOf('reviewer').length, 2);
  const prompts = sentBy('reviewer');
  assert.deepEqual(prompts.map((e) => e.turn), [1, 2, 1]);
  assert.ok(!prompts[1].prompt.includes('<system>'), 'same conversation: no system prompt again');
  assert.match(prompts[2].prompt, /^<system>\nYou are the reviewer\.[\s\S]*<handoff_note>/);
  const rotation = events.filter((e) => e.type === 'log' && e.kind === 'context_rotation');
  assert.equal(rotation.length, 1);
  assert.match(rotation[0].message, /\[reviewer\] context reached 70k \(max_context 60k\)/);

  // metrics per agent: context at the start and peak of each turn
  const rev = finished.summary.context.agents.reviewer;
  assert.deepEqual(rev.per_turn.map((x) => [x.start, x.peak]), [[20000, 40000], [50000, 70000], [20000, 40000]]);
  assert.equal(rev.peak, 70000);
  assert.equal(rev.fresh_sessions, 2);
  assert.equal(finished.summary.context.agents.developer.fresh_sessions, 3);
  assert.equal(finished.summary.context.waste_tokens, 0);
});

test('a turn that forgets its note gets one follow-up asking only for it, when the next turn needs it', { timeout: 60000 }, async (t) => {
  const { run, events, sentBy } = await runFixture(t, { mockSequences: { ...VERDICTS, no_handoff: { develop: 1, review: 2 } } });

  const followUps = events.filter((e) => e.type === 'session.message_sent' && e.prompt.startsWith('Write only your ```handoff block'));
  // developer (handoff) turn 1, and the reviewer's 2nd turn (above max_context); not its 1st (nothing needs it yet)
  assert.equal(followUps.length, 2);
  assert.equal(sentBy('developer').filter((e) => e.prompt.startsWith('Write only')).length, 1);
  const files = fs.readdirSync(path.join(run.runDir, 'handoffs'));
  assert.ok(files.includes('develop-v1-developer.md'));
  assert.ok(!files.includes('review-v1-reviewer.md'), 'a persistent turn without a note: nothing to save');
  assert.ok(files.includes('review-v2-reviewer.md'));
});

test('a resumed run starts its agents from the previous run\'s handoff notes', { timeout: 60000 }, async (t) => {
  const note = { text: '- Goal: NOTE FROM THE PREVIOUS RUN', step: 'develop', visit: 2 };
  const { sentBy } = await runFixture(t, { resume: { runId: 'prev', fromStep: 'develop', steps: {}, sessions: {}, handoffs: { developer: note } } });
  assert.match(sentBy('developer')[0].prompt, /<handoff_note>\n- Goal: NOTE FROM THE PREVIOUS RUN\n<\/handoff_note>/);
});

test('resumeSpec and the supervisor\'s report read the handoff notes from the run\'s events', { timeout: 60000 }, async (t) => {
  const { run } = await runFixture(t);
  const spec = supervisor.resumeSpec(run.runDir, 'develop');
  assert.deepEqual(Object.keys(spec.handoffs).sort(), ['developer', 'reviewer']);
  assert.equal(spec.handoffs.developer.step, 'develop');
  assert.equal(spec.handoffs.developer.visit, 3);
  assert.match(spec.handoffs.developer.text, /^- Goal: simulated goal/);
  const report = supervisor.runReport(run.runDir, { workflowsDir: path.dirname(FIXTURE) });
  assert.match(report, /## Handoff notes[\s\S]*### developer \(step develop, visit 3\)/);
});
