const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GATE_RUN_APP_WORKFLOW, gitRepo, makeService, resolveAndWait, untilTrue } = require('./helpers');

// A finished run with several files, saved through events.jsonl (so each has a step), for
// artifacts:list's paging/filtering/search (#200).
function addRunWithFiles(ws, id, { startedAt, projectId = null, mock = true, files, display }) {
  const dir = path.join(ws.runs, id);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [{ type: 'workflow.started', ts: startedAt, workflow: 'software-development', file: 'software-development.yaml', project_id: projectId, inputs: {}, mock, ...(display ? { display } : {}) }];
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f.rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, f.rel), f.content || 'x');
    lines.push({ type: 'file.saved', path: path.join(dir, f.rel), step_id: f.step });
  }
  fs.writeFileSync(path.join(dir, 'events.jsonl'), lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: id, workflow: 'software-development', file: 'software-development.yaml', project_id: projectId,
    status: 'success', mock, started_at: startedAt, finished_at: startedAt, inputs: {}, sessions: [],
  }));
}

test('artifacts: a run screenshot is read as an image data URL, a text file as text', async (t) => {
  const { api, service } = makeService(t);
  const run = path.join(service.workspace().runs, '20260101-000000-abcd1234');
  fs.mkdirSync(path.join(run, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(run, 'events.jsonl'), `${JSON.stringify({ seq: 1, type: 'workflow.started', run_id: '20260101-000000-abcd1234', workflow: 'software-development' })}\n`);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  fs.writeFileSync(path.join(run, 'screenshots', 'settings-after.png'), png);
  fs.writeFileSync(path.join(run, 'screenshots', 'screenshots.json'), '[]');

  const image = await api['artifacts:read']({ path: path.join(run, 'screenshots', 'settings-after.png') });
  assert.equal(image.kind, 'image');
  assert.equal(image.image, 'data:image/png;base64,iVBORw0KGgoAAAAA');
  const text = await api['artifacts:read']({ path: path.join(run, 'screenshots', 'screenshots.json') });
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
  assert.equal((await service.existingArtifact(inside)).path, inside);

  await assert.rejects(service.existingArtifact(path.join(os.tmpdir(), 'never-recorded.txt')), /Not an artifact of any run/);

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
  assert.equal((await service.existingArtifact(projectCopy)).path, projectCopy, 'inside the project\'s own folder: accepted');

  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-outside-'));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const bad = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(bad, 'nope');
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'file.saved', path: bad, step_id: 'gate' })}\n`);
  await assert.rejects(service.existingArtifact(bad), /Outside the workspace and the project's folder/);

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

// ---- #200: artifacts:list pages and filters one run's files, or lists runs with counts only -----

test('artifacts:list { runId }: pages a run\'s files, filters by kind, and a search that doesn\'t match the run itself still matches by file name', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  const files = [0, 1, 2, 3, 4].map((i) => ({ rel: `doc${i}.md`, step: 'plan' }));
  files.push({ rel: 'shot.png', step: 'evidence' });
  addRunWithFiles(ws, 'run1', { startedAt: '2026-01-01T00:00:00Z', files });

  const [page1] = await api['artifacts:list']({ runId: 'run1', limit: 4 });
  assert.equal(page1.total, 6);
  assert.equal(page1.artifacts.length, 4);
  assert.equal(page1.hasMore, true);

  const [page2] = await api['artifacts:list']({ runId: 'run1', offset: 4, limit: 4 });
  assert.equal(page2.artifacts.length, 2);
  assert.equal(page2.hasMore, false);

  const [onlyImages] = await api['artifacts:list']({ runId: 'run1', kind: 'image' });
  assert.deepEqual(onlyImages.artifacts.map((a) => a.rel), ['shot.png']);

  const [noMatch] = await api['artifacts:list']({ runId: 'run1', q: 'zzz' });
  assert.equal(noMatch.artifacts.length, 0, 'neither the run nor any file matches');

  const [fileMatch] = await api['artifacts:list']({ runId: 'run1', q: 'shot' });
  assert.deepEqual(fileMatch.artifacts.map((a) => a.rel), ['shot.png'], 'matched by file name, even though the run\'s own fields don\'t mention it');
});

test('artifacts:list without runId: runs with artifactCount/imageCount only (no file list), dropping a run with no files, honouring projectId; summary:true adds hiddenSim', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'art-list-proj-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'demo', folder });

  addRunWithFiles(ws, 'has-files', { startedAt: '2026-01-01T00:00:00Z', projectId: p.id, files: [{ rel: 'a.md', step: 'plan' }] });
  addRunWithFiles(ws, 'other-project', { startedAt: '2026-01-02T00:00:00Z', files: [{ rel: 'b.md', step: 'plan' }] });
  const emptyDir = path.join(ws.runs, 'no-files');
  fs.mkdirSync(emptyDir, { recursive: true });
  fs.writeFileSync(path.join(emptyDir, 'events.jsonl'), `${JSON.stringify({ type: 'workflow.started', ts: '2026-01-03T00:00:00Z', workflow: 'software-development' })}\n`);
  fs.writeFileSync(path.join(emptyDir, 'summary.json'), JSON.stringify({ run_id: 'no-files', workflow: 'software-development', status: 'success', mock: true, started_at: '2026-01-03T00:00:00Z', inputs: {}, sessions: [] }));

  const all = await api['artifacts:list']({});
  assert.deepEqual(all.map((r) => r.runId).sort(), ['has-files', 'other-project'], 'the run with no files is dropped');
  const hasFiles = all.find((r) => r.runId === 'has-files');
  assert.equal(hasFiles.artifactCount, 1);
  assert.equal(hasFiles.artifacts, undefined, 'no inline file list: that is what artifacts:list { runId } is for');

  const scoped = await api['artifacts:list']({ projectId: p.id });
  assert.deepEqual(scoped.map((r) => r.runId), ['has-files']);

  const summarized = await api['artifacts:list']({ summary: true });
  assert.deepEqual(Object.keys(summarized).sort(), ['hiddenSim', 'runs']);
});

test('artifacts:list { q }: a matching run comes with a preview of only its matching files and matchCount', async (t) => {
  const { api, service } = makeService(t);
  const ws = service.workspace();
  addRunWithFiles(ws, 'run1', { startedAt: '2026-01-01T00:00:00Z', files: [{ rel: 'needle.md', step: 'plan' }, { rel: 'other.md', step: 'plan' }] });
  addRunWithFiles(ws, 'run2', { startedAt: '2026-01-02T00:00:00Z', files: [{ rel: 'hay.md', step: 'plan' }] });

  const res = await api['artifacts:list']({ q: 'needle' });
  assert.equal(res.length, 1);
  assert.equal(res[0].runId, 'run1');
  assert.equal(res[0].matchCount, 1);
  assert.deepEqual(res[0].artifacts.map((a) => a.rel), ['needle.md']);
});

// #245: the artifacts panel (Run screen, gate panel) names a round's step from the run it lists, so
// the run carries the display names its workflow.started recorded
test('#245 artifacts:list { runId }: the run carries its step display names (stepNames) from workflow.started', async (t) => {
  const { api, service } = makeService(t);
  addRunWithFiles(service.workspace(), 'run245', {
    startedAt: '2026-10-04T00:00:00Z', files: [{ rel: 'evidence/verify_change/round-1/245-home.modified.png', step: 'verify_change' }],
    display: { agents: { developer: 'Developer' }, steps: { verify_change: 'Final verification' } },
  });
  const [run] = await api['artifacts:list']({ runId: 'run245' });
  assert.equal(run.stepNames?.verify_change, 'Final verification');
});
