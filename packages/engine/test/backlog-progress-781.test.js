// #781: the backlog sync's progress, what the wizard's review shows while the issues are read
// (packages/engine/domains/backlog/backlog.js syncBacklog, channel backlog:progress). Acceptance tests, written
// before the code.
//
// The contract these tests assume:
// - the domain's syncBacklog({ ..., onProgress }) reports { what: 'issues', read, total }, with read === total at the
//   end of the issues;
// - the new channel `backlog:progress` ({ projectId }; api.backlogProgress(projectId)) answers
//   { source: 'github' | 'gitlab' | ..., what: 'issues', read, total } | null: during the sync (the real backlog:sync
//   channel) the source and `what`, and null once it ended.
// The platform's CLI is the boundary: the domain takes a fake `exec`; the channel builds its own (execCli), so the
// channel's tests hold the domain's syncBacklog, as test/service/backlog.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backlog = require('../domains/backlog/backlog');
const { makeService, until } = require('./service/helpers');

const REPO = 'https://github.com/o/r.git';
const raw = (number) => ({
  number, title: `Issue ${number}`, state: 'OPEN', labels: [], url: `https://github.com/o/r/issues/${number}`,
  author: { login: 'o' }, assignees: [], body: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
});

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

// the platform's CLI: the issue list answers two issues (after `gate`), everything else nothing
const fakeExec = (gate = null) => async (_cli, args) => {
  if (args[0] !== 'issue' || args[1] !== 'list') return '[]';
  if (gate) await gate;
  return JSON.stringify([raw(1), raw(2)]);
};

function gated() {
  let release;
  const gate = new Promise((r) => { release = r; });
  return { gate, release };
}

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

// ---- the domain ---------------------------------------------------------------------------------------

test('#781 syncBacklog reports the issues read, read === total at the end of the issues', async (t) => {
  const reports = [];
  await backlog.syncBacklog({ dir: tmp(t, 'bl-781-'), project: { id: 'p1', repo: REPO }, platform: 'github', exec: fakeExec(), onProgress: (p) => reports.push(p) });
  assert.deepEqual(reports.at(-1), { what: 'issues', read: 2, total: 2 });
});

test('#781 while the platform has not answered, syncBacklog reports no finished read', async (t) => {
  const { gate, release } = gated();
  const reports = [];
  const run = backlog.syncBacklog({ dir: tmp(t, 'bl-781-'), project: { id: 'p1', repo: REPO }, platform: 'github', exec: fakeExec(gate), onProgress: (p) => reports.push(p) });
  await settle();
  const finished = reports.filter((p) => p.read === 2).length;
  release();
  await run;
  assert.equal(finished, 0, 'nothing says the issues were read before the platform answered');
  assert.equal(reports.filter((p) => p.read === 2).length > 0, true, 'and the end is reported after it answered');
});

// ---- the channel ----------------------------------------------------------------------------------------

async function setup(t, repo = REPO) {
  const { api } = makeService(t);
  const folder = tmp(t, 'bl-781-folder-');
  const project = await api['projects:create']({ name: 'demo', folder, repo });
  assert.equal(typeof api['backlog:progress'], 'function', 'the channel backlog:progress');
  return { api, projectId: project.id };
}

// the domain's sync held at `gate`; calls: the arguments it got
function holdSync(t, gate, { fails = false } = {}) {
  const calls = [];
  t.mock.method(backlog, 'syncBacklog', async (args) => {
    calls.push(args);
    await gate;
    if (fails) throw new Error('gh failed');
    return { projectId: args.project.id, issues: [], epics: [] };
  });
  return calls;
}

test('#781 backlog:progress answers null with no sync running', async (t) => {
  const { api, projectId } = await setup(t);
  assert.equal(await api['backlog:progress']({ projectId }), null);
});

test('#781 during the sync backlog:progress answers the source and what is read', async (t) => {
  const { api, projectId } = await setup(t);
  const { gate, release } = gated();
  const calls = holdSync(t, gate);
  const sync = api['backlog:sync']({ projectId });
  let during;
  try {
    await until(() => calls.length === 1);
    during = await api['backlog:progress']({ projectId });
  } finally {
    release();
    await sync;
  }
  assert.equal(during?.source, 'github');
  assert.equal(during?.what, 'issues');
});

test('#781 backlog:progress follows what the domain reports', async (t) => {
  const { api, projectId } = await setup(t);
  const { gate, release } = gated();
  const calls = holdSync(t, gate);
  const sync = api['backlog:sync']({ projectId });
  let during;
  try {
    await until(() => calls.length === 1);
    assert.equal(typeof calls[0].onProgress, 'function', 'the channel gives the domain an onProgress');
    calls[0].onProgress({ what: 'issues', read: 40, total: 120 });
    during = await api['backlog:progress']({ projectId });
  } finally {
    release();
    await sync;
  }
  assert.deepEqual(during, { source: 'github', what: 'issues', read: 40, total: 120 });
});

test('#781 the source of a GitLab project is gitlab', async (t) => {
  const { api, projectId } = await setup(t, 'https://gitlab.com/o/r.git');
  const { gate, release } = gated();
  const calls = holdSync(t, gate);
  const sync = api['backlog:sync']({ projectId });
  let during;
  try {
    await until(() => calls.length === 1);
    during = await api['backlog:progress']({ projectId });
  } finally {
    release();
    await sync;
  }
  assert.equal(during?.source, 'gitlab');
});

test('#781 backlog:progress answers null once the sync ended', async (t) => {
  const { api, projectId } = await setup(t);
  const { gate, release } = gated();
  holdSync(t, gate);
  const sync = api['backlog:sync']({ projectId });
  release();
  await sync;
  assert.equal(await api['backlog:progress']({ projectId }), null);
});

test('#781 backlog:progress answers null after a sync that failed', async (t) => {
  const { api, projectId } = await setup(t);
  const { gate, release } = gated();
  holdSync(t, gate, { fails: true });
  const sync = api['backlog:sync']({ projectId });
  release();
  await assert.rejects(sync, /gh failed/);
  assert.equal(await api['backlog:progress']({ projectId }), null);
});
