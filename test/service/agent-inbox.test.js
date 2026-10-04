// Agent inboxes (#240), service level, beyond the acceptance tests (agent-inbox-240.test.js): each
// owner's other request kinds and their refusals, through po:request / supervisor:request. Everything
// runs simulated (MULTIAGENT_SIMULATION_ONLY=1): no model, no gh, no real run.
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService, roadmapProject, roadmapIssue, ISSUE_WORKFLOW } = require('./helpers');

const ofRequest = (history, ref) => history.filter((m) => m.request && m.request.ref === ref);
const stagesOf = async (api, projectId) => (await api['roadmap:get']({ projectId }))?.stages || [];
const numbersIn = (item) => (item.issues || []).map((i) => (typeof i === 'object' ? i.number : i));

async function poSetup(t, name, numbers = [1, 2]) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, numbers, name);
  const request = (kind, params = {}, extra = {}) => api['po:request']({ projectId: p.id, kind, params, reason: 'test', from: 'oracle', ref: `${kind}-${Math.random()}`, mock: true, ...extra });
  return { service, api, ws, p, request };
}

const add = (request, issues, more = {}) => request('roadmap.add', { issues, workflow: 'fixture-issue.yaml', ...more });

// ---- roadmap.add ---------------------------------------------------------------------------------

test('roadmap.add refuses an issue that is not in the synced backlog and plans nothing', async (t) => {
  const { api, p, request } = await poSetup(t, 'inbox-add-unknown');
  const out = await add(request, [99]);
  assert.equal(out.ok, false);
  assert.match(out.error, /#99/);
  assert.equal((await stagesOf(api, p.id)).length, 0);
});

test('roadmap.add refuses a workflow that is not installed', async (t) => {
  const { request } = await poSetup(t, 'inbox-add-workflow');
  const out = await request('roadmap.add', { issues: [1], workflow: 'no-such-workflow.yaml' });
  assert.equal(out.ok, false);
  assert.match(out.error, /no-such-workflow\.yaml/);
});

test('roadmap.add of an issue already planned is refused: nothing was added', async (t) => {
  const { api, p, request } = await poSetup(t, 'inbox-add-twice');
  assert.equal((await add(request, [1])).ok, true);
  const again = await add(request, [1]);
  assert.equal(again.ok, false);
  assert.match(again.error, /already planned/);
  assert.equal((await stagesOf(api, p.id)).length, 1);
});

test('roadmap.add with group puts the issues in one item; without it, one item per issue', async (t) => {
  const { api, p, request } = await poSetup(t, 'inbox-add-group', [1, 2, 3, 4]);
  assert.equal((await add(request, [1, 2], { group: true })).ok, true);
  assert.equal((await add(request, [3, 4])).ok, true);
  const [grouped, single] = await stagesOf(api, p.id);
  assert.deepEqual(grouped.items.map(numbersIn), [[1, 2]]);
  assert.deepEqual(single.items.map(numbersIn), [[3], [4]]);
});

test('roadmap.add of an archived issue does not report it as added', async (t) => {
  const { api, ws, p, request } = await poSetup(t, 'inbox-add-archived');
  const file = path.join(ws.backlog, `${p.id}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.issues.push({ ...roadmapIssue(3), state: 'closed', labels: [{ name: 'archived' }] });
  fs.writeFileSync(file, JSON.stringify(data));

  const out = await add(request, [3]);
  const planned = (await stagesOf(api, p.id)).flatMap((s) => s.items || []).flatMap(numbersIn);
  assert.equal(planned.includes(3), false, 'the archived issue is not planned');
  assert.equal(out.ok, false, `an archived issue is not reported as added: ${out.text}`);
});

// ---- roadmap.move / roadmap.regroup / roadmap.skip -----------------------------------------------

test('roadmap.move to one stage past the last creates a new stage with the item', async (t) => {
  const { api, p, request } = await poSetup(t, 'inbox-move-new');
  assert.equal((await add(request, [1, 2])).ok, true);
  const [stage] = await stagesOf(api, p.id);
  const item = stage.items.find((x) => numbersIn(x).includes(2));

  const out = await request('roadmap.move', { itemId: item.id, stage: 2 });
  assert.equal(out.ok, true, out.error);
  const after = await stagesOf(api, p.id);
  assert.equal(after.length, 2);
  assert.deepEqual(after[0].items.map(numbersIn), [[1]]);
  assert.deepEqual(after[1].items.map(numbersIn), [[2]]);
});

test('roadmap.move refuses a stage out of range and an unknown item, and leaves the roadmap as it was', async (t) => {
  const { api, p, request } = await poSetup(t, 'inbox-move-refused');
  assert.equal((await add(request, [1])).ok, true);
  const [stage] = await stagesOf(api, p.id);

  const far = await request('roadmap.move', { itemId: stage.items[0].id, stage: 5 });
  assert.equal(far.ok, false);
  assert.match(far.error, /Stage 5/);
  const zero = await request('roadmap.move', { itemId: stage.items[0].id, stage: 0 });
  assert.equal(zero.ok, false);
  const unknown = await request('roadmap.move', { itemId: 'no-such-item', stage: 1 });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /no-such-item/);
  assert.equal((await stagesOf(api, p.id)).length, 1);
});

test('roadmap.regroup saves the stages it is given', async (t) => {
  const { api, p, request } = await poSetup(t, 'inbox-regroup');
  assert.equal((await add(request, [1])).ok, true);
  assert.equal((await add(request, [2])).ok, true);
  const before = await stagesOf(api, p.id);
  assert.equal(before.length, 2);
  const merged = [{ ...before[0], items: [...before[0].items, ...before[1].items] }];

  const out = await request('roadmap.regroup', { stages: merged });
  assert.equal(out.ok, true, out.error);
  const after = await stagesOf(api, p.id);
  assert.equal(after.length, 1);
  assert.deepEqual(after[0].items.map(numbersIn), [[1], [2]]);
});

test('roadmap.skip skips a planned item', async (t) => {
  const { api, p, request } = await poSetup(t, 'inbox-skip-ok');
  assert.equal((await add(request, [1])).ok, true);
  const [stage] = await stagesOf(api, p.id);
  const out = await request('roadmap.skip', { itemId: stage.items[0].id });
  assert.equal(out.ok, true, out.error);
  const [after] = await stagesOf(api, p.id);
  assert.equal(after.items[0].status, 'skipped');
});

// ---- queue.assign / issue.file / issue.update ----------------------------------------------------

test('queue.assign refuses a request without issues or without a workflow', async (t) => {
  const { request } = await poSetup(t, 'inbox-assign-refused');
  const noIssues = await request('queue.assign', { workflow: 'fixture-issue.yaml' });
  assert.equal(noIssues.ok, false);
  assert.match(noIssues.error, /issues/);
  const noWorkflow = await request('queue.assign', { issues: [1] });
  assert.equal(noWorkflow.ok, false);
  assert.match(noWorkflow.error, /workflow/);
});

test('issue.file and issue.update under simulation only preview: ok, US$ 0, nothing changed', async (t) => {
  const { api, p, request } = await poSetup(t, 'inbox-issue-preview');
  const filed = await request('issue.file', { title: 'Export as CSV', body: 'The run log as CSV.' }, { ref: 'file-1' });
  assert.equal(filed.ok, true, filed.error);
  assert.equal(filed.costUsd, 0);
  assert.match(filed.text, /Simulation only: nothing was changed/);
  const updated = await request('issue.update', { number: 1, body: 'New text', mode: 'comment' });
  assert.equal(updated.ok, true, updated.error);
  assert.match(updated.text, /Simulation only/);
  assert.equal(ofRequest(await api['po:history']({ projectId: p.id }), 'file-1').length, 2);
});

// ---- the project and the plan request ------------------------------------------------------------

test('po:request for an unknown project is ok false, not a throw', async (t) => {
  const { api } = makeService(t);
  const out = await api['po:request']({ projectId: 'no-such-project', kind: 'roadmap.add', params: { issues: [1] }, from: 'oracle', ref: 'x', mock: true });
  assert.equal(out.ok, false);
  assert.match(out.error, /no-such-project/);
  assert.equal(out.costUsd, 0);
});

test('a plan request with no question and no reason is recorded as Failed at US$ 0', async (t) => {
  const { api, p } = await poSetup(t, 'inbox-plan-empty');
  const out = await api['po:request']({ projectId: p.id, kind: 'plan', params: {}, from: 'oracle', ref: 'plan-empty', mock: true });
  assert.equal(out.ok, false);
  assert.equal(out.costUsd, 0);
  const result = ofRequest(await api['po:history']({ projectId: p.id }), 'plan-empty').at(-1);
  assert.ok(result.error);
  assert.match(result.text, /^Failed: /);
});

test('a plan request on a project whose backlog is not synced fails and says to sync it', async (t) => {
  const { api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-inbox-unsynced-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });
  const out = await api['po:request']({ projectId: p.id, kind: 'plan', params: { question: 'Plan it' }, from: 'oracle', ref: 'plan-unsynced', mock: true });
  assert.equal(out.ok, false);
  assert.match(out.error, /Sync the backlog/);
  assert.equal(out.costUsd, 0);
});

// ---- the Supervisor's kinds ----------------------------------------------------------------------

test('supervisor:request run.retry and run.resume on an unknown run are ok false and recorded', async (t) => {
  const { api } = makeService(t);
  const retry = await api['supervisor:request']({ kind: 'run.retry', params: { runId: 'no-such-run' }, from: 'oracle', ref: 'retry-1', mock: true });
  assert.equal(retry.ok, false);
  assert.equal(retry.costUsd, 0);
  const resume = await api['supervisor:request']({ kind: 'run.resume', params: { runId: 'no-such-run', step: 'build' }, from: 'oracle', ref: 'resume-1', mock: true });
  assert.equal(resume.ok, false);
  const history = await api['supervisor:chatHistory']();
  assert.ok(ofRequest(history, 'retry-1').at(-1).error);
  assert.ok(ofRequest(history, 'resume-1').at(-1).error);
});

test('supervisor:request workflow.restore brings back the bundled workflow', async (t) => {
  const { service, api } = makeService(t);
  const file = path.join(service.workspace().workflows, 'issue-tracker.yaml');
  const bundled = fs.readFileSync(path.join(__dirname, '..', '..', 'workflows', 'issue-tracker.yaml'), 'utf8');
  fs.writeFileSync(file, `${bundled}\n# edited by the owner\n`);

  const out = await api['supervisor:request']({ kind: 'workflow.restore', params: { file: 'issue-tracker.yaml' }, reason: 'broken edit', from: 'oracle', ref: 'restore-1', mock: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.costUsd, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), bundled);
});

test('supervisor:request workflow.restore of a workflow with no bundled default is refused', async (t) => {
  const { api } = makeService(t);
  const out = await api['supervisor:request']({ kind: 'workflow.restore', params: { file: 'fixture-service.yaml' }, from: 'oracle', ref: 'restore-2', mock: true });
  assert.equal(out.ok, false);
});

// ---- the Oracle's line ---------------------------------------------------------------------------

test('a Supervisor request from the Oracle leaves a line in its chat pointing to the Supervisor\'s result', async (t) => {
  const { api } = makeService(t);
  const out = await api['supervisor:request']({ kind: 'run.stop', params: { runId: 'no-such-run' }, reason: 'it loops', from: 'oracle', ref: 'oracle-sup-1', mock: true });
  assert.equal(out.ok, false);
  const result = ofRequest(await api['supervisor:chatHistory'](), 'oracle-sup-1').at(-1);
  const line = (await api['oracle:history']()).find((m) => m.kind === 'request' && m.ref === 'oracle-sup-1');
  assert.ok(line, 'the Oracle\'s chat has the request line');
  assert.equal(line.to, 'supervisor');
  assert.equal(line.ownerTs, result.ts);
  assert.equal(line.failed, true);
});

test('a request from another sender leaves no line in the Oracle\'s chat', async (t) => {
  const { api } = makeService(t);
  await api['supervisor:request']({ kind: 'dispatch.restart', params: {}, from: 'night-watch', ref: 'not-oracle-1', mock: true });
  const lines = (await api['oracle:history']()).filter((m) => m.kind === 'request' && m.ref === 'not-oracle-1');
  assert.equal(lines.length, 0);
  const request = ofRequest(await api['supervisor:chatHistory'](), 'not-oracle-1')[0];
  assert.match(request.text, /^Request from the night-watch: dispatch\.restart/);
});
