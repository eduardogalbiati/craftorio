// Acceptance tests for #399: the control channel (#336) opens the channels the operation sessions
// need (stage pause and Move on, resume without confirmGate, resume options, workflow restore and
// the watching reads), still never across a human gate and never writing settings.
// Seams: src/control/allowlist.js (CHANNELS), the control endpoint (src/control/index.js,
// POST /api/<channel> with the token of control/endpoint.json), control/calls.jsonl, the docs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const yaml = require('js-yaml');
const {
  ISSUE_WORKFLOW, makeService, makeResumeService, roadmapProject, until, watchRuns,
} = require('./service/helpers');

const ROOT = path.join(__dirname, '..');
const loadAllowlist = () => require('../src/control/allowlist');
const loadControl = () => require('../src/control');

const NEW_CHANNELS = [
  'gates:interrupted',
  'nightwatch:report',
  'nightwatch:state',
  'notifications:list',
  'roadmap:park-stage',
  'roadmap:pause-stage',
  'runs:resume',
  'runs:resumeOptions',
  'usage:get',
  'workflows:restore',
];

// Left out on purpose: they answer, skip or bypass a gate, change what automation may do on its
// own, or write settings.
const LEFT_OUT = [
  'approval:resolve',
  'nightwatch:limits',
  'nightwatch:permissions',
  'oracle:act',
  'oracle:nightWatch',
  'run:stop',
  'settings:set',
];

function request(url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Turns the switch on and opens the endpoint; returns the call an outside session makes.
async function openChannel(t, service) {
  const { createControlChannel } = loadControl();
  const control = createControlChannel({ service });
  t.after(() => control.stop());
  service.api['settings:set']({ controlChannel: true });
  await control.update();
  const endpoint = JSON.parse(fs.readFileSync(path.join(service.workspace().root, 'control', 'endpoint.json'), 'utf8'));
  return (channel, arg) => request(`${endpoint.url}/api/${channel}`, {
    headers: { authorization: `Bearer ${endpoint.token}` },
    body: arg === undefined ? {} : { arg },
  });
}

function readCalls(service) {
  const file = path.join(service.workspace().root, 'control', 'calls.jsonl');
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Starts a run, approves every gate it meets and resolves with its run id and its end event.
function runToEnd(service, api, opts) {
  const finished = new Promise((resolve) => {
    const onEvent = (ev) => {
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
      if (ev.type === 'workflow.finished') { service.events.off('run:event', onEvent); resolve(ev); }
    };
    service.events.on('run:event', onEvent);
  });
  return api['run:start'](opts).then(async (started) => ({ ...started, end: await finished }));
}

// ---- The allowlist ---------------------------------------------------------------------------------

test('#399 allowlist: the ten channels of the operation are allowed, each a real manifest channel', (t) => {
  const list = Array.from(loadAllowlist().CHANNELS);
  const { service } = makeService(t);
  const known = new Set(service.manifest.map((e) => e.channel).filter(Boolean));
  assert.deepEqual(NEW_CHANNELS.filter((c) => !list.includes(c)), [], 'every new channel is in the allowlist');
  assert.deepEqual(NEW_CHANNELS.filter((c) => !known.has(c)), [], 'every new channel is a manifest channel');
});

test('#399 allowlist: run:stop, the Night watch permissions and limits, the Oracle\'s actions, settings:set and every gate channel stay out', () => {
  const list = Array.from(loadAllowlist().CHANNELS);
  assert.deepEqual(LEFT_OUT.filter((c) => list.includes(c)), []);
  assert.deepEqual(list.filter((c) => /^(approval|gate|gates|phonegates):/.test(c) && c !== 'gates:interrupted'), []);
  assert.deepEqual(list.filter((c) => /^gate:/.test(c)), []);
});

test('#399 allowlist: one channel per line, sorted', () => {
  const list = Array.from(loadAllowlist().CHANNELS);
  assert.deepEqual(list, [...list].sort());
  const src = fs.readFileSync(path.join(ROOT, 'src', 'control', 'allowlist.js'), 'utf8');
  for (const channel of NEW_CHANNELS) assert.match(src, new RegExp(`^\\s*'${channel}',\\s*$`, 'm'), `${channel} on its own line`);
});

test('#399 allowlist: its header comment says why the left-out channels stay out', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'control', 'allowlist.js'), 'utf8');
  const header = src.slice(0, src.indexOf('const CHANNELS'));
  for (const channel of ['run:stop', 'nightwatch:permissions', 'nightwatch:limits', 'oracle:act']) {
    assert.ok(header.includes(channel), `the header names ${channel}`);
  }
});

// ---- Reads for watching ------------------------------------------------------------------------------

test('#399 reads: notifications, interrupted gates, Night watch state and report, usage (machine scope too) answer through the endpoint', async (t) => {
  const { service } = makeService(t);
  const call = await openChannel(t, service);
  const reads = [
    ['notifications:list', undefined],
    ['gates:interrupted', undefined],
    ['nightwatch:state', undefined],
    ['nightwatch:report', undefined],
    ['usage:get', undefined],
    ['usage:get', { scope: 'machine' }],
  ];
  for (const [channel, arg] of reads) {
    const res = await call(channel, arg);
    assert.equal(res.status, 200, `${channel}: ${res.text}`);
    assert.equal(res.json !== null && 'result' in res.json, true, `${channel} answers with a result`);
  }
  const logged = new Set(readCalls(service).map((c) => c.channel));
  for (const [channel] of reads) assert.equal(logged.has(channel), true, `${channel} is logged in calls.jsonl`);
});

// ---- runs:resume and runs:resumeOptions ---------------------------------------------------------------

test('#399 runs:resumeOptions answers through the endpoint with the steps the Resume dialog offers', async (t) => {
  const { service, api } = makeResumeService(t);
  const first = await runToEnd(service, api, { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  const call = await openChannel(t, service);
  const res = await call('runs:resumeOptions', { runId: first.runId });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.result.steps.map((s) => s.id), ['plan', 'approve', 'work']);
});

test('#399 runs:resume without confirmGate starts the resumed run, as the Resume dialog does, and is logged', async (t) => {
  const { service, api } = makeResumeService(t);
  const first = await runToEnd(service, api, { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  const { finished } = watchRuns(service);
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });
  const call = await openChannel(t, service);

  const res = await call('runs:resume', { runId: first.runId, step: 'plan' });
  assert.equal(res.status, 200, res.text);
  await until(() => started.some((e) => e.resumed_from && e.resumed_from.run_id === first.runId));
  const resumed = started.find((e) => e.resumed_from && e.resumed_from.run_id === first.runId);
  assert.equal(resumed.resumed_from.step, 'plan');
  // the gate it reaches again asks again: nobody answers it, so the run waits; stop it at the end
  t.after(() => { try { api['run:stop']({ runId: resumed.run_id }); } catch { /* already ended */ } });
  assert.equal(finished.has(resumed.run_id) && finished.get(resumed.run_id) === 'success', false);
  const logged = readCalls(service).find((c) => c.channel === 'runs:resume');
  assert.ok(logged, 'the resume is logged in calls.jsonl');
  assert.equal(Boolean(logged.error), false);
});

test('#399 runs:resume past a gate the previous run decided gets the refusal of resume.js, with its message', async (t) => {
  const { service, api } = makeResumeService(t);
  const first = await runToEnd(service, api, { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  const call = await openChannel(t, service);
  const res = await call('runs:resume', { runId: first.runId, step: 'work' });
  assert.notEqual(res.status, 200);
  assert.match(String(res.json && res.json.error), /Cannot resume from "work": it would go past the human gate "approve"/);
  assert.equal(api['runs:active']().length, 0, 'no run started');
});

test('#399 runs:resume carrying confirmGate (any value but null or false) is refused with 403 and starts nothing', async (t) => {
  const { service, api } = makeResumeService(t);
  const first = await runToEnd(service, api, { file: 'fixture-resume.yaml', inputs: {}, mock: true });
  const call = await openChannel(t, service);
  for (const confirmGate of ['approve', true, '', 0]) {
    const res = await call('runs:resume', { runId: first.runId, step: 'work', confirmGate });
    assert.equal(res.status, 403, `confirmGate ${JSON.stringify(confirmGate)}`);
    assert.match(String(res.json && res.json.error), /confirmGate/);
  }
  assert.equal(api['runs:active']().length, 0, 'no run started');
});

// ---- workflows:restore ---------------------------------------------------------------------------------

const BUNDLED = 'ai-arena.yaml';

function editCopy(service, edit) {
  const file = path.join(service.workspace().workflows, BUNDLED);
  assert.equal(fs.existsSync(file), true, `the workspace has a copy of the bundled ${BUNDLED}`);
  fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')));
  return file;
}

// The copy with one more human_approval step than its bundled default.
const withExtraGate = (text) => {
  const doc = yaml.load(text);
  doc.steps.push({ id: 'owner_extra_gate', type: 'human_approval', message: 'Ship it?' });
  return yaml.dump(doc, { lineWidth: -1 });
};

test('#399 workflows:restore through the endpoint is refused for a copy with a human_approval step the default lacks, naming it', async (t) => {
  const { service, trashed } = makeService(t);
  const file = editCopy(service, withExtraGate);
  const before = fs.readFileSync(file, 'utf8');
  const call = await openChannel(t, service);

  const res = await call('workflows:restore', BUNDLED);
  assert.notEqual(res.status, 200);
  assert.match(String(res.json && res.json.error), /owner_extra_gate/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the copy is kept as it is');
  assert.deepEqual(trashed, [], 'nothing goes to the trash');
  const logged = readCalls(service).find((c) => c.channel === 'workflows:restore');
  assert.ok(logged && logged.error, 'the refusal is logged in calls.jsonl');
});

test('#399 workflows:restore through the endpoint names each human gate the copy added when there are several', async (t) => {
  const { service, trashed } = makeService(t);
  editCopy(service, (text) => {
    const doc = yaml.load(text);
    doc.steps.push({ id: 'owner_gate_one', type: 'human_approval', message: 'One?' });
    doc.steps.push({ id: 'owner_gate_two', type: 'human_approval', message: 'Two?' });
    return yaml.dump(doc, { lineWidth: -1 });
  });
  const call = await openChannel(t, service);

  const res = await call('workflows:restore', BUNDLED);
  assert.equal(res.status, 403, res.text);
  const error = String(res.json && res.json.error);
  assert.match(error, /owner_gate_one/);
  assert.match(error, /owner_gate_two/);
  assert.deepEqual(trashed, []);
});

test('#399 workflows:restore through the endpoint, for a copy without an extra gate, works as the app\'s Restore: old copy to the trash, copy marked default', async (t) => {
  const { service, api, trashed } = makeService(t);
  const file = editCopy(service, (text) => `${text}\n# edited by the owner\n`);
  const call = await openChannel(t, service);

  const res = await call('workflows:restore', BUNDLED);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(trashed.map((p) => path.resolve(p)), [path.resolve(file)]);
  assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(ROOT, 'workflows', BUNDLED), 'utf8'));
  const listed = (await api['workflows:list']()).find((w) => w.file === BUNDLED);
  assert.equal(listed && listed.origin, 'default');
});

test('#399 the app\'s own Restore is unchanged: it restores a copy with an extra gate', async (t) => {
  const { service, api, trashed } = makeService(t);
  const file = editCopy(service, withExtraGate);
  assert.equal(await api['workflows:restore'](BUNDLED), true);
  assert.equal(trashed.length, 1);
  assert.equal(fs.readFileSync(file, 'utf8').includes('owner_extra_gate'), false);
});

// ---- roadmap:park-stage and roadmap:pause-stage -----------------------------------------------------------

async function startedRoadmap(t, stages, name, max) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const numbers = stages.flat();
  const p = await roadmapProject(api, ws, t, numbers, name);
  api['settings:set']({ concurrentRuns: { enabled: true, max, perProject: null, countSimulations: true } });
  const { gates, finished } = watchRuns(service);
  const resolved = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'approval.resolved') resolved.push(ev); });
  const it = (number) => ({ workflow: 'fixture-issue.yaml', number, mock: true });
  await api['roadmap:save']({ projectId: p.id, stages: stages.map((items) => ({ items: items.map(it) })) });
  const get = () => api['roadmap:get']({ projectId: p.id });
  return { service, api, p, get, gates, finished, resolved };
}

test('#399 roadmap:park-stage through the endpoint moves on as on the screen: the gate keeps waiting, a history line, Undo through roadmap:undo', async (t) => {
  const { service, api, p, get, gates, resolved } = await startedRoadmap(t, [[1, 2], [3]], 'ctl-park-stage', 1);
  const call = await openChannel(t, service);
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => !!get().stages[0].items[0].runId && gates.has(get().stages[0].items[0].runId));
  const run1 = get().stages[0].items[0].runId;
  const versionsBefore = (await api['roadmap:versions']({ projectId: p.id })).length;

  const res = await call('roadmap:park-stage', { projectId: p.id, stageId: get().stages[0].id });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(get().stages[0].items.map((x) => x.status), ['parked', 'skipped']);
  assert.equal(resolved.length, 0, 'the gate is not answered');
  assert.equal(api['runs:active']().some((r) => r.runId === run1), true, 'the parked run still waits at its gate');
  const versions = await api['roadmap:versions']({ projectId: p.id });
  assert.equal(versions.length, versionsBefore + 1, 'a line in the roadmap history');

  const undo = await call('roadmap:undo', { projectId: p.id, editId: res.json.result.edit.id });
  assert.equal(undo.status, 200, undo.text);
  assert.deepEqual([get().stages[0].items[0].status, get().stages[0].items[0].runId], ['running', run1]);
  assert.notEqual(get().stages[0].items[1].status, 'skipped');
});

test('#399 roadmap:pause-stage through the endpoint pauses the stage\'s run at its gate, unanswered, with a line in the roadmap history', async (t) => {
  const { service, api, p, get, gates, finished, resolved } = await startedRoadmap(t, [[1]], 'ctl-pause-stage', 1);
  const call = await openChannel(t, service);
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await until(() => !!get().stages[0].items[0].runId && gates.has(get().stages[0].items[0].runId));
  const run1 = get().stages[0].items[0].runId;
  const versionsBefore = (await api['roadmap:versions']({ projectId: p.id })).length;

  const res = await call('roadmap:pause-stage', { projectId: p.id, stageId: get().stages[0].id });
  assert.equal(res.status, 200, res.text);
  await until(() => finished.has(run1));
  assert.equal(finished.get(run1), 'paused');
  assert.equal(resolved.length, 0, 'the gate is not answered');
  assert.equal(get().state, 'paused');
  const versions = await api['roadmap:versions']({ projectId: p.id });
  assert.equal(versions.length, versionsBefore + 1, 'a line in the roadmap history');
  assert.equal(typeof (res.json.result.edit && res.json.result.edit.id), 'string', 'its answer names the edit Undo takes back');
});

test('#399 roadmap:pause-stage through the endpoint gets the screen\'s refusal when nothing of the stage runs', async (t) => {
  const { service, p, get } = await startedRoadmap(t, [[1]], 'ctl-pause-refused', 1);
  const call = await openChannel(t, service);
  const res = await call('roadmap:pause-stage', { projectId: p.id, stageId: get().stages[0].id });
  assert.notEqual(res.status, 200);
  assert.match(String(res.json && res.json.error), /Nothing of this stage is running/);
});

// ---- Docs ------------------------------------------------------------------------------------------------

test('#399 docs: control-channel.md lists the new channels, the ones left out and says a real resume costs money', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'features', 'control-channel.md'), 'utf8');
  for (const channel of [...NEW_CHANNELS, 'run:stop', 'nightwatch:permissions', 'nightwatch:limits', 'oracle:act']) {
    assert.ok(doc.includes(channel), `the doc names ${channel}`);
  }
  assert.match(doc, /runs:resume[^\n]*(money|cost)|(money|cost)[^\n]*runs:resume/i);
});
