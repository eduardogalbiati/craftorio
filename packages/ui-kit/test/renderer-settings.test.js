// packages/ui-kit/views/settings/settings.js: renderVoice (Settings › General › Voice input) shows a
// play button next to a missing CLI's install command (#147, commandHint from
// packages/ui-kit/command-hint.js), instead of plain text or nothing; renderTools (Settings › Agents &
// CLIs) hands the rows to settings-clis.js (#740).
// Pulled out of the source and run in a vm sandbox against a minimal fake DOM and a stubbed api,
// the way test/renderer-kept-work-dialog.test.js checks app.js's dialogs.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

// #329: the markup lives in settings-markup.js, its texts in the catalog (the sandboxes get t)
const { settingsSource, t } = require('./settings-source-329');
const settingsSrc = settingsSource();

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

function loadSettingsMarkup({ envDetails, speechStatus, SettingsClis } = {}) {
  const els = new Map();
  const $ = (sel) => { if (!els.has(sel)) els.set(sel, makeEl()); return els.get(sel); };
  const sandbox = {
    $, t, esc: (s) => String(s ?? ''),
    commandHint: (cmd) => `<PLAY:${cmd}>`,
    errMsg: (e) => String(e?.message || e),
    VOICE_LANGUAGES: {},
    state: { settings: {} },
    api: { envDetails: envDetails || (async () => []), speechStatus: speechStatus || (async () => ({ models: [], languages: [] })) },
  };
  sandbox.window = sandbox;
  sandbox.SettingsClis = SettingsClis;
  vm.createContext(sandbox);
  const renderTools =/async function renderTools\(\) \{[\s\S]*?\n\}/.exec(settingsSrc)[0];
  const renderVoice = /async function renderVoice\(st\) \{[\s\S]*?\n\}/.exec(settingsSrc)[0];
  for (const [name, code] of Object.entries({ renderTools, renderVoice })) {
    assert.ok(code, `${name} not found in settings.js: the source moved`);
  }
  vm.runInContext(`${renderTools}\n${renderVoice}\nthis.renderTools = renderTools; this.renderVoice = renderVoice;`, sandbox);
  return { renderTools: sandbox.renderTools, renderVoice: sandbox.renderVoice, $ };
}

// #740: the rows are the first-run Setup's (setup.js window.SetupRows), drawn by settings-clis.js; their
// content is checked in renderer-settings-clis-740.test.js and settings-clis-rows-740.test.js
test('renderTools: draws the CLIs with Settings › Agents & CLIs\' rows (window.SettingsClis.render)', async () => {
  let calls = 0;
  const { renderTools } = loadSettingsMarkup({ SettingsClis: { render: async () => { calls += 1; } } });
  await renderTools();
  assert.equal(calls, 1);
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
    $, t, errMsg: (e) => String(e?.message || e),
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
