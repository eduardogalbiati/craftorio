const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { GATE_WORKFLOW, gitRepo, makeService, openGateFixture, resolveAndWait, untilTrue } = require('./helpers');

// ---- #104 / #70: Show the diff at a human_approval gate (developer_check) -----------------------

test('term:open kind diff: refuses without an open gate, and one that does not offer a diff', async (t) => {
  const { service, api } = makeService(t);
  assert.throws(() => api['term:open']({ kind: 'diff', runId: 'nope', approvalId: 'a1' }), /The gate is no longer open\./);

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true }); // its "review" gate has no diff_base
  const gate = await gateP;
  assert.throws(() => api['term:open']({ kind: 'diff', runId, approvalId: gate.approval_id }), /This gate does not offer a diff\./);

  assert.equal(api['approval:resolve']({ runId, id: gate.approval_id, answer: true }), true);
  assert.throws(() => api['term:open']({ kind: 'diff', runId, approvalId: gate.approval_id }), /The gate is no longer open\./);
  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId));
});

test('term:open kind diff: streams the branch\'s changes since diff_base, read-only, in the gate\'s work_dir', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);
  const gate = await openGateFixture(t, service, api, repo);
  assert.equal(gate.diff_base, repo.base);
  assert.equal(gate.work_dir, repo.dir);

  const out = [];
  service.events.on('term:data', (p) => out.push(p));
  const opened = api['term:open']({ kind: 'diff', runId: gate.run_id, approvalId: gate.approval_id });
  assert.equal(opened.cwd, repo.dir);
  await untilTrue(() => out.some((p) => p.id === opened.id && /two/.test(p.data)));
  const data = out.filter((p) => p.id === opened.id).map((p) => p.data).join('');
  assert.match(data, /a\.txt/);
  // a diff, never a rejected answer: Show the diff must not resolve the gate
  assert.equal(api['runs:active']().find((r) => r.runId === gate.run_id)?.gates.length, 1);
});

test('term:open kind diff: refuses a diff_base starting with "-" (git would read it as an option, not a ref)', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);
  const gate = await openGateFixture(t, service, api, { dir: repo.dir, base: '--upload-pack=evil' });
  assert.equal(gate.diff_base, '--upload-pack=evil');
  assert.throws(() => api['term:open']({ kind: 'diff', runId: gate.run_id, approvalId: gate.approval_id }), /Not a ref: --upload-pack=evil/);
});

test('gate:changes: the files changed since the gate\'s diff_base, added/deleted per file; refuses on a non-git folder', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);
  const gate = await openGateFixture(t, service, api, repo);
  const changes = await api['gate:changes']({ runId: gate.run_id, approvalId: gate.approval_id });
  assert.deepEqual(changes, [{ file: 'a.txt', added: 1, deleted: 0 }]);
  await resolveAndWait(api, gate.run_id, gate.approval_id, 'approve');

  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-notgit-'));
  t.after(() => fs.rmSync(plainDir, { recursive: true, force: true }));
  const notGitGate = await openGateFixture(t, service, api, { dir: plainDir, base: 'HEAD' });
  await assert.rejects(api['gate:changes']({ runId: notGitGate.run_id, approvalId: notGitGate.approval_id }), /not a git repository/);
  await resolveAndWait(api, notGitGate.run_id, notGitGate.approval_id, 'approve');
});

test('term:open kind diff: a `file` opens that file\'s diff only (git diff ... -- <file>)', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);
  // a second, untouched file: its diff must not show up when the gate's tool asks for a.txt only
  fs.writeFileSync(path.join(repo.dir, 'b.txt'), 'other\n');
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], { cwd: repo.dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'third'], { cwd: repo.dir });
  const gate = await openGateFixture(t, service, api, repo);

  const out = [];
  service.events.on('term:data', (p) => out.push(p));
  const opened = api['term:open']({ kind: 'diff', runId: gate.run_id, approvalId: gate.approval_id, file: 'a.txt' });
  await untilTrue(() => out.some((p) => p.id === opened.id && /two/.test(p.data)));
  const data = out.filter((p) => p.id === opened.id).map((p) => p.data).join('');
  assert.match(data, /a\.txt/);
  assert.doesNotMatch(data, /b\.txt/);
  await resolveAndWait(api, gate.run_id, gate.approval_id, 'approve');
});
