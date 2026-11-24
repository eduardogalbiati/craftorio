const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../../engine/workflow');
const evidence = require('../../domains/evidence/evidence');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';
const { root, retro, runsWith, runWriterReviewer, arenaRun, backlogRefreshRun, until } = require('../engine-helpers');

test('a run input defaults to the latest run of another workflow', (t) => {
  const runsDir = runsWith(t, [
    ['20260927-101010-aaaaaaaa', 'software-development'],
    ['20260928-101010-bbbbbbbb', 'ai-arena'],
    ['20260929-101010-cccccccc', 'retrospective'], // a retrospective itself is skipped (#631: retrospective.yaml is named retrospective)
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
test('writer-reviewer: agents take provider, model and effort from the inputs', () => {
  const run = new WorkflowRun({
    file: path.join(__dirname, '..', 'fixtures', 'legacy', 'writer-reviewer.yaml'), // #648: left workflows/
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
    // what comes before the review (#63: the platform repository) is in backlog-refresh-platform-repo-63-65
    assert.deepEqual(transitions.slice(-2), ['review>scope', 'scope>end']);
    const gate =events.find((e) => e.type === 'approval.requested');
    assert.deepEqual(gate.choices.map((c) => c.id), ['apply', 'skip']); // the supervisor never answers this gate
    const actions = events.filter((e) => e.type === 'action.executed' && /--mode (?:safe|scope)/.test(e.command));
    assert.equal(actions.length, 2); // safe mode before the gate, scope mode after Apply
    assert.ok(actions.every((a) => a.skipped), 'mock mode never runs the action');
    // the project is quoted for the platform's shell (shell_quote: "…" on Windows, '…' elsewhere, #769)
    assert.match(actions[0].command, /apply\.js" --platform gh --mode safe --file ".*refresh\.json" --project (?:"C:\/proj"|'C:\/proj') --run-id /);
    assert.match(actions[1].command, /apply\.js" --platform gh --mode scope --file ".*refresh\.json" --project (?:"C:\/proj"|'C:\/proj') --run-id /);
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
    assert.deepEqual(transitions.slice(-2), ['review>scope', 'scope>end']);
    const actions = events.filter((e) => e.type === 'action.executed' && /--mode (?:safe|scope)/.test(e.command));
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
