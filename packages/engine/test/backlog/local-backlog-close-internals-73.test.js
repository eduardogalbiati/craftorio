// #73 internals: which local issues a merged run closes (local-backlog.js closeMergedLocalIssues), what a restore
// drops, and the push step's text (machine-steps.js runPushBaseStep) with no remote and with an error that ends in a dot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const local = require('../../domains/backlog/local-backlog');
const { WorkflowRun } = require('../../engine/workflow');

const BY = { runId: 'run-1', commit: 'a'.repeat(40) };

function fixture(t, titles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-close-73-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  for (const title of titles) local.createLocalIssue(dir, 'p', { title });
  return dir;
}
const states = (dir) => local.readLocalIssues(dir, 'p').map((i) => [i.number, i.state]);

test('#73 closeMergedLocalIssues: a renumbered issue is closed by its earlier number, a ref with a url closes nothing', (t) => {
  const dir = fixture(t, ['One', 'Two']);
  local.renumberLocalIssues(dir, 'p', [1]);
  assert.deepEqual(local.closeMergedLocalIssues(dir, 'p', [{ number: 1, url: '' }, { number: 2, url: 'https://github.com/o/r/issues/2' }], BY), [3]);
  assert.deepEqual(states(dir), [[3, 'closed'], [2, 'open']]);
});

test('#73 closeMergedLocalIssues: an issue already closed keeps its record', (t) => {
  const dir = fixture(t, ['One']);
  local.closeMergedLocalIssues(dir, 'p', [{ number: 1 }], BY);
  const before = local.readLocalIssues(dir, 'p');
  assert.deepEqual(local.closeMergedLocalIssues(dir, 'p', [{ number: 1 }], { ...BY, runId: 'run-2' }), []);
  assert.deepEqual(local.readLocalIssues(dir, 'p'), before);
});

test('#73 restore drops what closed the issue; a person\'s close records no run', (t) => {
  const dir = fixture(t, ['One']);
  local.closeMergedLocalIssues(dir, 'p', [{ number: 1 }], BY);
  assert.deepEqual(local.readLocalIssues(dir, 'p')[0].closedBy, BY);
  local.restoreLocalIssues(dir, 'p', { numbers: [1] });
  assert.equal('closedBy' in local.readLocalIssues(dir, 'p')[0], false);
  local.closeLocalIssue(dir, 'p', 1);
  assert.equal('closedBy' in local.readLocalIssues(dir, 'p')[0], false);
});

async function pushStep(pushBase) {
  const events = [];
  const s = {
    machine: { simulated: false, pushBase },
    worktree: { repo: '/ws/repos/x', base: 'main' },
    ctx: { local_merge: { branch: 'feat/x', base: 'main', commit: 'abc' } },
    emitEvent: (type, data) => events.push({ type, ...data }),
  };
  const out = await WorkflowRun.prototype.runPushBaseStep.call(s, { id: 'push_main', type: 'push_base' });
  return { out, levels: events.filter((e) => e.type === 'log').map((e) => e.level) };
}

test('#73 push_base with no remote: the summary and the reason say so, in an info line', async () => {
  const { out, levels } = await pushStep(async () => ({ pushed: false, noRemote: true, reason: 'x', commits: [], issues: [] }));
  assert.deepEqual([out.summary, out.reason], ['Merged locally, this project has no remote.', 'Merged locally, this project has no remote.']);
  assert.deepEqual(levels, ['info']);
});

test('#73 push_base: an error that ends with a dot is not followed by another', async () => {
  const { out } = await pushStep(async () => { throw new Error('origin/main not found: nothing to compare the local main with.'); });
  assert.equal(out.summary, 'Could not push main: origin/main not found: nothing to compare the local main with. The run is merged locally; push it from the Backlog.');
});
