// Workflows in the workspace: seeding of the bundled defaults, origin status, restore and
// resolution order (workspace first, then the bundled folder).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const wfs = require('../../domains/workflow/workflows');
const { MANIFEST } = require('../../domains/seed/seed');
const { setupWorkspace } = require('../../domains/workspace/workspace');
const { samePath } = require('../../engine/worktree');

const root = path.join(__dirname, '..', '..', '..', '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const yamlOf = (name, version, step = 'work') =>
  `apiVersion: craftorio/v1\nkind: Workflow\nmetadata:\n  name: ${name}\n  version: ${version}\nagents:\n  a: { provider: claude, model: m, session: ephemeral }\nsteps:\n  - id: ${step}\n    agent: a\n    prompt: "do it"\n`;
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

test('setupWorkspace creates workflows/', (t) => {
  const ws = setupWorkspace(path.join(tmp(t), 'w'), { persist: false });
  assert.equal(ws.workflows, path.join(ws.root, 'workflows'));
  assert.ok(fs.statSync(ws.workflows).isDirectory());
});

test('seedWorkflows copies the bundled workflows once and never touches user files', (t) => {
  const src = tmp(t);
  const dest = path.join(tmp(t), 'workflows');
  write(src, 'a.yaml', yamlOf('a', '1.0.0'));
  write(src, 'b.yaml', yamlOf('b', '1.0.0'));
  write(src, 'notes.txt', 'not a workflow');
  assert.deepEqual(wfs.seedWorkflows(src, dest), ['a.yaml', 'b.yaml']);
  assert.equal(read(dest, 'a.yaml'), read(src, 'a.yaml'));
  assert.equal(fs.existsSync(path.join(dest, 'notes.txt')), false);
  assert.deepEqual(wfs.seedWorkflows(src, dest), []); // idempotent

  // user-created workflow: listed as custom, never touched
  write(dest, 'mine.yaml', yamlOf('mine', '0.1.0'));
  // deleted by the user: does not come back
  fs.rmSync(path.join(dest, 'b.yaml'));
  // new bundled workflow in a later app version: copied
  write(src, 'c.yaml', yamlOf('c', '1.0.0'));
  assert.deepEqual(wfs.seedWorkflows(src, dest), ['c.yaml']);
  assert.equal(fs.existsSync(path.join(dest, 'b.yaml')), false);
  assert.equal(read(dest, 'mine.yaml'), yamlOf('mine', '0.1.0'));

  // a user file with the name of a new bundled workflow is kept (it is theirs)
  write(dest, 'd.yaml', 'USER');
  write(src, 'd.yaml', yamlOf('d', '1.0.0'));
  assert.deepEqual(wfs.seedWorkflows(src, dest), []);
  assert.equal(read(dest, 'd.yaml'), 'USER');
  assert.deepEqual(wfs.workflowStatus(src, dest)['d.yaml'], { origin: 'custom', updateAvailable: false, restorable: false });
  assert.deepEqual(wfs.workflowStatus(src, dest)['mine.yaml'].origin, 'custom');
});

test('a bundled version bump reaches untouched copies; edited copies are kept and flagged', (t) => {
  const src = tmp(t);
  const dest = path.join(tmp(t), 'workflows');
  write(src, 'software-development.yaml', yamlOf('software-development', '0.9.0'));
  write(src, 'ai-arena.yaml', yamlOf('ai-arena', '0.9.0'));
  wfs.seedWorkflows(src, dest);
  assert.deepEqual(wfs.workflowStatus(src, dest)['software-development.yaml'], { origin: 'default', updateAvailable: false, restorable: false });

  write(dest, 'ai-arena.yaml', yamlOf('ai-arena', '0.9.0', 'edited_step')); // user edit
  assert.deepEqual(wfs.workflowStatus(src, dest)['ai-arena.yaml'], { origin: 'modified', updateAvailable: false, restorable: true });

  write(src, 'software-development.yaml', yamlOf('software-development', '0.10.0'));
  write(src, 'ai-arena.yaml', yamlOf('ai-arena', '0.10.0'));
  assert.deepEqual(wfs.seedWorkflows(src, dest), ['software-development.yaml']);
  assert.match(read(dest, 'software-development.yaml'), /version: 0\.10\.0/);
  assert.match(read(dest, 'ai-arena.yaml'), /edited_step/);
  const status = wfs.workflowStatus(src, dest);
  assert.equal(status['software-development.yaml'].origin, 'default');
  assert.deepEqual(status['ai-arena.yaml'], { origin: 'modified', updateAvailable: true, restorable: true });
  assert.deepEqual(wfs.seedWorkflows(src, dest), []);

  // restore default: the new bundled version, untouched again (and updated by later versions)
  wfs.restoreWorkflow(src, dest, 'ai-arena.yaml');
  assert.equal(read(dest, 'ai-arena.yaml'), read(src, 'ai-arena.yaml'));
  assert.deepEqual(wfs.workflowStatus(src, dest)['ai-arena.yaml'], { origin: 'default', updateAvailable: false, restorable: false });
  write(src, 'ai-arena.yaml', yamlOf('ai-arena', '0.11.0'));
  assert.deepEqual(wfs.seedWorkflows(src, dest), ['ai-arena.yaml']);
  assert.throws(() => wfs.restoreWorkflow(src, dest, 'mine.yaml'), /not a bundled default/);
});

test('an edited copy that matches the new default becomes untouched again', (t) => {
  const src = tmp(t);
  const dest = path.join(tmp(t), 'workflows');
  write(src, 'a.yaml', yamlOf('a', '1.0.0'));
  wfs.seedWorkflows(src, dest);
  write(src, 'a.yaml', yamlOf('a', '2.0.0'));
  write(dest, 'a.yaml', yamlOf('a', '2.0.0')); // the user made the same change
  assert.deepEqual(wfs.seedWorkflows(src, dest), []);
  assert.equal(wfs.workflowStatus(src, dest)['a.yaml'].origin, 'default');
  assert.ok(JSON.parse(read(dest, MANIFEST))['a.yaml']);
});

// ---- #203: a workflow copy changed only in an input's `default:` is not "frozen" -----------------

const yamlWithInput = (name, version, def, { label = '' } = {}) => `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: ${name}
  version: ${version}
inputs:
  unit_tests:
    type: string
    enum: [write_and_run, "off"]
${label}
    default: ${def}
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do it"
`;

test('#203: a bump that only ships a new default reaches a copy whose only edit was its own default; the owner\'s value is kept, and later bumps keep reaching it too', (t) => {
  const src = tmp(t);
  const dest = path.join(tmp(t), 'workflows');
  write(src, 'a.yaml', yamlWithInput('a', '1.0.0', 'write_and_run'));
  wfs.seedWorkflows(src, dest);
  // the owner turns it off in their copy (nothing else touched): baseHash ignores the default line,
  // so it is still the kind of edit carryOver understands, even though its bytes differ (shown as
  // "modified", like any edited copy, until the next bump carries it forward)
  write(dest, 'a.yaml', yamlWithInput('a', '1.0.0', 'off'));
  assert.deepEqual(wfs.workflowStatus(src, dest)['a.yaml'], { origin: 'modified', updateAvailable: false, restorable: true });

  // a later app version ships a change elsewhere (not the input): the owner's default survives it
  write(src, 'a.yaml', yamlWithInput('a', '2.0.0', 'write_and_run', { label: '    label: Unit tests' }));
  assert.deepEqual(wfs.seedWorkflows(src, dest), ['a.yaml']);
  assert.match(read(dest, 'a.yaml'), /version: 2\.0\.0/);
  assert.match(read(dest, 'a.yaml'), /label: Unit tests/); // the rest of the new version came through
  assert.match(read(dest, 'a.yaml'), /default: off/); // the owner's value survived the update
  assert.deepEqual(wfs.seedWorkflows(src, dest), [], 'idempotent: nothing left to carry over');

  // unlike a genuinely modified copy (which freezes forever, see the next test), this one keeps
  // receiving later bumps too: it never "freezes" just because its default differs
  write(src, 'a.yaml', yamlWithInput('a', '3.0.0', 'write_and_run', { label: '    label: Unit tests' }));
  assert.deepEqual(wfs.seedWorkflows(src, dest), ['a.yaml']);
  assert.match(read(dest, 'a.yaml'), /version: 3\.0\.0/);
  assert.match(read(dest, 'a.yaml'), /default: off/); // the owner's value survives every later bump
});

test('#203: an edit outside the input defaults (a step, a prompt) is still kept frozen, like before', (t) => {
  const src = tmp(t);
  const dest = path.join(tmp(t), 'workflows');
  write(src, 'a.yaml', yamlOf('a', '1.0.0'));
  wfs.seedWorkflows(src, dest);
  write(dest, 'a.yaml', yamlOf('a', '1.0.0', 'edited_step')); // a real edit, not an input default
  assert.deepEqual(wfs.workflowStatus(src, dest)['a.yaml'], { origin: 'modified', updateAvailable: false, restorable: true });
  write(src, 'a.yaml', yamlOf('a', '2.0.0'));
  assert.deepEqual(wfs.seedWorkflows(src, dest), [], 'an edit outside the input defaults is kept, not silently updated');
  assert.match(read(dest, 'a.yaml'), /version: 1\.0\.0/);
  assert.deepEqual(wfs.workflowStatus(src, dest)['a.yaml'], { origin: 'modified', updateAvailable: true, restorable: true });
});

test('resolveWorkflow looks in the workspace first, then in the bundled folder', (t) => {
  const wsDir = tmp(t);
  const bundled = tmp(t);
  write(wsDir, 'a.yaml', 'ws');
  write(bundled, 'a.yaml', 'bundled');
  write(bundled, 'b.yaml', 'bundled');
  assert.deepEqual(wfs.resolveWorkflow('a.yaml', [wsDir, bundled]), { file: path.join(wsDir, 'a.yaml'), dir: wsDir, fallback: false });
  assert.deepEqual(wfs.resolveWorkflow('b.yaml', [wsDir, bundled]), { file: path.join(bundled, 'b.yaml'), dir: bundled, fallback: true });
  const abs = path.join(bundled, 'a.yaml');
  assert.equal(wfs.resolveWorkflow(abs, [wsDir]).file, abs);
  assert.throws(() => wfs.resolveWorkflow('nothing.yaml', [wsDir, bundled]), /Workflow not found/);
});

test('bundled workflows are seeded into the CLI workspace and the workspace copy wins', (t) => {
  const wsDir = tmp(t);
  const wfDir = path.join(wsDir, 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  // a user file with a bundled name: kept by the seeding and used by the CLI
  write(wfDir, 'feature.yaml', yamlOf('from-workspace', '1.0.0', 'workspace_step'));
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'run.js'), '--mock', '--auto-approve', '--task', 'cli test'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CRAFTORIO_WORKSPACE: wsDir, CRAFTORIO_MOCK_DELAY_SCALE: '0.05' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /workspace_step/);
  // the other bundled workflows were copied into the workspace
  for (const f of fs.readdirSync(path.join(root, 'workflows')).filter(wfs.isWorkflowFile)) {
    if (f !== 'feature.yaml') assert.equal(read(wfDir, f), read(path.join(root, 'workflows'), f), f);
  }
  const runs = fs.readdirSync(path.join(wsDir, 'runs'));
  assert.equal(runs.length, 1);
  const started = JSON.parse(fs.readFileSync(path.join(wsDir, 'runs', runs[0], 'events.jsonl'), 'utf8').split('\n')[0]);
  assert.equal(started.file, 'feature.yaml');
  assert.ok(samePath(wfs.resolveWorkflow(started.file, [wfDir]).file, path.join(wfDir, 'feature.yaml')));
});

test('the supervisor reads a run workflow from the workspace, falling back to the bundled copy', (t) => {
  const runDir = tmp(t);
  const wsDir = tmp(t);
  const bundled = tmp(t);
  const supervisor = require('../../domains/supervisor/supervisor');
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ type: 'workflow.started', file: 'wf.yaml', inputs: {} }) + '\n');
  write(bundled, 'wf.yaml', 'orchestrator:\n  supervisor: { model: bundled-model }\n');
  assert.equal(supervisor.supervisorConfig(runDir, [wsDir, bundled]).model, 'bundled-model');
  write(wsDir, 'wf.yaml', 'orchestrator:\n  supervisor: { model: workspace-model }\n');
  assert.equal(supervisor.supervisorConfig(runDir, [wsDir, bundled]).model, 'workspace-model');
  assert.equal(supervisor.supervisorConfig(runDir, wsDir).model, 'workspace-model'); // a single folder still works
});
