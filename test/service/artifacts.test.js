const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GATE_RUN_APP_WORKFLOW, gitRepo, makeService, resolveAndWait, untilTrue } = require('./helpers');

test('artifacts: a run screenshot is read as an image data URL, a text file as text', (t) => {
  const { api, service } = makeService(t);
  const run = path.join(service.workspace().runs, '20260101-000000-abcd1234');
  fs.mkdirSync(path.join(run, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(run, 'events.jsonl'), `${JSON.stringify({ seq: 1, type: 'workflow.started', run_id: '20260101-000000-abcd1234', workflow: 'software-development' })}\n`);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  fs.writeFileSync(path.join(run, 'screenshots', 'settings-after.png'), png);
  fs.writeFileSync(path.join(run, 'screenshots', 'screenshots.json'), '[]');

  const image = api['artifacts:read']({ path: path.join(run, 'screenshots', 'settings-after.png') });
  assert.equal(image.kind, 'image');
  assert.equal(image.image, 'data:image/png;base64,iVBORw0KGgoAAAAA');
  const text = api['artifacts:read']({ path: path.join(run, 'screenshots', 'screenshots.json') });
  assert.equal(text.image, null);
  assert.equal(text.text, '[]');
});

test('artifacts:evidence (runEvidence) resolves the manifest\'s relative paths to absolute files under the run folder, pair included (#146)', (t) => {
  const { api, service } = makeService(t);
  const run = path.join(service.workspace().runs, '20260101-000000-abcd1235');
  fs.mkdirSync(path.join(run, 'evidence', 'evidence', 'round-1'), { recursive: true });
  fs.writeFileSync(path.join(run, 'events.jsonl'), `${JSON.stringify({ seq: 1, type: 'workflow.started', run_id: '20260101-000000-abcd1235', workflow: 'software-development' })}\n`);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  fs.writeFileSync(path.join(run, 'evidence', 'evidence', 'round-1', '146-x-default.original.png'), png);
  fs.writeFileSync(path.join(run, 'evidence', 'evidence', 'round-1', '146-x-default.modified.png'), png);

  const m = api['artifacts:evidence']({ runId: '20260101-000000-abcd1235' });

  assert.equal(m.images.length, 2);
  const modified = m.images.find((x) => x.side === 'modified');
  const original = m.images.find((x) => x.side === 'original');
  assert.equal(modified.file, path.join(run, 'evidence', 'evidence', 'round-1', '146-x-default.modified.png'));
  assert.equal(modified.pair_file, original.file);
  assert.equal(original.pair_file, modified.file);
});

test('artifacts:evidence returns null for a run with no evidence and no legacy screenshots', (t) => {
  const { api, service } = makeService(t);
  const run = path.join(service.workspace().runs, '20260101-000000-abcd1236');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'events.jsonl'), `${JSON.stringify({ seq: 1, type: 'workflow.started', run_id: '20260101-000000-abcd1236', workflow: 'software-development' })}\n`);
  assert.equal(api['artifacts:evidence']({ runId: '20260101-000000-abcd1236' }), null);
});

// ---- #114: clipboard copy only accepts a run's own artifacts, inside the workspace or its project's folder ----

test('existingArtifact: accepts a file inside the run\'s own folder; refuses anything that is not a recorded artifact', async (t) => {
  const { service, api } = makeService(t);
  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  const gate = await gateP;

  // the recorder's events.jsonl is opened asynchronously: the run folder itself exists synchronously
  const runDir = path.join(service.workspace().runs, runId);
  const inside = path.join(runDir, 'documents', 'report.md');
  fs.mkdirSync(path.dirname(inside), { recursive: true });
  fs.writeFileSync(inside, '# report');
  assert.equal(service.existingArtifact(inside).path, inside);

  assert.throws(() => service.existingArtifact(path.join(os.tmpdir(), 'never-recorded.txt')), /Not an artifact of any run/);

  await resolveAndWait(api, runId, gate.approval_id, true);
});

test('existingArtifact: also accepts a file recorded outside the run folder when it is inside the run\'s project folder (a project copy); refuses anywhere else', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t);
  await api['projects:create']({ name: 'demo', folder: repo.dir });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;
  const runDir = path.join(service.workspace().runs, runId);
  // the recorder's events.jsonl is opened asynchronously: wait for its first line before appending
  const eventsFile = path.join(runDir, 'events.jsonl');
  await untilTrue(() => { try { return fs.readFileSync(eventsFile, 'utf8').trim().length > 0; } catch { return false; } });

  const projectCopy = path.join(repo.dir, 'prd.md');
  fs.writeFileSync(projectCopy, '# PRD');
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'file.saved', path: projectCopy, step_id: 'gate' })}\n`);
  assert.equal(service.existingArtifact(projectCopy).path, projectCopy, 'inside the project\'s own folder: accepted');

  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-outside-'));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const bad = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(bad, 'nope');
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'file.saved', path: bad, step_id: 'gate' })}\n`);
  assert.throws(() => service.existingArtifact(bad), /Outside the workspace and the project's folder/);

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});
