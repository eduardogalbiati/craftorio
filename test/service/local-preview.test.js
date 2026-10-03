const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GATE_RUN_APP_WORKFLOW, GATE_WORKFLOW, gitRepo, makeService, openGateFixture, resolveAndWait, untilTrue } = require('./helpers');

test('localPreview:start: offered only when the gate sets local_preview, runs in its work_dir, and never answers the gate', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);

  // fixture-service.yaml's "review" gate has no local_preview
  const plainGateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId: plainRunId } = await api['run:start']({ file: 'fixture-service.yaml', inputs: {}, mock: true });
  const plainGate = await plainGateP;
  await assert.rejects(api['localPreview:start']({ runId: plainRunId, approvalId: plainGate.approval_id }), /This gate does not offer Run locally/);
  await resolveAndWait(api, plainRunId, plainGate.approval_id, true); // only one run at a time by default

  const gate = await openGateFixture(t, service, api, repo);
  assert.deepEqual(gate.local_preview, { command: 'git --version' });

  const events = [];
  service.events.on('run:event', (ev) => events.push(ev));
  // #115: the first run of a declared command (here the workflow's) still needs the owner's one-click confirmation
  await assert.rejects(api['localPreview:start']({ runId: gate.run_id, approvalId: gate.approval_id }), /Confirm the command first: git --version/);
  const preview = await api['localPreview:start']({ runId: gate.run_id, approvalId: gate.approval_id, confirm: true });
  assert.equal(preview.cwd, repo.dir);
  assert.deepEqual(api['localPreview:list']().map((p) => p.runId), [gate.run_id]);
  assert.ok(events.some((e) => e.type === 'local_preview.started' && e.dir === repo.dir), 'recorded in the run');
  // never answers the gate
  assert.equal(api['runs:active']().find((r) => r.runId === gate.run_id)?.gates.length, 1);

  // stopped when the gate is answered
  await resolveAndWait(api, gate.run_id, gate.approval_id, 'approve');
  assert.deepEqual(api['localPreview:list'](), []);
});

test('localPreview:stop: the Stop button ends the preview without answering the gate', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-fixture.yaml'), GATE_WORKFLOW);
  const repo = gitRepo(t);
  const gate = await openGateFixture(t, service, api, repo);
  // #115: the first run of a declared command still needs the owner's one-click confirmation
  await api['localPreview:start']({ runId: gate.run_id, approvalId: gate.approval_id, confirm: true });
  assert.equal(api['localPreview:stop']({ runId: gate.run_id }), true);
  assert.deepEqual(api['localPreview:list'](), []);
  assert.equal(api['localPreview:stop']({ runId: gate.run_id }), false, 'nothing left to stop');
  assert.equal(api['runs:active']().find((r) => r.runId === gate.run_id)?.gates.length, 1, 'the gate is still open');
  await resolveAndWait(api, gate.run_id, gate.approval_id, 'approve');
});

// ---- #108: Run App at a gate without a configured preview (localPreview:info / :start, gate:changes) ----

test('localPreview:info: without a project config it returns a suggestion read from the worktree; after projects:update it returns the project\'s, re-read without restarting the run', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t);
  fs.writeFileSync(path.join(repo.dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;
  assert.equal(gate.run_app, true);
  assert.equal('local_preview' in gate, false);

  const before = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(before.config, null);
  assert.equal(before.source, null);
  assert.deepEqual(before.suggestion, { install: 'npm install', command: 'npm start', url: null, from: 'package.json (scripts.start)' });
  assert.equal(before.project.id, project.id);

  api['projects:update']({ id: project.id, patch: { localPreview: { install: null, command: 'git --version', url: null } } });
  const after = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.deepEqual(after.config, { install: null, command: 'git --version', url: null });
  assert.equal(after.source, 'project');

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

test('localPreview:start: refuses without a command; a one-off config arg runs on a project-less run', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t); // no project matches this folder: the run has no project

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;

  await assert.rejects(api['localPreview:start']({ runId, approvalId: gate.approval_id }), /No command to run/);

  const events = [];
  service.events.on('run:event', (ev) => events.push(ev));
  const preview = await api['localPreview:start']({ runId, approvalId: gate.approval_id, config: { command: 'git --version' } });
  assert.equal(preview.cwd, repo.dir);
  assert.ok(events.some((e) => e.type === 'local_preview.started' && e.command === 'git --version'));
  assert.equal(api['runs:active']().find((r) => r.runId === runId)?.gates.length, 1, 'starting it never answers the gate');

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

// ---- #119: localPreview:info's install state, and the terminal's first line agreeing with it ------

test('localPreview:info: install.state is "none" for a config with no install command, "will-run" with no node_modules, "skipped" once installed, and follows the suggestion without any config at all', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t);
  fs.writeFileSync(path.join(repo.dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;

  // no config at all: the install state follows the prefilled suggestion (a package.json with no lockfile: npm install)
  const noConfig = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(noConfig.suggestion.install, 'npm install');
  assert.equal(noConfig.install.state, 'will-run', 'no node_modules yet: the suggested install would run');

  // a config with a command but no install: 'none', never "will run"
  api['projects:update']({ id: project.id, patch: { localPreview: { command: 'git --version' } } });
  const noInstall = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(noInstall.install.state, 'none');

  // a config with an install command, but no node_modules yet: 'will-run'
  api['projects:update']({ id: project.id, patch: { localPreview: { install: 'npm ci', command: 'git --version' } } });
  const willRun = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(willRun.install.state, 'will-run');
  assert.match(willRun.install.text, /missing/);

  // node_modules already there, lockfile unchanged: 'skipped'
  fs.mkdirSync(path.join(repo.dir, 'node_modules'));
  fs.writeFileSync(path.join(repo.dir, 'package-lock.json'), '{}');
  const skipped = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(skipped.install.state, 'skipped');

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

test('startLocalPreview: the terminal\'s first line announces the same install state localPreview:info reports for the same config', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t);
  fs.writeFileSync(path.join(repo.dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
  // a harmless, fast "install": no real npm call in a test
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });
  api['projects:update']({ id: project.id, patch: { localPreview: { install: 'node -e "0"', command: 'git --version' } } });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;

  const info = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(info.install.state, 'will-run');

  const out = [];
  service.events.on('term:data', (p) => out.push(p));
  const opened = await api['localPreview:start']({ runId, approvalId: gate.approval_id });
  await untilTrue(() => out.some((p) => p.id === opened.id && p.data.includes('Run App:')));
  const data = out.filter((p) => p.id === opened.id).map((p) => p.data).join('');
  assert.ok(data.includes(`Run App: ${info.install.text}`), `the terminal's first line does not match localPreview:info's install text:\n${data}`);

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});

// ---- #115: the owner confirms a declared/detected run command once; an edited one asks again -------

test('Run App: a command the repository declares needs the owner\'s confirmation once; editing it asks again; the project\'s own override needs no confirmation', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'gate-run-app.yaml'), GATE_RUN_APP_WORKFLOW);
  const repo = gitRepo(t);
  fs.mkdirSync(path.join(repo.dir, '.multiagent'));
  fs.writeFileSync(path.join(repo.dir, '.multiagent', 'local-preview.yaml'), 'command: git --version\n');
  const project = await api['projects:create']({ name: 'demo', folder: repo.dir });

  const gateP = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'approval.requested') resolve(ev); }));
  const { runId } = await api['run:start']({ file: 'gate-run-app.yaml', inputs: { repo_path: repo.dir }, mock: true });
  const gate = await gateP;

  const info = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(info.source, 'repo');
  assert.equal(info.confirmed, false, 'a declared command not yet confirmed for this project');
  assert.equal(info.changed, false, 'never confirmed before: it is new, not "changed"');

  await assert.rejects(api['localPreview:start']({ runId, approvalId: gate.approval_id }), /Confirm the command first: git --version/);
  const events = [];
  service.events.on('run:event', (ev) => events.push(ev));
  await api['localPreview:start']({ runId, approvalId: gate.approval_id, confirm: true });
  assert.ok(events.some((e) => e.type === 'local_preview.started' && e.command === 'git --version'));
  assert.equal(api['projects:list']().find((p) => p.id === project.id)?.localPreviewConfirmed, info.fingerprint);
  assert.equal(api['localPreview:stop']({ runId }), true);

  const confirmedInfo = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(confirmedInfo.confirmed, true, 'confirmed for this exact command now');

  // the owner edits the repository's declared command (a new commit): it asks again
  fs.writeFileSync(path.join(repo.dir, '.multiagent', 'local-preview.yaml'), 'command: git status\n');
  const changedInfo = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(changedInfo.confirmed, false);
  assert.equal(changedInfo.changed, true, 'the declared command changed since it was confirmed');
  await assert.rejects(api['localPreview:start']({ runId, approvalId: gate.approval_id }), /Confirm the command first: git status/);

  // the project's own override always wins, and needs no confirmation of its own
  api['projects:update']({ id: project.id, patch: { localPreview: { command: 'git log -1' } } });
  const overrideInfo = await api['localPreview:info']({ runId, approvalId: gate.approval_id });
  assert.equal(overrideInfo.source, 'project');
  assert.equal(overrideInfo.confirmed, true);

  await resolveAndWait(api, runId, gate.approval_id, 'approve');
});
