// #374, architecture:agents beyond its acceptance tests: runs in progress seeded on disk (an owner on
// another host with a fresh heartbeat, as a run in another app), their agents, trails, uncommitted
// files and collisions; another project's run is not shown; a finished run is only in a replay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRepo, makeService } = require('@craftorio/engine/test/service/helpers');

const T0 = Date.parse('2026-10-13T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();

// a run of `projectId` whose `agent` (step `step`) edits `files` in `worktree`; `finished`: with a summary
// `workDir`: the project's folder inside the worktree (default: the worktree itself)
function seedRun(runsDir, runId, { projectId, worktree, workDir = worktree, agent, step, files, finished = false }) {
  const dir = path.join(runsDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  const sid = `s-${runId}`;
  const events = [
    { ts: at(0), type: 'workflow.started', workflow: 'software-development', project_id: projectId, mock: false, inputs: {} },
    { ts: at(1), type: 'worktree.ready', dir: worktree, work_dir: workDir },
    { ts: at(2), type: 'session.opened', session_id: sid, step_id: step, session: { agent, step_id: step, provider: 'claude', model: 'claude-opus-5-5' } },
    ...files.map((f, i) => ({ ts: at(3 + i), type: 'session.stream', session_id: sid, step_id: step, turn: 1, item: { kind: 'tool_call', name: 'Edit', input: { file_path: path.join(workDir, f) } } })),
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e, i) => JSON.stringify({ seq: i + 1, run_id: runId, ...e })).join('\n')}\n`);
  if (finished) {
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ workflow: 'software-development', status: 'success', mock: false, project_id: projectId, started_at: at(0), finished_at: at(60), sessions: [] }));
  } else {
    fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: 4242, host: `not-${os.hostname()}`, role: 'run', started_at: at(0), heartbeat_at: new Date().toISOString() }));
  }
}

async function setup(t) {
  const { service, api } = makeService(t);
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'agents', folder: repo.dir });
  const other = await api['projects:create']({ name: 'other', folder: fs.mkdtempSync(path.join(os.tmpdir(), 'agents374-other-')) });
  t.after(() => fs.rmSync(other.folder, { recursive: true, force: true }));
  return { api, runsDir: service.workspace().runs, repo, projectId: project.id, otherId: other.id };
}

test('#374 architecture:agents: the runs in progress of the project, their agents, trails, uncommitted files and collisions', async (t) => {
  const { api, runsDir, repo, projectId, otherId } = await setup(t);
  // the first run's worktree is a git repository with an uncommitted change
  fs.appendFileSync(path.join(repo.dir, 'a.txt'), 'more\n');
  seedRun(runsDir, '20261013-100000-aaaa0001', { projectId, worktree: repo.dir, agent: 'developer', step: 'implement', files: ['src/x.js', 'src/shared.js'] });
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'agents374-wt-'));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  seedRun(runsDir, '20261013-100500-aaaa0002', { projectId, worktree: plain, agent: 'refactorer', step: 'refactor', files: ['src/shared.js'] });
  seedRun(runsDir, '20261013-101000-aaaa0003', { projectId: otherId, worktree: plain, agent: 'tester', step: 'write_tests', files: ['src/shared.js'] });
  seedRun(runsDir, '20261013-090000-aaaa0004', { projectId, worktree: plain, agent: 'developer', step: 'implement', files: ['src/old.js'], finished: true });

  const out = await api['architecture:agents']({ projectId });
  assert.deepEqual(out.runs.map((r) => r.id), ['20261013-100000-aaaa0001', '20261013-100500-aaaa0002']);
  const [one, two] = out.runs;
  assert.notEqual(one.colour, two.colour);
  assert.deepEqual(one.agents.map((a) => `${a.agent} · ${a.step} ${a.kind} ${a.path}`), ['developer · implement change src/shared.js']);
  assert.deepEqual(one.trail, ['src/x.js', 'src/shared.js']);
  assert.deepEqual(one.dirty, ['a.txt']);
  assert.deepEqual(two.dirty, [], 'a folder that is not a git worktree has no uncommitted file');
  assert.deepEqual(out.collisions, [{ path: 'src/shared.js', runs: ['20261013-100000-aaaa0001', '20261013-100500-aaaa0002'] }]);
  assert.equal(out.replay, undefined);
});

test('#374 architecture:agents: a project in a subfolder of the worktree gets its uncommitted files on the same base as its touches', async (t) => {
  const { api, runsDir, repo, projectId } = await setup(t);
  const workDir = path.join(repo.dir, 'app');
  fs.mkdirSync(path.join(workDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workDir, 'src', 'new.js'), 'new\n'); // new, inside the project's folder
  fs.appendFileSync(path.join(repo.dir, 'a.txt'), 'more\n'); // changed, outside it: not the project's
  seedRun(runsDir, '20261013-100000-bbbb0001', { projectId, worktree: repo.dir, workDir, agent: 'developer', step: 'implement', files: ['src/new.js'] });

  const [run] = (await api['architecture:agents']({ projectId })).runs;
  assert.deepEqual(run.agents.map((a) => a.path), ['src/new.js']);
  assert.deepEqual(run.dirty, ['src/new.js']);
});

test('#374 architecture:agents with a runId: that run\'s touches for the replay; a run of another project is refused', async (t) => {
  const { api, runsDir, projectId, otherId } = await setup(t);
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'agents374-wt-'));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  seedRun(runsDir, '20261013-090000-bbbb0001', { projectId, worktree: wt, agent: 'developer', step: 'implement', files: ['src/a.js', 'src/b.js'], finished: true });
  seedRun(runsDir, '20261013-090000-bbbb0002', { projectId: otherId, worktree: wt, agent: 'developer', step: 'implement', files: ['src/c.js'], finished: true });
  const out = await api['architecture:agents']({ projectId, runId: '20261013-090000-bbbb0001' });
  assert.deepEqual(out.runs, [], 'a finished run is not in progress');
  assert.equal(out.replay.runId, '20261013-090000-bbbb0001');
  assert.deepEqual(out.replay.touches.map((x) => `${x.kind} ${x.path}`), ['change src/a.js', 'change src/b.js']);
  await assert.rejects(() => api['architecture:agents']({ projectId, runId: '20261013-090000-bbbb0002' }), /Unknown run of this project/);
});
