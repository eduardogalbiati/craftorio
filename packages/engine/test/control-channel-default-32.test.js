// Acceptance tests for #32: the control channel (#336) is on by default. A new workspace (no
// controlChannel in its settings) opens the loopback endpoint and writes control/endpoint.json; a
// workspace whose settings hold controlChannel: false (the user unticked it, or the old default
// written as is) stays off. README and SECURITY.md say it is on by default and where to turn it off.
// Seams: the settings:get channel, packages/engine/control (createControlChannel({ service }) →
// { update(), stop() }), the workspace's settings.json, README.md and SECURITY.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./service/helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const loadControl = () => require('../control');

const endpointFile = (service) => path.join(service.workspace().root, 'control', 'endpoint.json');
const settingsFile = (service) => service.workspace().settings;

function openControl(t, service) {
  const { createControlChannel } = loadControl();
  const control = createControlChannel({ service });
  t.after(() => control.stop());
  return control;
}

test('a new workspace reads controlChannel: true', (t) => {
  const { api } = makeService(t);
  assert.equal(api['settings:get']().controlChannel, true);
});

test('a new workspace: update() opens the channel and writes endpoint.json with a 127.0.0.1 url and a token, without touching the setting', async (t) => {
  const { service } = makeService(t);
  const control = openControl(t, service);
  const status = await control.update();
  assert.equal(status.enabled, true);
  assert.equal(status.error || null, null);
  const endpoint = JSON.parse(fs.readFileSync(endpointFile(service), 'utf8'));
  assert.equal(new URL(endpoint.url).hostname, '127.0.0.1');
  assert.equal(String(status.port), new URL(endpoint.url).port);
  assert.equal(typeof endpoint.token, 'string');
  assert.ok(endpoint.token.length >= 32, 'a long random token');
});

test('saved settings without controlChannel (other preferences saved): the channel opens', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(settingsFile(service), JSON.stringify({ keepAwake: true, developerMode: true }, null, 2));
  assert.equal(api['settings:get']().controlChannel, true);
  const control = openControl(t, service);
  const status = await control.update();
  assert.equal(status.enabled, true);
  assert.equal(fs.existsSync(endpointFile(service)), true);
});

test('saved controlChannel: false stays off: update() opens nothing and writes no endpoint file', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(settingsFile(service), JSON.stringify({ controlChannel: false, keepAwake: true }, null, 2));
  assert.equal(api['settings:get']().controlChannel, false);
  const control = openControl(t, service);
  const status = await control.update();
  assert.equal(status.enabled, false);
  assert.equal(fs.existsSync(endpointFile(service)), false);
});

test('saved controlChannel: false is kept when another preference is saved', async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(settingsFile(service), JSON.stringify({ controlChannel: false }, null, 2));
  api['settings:set']({ keepAwake: true });
  assert.equal(api['settings:get']().controlChannel, false);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile(service), 'utf8')).controlChannel, false);
  const control = openControl(t, service);
  assert.equal((await control.update()).enabled, false);
  assert.equal(fs.existsSync(endpointFile(service)), false);
});

test('a new workspace that then saves another preference (e.g. the Setup) keeps the channel on', async (t) => {
  const { service, api } = makeService(t);
  api['settings:set']({ keepAwake: true, setupDone: true });
  assert.equal(api['settings:get']().controlChannel, true);
  const control = openControl(t, service);
  assert.equal((await control.update()).enabled, true);
  assert.equal(fs.existsSync(endpointFile(service)), true);
});

test('unticking it on a new workspace closes the channel and deletes endpoint.json', async (t) => {
  const { service, api } = makeService(t);
  const control = openControl(t, service);
  await control.update();
  assert.equal(fs.existsSync(endpointFile(service)), true);
  api['settings:set']({ controlChannel: false });
  const off = await control.update();
  assert.equal(off.enabled, false);
  assert.equal(fs.existsSync(endpointFile(service)), false);
});

// the README paragraph about the control channel, from its bold title to the next blank line
function readmeControlParagraph() {
  const text = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const start = text.indexOf('**Control channel for outside sessions**');
  assert.ok(start >= 0, 'README has its "Control channel for outside sessions" paragraph');
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end < 0 ? undefined : end);
}

test('README: the control channel is on by default, and Settings › Execution turns it off', () => {
  const para = readmeControlParagraph();
  assert.doesNotMatch(para, /off by default/i);
  assert.match(para, /on by default/i);
  assert.match(para, /Settings › Execution/);
  assert.match(para, /allowlist/i, 'says what it allows');
});

test('SECURITY.md: the control channel is on by default, what it allows, and where to turn it off', () => {
  const text = fs.readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf8');
  const lines = text.split('\n').filter((l) => /control channel/i.test(l)).join(' ');
  assert.doesNotMatch(text, /control channel[^.]*off by default/i);
  assert.match(text, /control channel[^.]*on by default|on by default[^.]*control channel/i);
  assert.match(text, /Settings › Execution/);
  assert.match(lines, /allowlist/i);
});
