// #129: image attachments on agent turns, through mock runs of workflows/issue.yaml: an
// image attached to an input, and one pasted into a resume instruction (packages/engine/engine/workflow.js).
// Split by #306 (whole mock runs of a bundled workflow live in test/slow/, docs/agents/testing.md):
// the rest of this file's tests are in test/image-attachments.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const root = path.join(__dirname, '..', '..', '..', '..');

// A valid, minimal 1x1 PNG (its first 8 bytes are the real PNG signature sniffImage checks).
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function writePng(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG_1PX);
  return file;
}

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a mock run of issue-tracker with an image attached to an input copies it into <run_dir>/attachments/<input>/ and gives it to every step whose prompt uses that input', { timeout: 60000 }, async (t) => {
  const dir = tmpDir(t, 'img-run-');
  const png = writePng(path.join(dir, 'bug.png'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'issue.yaml'), // #648: issue-tracker.yaml was renamed issue.yaml
    inputs: { request: 'The run chat hides the gate when the window is small', project_path: root },
    mock: true,
    runsDir: path.join(dir, 'runs'),
    attachments: { request: [png] },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices[0].id, 'user'));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const started = events.find((e) => e.type === 'workflow.started');
  assert.equal(started.attachments.request.length, 1);
  const storedPath = started.attachments.request[0].path;
  assert.ok(fs.existsSync(storedPath), 'the copy survives in the run folder');
  assert.ok(storedPath.startsWith(path.join(run.runDir, 'attachments', 'request')), storedPath);

  for (const stepId of ['analyze', 'write']) {
    const sent = events.find((e) => e.type === 'session.message_sent' && e.step_id === stepId);
    assert.equal(sent.attachments?.length, 1, stepId);
    assert.equal(sent.attachments[0].path, storedPath, stepId);
  }
});

test('resume: an image pasted into the instruction is copied into <run_dir>/attachments/<step>-instruction/ and reaches the first resumed agent step', { timeout: 30000 }, async (t) => {
  const dir = tmpDir(t, 'img-resume-');
  const png = writePng(path.join(dir, 'shot.png'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'issue.yaml'),
    inputs: { request: 'x', project_path: root },
    mock: true,
    runsDir: path.join(dir, 'runs'),
    resume: { runId: 'prev-run', fromStep: 'analyze', steps: {}, sessions: {}, handoffs: {}, images: [png] },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices[0].id, 'user'));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const sent = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'analyze');
  assert.equal(sent.attachments?.length, 1);
  assert.ok(fs.existsSync(sent.attachments[0].path), 'the copy survives in the run folder');
  assert.ok(sent.attachments[0].path.startsWith(path.join(run.runDir, 'attachments', 'analyze-instruction')), sent.attachments[0].path);

  const next = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'write');
  assert.equal(next?.attachments?.length ?? 0, 0, 'only the first resumed step gets the instruction\'s images');
});
