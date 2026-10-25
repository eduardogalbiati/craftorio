// Acceptance tests for #336: the control channel, a loopback endpoint outside sessions use to drive
// the running app through its own channels (an allowlist), never across a human gate.
// Seams: src/control/allowlist.js (CHANNELS, the allowlisted channel names), src/control/index.js
// (createControlChannel({ service }) → { update(), stop() }; update() follows the controlChannel
// setting and resolves { enabled, url, port, file, error }), scripts/ctl.js, the docs.
// The modules are loaded inside each test: they do not exist before the change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { builtinModules } = require('module');
const { ISSUE_WORKFLOW, makeService, roadmapProject, until } = require('./service/helpers');
const { setupWorkspace } = require('../src/domains/workspace/workspace');

const ROOT = path.join(__dirname, '..');
const loadAllowlist = () => require('../src/control/allowlist');
const loadControl = () => require('../src/control');

function request(url, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Turns the switch on and opens the endpoint; returns what an outside session reads.
async function openChannel(t, service) {
  const { createControlChannel } = loadControl();
  const control = createControlChannel({ service });
  t.after(() => control.stop());
  service.api['settings:set']({ controlChannel: true });
  const status = await control.update();
  const file = path.join(service.workspace().root, 'control', 'endpoint.json');
  const endpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
  const call = (channel, arg, headers = {}) => request(`${endpoint.url}/api/${channel}`, {
    headers: { authorization: `Bearer ${endpoint.token}`, ...headers },
    body: arg === undefined ? {} : { arg },
  });
  return { control, status, file, endpoint, call };
}

function readCalls(service) {
  const file = path.join(service.workspace().root, 'control', 'calls.jsonl');
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('allowlist: lists the reading channels and the roadmap actions, each a real manifest channel', (t) => {
  const { CHANNELS } = loadAllowlist();
  const { service } = makeService(t);
  const list = Array.from(CHANNELS);
  for (const channel of ['roadmap:get', 'roadmap:save', 'roadmap:pause', 'roadmap:start', 'roadmap:item', 'roadmap:undo',
    'settings:get', 'backlog:get', 'runs:list', 'runs:events']) {
    assert.equal(list.includes(channel), true, `${channel} is allowed`);
  }
  const known = new Set(service.manifest.map((e) => e.channel).filter(Boolean));
  for (const channel of list) assert.equal(known.has(channel), true, `${channel} is a manifest channel`);
});

test('allowlist: never contains a channel that answers, skips or bypasses a human gate', () => {
  const list = Array.from(loadAllowlist().CHANNELS);
  assert.equal(list.includes('approval:resolve'), false);
  assert.deepEqual(list.filter((c) => c.startsWith('phonegates:')), []);
  assert.deepEqual(list.filter((c) => /approv/i.test(c)), []);
  // Writing settings could turn gates or the switch itself off: outside sessions only read them.
  assert.equal(list.includes('settings:set'), false);
});

test('switch: off by default, update() opens nothing and writes no endpoint file', async (t) => {
  const { service, api } = makeService(t);
  assert.equal(api['settings:get']().controlChannel, false);
  const { createControlChannel } = loadControl();
  const control = createControlChannel({ service });
  t.after(() => control.stop());
  const status = await control.update();
  assert.equal(status.enabled, false);
  assert.equal(fs.existsSync(path.join(service.workspace().root, 'control', 'endpoint.json')), false);
});

test('switch on: endpoint.json gives a 127.0.0.1 url and a random token, and the status names the port and the file', async (t) => {
  const { service } = makeService(t);
  const { status, file, endpoint } = await openChannel(t, service);
  const url = new URL(endpoint.url);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(status.enabled, true);
  assert.equal(String(status.port), url.port);
  assert.equal(path.resolve(status.file), path.resolve(file));
  assert.equal(typeof endpoint.token, 'string');
  assert.ok(endpoint.token.length >= 32, 'a long random token');
  assert.equal(status.error || null, null);
});

test('switch off: the port closes and endpoint.json is deleted; on again gives a new token', async (t) => {
  const { service, api } = makeService(t);
  const { control, file, endpoint } = await openChannel(t, service);
  api['settings:set']({ controlChannel: false });
  const off = await control.update();
  assert.equal(off.enabled, false);
  assert.equal(fs.existsSync(file), false);
  await assert.rejects(request(`${endpoint.url}/api/settings:get`, { headers: { authorization: `Bearer ${endpoint.token}` }, body: {} }));

  api['settings:set']({ controlChannel: true });
  await control.update();
  const again = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.notEqual(again.token, endpoint.token);
});

test('stop(): closes the port and removes endpoint.json (the app quitting)', async (t) => {
  const { service } = makeService(t);
  const { control, file, endpoint } = await openChannel(t, service);
  await control.stop();
  assert.equal(fs.existsSync(file), false);
  await assert.rejects(request(`${endpoint.url}/api/settings:get`, { headers: { authorization: `Bearer ${endpoint.token}` }, body: {} }));
});

test('token: a call without it or with a wrong one gets 401', async (t) => {
  const { service } = makeService(t);
  const { endpoint } = await openChannel(t, service);
  const none = await request(`${endpoint.url}/api/settings:get`, { body: {} });
  assert.equal(none.status, 401);
  const wrong = await request(`${endpoint.url}/api/settings:get`, { headers: { authorization: 'Bearer wrong-token-0123456789abcdef0123' }, body: {} });
  assert.equal(wrong.status, 401);
});

test('an allowed channel answers with its result, as from the screen', async (t) => {
  const { service } = makeService(t);
  const { call } = await openChannel(t, service);
  const res = await call('settings:get');
  assert.equal(res.status, 200);
  assert.equal(res.json.result.controlChannel, true);
});

test('a channel outside the allowlist gets 403 naming the channel', async (t) => {
  const { service } = makeService(t);
  const { call } = await openChannel(t, service);
  for (const channel of ['approval:resolve', 'phonegates:configure', 'run:start', 'settings:set']) {
    const res = await call(channel, {});
    assert.equal(res.status, 403, channel);
    assert.match(String(res.json && res.json.error), new RegExp(channel), channel);
  }
});

test('runs:resume carrying confirmGate is refused', async (t) => {
  const { service } = makeService(t);
  const { call } = await openChannel(t, service);
  const res = await call('runs:resume', { runId: 'r1', step: 'review', confirmGate: 'review' });
  assert.equal(res.status, 403);
});

test('a request from another origin is refused', async (t) => {
  const { service } = makeService(t);
  const { call } = await openChannel(t, service);
  const res = await call('settings:get', undefined, { origin: 'http://evil.example' });
  assert.equal(res.status, 403);
});

test('loopback only: the port is not reachable on another interface of the machine', async (t) => {
  const external = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (!external) { t.skip('no non-loopback IPv4 interface on this machine'); return; }
  const { service } = makeService(t);
  const { endpoint } = await openChannel(t, service);
  const port = new URL(endpoint.url).port;
  await assert.rejects(request(`http://${external.address}:${port}/api/settings:get`, { headers: { authorization: `Bearer ${endpoint.token}` }, body: {} }));
});

test('roadmap:start through the endpoint dispatches at once, as the Roadmap screen button does', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'control-start');
  await api['roadmap:save']({ projectId: p.id, stages: [{ name: 'Stage one', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }] });
  const { call } = await openChannel(t, service);
  assert.equal(api['runs:active']().length, 0);

  const res = await call('roadmap:start', { projectId: p.id, simulated: true });
  assert.equal(res.status, 200, res.text);
  await until(() => api['runs:active']().some((r) => r.issues.some((i) => i.number === 1)));
});

test('every call is appended to control/calls.jsonl: time, channel, short argument summary, result or error', async (t) => {
  const { service } = makeService(t);
  const { call } = await openChannel(t, service);
  await call('settings:get');
  await call('approval:resolve', { runId: 'r', id: 'g', answer: true });
  await call('roadmap:get', { projectId: 'x'.repeat(5000) });

  const calls = readCalls(service);
  const ok = calls.find((c) => c.channel === 'settings:get');
  assert.ok(ok, 'the allowed call is recorded');
  assert.equal(Number.isNaN(Date.parse(ok.time)), false);
  assert.equal(Boolean(ok.error), false);
  const refused = calls.find((c) => c.channel === 'approval:resolve');
  assert.ok(refused, 'the refused call is recorded');
  assert.ok(refused.error, 'with its error');
  const big = calls.find((c) => c.channel === 'roadmap:get');
  assert.ok(big, 'the large call is recorded');
  assert.ok(JSON.stringify(big).length < 2000, 'its arguments are summarised, not copied');
});

test('scripts/ctl.js: reads endpoint.json, calls a channel and prints its result', async (t) => {
  const { service } = makeService(t);
  await openChannel(t, service);
  const ctl = path.join(ROOT, 'scripts', 'ctl.js');
  assert.equal(fs.existsSync(ctl), true, 'scripts/ctl.js exists');
  const env = { ...process.env, MULTIAGENT_WORKSPACE: service.workspace().root };
  // Async: the endpoint is served by this very process.
  const { stdout } = await promisify(execFile)(process.execPath, [ctl, 'settings:get'], { env, timeout: 30000 });
  const printed = JSON.parse(stdout);
  const result = printed && Object.hasOwn(printed, 'result') ? printed.result : printed;
  assert.equal(result.controlChannel, true);

  const refused = await promisify(execFile)(process.execPath, [ctl, 'approval:resolve', '{"runId":"r","id":"g","answer":true}'], { env, timeout: 30000 })
    .then(() => null, (e) => e);
  assert.ok(refused, 'a refused channel exits non-zero');
  assert.match(String(refused.stderr) + String(refused.stdout), /approval:resolve/);
});

test('scripts/ctl.js: plain Node, no dependencies', () => {
  const ctl = path.join(ROOT, 'scripts', 'ctl.js');
  assert.equal(fs.existsSync(ctl), true, 'scripts/ctl.js exists');
  const src = fs.readFileSync(ctl, 'utf8');
  const required = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1].replace(/^node:/, ''));
  assert.deepEqual(required.filter((m) => !builtinModules.includes(m)), []);
});

test('docs: a docs/features fragment maps each tools/roadmap operation to channel calls, with curl and Invoke-RestMethod', () => {
  const dir = path.join(ROOT, 'docs', 'features');
  const doc = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .find((text) => text.includes('control/endpoint.json'));
  assert.ok(doc, 'a docs/features fragment documents control/endpoint.json');
  for (const op of ['pause', 'resume', 'new-stage', 'new-stage-at', 'add-to-stage', 'append-issue', 'swap', 'add-task', 'restore-stage', 'move-stage-after']) {
    assert.match(doc, new RegExp(`\\b${op}\\b`), op);
  }
  for (const channel of ['roadmap:get', 'roadmap:save', 'roadmap:pause', 'roadmap:start']) assert.equal(doc.includes(channel), true, channel);
  assert.match(doc, /curl/);
  assert.match(doc, /Invoke-RestMethod/);
  assert.match(doc, /multiagent-ctl|ctl\.js/); // #342: the client is the multiagent-ctl binary
});

test('docs: capabilities.md says outside sessions act through the control endpoint, not by editing workspace files', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'agents', 'capabilities.md'), 'utf8');
  assert.match(doc, /control\/endpoint\.json/);
  assert.match(doc, /outside session/i);
});

// ---- follow-ups after the change (developer's and reviewer's notes) ---------------------------------

test('a request whose Host is not the loopback address gets 403 even without an Origin (DNS rebinding); localhost works', async (t) => {
  const { service } = makeService(t);
  const { endpoint } = await openChannel(t, service);
  const port = new URL(endpoint.url).port;
  const auth = { authorization: `Bearer ${endpoint.token}` };
  const foreign = await request(`${endpoint.url}/api/settings:get`, { headers: { ...auth, host: `evil.example:${port}` }, body: {} });
  assert.equal(foreign.status, 403);
  const local = await request(`${endpoint.url}/api/settings:get`, { headers: { ...auth, host: `localhost:${port}` }, body: {} });
  assert.equal(local.status, 200);
});

test('error state: when the endpoint cannot open, the status says why and nothing listens; it opens once the cause is gone', async (t) => {
  const { service, api } = makeService(t);
  const blocker = path.join(service.workspace().root, 'control');
  fs.writeFileSync(blocker, 'a file where the control folder goes'); // the endpoint file cannot be written
  const { createControlChannel } = loadControl();
  const control = createControlChannel({ service });
  t.after(() => control.stop());
  api['settings:set']({ controlChannel: true });
  const failed = await control.update();
  assert.equal(failed.enabled, false);
  assert.equal(failed.port, null);
  assert.match(String(failed.error), /^The control channel could not open: /);

  fs.rmSync(blocker);
  const opened = await control.update();
  assert.equal(opened.enabled, true);
  assert.equal(opened.error, null);
  assert.equal(fs.existsSync(path.join(blocker, 'endpoint.json')), true);
});

test('switch off at start: a stale endpoint.json left by an abrupt exit is removed', async (t) => {
  const { service } = makeService(t);
  const dir = path.join(service.workspace().root, 'control');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'endpoint.json');
  fs.writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:1', token: 'stale' }));
  const { createControlChannel } = loadControl();
  const control = createControlChannel({ service });
  t.after(() => control.stop());
  const status = await control.update();
  assert.equal(status.enabled, false);
  assert.equal(fs.existsSync(file), false, 'an outside session never reads the address of a closed app');
});

test('a workspace change closes the old endpoint (its file removed) and follows the new workspace\'s setting', async (t) => {
  const { service, api } = makeService(t);
  const { control, file, endpoint } = await openChannel(t, service);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'control-ws2-'));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  service.setWorkspace(setupWorkspace(other, { persist: false }));
  api['settings:set']({ controlChannel: true });
  const status = await control.update();
  assert.equal(fs.existsSync(file), false, 'the first workspace no longer advertises an endpoint');
  const otherFile = path.join(other, 'control', 'endpoint.json');
  assert.equal(path.resolve(status.file), path.resolve(otherFile));
  const next = JSON.parse(fs.readFileSync(otherFile, 'utf8'));
  assert.notEqual(next.token, endpoint.token);
  const res = await request(`${next.url}/api/settings:get`, { headers: { authorization: `Bearer ${next.token}` }, body: {} });
  assert.equal(res.status, 200);
});

test('confirmGate is refused on any allowed channel, not only runs:resume', async (t) => {
  const { service } = makeService(t);
  const { call } = await openChannel(t, service);
  const res = await call('roadmap:get', { projectId: 'x', confirmGate: 'review' });
  assert.equal(res.status, 403);
  assert.match(String(res.json && res.json.error), /confirmGate/);
});

test('calls.jsonl: a very long channel name and its error are cut short', async (t) => {
  const { service } = makeService(t);
  const { call } = await openChannel(t, service);
  const res = await call('a'.repeat(3000), {});
  assert.equal(res.status, 403);
  const line = readCalls(service).find((c) => String(c.channel).startsWith('aaa'));
  assert.ok(line, 'the call is recorded');
  assert.ok(line.channel.length <= 300, `channel cut: ${line.channel.length}`);
  assert.ok(String(line.error).length <= 600, `error cut: ${String(line.error).length}`);
});

test('roadmap:save through the endpoint with a stale base goes through the #287 merge: the screen\'s save is kept', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'control-merge');
  await api['roadmap:save']({ projectId: p.id, stages: [
    { name: 'One', note: '', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] },
    { name: 'Two', note: '', items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
  ], label: 'Planned' });
  const { call } = await openChannel(t, service);
  const read = (await call('backlog:get', { projectId: p.id })).json.result.roadmap; // the outside session reads
  assert.ok(read.updatedAt);

  await new Promise((r) => setTimeout(r, 15)); // the screen's save gets a newer updatedAt
  const screen = JSON.parse(JSON.stringify(read.stages));
  screen[1].name = 'Screen';
  await api['roadmap:save']({ projectId: p.id, stages: screen, label: 'Renamed stage 2', base: read.updatedAt });

  const outside = JSON.parse(JSON.stringify(read.stages));
  outside[0].name = 'Outside';
  const res = await call('roadmap:save', { projectId: p.id, stages: outside, label: 'Renamed stage 1', base: read.updatedAt });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.result.conflict, undefined, JSON.stringify(res.json.result.conflict));
  const names = api['roadmap:get']({ projectId: p.id }).stages.map((s) => s.name);
  assert.deepEqual(names, ['Outside', 'Screen']);
});

test('scripts/ctl.js: --workspace <dir> instead of MULTIAGENT_WORKSPACE', async (t) => {
  const { service } = makeService(t);
  await openChannel(t, service);
  const env = { ...process.env };
  delete env.MULTIAGENT_WORKSPACE;
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(ROOT, 'scripts', 'ctl.js'), 'settings:get', '--workspace', service.workspace().root], { env, timeout: 30000 });
  assert.equal(JSON.parse(stdout).controlChannel, true);
});

test('scripts/ctl.js: an argument that is not JSON, or no endpoint file, exits 1 with the reason on stderr', async (t) => {
  const { service } = makeService(t);
  const env = { ...process.env, MULTIAGENT_WORKSPACE: service.workspace().root };
  const ctl = path.join(ROOT, 'scripts', 'ctl.js');
  const run = (args) => promisify(execFile)(process.execPath, [ctl, ...args], { env, timeout: 30000 }).then(() => null, (e) => e);

  const noEndpoint = await run(['settings:get']);
  assert.ok(noEndpoint, 'no endpoint file: exits non-zero');
  assert.equal(noEndpoint.code, 1);
  assert.match(String(noEndpoint.stderr), /endpoint/i);

  await openChannel(t, service);
  const notJson = await run(['roadmap:get', '{projectId: nope']);
  assert.ok(notJson, 'a non-JSON argument: exits non-zero');
  assert.equal(notJson.code, 1);
  assert.match(String(notJson.stderr), /not valid JSON/);
});
