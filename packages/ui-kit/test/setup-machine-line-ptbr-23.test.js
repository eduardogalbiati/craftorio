// #23 acceptance, moved by #69 (written before the code): the Setup's Try it safely step is gone, so the machine's line
// (data-testid="machine-profile-line", #set-mp-line) is read in Settings › Execution › Concurrent runs only
// (packages/ui-kit/views/settings/settings.js). Nothing is lost with the step: in pt-BR that line is in Portuguese, never
// the engine's English sentence "This machine: 20 threads, 32 GB → up to 5 runs at once, 1 test worker per run"; in
// English it reads as the engine's. Driven on the real page; api.machineProfile answers what the settings:machineProfile
// channel answers today (packages/engine/service/channels/app.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');

const ENGLISH_LINE = 'This machine: 20 threads, 32 GB → up to 5 runs at once, 1 test worker per run';
const PROFILE = {
  state: 'auto', concurrentRuns: 5, testWorkers: 1,
  machine: { threads: 20, totalBytes: 32 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 },
  proposal: { concurrentRuns: 5, testWorkers: 1 },
  line: ENGLISH_LINE, suggestion: null,
};

async function machineLineIn(lang) {
  let saved = { setupDone: true, language: { interface: lang } };
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
  await app.defs.get('settings').show();
  await app.settle(30);
  const line = String(app.el('#set-mp-line').textContent || '').replace(/\s+/g, ' ').trim();
  assert.notEqual(line, '', 'Settings › Execution shows the machine line');
  return line;
}

test('#23 #69 Settings › Execution in pt-BR: the machine line has no English', { timeout: 30000 }, async () => {
  const line = await machineLineIn('pt-BR');
  for (const english of ['This machine', 'threads,', 'up to', 'runs at once', 'test worker', 'per run']) {
    assert.equal(line.includes(english), false, `"${english}" in "${line}"`);
  }
});

test('#23 #69 Settings › Execution in pt-BR: the machine line still carries the numbers (20 threads, 32 GB, 5 runs, 1 worker)', { timeout: 30000 }, async () => {
  const line = await machineLineIn('pt-BR');
  for (const n of ['20', '32', '5', '1']) assert.match(line, new RegExp(`\\b${n}\\b`), `${n} in "${line}"`);
});

test('#23 guard: Settings › Execution in English shows the machine line as today', { timeout: 30000 }, async () => {
  assert.equal(await machineLineIn('en'), ENGLISH_LINE);
});
