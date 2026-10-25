// Analytics service channels of #188 (24/7 meter), #197 (Repository performance: project picker,
// "Ask for a plan") and #228 (one run in depth), through the service API like the app's IPC.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRepo, makeService, untilTrue } = require('./helpers');

// ---- #188 24/7 meter --------------------------------------------------------------------------------

test('analytics:occupancy: a workspace with no runs yet is reported as empty', async (t) => {
  const { api } = makeService(t);
  const out = await api['analytics:occupancy']({});
  assert.equal(out.empty, true);
});

test('settings: the top bar 24/7 chip is shown by default and Settings can hide it', (t) => {
  const { api } = makeService(t);
  assert.equal(api['settings:get']().showOccupancyChip, true);
  api['settings:set']({ showOccupancyChip: false });
  assert.equal(api['settings:get']().showOccupancyChip, false);
});

// ---- #197 Repository performance: choose the project ------------------------------------------------

test('analytics:performance: lists every project with its folder; one without git is listed with the reason it cannot be analysed', async (t) => {
  const { api } = makeService(t);
  const repo = gitRepo(t);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-plain-'));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  const withGit = await api['projects:create']({ name: 'With git', folder: repo.dir });
  const noGit = await api['projects:create']({ name: 'No git', folder: plain });

  const out = await api['analytics:performance']({ projectId: withGit.id });
  assert.equal(out.project.id, withGit.id);
  const listed = Object.fromEntries(out.projects.map((p) => [p.id, p]));
  assert.equal(listed[withGit.id].isGit, true);
  assert.equal(path.resolve(listed[withGit.id].folder), path.resolve(repo.dir));
  assert.equal(listed[noGit.id].isGit, false);
  assert.equal(typeof listed[noGit.id].reason, 'string');
  assert.ok(listed[noGit.id].reason.length > 0, 'a disabled project says why');
});

test('analytics:plan: "Ask for a plan" is a real-model call, refused in simulation-only mode', async (t) => {
  const { api } = makeService(t);
  const repo = gitRepo(t);
  const p = await api['projects:create']({ name: 'With git', folder: repo.dir });
  await assert.rejects(async () => api['analytics:plan']({ projectId: p.id, files: ['a.txt'], mock: false }), /Simulation only/);
});

// ---- #228 one run in depth ---------------------------------------------------------------------------

test('analytics:run: one run\'s figures (its gate wait by name) and how it compares with its workflow\'s runs', async (t) => {
  const { service, api } = makeService(t);
  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true }); // its "review" gate
  const gate = await gateP;
  api['approval:resolve']({ runId, id: gate.approval_id, answer: true });
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));

  const out = await api['analytics:run']({ runId });
  assert.equal(out.figures.status, 'success');
  assert.ok(out.figures.gates.some((g) => g.gate === 'review'), 'the review gate wait is listed');
  assert.equal(out.comparison.count, 0); // no other successful real run of this workflow
  assert.equal(out.comparison.tooFew, true);
});
