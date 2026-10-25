// Findings (#361), service level: the setting that shows the Findings button in a packaged build,
// whether the app is packaged, saving and listing findings, and "File as issue": the finding reaches
// the Product Owner's agent inbox (#240) as a request naming the finding's folder.
//
// The interface these tests define (tests-first):
// - Settings: settings.findingsButton, false by default (src/workspace.js DEFAULT_SETTINGS), saved by
//   settings:set and read back by settings:get.
// - app:info adds isPackaged: the host's isPackaged (a boolean), so the renderer can apply
//   FindingsModel.buttonVisible (src/renderer/findings-model.js).
// - findings:save { image, marked, marks, note, context } → { id, dir, status: 'saved' }: src/domains/evidence/findings.js
//   saveFinding on the service's workspace (<workspace>/findings/<id>/); the service may add the main
//   process's own context (log, channel calls) before saving.
// - findings:list → [{ id, dir, at, note, status }], newest first (Settings › General › Findings).
// - findings:file { id, projectId, mock } → the Product Owner inbox's answer ({ ok, text, costUsd,
//   error?, pending? }): a po:request of kind 'issue.file' from 'findings' whose params (title, body)
//   name the finding's folder (its absolute dir); the request shows in po:history with
//   request.from === 'findings'. Afterwards findings:list gives the finding a status other than
//   'saved' ('sent' while the request waits in the inbox, 'filed' once the issue exists).
//   An unknown id is refused: ok false with an error, nothing sent.
// Everything runs simulated (MULTIAGENT_SIMULATION_ONLY=1): no model, no gh, no real run.
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService, roadmapProject } = require('./helpers');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// The channel, or a clear failure while it does not exist yet (the file still loads).
function channel(api, name) {
  assert.equal(typeof api[name], 'function', `the ${name} channel exists`);
  return api[name];
}

const finding = (note = 'The Retry button does nothing') => ({
  image: PNG,
  marked: PNG,
  marks: [{ type: 'pin', n: 1, x: 40, y: 30, note: 'here', element: { empty: false, testid: 'step-retry', view: 'run', tab: 'steps', ids: { run: 'run-1' }, box: { x: 10, y: 20, width: 100, height: 30 } } }],
  note,
  context: { view: 'run', tab: 'steps', project: null, runIds: ['run-1'], window: { width: 1280, height: 800 }, theme: 'dark' },
});

// A JSON-escaped path, to find it inside a serialized message (Windows backslashes are doubled).
const inJson = (value, p) => JSON.stringify(value).includes(JSON.stringify(path.resolve(p)).slice(1, -1)) || JSON.stringify(value).includes(JSON.stringify(p).slice(1, -1));

test('settings: the Findings button setting is off by default', async (t) => {
  const { api } = makeService(t);
  const settings = await api['settings:get']();
  assert.equal(settings.findingsButton, false);
});

test('settings: turning the Findings button on is saved and read back', async (t) => {
  const { api } = makeService(t);
  await api['settings:set']({ findingsButton: true });
  assert.equal((await api['settings:get']()).findingsButton, true);
});

test('app:info tells whether the app is packaged (from source here)', async (t) => {
  const { api } = makeService(t, { isPackaged: false });
  assert.equal((await api['app:info']()).isPackaged, false);
});

test('app:info tells whether the app is packaged (a packaged build)', async (t) => {
  const { api } = makeService(t, { isPackaged: true });
  assert.equal((await api['app:info']()).isPackaged, true);
});

test('app:info\'s result schema lists isPackaged and screenshot as booleans, and its answer gives booleans', async (t) => {
  const { service, api } = makeService(t, { isPackaged: false });
  const props = service.manifest.find((e) => e.channel === 'app:info').schema.result.properties;
  assert.equal(props.isPackaged?.type, 'boolean', 'schema.result names isPackaged');
  assert.equal(props.screenshot?.type, 'boolean', 'schema.result names screenshot');
  const info = await api['app:info']();
  assert.equal(typeof info.isPackaged, 'boolean');
  assert.equal(typeof info.screenshot, 'boolean');
});

test('findings:save writes the finding into <workspace>/findings/<id>/', async (t) => {
  const { service, api } = makeService(t);
  const out = await channel(api, 'findings:save')(finding());
  assert.equal(out.status, 'saved');
  assert.equal(path.resolve(out.dir), path.resolve(service.workspace().root, 'findings', out.id));
  for (const file of ['context.json', 'marked.png', 'marks.json', 'note.md', 'screenshot.png']) {
    assert.ok(fs.existsSync(path.join(out.dir, file)), `${file} exists`);
  }
});

test('findings:list shows the saved findings with their status', async (t) => {
  const { api } = makeService(t);
  const saved = await channel(api, 'findings:save')(finding('A listed finding'));
  const list = await channel(api, 'findings:list')();
  const mine = list.find((f) => f.id === saved.id);
  assert.ok(mine, 'the saved finding is listed');
  assert.equal(mine.status, 'saved');
  assert.match(mine.note, /A listed finding/);
});

test('findings:file sends the finding to the Product Owner\'s inbox as an issue.file request naming its folder', async (t) => {
  const { service, api } = makeService(t);
  const p = await roadmapProject(api, service.workspace(), t, [1], 'findings-file');
  const saved = await channel(api, 'findings:save')(finding());

  const out = await channel(api, 'findings:file')({ id: saved.id, projectId: p.id, mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));

  const history = await api['po:history']({ projectId: p.id });
  const requests = history.filter((m) => m.role === 'request' && m.request && m.request.from === 'findings');
  assert.equal(requests.length, 1, 'one request from the findings in the Product Owner\'s history');
  assert.equal(requests[0].request.kind, 'issue.file');
  assert.ok(inJson(requests[0].params, saved.dir), `the request names the finding's folder ${saved.dir}`);
});

test('findings:file without a repository to publish on files the issue with the local marked.png path', async (t) => {
  const { service, api } = makeService(t);
  const p = await roadmapProject(api, service.workspace(), t, [1], 'findings-local-image');
  const saved = await channel(api, 'findings:save')(finding());
  const out = await channel(api, 'findings:file')({ id: saved.id, projectId: p.id, mock: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  const history = await api['po:history']({ projectId: p.id });
  const request = history.find((m) => m.role === 'request' && m.request?.from === 'findings');
  assert.ok(inJson(request.params, path.join(saved.dir, 'marked.png')), 'the issue body names the local marked.png');
  assert.equal(/!\[[^\]]*\]\(https?:/.test(JSON.stringify(request.params)), false, 'no published image link');
});

test('a finding sent to the Product Owner is no longer listed as "saved"', async (t) => {
  const { service, api } = makeService(t);
  const p = await roadmapProject(api, service.workspace(), t, [1], 'findings-status');
  const saved = await channel(api, 'findings:save')(finding());
  await channel(api, 'findings:file')({ id: saved.id, projectId: p.id, mock: true });
  const mine = (await channel(api, 'findings:list')()).find((f) => f.id === saved.id);
  assert.ok(['sent', 'filed'].includes(mine.status), `status ${mine.status}`);
});

test('findings:file with an unknown finding is refused and sends nothing', async (t) => {
  const { service, api } = makeService(t);
  const p = await roadmapProject(api, service.workspace(), t, [1], 'findings-unknown');
  const out = await channel(api, 'findings:file')({ id: 'no-such-finding', projectId: p.id, mock: true });
  assert.equal(out.ok, false);
  assert.equal(typeof out.error, 'string');
  const history = await api['po:history']({ projectId: p.id });
  assert.equal(history.filter((m) => m.request && m.request.from === 'findings').length, 0);
});
