// Runs on disk for the project view.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runs = require('../src/runs');
const projects = require('../src/projects');

const jl = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
const snap = (id, agent, extra = {}) => ({ id, agent, provider: 'claude', model: 'm', status: 'idle', turns: 1, tokens: { input: 10, output: 5 }, cost_usd: 0.5, provider_session_id: `p-${id}`, ...extra });

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const add = (id, events, summary) => {
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, id, 'events.jsonl'), jl(...events));
    if (summary) fs.writeFileSync(path.join(root, id, 'summary.json'), JSON.stringify(summary));
  };
  // finished run, recorded with a project id
  add('r1', [
    { ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'ai-arena', version: '0.6.1', file: 'ai-arena.yaml', project_id: 'proj', inputs: { task: 'Write a PRD', project_path: path.join(root, 'elsewhere') }, mock: false },
    { ts: '2026-09-27T10:05:00Z', type: 'workflow.finished', status: 'failed', error: 'verify failed' },
  ], { run_id: 'r1', workflow: 'ai-arena', project_id: 'proj', status: 'failed', started_at: '2026-09-27T10:00:00Z', finished_at: '2026-09-27T10:05:00Z', duration_ms: 300000, inputs: { task: 'Write a PRD' }, sessions: [snap('orchestrator', 'orchestrator'), snap('s1', 'opus')] });
  // run that died with the app: rebuilt from events, matched by an old folder
  add('r2', [
    { ts: '2026-09-26T09:00:00Z', type: 'workflow.started', workflow: 'software-development', version: '0.7.0', file: 'software-development.yaml', inputs: { task: 'Fix the bug', repo_path: path.join(root, 'old-folder') }, mock: true },
    { ts: '2026-09-26T09:00:01Z', type: 'session.opened', session_id: 's1', session: snap('s1', 'developer', { provider_session_id: null, status: 'idle' }) },
    { ts: '2026-09-26T09:00:02Z', type: 'session.status', session_id: 's1', status: 'active' },
    { ts: '2026-09-26T09:00:30Z', type: 'session.message_received', session_id: 's1', session: snap('s1', 'developer', { status: 'idle' }) },
    { ts: '2026-09-26T09:00:31Z', type: 'session.status', session_id: 's1', status: 'active' },
  ]);
  // another project's run, and a folder that is not a run
  add('r3', [{ ts: '2026-09-25T09:00:00Z', type: 'workflow.started', workflow: 'x', inputs: { repo_path: path.join(root, 'other-project') } }]);
  fs.mkdirSync(path.join(root, 'not-a-run'));
  return root;
}

test('listRuns reads finished runs from summary.json and rebuilds interrupted ones from events', (t) => {
  const list = runs.listRuns(workspace(t));
  assert.deepEqual(list.map((r) => r.runId), ['r1', 'r2', 'r3']); // newest first, non-runs skipped
  const [r1, r2] = list;
  assert.equal(r1.status, 'failed');
  assert.equal(r1.error, 'verify failed');
  assert.equal(r1.file, 'ai-arena.yaml');
  assert.equal(r1.projectId, 'proj');
  assert.equal(r1.costUsd, 1);
  assert.equal(r1.task, 'Write a PRD');
  assert.equal(r2.status, 'interrupted');
  assert.equal(r2.mock, true);
  assert.equal(r2.sessions.length, 1);
  assert.equal(r2.sessions[0].status, 'active'); // last session.status wins
  assert.equal(r2.sessions[0].provider_session_id, 'p-s1');
});

test('readRun gives the issues a run implements; a run recorded with one `issue` still loads as a list of one', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-issues-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ref = (n) => ({ number: n, url: `https://github.com/o/r/issues/${n}`, title: `T${n}` });
  const add = (id, started, summary) => {
    fs.mkdirSync(path.join(root, id));
    fs.writeFileSync(path.join(root, id, 'events.jsonl'), jl({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'w', ...started }));
    if (summary) fs.writeFileSync(path.join(root, id, 'summary.json'), JSON.stringify({ run_id: id, workflow: 'w', status: 'success', started_at: '2026-09-27T10:00:00Z', sessions: [], ...summary }));
  };
  add('group', { issues: [ref(53), ref(65)] }, { issues: [ref(53), ref(65)] });
  add('old-finished', { issue: ref(7) }, { issue: ref(7) });
  add('old-interrupted', { issue: ref(8) });
  add('none', {});
  assert.deepEqual(runs.readRun(root, 'group').issues, [ref(53), ref(65)]);
  assert.deepEqual(runs.readRun(root, 'old-finished').issues, [ref(7)]);
  assert.deepEqual(runs.readRun(root, 'old-interrupted').issues, [ref(8)]);
  assert.equal(runs.readRun(root, 'none').issues, null);
});

test('runsForProject matches the project id, then the current or previous folders', (t) => {
  const root = workspace(t);
  const list = runs.listRuns(root);
  const project = { id: 'proj', folder: path.join(root, 'new-folder'), previousFolders: [path.join(root, 'old-folder')] };
  assert.deepEqual(runs.runsForProject(list, project).map((r) => r.runId), ['r1', 'r2']);
  assert.deepEqual(runs.runsForProject(list, { id: 'other', folder: path.join(root, 'old-folder') }).map((r) => r.runId), ['r2']);
});

test('projectOf finds the project a run belongs to, by id or by folder, or null', (t) => {
  const root = workspace(t);
  const [r1, r2, r3] = runs.listRuns(root);
  const app = { id: 'app', name: 'App', folder: path.join(root, 'old-folder') };
  const proj = { id: 'proj', name: 'Proj', folder: path.join(root, 'elsewhere') };
  assert.equal(runs.projectOf(r1, [app, proj]).name, 'Proj');
  assert.equal(runs.projectOf(r2, [app, proj]).name, 'App');
  assert.equal(runs.projectOf(r3, [app, proj]), null);
  assert.equal(runs.projectOf(r1, [app]), null); // its project was removed
});

test('updateProject remembers the previous folder', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = await projects.createProject(dir, { name: 'App' });
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'other-'));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  const q = projects.updateProject(dir, p.id, { folder: other });
  assert.equal(q.folder, path.resolve(other));
  assert.deepEqual(q.previousFolders, [p.folder]);
});

test('runArtifacts lists saved files (also outside the run folder) and other run files, not the logs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = path.join(root, 'run');
  const external = path.join(root, 'project', 'docs', 'prd.md');
  fs.mkdirSync(path.join(run, 'arena', 'reviews'), { recursive: true });
  fs.mkdirSync(path.join(run, 'sessions'), { recursive: true });
  fs.mkdirSync(path.dirname(external), { recursive: true });
  fs.writeFileSync(path.join(run, 'arena', 'final.md'), '# PRD');
  fs.writeFileSync(path.join(run, 'arena', 'reviews', 'gpt.json'), '{}');
  fs.writeFileSync(path.join(run, 'decisions.tsv'), 'ts\tagent\n');
  fs.writeFileSync(path.join(run, 'summary.json'), '{}');
  fs.writeFileSync(path.join(run, 'sessions', 's1.jsonl'), '');
  fs.writeFileSync(external, '# PRD');
  fs.writeFileSync(path.join(run, 'events.jsonl'), [
    { type: 'file.saved', step_id: 'synthesize', agent: 'synthesizer', path: path.join(run, 'arena', 'final.md') },
    { type: 'file.saved', step_id: 'synthesize', agent: 'synthesizer', path: external },
    { type: 'file.saved', step_id: 'old', agent: 'x', path: path.join(root, 'gone.md') },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');

  const list = runs.runArtifacts(run);
  const by = Object.fromEntries(list.map((a) => [a.name + ':' + a.location, a]));
  assert.deepEqual(Object.keys(by).sort(), ['decisions.tsv:run', 'final.md:run', 'gone.md:external', 'gpt.json:run', 'prd.md:external']);
  assert.equal(by['final.md:run'].step, 'synthesize');
  assert.equal(by['final.md:run'].kind, 'markdown');
  assert.equal(by['final.md:run'].rel, path.join('arena', 'final.md'));
  assert.equal(by['gpt.json:run'].kind, 'json');
  assert.equal(by['decisions.tsv:run'].kind, 'table');
  assert.equal(by['prd.md:external'].rel, external);
  assert.equal(by['gone.md:external'].exists, false);
});

test('runEvents returns the events to replay a run, without the streamed CLI output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-events-'));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), jl(
    { seq: 1, type: 'workflow.started', workflow: 'writer-reviewer' },
    { seq: 2, type: 'session.stream', item: { kind: 'text', text: 'x' } },
    { seq: 3, type: 'step.finished', step_id: 'write', output: { document: '# Doc' } },
  ) + 'not json\n');
  assert.deepEqual(runs.runEvents(dir).map((e) => e.seq), [1, 3]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runEvents with activity keeps tool calls and thinking, compacted, and drops the streamed text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-events-'));
  const s = (seq, turn, item, session_id = 's1') => ({ seq, type: 'session.stream', session_id, turn, item });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), jl(
    { seq: 1, type: 'workflow.started', workflow: 'software-development' },
    s(2, 1, { kind: 'thinking', text: 'Read ' }),
    s(3, 1, { kind: 'text', text: 'partial answer' }),
    s(4, 1, { kind: 'thinking', text: 'the tests.' }),
    s(5, 1, { kind: 'tool_call', name: 'Bash', input: { command: 'npm test', pad: 'x'.repeat(2000) } }),
    s(6, 1, { kind: 'tool_result', is_error: true, output: 'y'.repeat(5000) }),
    s(7, 1, { kind: 'tool_result', output: 'ok' }),
    s(8, 1, { kind: 'thinking', text: 'z'.repeat(5000) }),
    s(9, 1, { kind: 'usage', usage: { input: 1 } }),
    s(10, 2, { kind: 'stderr', text: 'warn' }),
    { seq: 11, type: 'session.message_received', session_id: 's1', turn: 1, text: 'Done.' },
  ));
  const events = runs.runEvents(dir, { activity: true });
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 5, 6, 8, 11]);
  assert.deepEqual(events[1].item, { kind: 'thinking', text: 'Read the tests.' });
  assert.equal(events[2].item.name, 'Bash');
  assert.equal(events[2].item.input.length, 601); // 600 characters + "…"
  assert.ok(events[2].item.input.startsWith('{"command":"npm test"'));
  assert.deepEqual(events[3].item, { kind: 'tool_result', is_error: true });
  assert.equal(events[4].item.text.length, 4001);
  // without the option nothing streamed comes back
  assert.deepEqual(runs.runEvents(dir).map((e) => e.seq), [1, 11]);
  fs.rmSync(dir, { recursive: true, force: true });
});
