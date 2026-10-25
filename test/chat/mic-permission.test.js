// src/domains/chat/mic-permission.js (#318): before the first recording on macOS the main process asks
// systemPreferences.askForMediaAccess('microphone'); a denial is the voice-input error pointing to
// System Settings. Other OSes never ask. Also the renderer side (src/renderer/voice.js): it calls
// api.micAccess() (channel 'voice:mic-access') before getUserMedia, and a denial shows the error in
// the voice-input toast without opening the microphone. voice.js runs in a vm sandbox with a
// minimal fake DOM (the way test/renderer-command-hint.test.js runs command-hint.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const load = () => require('../../src/domains/chat/mic-permission');
const SETTINGS_HINT = 'System Settings › Privacy & Security › Microphone';

function fakePrefs(answer) {
  const calls = [];
  return { calls, askForMediaAccess: async (media) => { calls.push(media); return answer; } };
}

test('ensureMicrophoneAccess: macOS asks for the microphone and is ok when granted', async () => {
  const prefs = fakePrefs(true);
  const r = await load().ensureMicrophoneAccess({ platform: 'darwin', systemPreferences: prefs });
  assert.equal(r.ok, true);
  assert.deepEqual(prefs.calls, ['microphone']);
});

test('ensureMicrophoneAccess: a macOS denial is not ok, with an error pointing to System Settings', async () => {
  const r = await load().ensureMicrophoneAccess({ platform: 'darwin', systemPreferences: fakePrefs(false) });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
  assert.ok(r.error.includes(SETTINGS_HINT), r.error);
});

test('ensureMicrophoneAccess: Windows and Linux are ok without asking', async () => {
  for (const platform of ['win32', 'linux']) {
    const prefs = fakePrefs(false);
    const r = await load().ensureMicrophoneAccess({ platform, systemPreferences: prefs });
    assert.equal(r.ok, true, platform);
    assert.equal(prefs.calls.length, 0, `${platform}: askForMediaAccess was called`);
  }
});

// --- renderer: src/renderer/voice.js ---------------------------------------------------------------

const voiceSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'voice.js'), 'utf8');

function fakeEl() {
  const attrs = {};
  return {
    nodeType: 1, dataset: {}, style: {}, isConnected: true, offsetParent: null, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; },
    getAttribute: (k) => attrs[k] ?? null,
    after() {}, matches: () => false, querySelectorAll: () => [],
  };
}

function loadVoice(micAccess) {
  const toasts = [];
  const getUserMediaCalls = [];
  const body = fakeEl();
  const sandbox = {
    document: { readyState: 'complete', body, createElement: () => fakeEl(), addEventListener() {}, activeElement: null },
    navigator: { mediaDevices: { getUserMedia: async (c) => { getUserMediaCalls.push(c); throw new Error('getUserMedia must not be called'); } } },
    api: {
      platform: 'darwin',
      micAccess,
      speechStatus: async () => ({ path: '/usr/local/bin/whisper-cli', command: 'whisper-cli', modelReady: true, model: 'small' }),
    },
    MutationObserver: class { observe() {} },
    getComputedStyle: () => ({ position: 'relative' }),
    showToast: (title, detail) => toasts.push(`${title}: ${detail}`),
    errMsg: (e) => String(e?.message || e),
    console,
    setInterval, clearInterval, setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(voiceSrc, sandbox);
  const ta = fakeEl();
  ta.parentElement = fakeEl();
  sandbox.voice.attach(ta);
  return { ta, toasts, getUserMediaCalls };
}

test('voice.js: a denied microphone (api.micAccess, voice:mic-access) shows the System Settings error and never opens the microphone', async () => {
  const micCalls = [];
  const { ta, toasts, getUserMediaCalls } = loadVoice(async () => { micCalls.push(1); return { ok: false, error: `Microphone access is denied. Allow it in ${SETTINGS_HINT}.` }; });
  ta._voiceBtn.onclick({ detail: 0 });
  for (let i = 0; i < 20 && !toasts.length; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(micCalls.length, 1, 'api.micAccess was not called before recording');
  assert.equal(getUserMediaCalls.length, 0);
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].includes(SETTINGS_HINT), toasts[0]);
});
