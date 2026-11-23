// #23 acceptance, written before the code: the Welcome's step 2 (Try it safely, packages/ui-kit/setup.js) in pt-BR
// shows the machine's line (data-testid="machine-profile-line") in Portuguese, never the engine's English sentence
// "This machine: 20 threads, 32 GB → up to 5 runs at once, 1 test worker per run". Driven on the real page as
// setup-three-steps-643.test.js; api.machineProfile answers what the settings:machineProfile channel answers today
// (packages/engine/service/channels/app.js: the resolved limits, the machine, the proposal and the English `line`).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');
const H = require('./page-pieces');

const ENGLISH_LINE = 'This machine: 20 threads, 32 GB → up to 5 runs at once, 1 test worker per run';
const PROFILE = {
  state: 'auto', concurrentRuns: 5, testWorkers: 1,
  machine: { threads: 20, totalBytes: 32 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 },
  proposal: { concurrentRuns: 5, testWorkers: 1 },
  line: ENGLISH_LINE, suggestion: null,
};

async function machineLineIn(lang) {
  let saved = { setupDone: false, language: { interface: lang } };
  const app = loadApp({
    api: {
      getSettings: async () => JSON.parse(JSON.stringify(saved)),
      setSettings: async (patch) => { saved = { ...saved, ...JSON.parse(JSON.stringify(patch || {})) }; return JSON.parse(JSON.stringify(saved)); },
      listWorkflows: async () => [],
      listProjects: async () => [],
      envDetails: async () => [],
      machineProfile: async () => JSON.parse(JSON.stringify(PROFILE)),
    },
  });
  await app.boot();
  if (app.sandbox.I18n.getLanguage() !== lang) app.sandbox.I18n.setLanguage(lang);
  assert.equal(app.run('!!(window.Setup && window.Setup.isOpen())'), true, 'a new workspace opens the Setup');
  await app.click('#setup-modal #btn-setup-next'); // Agents -> Try it safely
  await app.settle(10);
  const body = String(app.el('#setup-modal #setup-body').innerHTML || '');
  const line = H.findEl(body, (e) => e.attrs['data-testid'] === 'machine-profile-line');
  assert.ok(line, `the machine line on step 2: ${body.slice(0, 300)}`);
  return H.visibleText(line.inner).replace(/\s+/g, ' ').trim();
}

test('#23 Welcome step 2 in pt-BR: the machine line has no English', { timeout: 30000 }, async () => {
  const line = await machineLineIn('pt-BR');
  for (const english of ['This machine', 'threads,', 'up to', 'runs at once', 'test worker', 'per run']) {
    assert.equal(line.includes(english), false, `"${english}" in "${line}"`);
  }
});

test('#23 Welcome step 2 in pt-BR: the machine line still carries the numbers (20 threads, 32 GB, 5 runs, 1 worker)', { timeout: 30000 }, async () => {
  const line = await machineLineIn('pt-BR');
  for (const n of ['20', '32', '5', '1']) assert.match(line, new RegExp(`\\b${n}\\b`), `${n} in "${line}"`);
});

test('#23 guard: Welcome step 2 in English shows the machine line as today', { timeout: 30000 }, async () => {
  assert.equal(await machineLineIn('en'), ENGLISH_LINE);
});
