// Acceptance tests for #605 / #446 (written before the code): with the plain queue retired, its
// readers read only the roadmap and no code path writes the queue any more.
// - Keep awake (service.pendingWork, packages/engine/service/areas/keep-awake.js): a queue with items,
//   not paused, is no work to keep the computer awake for.
// - The Oracle's `backlog` tool (packages/engine/domains/oracle/oracle-tools.js) returns no queue.
// - App update (packages/engine/service/areas/app-update.js), keep awake and the Oracle tools never
//   read or pause a queue (a source check: the cycle's pause/resume needs a real host restart).
// - No production file under packages/, fronts/ or apps/ calls a queue writer or the queue dispatcher.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, roadmapProject } = require('./service/helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// a queue with one item, not paused, for the project: through the backlog module while it still has
// a writer (before the change), else the file an older version would have left
function leaveQueue(ws, projectId) {
  const backlog = require('../domains/backlog/backlog');
  const issue = { number: 1, url: 'https://github.com/o/r/issues/1', title: 'Issue 1', body: 'Do it' };
  if (typeof backlog.enqueue === 'function') {
    backlog.enqueue(ws.backlog, projectId, { issues: [issue], workflow: 'fixture-issue.yaml', workflowName: 'fixture-issue', mock: true });
    return;
  }
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.queue.json`), JSON.stringify({ paused: false, error: null, inputs: {}, items: [{ ...issue, workflow: 'fixture-issue.yaml', mock: true }], skipped: [] }));
}

test('#446 keep awake: a queue with items, not paused, is not work pending', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'keep-awake-446');
  leaveQueue(ws, p.id);

  const work = service.pendingWork();
  assert.equal(work.queued ?? 0, 0);
  assert.deepEqual(work.runs, []);
});

test('#446 Oracle backlog tool: answers the synced backlog without any queue', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'oracle-backlog-446');
  leaveQueue(ws, p.id);
  const { callTool, oracleTools } = require('../domains/oracle/oracle-tools');
  const ctx = {
    get ws() { return service.workspace(); },
    BUNDLED_SKILLS_DIR: require('../service').BUNDLED_SKILLS_DIR,
    listWorkflows: () => api['workflows:list'](),
    activeRuns: () => api['runs:active'](),
    roadmapView: (projectId) => api['roadmap:get']({ projectId }),
    withIssueRuns: (data) => api['backlog:get']({ projectId: data.projectId }),
    unpushedProjects: () => api['backlog:unpushed'](),
  };
  const tools = oracleTools(ctx);
  const tool = tools.find((x) => x.name === 'backlog');
  assert.ok(tool, 'the backlog tool is still offered');
  assert.doesNotMatch(tool.description, /queue/i);

  const out = await callTool(tools, 'backlog', { projectId: p.id });
  assert.equal(out.isError, false);
  const parsed = JSON.parse(out.text);
  assert.equal('queue' in parsed, false, 'no queue beside the backlog');
  assert.equal(parsed.backlog?.queue, undefined, 'no queue inside the backlog');
  assert.deepEqual(parsed.backlog.issues.map((i) => i.number), [1]);
});

const QUEUE_READ = /\b(readQueue|queuedProjects|nextQueued|claimQueued)\s*\(|backlog\.pauseAll\s*\(/;
const QUEUE_WRITE = /\b(enqueue|writeQueue|writeQueueFile|updateQueue|unqueue|skipQueued|setPaused|pauseForFailure|clearDonePause|dispatchQueue)\s*\(/;

test('#446 app update, keep awake and the Oracle tools read only the roadmap: no queue read or pause in their source', () => {
  for (const rel of [
    'packages/engine/service/areas/app-update.js',
    'packages/engine/service/areas/keep-awake.js',
    'packages/engine/domains/oracle/oracle-tools.js',
  ]) {
    const src = read(rel);
    assert.equal(QUEUE_READ.test(src), false, `${rel} reads a queue: ${QUEUE_READ.exec(src)?.[0]}`);
    assert.equal(QUEUE_WRITE.test(src), false, `${rel} writes a queue: ${QUEUE_WRITE.exec(src)?.[0]}`);
  }
});

// production .js files: tests, BDD steps, fixtures and dependencies left out
function sources(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'test', 'tests', 'features', 'fixtures', 'dist', 'out', '.git'].includes(e.name)) continue;
      sources(full, out);
    } else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

test('#446 no production code writes the queue: no queue writer, no queue dispatcher', () => {
  const files = ['packages', 'fronts', 'apps'].flatMap((d) => sources(path.join(ROOT, d)));
  assert.ok(files.length > 50, 'the source folders were walked');
  const writers = files
    .map((f) => ({ f: path.relative(ROOT, f).split(path.sep).join('/'), m: QUEUE_WRITE.exec(fs.readFileSync(f, 'utf8')) }))
    .filter((x) => x.m)
    .map((x) => `${x.f}: ${x.m[0]}`);
  assert.deepEqual(writers, []);
});

test('#446 the backlog module no longer offers the queue writers', () => {
  const backlog = require('../domains/backlog/backlog');
  const left = ['enqueue', 'unqueue', 'setPaused', 'pauseForFailure', 'skipQueued', 'claimQueued', 'pauseAll']
    .filter((name) => typeof backlog[name] === 'function');
  assert.deepEqual(left, []);
});
