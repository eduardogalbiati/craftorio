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
