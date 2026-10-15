// src/renderer/views/settings/settings.js: renderTools (Settings › Agents & CLIs) and renderVoice
// (Settings › General › Voice input) now show a play button next to a missing CLI's install
// command (#147, commandHint from src/renderer/command-hint.js), instead of plain text or nothing.
// Pulled out of the source and run in a vm sandbox against a minimal fake DOM and a stubbed api,
// the way test/renderer-kept-work-dialog.test.js checks app.js's dialogs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'settings', 'settings.js'), 'utf8');
const defaultWorkflowSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'default-workflow.js'), 'utf8');

function makeEl() {
  const classes = new Set();
  return {
    innerHTML: '', textContent: '', value: '',
    classList: {
      toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
      add: (...cs) => cs.forEach((c) => classes.add(c)),
    },
  };
}

function loadSettingsMarkup({ envDetails, speechStatus } = {}) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl()); return els.get(sel); };
  const sandbox = {
    $, esc: (s) => String(s ?? ''),
    commandHint: (cmd) => `<PLAY:${cmd}>`,
    errMsg: (e) => String(e?.message || e),
    VOICE_LANGUAGES: {},
    state: { settings: {} },
    api: { envDetails: envDetails || (async () => []), speechStatus: speechStatus || (async () => ({ models: [], languages: [] })) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const renderTools = /async function renderTools\(\) \{[\s\S]*?\n\}/.exec(settingsSrc)[0];
  const renderVoice = /async function renderVoice\(st\) \{[\s\S]*?\n\}/.exec(settingsSrc)[0];
  for (const [name, code] of Object.entries({ renderTools, renderVoice })) {
    assert.ok(code, `${name} not found in settings.js: the source moved`);
  }
  vm.runInContext(`${renderTools}\n${renderVoice}\nthis.renderTools = renderTools; this.renderVoice = renderVoice;`, sandbox);
  return { renderTools: sandbox.renderTools, renderVoice: sandbox.renderVoice, $ };
}

// renderDefaultWorkflow (#195) is pure enough (it only reads state.workflows/state.settings and the
// real DefaultWorkflow module) to pull out of the source and run for real, the same way renderTools
// and renderVoice are above.
function loadDefaultWorkflow({ workflows, defaultWorkflow } = {}) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl()); return els.get(sel); };
  const sandbox = { $, esc: (s) => String(s ?? ''), state: { workflows: workflows || [], settings: { defaultWorkflow: defaultWorkflow ?? null } } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(defaultWorkflowSrc, sandbox); // the real DefaultWorkflow module (#195), not reimplemented
  const renderDefaultWorkflow = /function renderDefaultWorkflow\(\) \{[\s\S]*?\n\}/.exec(settingsSrc)[0];
  assert.ok(renderDefaultWorkflow, 'renderDefaultWorkflow not found in settings.js: the source moved');
  vm.runInContext(`${renderDefaultWorkflow}\nthis.renderDefaultWorkflow = renderDefaultWorkflow;`, sandbox);
  return { renderDefaultWorkflow: sandbox.renderDefaultWorkflow, $ };
}

const TASK_WORKFLOWS = [
  { file: 'software-development.yaml', name: 'Software development', inputs: { task: {} }, merge: 'remote' },
  { file: 'software-development-local-hero.yaml', name: 'Software development (local)', inputs: { task: {} }, merge: 'local' },
];

test('renderDefaultWorkflow: unset selects the local workflow when the workspace has one, naming how each option merges', () => {
  const { renderDefaultWorkflow, $ } = loadDefaultWorkflow({ workflows: TASK_WORKFLOWS });
  renderDefaultWorkflow();
  const sel = $('#set-default-workflow');
  assert.match(sel.innerHTML, /<option value="software-development\.yaml">Software development \(software-development\.yaml, pushes and opens PRs\)<\/option>/);
  assert.match(sel.innerHTML, /<option value="software-development-local-hero\.yaml">Software development \(local\) \(software-development-local-hero\.yaml, local merge\)<\/option>/);
  assert.equal(sel.value, 'software-development-local-hero.yaml');
  assert.equal($('#set-default-wf-note').textContent, '');
  assert.equal($('#set-default-wf-note').classList.contains('hidden'), true);
});

test('renderDefaultWorkflow: the saved setting is selected when it still exists', () => {
  const { renderDefaultWorkflow, $ } = loadDefaultWorkflow({ workflows: TASK_WORKFLOWS, defaultWorkflow: 'software-development.yaml' });
  renderDefaultWorkflow();
  assert.equal($('#set-default-workflow').value, 'software-development.yaml');
  assert.equal($('#set-default-wf-note').classList.contains('hidden'), true);
});

test('renderDefaultWorkflow: a saved workflow that no longer exists falls back and the note says so, naming the missing file', () => {
  const { renderDefaultWorkflow, $ } = loadDefaultWorkflow({ workflows: TASK_WORKFLOWS, defaultWorkflow: 'deleted-workflow.yaml' });
  renderDefaultWorkflow();
  assert.equal($('#set-default-workflow').value, 'software-development-local-hero.yaml');
  assert.equal($('#set-default-wf-note').textContent, 'deleted-workflow.yaml no longer exists: software-development-local-hero.yaml is used instead.');
  assert.equal($('#set-default-wf-note').classList.contains('hidden'), false);
});

test('renderDefaultWorkflow: a workflow with no `task` input (it cannot take one) is never listed', () => {
  const { renderDefaultWorkflow, $ } = loadDefaultWorkflow({ workflows: [...TASK_WORKFLOWS, { file: 'backlog-refresh.yaml', name: 'Backlog refresh', inputs: {} }] });
  renderDefaultWorkflow();
  assert.doesNotMatch($('#set-default-workflow').innerHTML, /backlog-refresh/);
});

test('renderTools: a tool not in PATH with an install command shows the play button, not just "Not found in PATH."', async () => {
  const { renderTools, $ } = loadSettingsMarkup({
    envDetails: async () => [{ id: 'gh', name: 'GitHub CLI', path: null, connected: false, installCommand: 'winget install --id GitHub.cli -e' }],
  });
  await renderTools();
  const html = $('#set-tools').innerHTML;
  assert.match(html, /Not found in PATH\./);
  assert.match(html, /<PLAY:winget install --id GitHub\.cli -e>/);
});

test('renderTools: a tool with no install command but a prose hint shows "Install: <prose>", no play button', async () => {
  const { renderTools, $ } = loadSettingsMarkup({
    envDetails: async () => [{ id: 'grok', name: 'Grok Build', path: null, connected: false, installCommand: null, installHint: 'install Grok Build from x.ai' }],
  });
  await renderTools();
  const html = $('#set-tools').innerHTML;
  assert.doesNotMatch(html, /<PLAY:/);
  assert.match(html, /Install: install Grok Build from x\.ai/);
});

test('renderTools: a tool found in PATH shows its path, no install hint at all', async () => {
  const { renderTools, $ } = loadSettingsMarkup({
    envDetails: async () => [{ id: 'git', name: 'Git', path: 'C:\\Git\\git.exe', version: 'git version 2.44', connected: true }],
  });
  await renderTools();
  const html = $('#set-tools').innerHTML;
  assert.match(html, /<code>C:\\Git\\git\.exe<\/code>/);
  assert.doesNotMatch(html, /<PLAY:/);
  assert.doesNotMatch(html, /Not found in PATH/);
});

test('renderVoice: the speech CLI not found, with an install command, shows the play button next to "Not found"', async () => {
  const { renderVoice, $ } = loadSettingsMarkup({
    speechStatus: async () => ({ command: 'whisper-cli', path: null, installCommand: 'brew install whisper-cpp', models: [], languages: [] }),
  });
  await renderVoice();
  const html = $('#set-voice-cli').innerHTML;
  assert.match(html, /Not found \(command "whisper-cli"\)/);
  assert.match(html, /<PLAY:brew install whisper-cpp>/);
});

test('renderVoice: the speech CLI not found, with only a prose hint (e.g. a custom command), shows the prose instead', async () => {
  const { renderVoice, $ } = loadSettingsMarkup({
    speechStatus: async () => ({ command: 'my-custom-whisper', path: null, installCommand: null, installHint: 'build whisper.cpp yourself', models: [], languages: [] }),
  });
  await renderVoice();
  const html = $('#set-voice-cli').innerHTML;
  assert.doesNotMatch(html, /<PLAY:/);
  assert.match(html, /build whisper\.cpp yourself/);
});

// renderControlChannel (#336, Settings › Execution): the control channel's status and error, from
// main's state { enabled, port, file, error }; the browser client has no endpoint.
function loadControlChannel({ platform = 'win32', state = null } = {}) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl()); return els.get(sel); };
  const box = { disabled: false };
  const sandbox = {
    $, errMsg: (e) => String(e?.message || e),
    document: { querySelector: (sel) => (sel === '[data-setting="controlChannel"]' ? box : null) },
    api: { platform, controlChannelState: async () => state },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const available = /const controlChannelAvailable = [^\n]*\n/.exec(settingsSrc);
  const render = /function renderControlChannel\(s, failure\) \{[\s\S]*?\n\}/.exec(settingsSrc);
  const refresh = /async function refreshControlChannel\(\) \{[\s\S]*?\n\}/.exec(settingsSrc);
  assert.ok(available && render && refresh, 'the control channel renderer not found in settings.js: the source moved');
  vm.runInContext(`${available[0]}${render[0]}\n${refresh[0]}\nthis.refresh = refreshControlChannel;`, sandbox);
  return { refresh: sandbox.refresh, $, box };
}

test('renderControlChannel: on, the status names the 127.0.0.1 port and the endpoint file', async () => {
  const { refresh, $, box } = loadControlChannel({ state: { enabled: true, port: 51234, file: 'C:/ws/control/endpoint.json', error: null } });
  await refresh();
  assert.match($('#set-control-status').textContent, /127\.0\.0\.1:51234/);
  assert.match($('#set-control-status').textContent, /endpoint\.json/);
  assert.equal($('#set-control-error').textContent, '');
  assert.equal(box.disabled, false);
});

test('renderControlChannel: the port could not open, the error is shown and the status says Off', async () => {
  const { refresh, $ } = loadControlChannel({ state: { enabled: false, port: null, file: null, error: 'The control channel could not open: EACCES' } });
  await refresh();
  assert.equal($('#set-control-status').textContent, 'Off');
  assert.equal($('#set-control-error').textContent, 'The control channel could not open: EACCES');
});

test('renderControlChannel: the browser client has no endpoint, the switch is disabled and says why', async () => {
  const { refresh, $, box } = loadControlChannel({ platform: 'browser' });
  await refresh();
  assert.equal(box.disabled, true);
  assert.match($('#set-control-status').textContent, /browser/i);
});
