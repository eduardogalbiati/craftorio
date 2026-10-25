// #374, architecture:agents review fixes: a run without a worktree.ready event resolves its agents'
// absolute paths against the project's folder (no uncommitted files: the project's own changes are
// not the run's), and a closed session's agent no longer works on the city.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./helpers');

const T0 = Date.parse('2026-10-13T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();

test('#374 architecture:agents: no worktree → the project folder; closed sessions are not shown', async (t) => {
  const { service, api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agents374-folder-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const project = await api['projects:create']({ name: 'fallback', folder });
  const runId = '20261013-100000-cccc0001';
  const dir = path.join(service.workspace().runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  const edit = (sid, f, s) => ({ ts: at(s), type: 'session.stream', session_id: sid, step_id: 'implement', turn: 1, item: { kind: 'tool_call', name: 'Edit', input: { file_path: path.join(folder, f) } } });
  const opened = (sid, agent, s) => ({ ts: at(s), type: 'session.opened', session_id: sid, step_id: 'implement', session: { agent, step_id: 'implement' } });
  const events = [
    { ts: at(0), type: 'workflow.started', workflow: 'software-development', project_id: project.id, mock: false, inputs: {} },
    opened('s1', 'planner', 1),
    edit('s1', 'docs/plan.md', 2),
    { ts: at(3), type: 'session.closed', session_id: 's1', status: 'done', session: { agent: 'planner' } },
    opened('s2', 'developer', 4),
    edit('s2', 'src/a.js', 5),
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e, i) => JSON.stringify({ seq: i + 1, run_id: runId, ...e })).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: 4242, host: `not-${os.hostname()}`, role: 'run', started_at: at(0), heartbeat_at: new Date().toISOString() }));

  const out = await api['architecture:agents']({ projectId: project.id, runId });
  assert.equal(out.runs.length, 1);
  assert.deepEqual(out.runs[0].agents.map((a) => `${a.agent} ${a.path}`), ['developer src/a.js']);
  assert.deepEqual(out.runs[0].trail, ['docs/plan.md', 'src/a.js']);
  assert.deepEqual(out.runs[0].dirty, []);
  assert.deepEqual(out.replay.touches.map((x) => x.path), ['docs/plan.md', 'src/a.js']);
});
