// Acceptance tests for #605 / #446 (written before the code): the one-time move of a leftover plain
// queue. A project whose backlog/<project>.queue.json still has items gets them as ONE planned roadmap
// stage at the end (the rule roadmap:from-queue follows today: one roadmap item per queue item, a
// group staying one item, with its workflow, inputs and mock), the queue's pause dropped (the roadmap
// is a plan, not paused); afterwards the queue file is never read again: opening the workspace again
// does not add another stage.
// Assumed seam: the move happens when the service opens the workspace (setWorkspace) or, at the
// latest, on the first roadmap read (roadmap:get). The test writes the queue file while no service has
// the workspace open, then opens it in a fresh service and reads roadmap:get, so either place works.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService } = require('../../service');
const { setupWorkspace } = require('../../domains/workspace/workspace');
const { ISSUE_WORKFLOW, roadmapIssue } = require('./helpers');

// Every service opened by the test is closed before its folders go (one after hook, in this order).
function harness(t) {
  const closers = [];
  const folders = [];
  t.after(() => {
    for (const close of closers) close();
    for (const f of folders) fs.rmSync(f, { recursive: true, force: true });
  });
  const tmp = (prefix) => { const f = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); folders.push(f); return f; };
  function openService(dir) {
    const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, cliHome: tmp('queue-move-cli-') } });
    let open = true;
    const close = () => { if (open) { open = false; service.shutdown(); } };
    closers.push(close);
    service.setWorkspace(setupWorkspace(dir, { persist: false }));
    return { api: service.api, close, workspace: () => service.workspace() };
  }
  return { tmp, openService };
}

const ref = (n) => ({ number: n, url: `https://github.com/o/r/issues/${n}`, title: `Issue ${n}`, body: 'Do it' });
const issueNumbers = (item) => (item.issues || [item]).map((i) => i.number);

test('#446 a leftover queue file becomes one planned roadmap stage at the end, once; its pause is dropped', async (t) => {
  process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
  const { tmp, openService } = harness(t);
  const dir = tmp('queue-move-ws-');
  const folder = tmp('queue-move-project-');

  // 1. a workspace with a project, its synced backlog and a planned roadmap stage
  const first = openService(dir);
  const ws = first.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await first.api['projects:create']({ name: 'demo', folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [1, 2, 3, 9].map(roadmapIssue) }));
  await first.api['roadmap:save']({ projectId: p.id, stages: [{ name: 'Planned before', items: [{ workflow: 'fixture-issue.yaml', number: 9, mock: true }] }] });
  first.close();

  // 2. the queue an older version left behind: paused, one single issue and one group
  const addedAt = '2026-10-01T00:00:00.000Z';
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.queue.json`), JSON.stringify({
    paused: true, error: 'Paused by hand', inputs: { 'fixture-issue.yaml': { language: 'go' } },
    items: [
      { ...ref(1), workflow: 'fixture-issue.yaml', workflowName: 'fixture-issue', inputs: { language: 'go' }, mock: true, addedAt },
      { ...ref(2), workflow: 'fixture-issue.yaml', workflowName: 'fixture-issue', inputs: {}, mock: true, addedAt, issues: [ref(2), ref(3)] },
    ],
    skipped: [],
  }));

  // 3. opened again: the queue is now the roadmap's last stage
  const second = openService(dir);
  let roadmap = second.api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages.length, 2, 'the queue became one stage after the planned one');
  assert.deepEqual(issueNumbers(roadmap.stages[0].items[0]), [9]);
  const moved = roadmap.stages[1];
  assert.deepEqual(moved.items.map(issueNumbers), [[1], [2, 3]], 'one item per queue item, the group kept');
  assert.deepEqual(moved.items.map((x) => x.workflow), ['fixture-issue.yaml', 'fixture-issue.yaml']);
  assert.deepEqual(moved.items[0].inputs, { language: 'go' });
  assert.deepEqual(moved.items.map((x) => x.status), ['planned', 'planned']);
  assert.equal(roadmap.state, 'planned', 'the queue\'s pause is not carried over');
  assert.equal(second.api['runs:active']().length, 0, 'nothing starts by itself');
  second.close();

  // 4. a later open never moves it again
  const third = openService(dir);
  roadmap = third.api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages.length, 2, 'the move happened once');
  assert.deepEqual(roadmap.stages.map((s) => s.items.flatMap(issueNumbers)), [[9], [1, 2, 3]]);
});
