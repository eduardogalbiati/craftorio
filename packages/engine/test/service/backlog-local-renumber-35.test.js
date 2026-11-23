// #35 review: what follows a local issue (a project created with no remote) once a repository is added.
// 1. The sync renumbers a local issue whose number the platform already uses (#1 → past the platform's): the local
//    issue keeps its Discovery card and its runs, and the platform's #1 gets neither.
// 2. The issue workflow's real (non-mock) run on a project with no remote files its drafts into the local backlog:
//    the run's `issues` output names them and backlog:changed says file 'local-issues'; a simulated run files nothing.
// The platform's CLI is the boundary: the domain's syncBacklog gets a fake `exec` (as backlog-progress-781.test.js).
// Part 2 drives the run's end through the backlog area (service/areas/backlog.js fileRunLocally, what runs.js
// afterRunFinished calls): a whole non-mock issue run needs a model for its write and review steps.
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const backlog = require('../../domains/backlog/backlog');
const discovery = require('../../domains/discovery/discovery');
const { makeService, watchRuns, until } = require('./helpers');

const REPO = 'https://github.com/o/field-notes';
const platformIssue = (number) => ({
  number, title: `Platform issue ${number}`, state: 'OPEN', labels: [], url: `${REPO}/issues/${number}`,
  author: { login: 'o' }, assignees: [], body: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
});
const AGENT_FREE = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-gate
agents: {}
steps:
  - id: review
    type: human_approval
    message: "Accept?"
`;

async function setup(t, name) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `service-local-renumber-35-${name}-`));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'field notes', folder });
  return { service, api, ws, p };
}

const issuesOf = async (api, projectId) => (await api['backlog:get']({ projectId }))?.issues || [];

test('#35 a local issue renumbered by the sync keeps its Discovery card and its runs; the platform\'s #1 gets neither', async (t) => {
  const { service, api, ws, p } = await setup(t, 'renumber');
  // local #1, filed from a Discovery card
  const card = discovery.createCard(ws.discovery, p.id, { title: 'Export runs as CSV', text: 'The runs table cannot be exported.' });
  discovery.updateCard(ws.discovery, p.id, card.id, { acceptance: '- [ ] Add the CSV writer', clarity: { score: 90, gaps: [] } });
  discovery.moveCard(ws.discovery, p.id, card.id, 'ready', { by: 'tester' });
  const proposal = await api['discovery:commit-proposal']({ projectId: p.id, cardId: card.id });
  await api['discovery:commit']({ projectId: p.id, cardId: card.id, split: proposal.split });
  const before = (await issuesOf(api, p.id)).find((i) => i.title === 'Export runs as CSV');
  assert.equal(before?.number, 1, 'the local issue is #1');
  // a run started for it (the Backlog's Assign workflow records run.issues: a local issue has no url)
  fs.writeFileSync(path.join(ws.workflows, 'fixture-gate.yaml'), AGENT_FREE);
  const { gates } = watchRuns(service);
  const run = await api['run:start']({ file: 'fixture-gate.yaml', inputs: {}, mock: true, projectId: p.id, issues: [{ number: 1, url: '', title: 'Export runs as CSV' }] });
  await until(() => gates.has(run.runId));
  const linked = (await issuesOf(api, p.id)).find((i) => i.number === 1);
  assert.deepEqual((linked?.runs || []).map((r) => r.runId), [run.runId], 'the run is linked before the sync');
  // a repository is added; its sync brings the platform's #1
  const realSync = backlog.syncBacklog;
  t.mock.method(backlog, 'syncBacklog', (args) => realSync({ ...args, exec: async (_cli, a) => (a[0] === 'issue' && a[1] === 'list' ? JSON.stringify([platformIssue(1)]) : '[]') }));
  await api['projects:update']({ id: p.id, patch: { repo: REPO } });
  await api['backlog:sync']({ projectId: p.id });

  const after = await issuesOf(api, p.id);
  const local = after.find((i) => i.title === 'Export runs as CSV');
  const platform = after.find((i) => i.url === `${REPO}/issues/1`);
  assert.equal(platform?.number, 1, 'the platform\'s #1 is listed');
  assert.notEqual(local?.number, 1, 'the local issue moved past the platform\'s numbers');
  assert.equal(local?.discoveryCard?.id ?? null, card.id, 'the local issue keeps its Discovery card');
  assert.deepEqual((local?.runs || []).map((r) => r.runId), [run.runId], 'the local issue keeps its run');
  assert.equal(platform?.discoveryCard ?? null, null, 'the platform\'s #1 has no Discovery card');
  assert.deepEqual((platform?.runs || []).map((r) => r.runId), [], 'the platform\'s #1 has no run');
});

// ---- the issue workflow's run on a project with no remote ---------------------------------------------

function area(service) {
  const events = new EventEmitter();
  const changed = [];
  events.on('backlog:changed', (e) => changed.push(e));
  const backlogArea = require('../../service/areas/backlog')({ ws: service.workspace(), events, backlogWatching: () => false });
  return { backlogArea, changed };
}
const issueRun = (projectId, mock) => ({
  runId: 'r-35', projectId, mock, wf: { metadata: { name: 'issue' } },
  ctx: { steps: {
    analyze: { output: { complexity: { score: 2 }, grouping: 'alone' } },
    write: { output: { issues: [{ title: 'Export runs as CSV', body: 'The runs table cannot be exported.', labels: [] }] } },
    review: { output: { choice: 'create' } },
  } },
});

test('#35 a real issue run on a project with no remote ends with its issues output naming the local backlog\'s new issue', async (t) => {
  const { service, api, p } = await setup(t, 'run-real');
  const { backlogArea, changed } = area(service);
  const ev = { status: 'success' };
  backlogArea.fileRunLocally(issueRun(p.id, false), ev);
  const listed = (await issuesOf(api, p.id)).find((i) => i.title === 'Export runs as CSV');
  assert.equal(Number.isInteger(listed?.number), true, 'the Backlog lists the filed issue');
  assert.deepEqual((ev.outputs?.issues || []).map((i) => [i.number, i.title]), [[listed.number, 'Export runs as CSV']]);
  assert.deepEqual(changed.map((e) => [e.projectId, e.file]), [[p.id, 'local-issues']]);
});

test('#35 a simulated issue run on a project with no remote files nothing', async (t) => {
  const { service, api, p } = await setup(t, 'run-mock');
  const { backlogArea, changed } = area(service);
  const ev = { status: 'success' };
  backlogArea.fileRunLocally(issueRun(p.id, true), ev);
  assert.deepEqual((await issuesOf(api, p.id)).map((i) => i.title), []);
  assert.equal(ev.outputs?.issues ?? null, null);
  assert.deepEqual(changed, []);
});
