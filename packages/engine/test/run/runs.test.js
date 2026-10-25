// Runs on disk for the project view.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runs = require('../../domains/run/runs');
const projects = require('../../domains/project/projects');
const { writeTitle } = require('../../domains/run/run-pr');

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

// ---- owner.json: "running (elsewhere)" vs "interrupted" (#112) ----------------------------------

function unfinishedRun(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-owner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'live1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), jl({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'w', file: 'w.yaml', inputs: {}, mock: true }));
  if (extra.owner) fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify(extra.owner));
  return { root, dir };
}

test('readRun/listRuns: a run with no owner.json (died with the app, before #112, or the owner never wrote one in time) is interrupted', (t) => {
  const { root } = unfinishedRun(t);
  assert.equal(runs.readRun(root, 'live1').status, 'interrupted');
  assert.equal(runs.readRun(root, 'live1').runningElsewhere, null);
  assert.equal(runs.listRuns(root).find((r) => r.runId === 'live1').status, 'interrupted');
});

test('readRun/listRuns: a fresh heartbeat from another live process reads as "running", never "interrupted"', (t) => {
  const { root } = unfinishedRun(t, { owner: { pid: process.ppid, host: os.hostname(), heartbeat_at: new Date().toISOString() } });
  const read = runs.readRun(root, 'live1');
  assert.equal(read.status, 'running');
  assert.deepEqual(read.runningElsewhere, { pid: process.ppid, host: os.hostname() });
  const listed = runs.listRuns(root).find((r) => r.runId === 'live1');
  assert.equal(listed.status, 'running');
  assert.deepEqual(listed.runningElsewhere, { pid: process.ppid, host: os.hostname() });
});

test('readRun/listRuns: this process\'s own ownership reads as "running" with no runningElsewhere (the service already knows its own runs)', (t) => {
  const { root } = unfinishedRun(t, { owner: { pid: process.pid, host: os.hostname(), heartbeat_at: new Date().toISOString() } });
  const read = runs.readRun(root, 'live1');
  assert.equal(read.status, 'running');
  assert.equal(read.runningElsewhere, null);
});

test('readRun/listRuns: a dead owner (stale heartbeat) makes the run interrupted, even if it once had a live one', (t) => {
  const stale = new Date(Date.now() - 60000).toISOString(); // past STALE_MS (30s)
  const { root } = unfinishedRun(t, { owner: { pid: process.ppid, host: os.hostname(), heartbeat_at: stale } });
  assert.equal(runs.readRun(root, 'live1').status, 'interrupted');
  assert.equal(runs.listRuns(root).find((r) => r.runId === 'live1').status, 'interrupted');
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

test('readRun exposes parentRun and childRuns (#174): from summary.json when there is one', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-children-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parentRun = { run_id: 'parent', workflow: 'parent.yaml', step_id: 'child', index: 1, depth: 1 };
  const childRuns = [
    { run_id: 'c1', step_id: 'child', index: 0, workflow: 'child.yaml', status: 'success' },
    { run_id: 'c2', step_id: 'child', index: 1, workflow: 'child.yaml', status: 'running' },
  ];
  fs.mkdirSync(path.join(root, 'parent'));
  fs.writeFileSync(path.join(root, 'parent', 'events.jsonl'), jl({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'parent.yaml' }));
  fs.writeFileSync(path.join(root, 'parent', 'summary.json'), JSON.stringify({ run_id: 'parent', workflow: 'parent.yaml', status: 'running', started_at: '2026-09-27T10:00:00Z', sessions: [], child_runs: childRuns }));
  fs.mkdirSync(path.join(root, 'c1'));
  fs.writeFileSync(path.join(root, 'c1', 'events.jsonl'), jl({ ts: '2026-09-27T10:00:01Z', type: 'workflow.started', workflow: 'child.yaml', parent_run: parentRun }));
  fs.writeFileSync(path.join(root, 'c1', 'summary.json'), JSON.stringify({ run_id: 'c1', workflow: 'child.yaml', status: 'success', started_at: '2026-09-27T10:00:01Z', sessions: [], parent_run: parentRun }));
  assert.deepEqual(runs.readRun(root, 'parent').childRuns, childRuns);
  assert.equal(runs.readRun(root, 'parent').parentRun, null);
  assert.deepEqual(runs.readRun(root, 'c1').parentRun, parentRun);
  assert.equal(runs.readRun(root, 'c1').childRuns, null); // no child_runs: null, not []
});

test('readRun derives parentRun and childRuns from events.jsonl when there is no summary yet (#174)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-children-live-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parentRun = { run_id: 'parent', workflow: 'parent.yaml', step_id: 'child', index: 0, depth: 1 };
  fs.mkdirSync(path.join(root, 'parent'));
  fs.writeFileSync(path.join(root, 'parent', 'events.jsonl'), jl(
    { ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'parent.yaml' },
    { ts: '2026-09-27T10:00:01Z', type: 'workflow.child_started', child_run_id: 'c1', step_id: 'child', index: 0, workflow: 'child.yaml' },
    { ts: '2026-09-27T10:00:01Z', type: 'workflow.child_started', child_run_id: 'c2', step_id: 'child', index: 1, workflow: 'child.yaml' },
    { ts: '2026-09-27T10:00:05Z', type: 'workflow.child_finished', child_run_id: 'c1', status: 'success' },
  ));
  fs.mkdirSync(path.join(root, 'c1'));
  fs.writeFileSync(path.join(root, 'c1', 'events.jsonl'), jl({ ts: '2026-09-27T10:00:01Z', type: 'workflow.started', workflow: 'child.yaml', parent_run: parentRun }));
  assert.deepEqual(runs.readRun(root, 'parent').childRuns, [
    { run_id: 'c1', step_id: 'child', index: 0, workflow: 'child.yaml', status: 'success' },
    { run_id: 'c2', step_id: 'child', index: 1, workflow: 'child.yaml', status: 'running' },
  ]);
  assert.deepEqual(runs.readRun(root, 'c1').parentRun, parentRun);
});

test('readRun exposes childrenCostUsd (#175): from summary.children_cost_usd when there is one, else summed from each child\'s cost_usd', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-children-cost-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const childRuns = [
    { run_id: 'c1', step_id: 'child', index: 0, workflow: 'child.yaml', status: 'success', cost_usd: 0.5 },
    { run_id: 'c2', step_id: 'child', index: 1, workflow: 'child.yaml', status: 'success', cost_usd: 0.25 },
  ];
  fs.mkdirSync(path.join(root, 'with-summary'));
  fs.writeFileSync(path.join(root, 'with-summary', 'events.jsonl'), jl({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'parent.yaml' }));
  fs.writeFileSync(path.join(root, 'with-summary', 'summary.json'), JSON.stringify({ run_id: 'with-summary', workflow: 'parent.yaml', status: 'success', started_at: '2026-09-27T10:00:00Z', sessions: [], child_runs: childRuns, children_cost_usd: 0.75 }));
  assert.equal(runs.readRun(root, 'with-summary').childrenCostUsd, 0.75);

  fs.mkdirSync(path.join(root, 'no-summary'));
  fs.writeFileSync(path.join(root, 'no-summary', 'events.jsonl'), jl(
    { ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'parent.yaml' },
    { ts: '2026-09-27T10:00:01Z', type: 'workflow.child_started', child_run_id: 'c1', step_id: 'child', index: 0, workflow: 'child.yaml' },
    { ts: '2026-09-27T10:00:01Z', type: 'workflow.child_started', child_run_id: 'c2', step_id: 'child', index: 1, workflow: 'child.yaml' },
    { ts: '2026-09-27T10:00:05Z', type: 'workflow.child_finished', child_run_id: 'c1', status: 'success', cost_usd: 0.5 },
    { ts: '2026-09-27T10:00:06Z', type: 'workflow.child_finished', child_run_id: 'c2', status: 'success', cost_usd: 0.25 },
  ));
  assert.equal(runs.readRun(root, 'no-summary').childrenCostUsd, 0.75);

  fs.mkdirSync(path.join(root, 'no-children'));
  fs.writeFileSync(path.join(root, 'no-children', 'events.jsonl'), jl({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'solo.yaml' }));
  assert.equal(runs.readRun(root, 'no-children').childrenCostUsd, 0);
});

test('readRun exposes the saves of its document to its issue (issue-saves.json), [] when there are none', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-issue-saves-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'a'));
  fs.writeFileSync(path.join(root, 'a', 'events.jsonl'), jl({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'writer-reviewer', issues: [{ number: 29, url: 'https://github.com/o/r/issues/29', title: 'T' }] }));
  const saved = [{ number: 29, url: 'https://github.com/o/r/issues/29', mode: 'replace', platform: 'github', at: '2026-09-27T11:00:00Z' }];
  fs.writeFileSync(path.join(root, 'a', 'issue-saves.json'), JSON.stringify(saved));
  fs.mkdirSync(path.join(root, 'b'));
  fs.writeFileSync(path.join(root, 'b', 'events.jsonl'), jl({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'writer-reviewer' }));
  assert.deepEqual(runs.readRun(root, 'a').issueSaves, saved);
  assert.deepEqual(runs.readRun(root, 'b').issueSaves, []);
});

test('readRun exposes the PR from the latest step output with pr_url/pr_number, and the default title from the task', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-pr-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'a'));
  fs.writeFileSync(path.join(root, 'a', 'events.jsonl'), jl(
    { ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'w', inputs: { task: 'Fix the bug' } },
    { ts: '2026-09-27T10:01:00Z', type: 'step.finished', step_id: 'ci', output: { pr_url: 'https://github.com/o/r/pull/42', pr_number: 42 } },
  ));
  const r = runs.readRun(root, 'a');
  assert.deepEqual(r.pr, { number: 42, url: 'https://github.com/o/r/pull/42' });
  assert.equal(r.title, 'Fix the bug');
  assert.equal(r.customTitle, null);
  assert.equal(r.resumedFrom, null);
});

test('readRun: the owner\'s title (meta.json) wins over the default', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-title-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'a'));
  fs.writeFileSync(path.join(root, 'a', 'events.jsonl'), jl({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'w', inputs: { task: 'Fix the bug' } }));
  writeTitle(path.join(root, 'a'), 'Second try after conflict');
  const r = runs.readRun(root, 'a');
  assert.equal(r.title, 'Second try after conflict');
  assert.equal(r.customTitle, 'Second try after conflict');
});

test('readRun: a resumed run without its own PR or title inherits them from the run it resumes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'a'));
  fs.writeFileSync(path.join(root, 'a', 'events.jsonl'), jl(
    { ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'w', inputs: { task: 'Fix the bug' } },
    { ts: '2026-09-27T10:01:00Z', type: 'step.finished', step_id: 'ci', output: { pr_url: 'https://github.com/o/r/pull/42', pr_number: 42 } },
  ));
  writeTitle(path.join(root, 'a'), 'Notifications');
  fs.mkdirSync(path.join(root, 'b'));
  fs.writeFileSync(path.join(root, 'b', 'events.jsonl'), jl(
    { ts: '2026-09-28T10:00:00Z', type: 'workflow.started', workflow: 'w', inputs: { task: 'Fix the bug, again' }, resumed_from: { run_id: 'a', step: 'develop' } },
  ));
  const r = runs.readRun(root, 'b');
  assert.equal(r.resumedFrom, 'a');
  assert.deepEqual(r.pr, { number: 42, url: 'https://github.com/o/r/pull/42' });
  assert.equal(r.title, 'Notifications');
  assert.equal(r.customTitle, 'Notifications');
});

test('writeTitle never touches events.jsonl', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-events-untouched-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'a');
  fs.mkdirSync(dir);
  const eventsPath = path.join(dir, 'events.jsonl');
  fs.writeFileSync(eventsPath, jl({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'w' }));
  const before = fs.readFileSync(eventsPath, 'utf8');
  writeTitle(dir, 'A title');
  assert.equal(fs.readFileSync(eventsPath, 'utf8'), before);
  assert.ok(fs.existsSync(path.join(dir, 'meta.json')));
});

test('runArtifacts never lists meta.json', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-meta-artifact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'a');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
  writeTitle(dir, 'A title');
  const names = runs.runArtifacts(dir).map((a) => a.name);
  assert.ok(!names.includes('meta.json'));
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

test('runEvents with activity keeps a sub-agent call\'s type and description, not its long prompt (#160)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-events-'));
  const s = (seq, item) => ({ seq, type: 'session.stream', session_id: 's1', turn: 1, item });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), jl(
    { seq: 1, type: 'workflow.started', workflow: 'software-development' },
    s(2, { kind: 'tool_call', name: 'Task', input: { subagent_type: 'Explore', description: `Map the login flow ${'x'.repeat(1000)}`, prompt: 'z'.repeat(5000) } }),
    s(3, { kind: 'tool_call', name: 'Agent', input: {} }),
    s(4, { kind: 'tool_call', name: 'Bash', input: { command: 'npm test' } }),
  ));
  const events = runs.runEvents(dir, { activity: true });
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3, 4]);
  assert.deepEqual(Object.keys(events[1].item.input), ['subagent_type', 'description']); // no raw prompt
  assert.equal(events[1].item.input.subagent_type, 'Explore');
  assert.equal(events[1].item.input.description.length, 601); // 600 characters + "…"
  // no subagent_type or description at all: still the compact { subagent_type, description } shape
  assert.deepEqual(events[2].item.input, { subagent_type: undefined, description: '' });
  // an ordinary tool call keeps its usual (JSON string) input
  assert.equal(events[3].item.input, '{"command":"npm test"}');
  fs.rmSync(dir, { recursive: true, force: true });
});

// #201: the run's scratch workspace (<run_dir>/scratch, #120: seeded skills/workflows, Electron
// caches, test workspaces) is not the run's output: no list shows its files, except one an agent
// saved on purpose (file.saved).
test('runArtifacts: files under the run\'s scratch folder are not artifacts, unless an agent saved one on purpose', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'art-scratch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = path.join(root, 'run');
  const seeded = [
    ['scratch', 'workspace', 'skills', 'code-review', 'SKILL.md'],
    ['scratch', 'workspace', 'workflows', 'software-development.yaml'],
    ['scratch', 'user-data', 'Cache', 'data_0'],
    ['scratch', 'ws-1234', 'settings.json'],
  ];
  for (const parts of seeded) {
    fs.mkdirSync(path.join(run, ...parts.slice(0, -1)), { recursive: true });
    fs.writeFileSync(path.join(run, ...parts), 'seeded');
  }
  const kept = path.join(run, 'scratch', 'workspace', 'report.md');
  fs.writeFileSync(kept, '# report');
  fs.mkdirSync(path.join(run, 'arena'), { recursive: true });
  fs.writeFileSync(path.join(run, 'arena', 'final.md'), '# final');
  fs.writeFileSync(path.join(run, 'events.jsonl'), JSON.stringify({ type: 'file.saved', step_id: 'review', agent: 'reviewer', path: kept }) + '\n');

  const list = runs.runArtifacts(run);
  const rels = list.map((a) => path.relative(run, a.path).replace(/\\/g, '/')).sort();
  assert.deepEqual(rels.filter((r) => r.startsWith('scratch/')), ['scratch/workspace/report.md'], 'only the file saved on purpose');
  assert.ok(rels.includes('arena/final.md'), 'the run\'s own outputs are still listed');
  const saved = list.find((a) => a.path === kept);
  assert.equal(saved.step, 'review');
});
