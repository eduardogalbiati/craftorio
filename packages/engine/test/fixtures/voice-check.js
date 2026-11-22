// UI check for voice input (#82, #131, no real audio, no real CLI, no real model): opens the app
// in a scratch workspace, points its voice settings at fake-whisper.js (test/fixtures), navigates
// to Write & Review, stubs only the browser APIs a real microphone would need (getUserMedia,
// MediaRecorder, AudioContext/OfflineAudioContext) and "clicks" the mic button on #duo-prompt
// (field A) and #duo-goal (field B, same view) to run a sequence of scenarios:
//   1. delayed transcription: the transcript lands at the cursor, and while it is pending the
//      field carries the transcribing state (class, aria-busy, visible badge), cleared after.
//   2. a failing fake CLI: the state is cleared, an error toast shows, the mic ends idle/enabled.
//   3. an empty transcript: the state is cleared and the "Nothing was recognised" toast shows.
//   4. an Escape-cancelled recording, and one with no audio chunks: the transcribing state never
//      appears.
//   5. concurrency: field A transcribing while field B records, each showing only its own state.
//   6. the field (and its positioning box) removed from the DOM while transcription is pending:
//      no uncaught error, and the mic ends idle.
// `window.api` is exposed through contextBridge (apps/desktop/host/preload.js): its methods cannot be
// monkey-patched from the page, so the real audio:transcribe channel runs, against the fake CLI,
// whose behaviour (delay, text, failure) is chosen per scenario via env vars the main process
// (this file) sets before each one, read by packages/engine/domains/chat/speech.js's execFile call.
// See scripts/smoke.js (the pattern this follows) and packages/ui-kit/test/voice-ui.test.js (the runner, gated by
// CRAFTORIO_UI_TESTS=1 like test/screenshot.test.js).
// Usage: npx electron test/fixtures/voice-check.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
process.env.CRAFTORIO_SIMULATION_ONLY = '1';
process.env.FAKE_WHISPER_TEXT = 'dictated text';
const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-voice-check-ws-'));
process.env.CRAFTORIO_WORKSPACE = wsDir;

// A scratch user data folder with the "model" already "downloaded", so Settings needs no network.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-voice-check-data-'));
app.setPath('userData', userDataDir);
fs.mkdirSync(path.join(userDataDir, 'speech-models'), { recursive: true });
fs.writeFileSync(path.join(userDataDir, 'speech-models', 'ggml-small.bin'), 'fake model');

const FAKE_CLI = process.platform === 'win32'
  ? path.join(__dirname, 'fake-whisper.cmd')
  : path.join(__dirname, 'fake-whisper.js');
if (process.platform !== 'win32') fs.chmodSync(FAKE_CLI, 0o755);

require('@craftorio/desktop/host/main');

setTimeout(() => { console.error('voice-check: timed out'); app.exit(1); }, 60000);

const SETUP = `(async () => {
  await api.setSettings({ voiceCommand: ${JSON.stringify(FAKE_CLI)} });
  document.querySelector('[data-view="duo"]').click();
  const taA = document.querySelector('#duo-prompt');
  const taB = document.querySelector('#duo-goal');
  const btnA = taA._voiceBtn;
  const btnB = taB._voiceBtn;
  if (!btnA) throw new Error('no mic button attached to #duo-prompt');
  if (!btnB) throw new Error('no mic button attached to #duo-goal');

  // Stubs: a fake microphone and a fake (no-op) audio codec; never real audio.
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
  window.__noChunks = false;
  window.MediaRecorder = class {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      if (!window.__noChunks) this.ondataavailable?.({ data: new Blob(['x']) });
      this.onstop?.();
    }
  };
  window.AudioContext = class { async decodeAudioData() { return { duration: 0.1 }; } close() {} };
  window.OfflineAudioContext = class {
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(10) }; }
  };

  window.__toasts = [];
  window.showToast = (title, detail) => window.__toasts.push(title + ': ' + detail);
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.error?.message || e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason?.message || e.reason)));

  window.__click = (btn) => {
    btn.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
    btn.dispatchEvent(new PointerEvent('pointerup'));
  };
  window.__state = (ta) => ({
    cls: ta.classList.contains('voice-transcribing'),
    busy: ta.getAttribute('aria-busy'),
    disabled: ta.disabled,
    indVisible: !!(ta._voiceInd && !ta._voiceInd.classList.contains('hidden')),
    indText: ta._voiceInd ? ta._voiceInd.textContent : null,
  });

  window.__t = { taA, taB, btnA, btnB };
  return true;
})()`;

// 1. Delayed transcription: during the wait the field shows the transcribing state (class,
// aria-busy, a visible badge with "Transcribing…"); after, it is cleared, the mic is idle and the
// transcript lands at the cursor with an input event. The field is never disabled, either way.
const DELAYED = `(async () => {
  const { taA, btnA } = window.__t;
  taA.focus();
  taA.setSelectionRange(taA.value.length, taA.value.length);
  const before = taA.value;
  let inputFired = false;
  taA.addEventListener('input', () => { inputFired = true; }, { once: true });
  window.__click(btnA); // start
  await new Promise((r) => setTimeout(r, 50));
  window.__click(btnA); // stop: transcribes against the fake CLI (delayed)
  await new Promise((r) => setTimeout(r, 150)); // well before the fake CLI answers
  const during = window.__state(taA);
  const micDuring = btnA.dataset.state;
  await new Promise((r) => setTimeout(r, 700)); // past the fake CLI's delay
  const after = window.__state(taA);
  return {
    during, micDuring, after,
    micAfter: btnA.dataset.state,
    inserted: taA.value !== before && taA.value.includes('dictated text'),
    inputFired,
    caretAtEnd: taA.selectionStart === taA.selectionEnd,
  };
})()`;

// 2. A failing fake CLI: the state is cleared, an error toast shows, the mic ends idle and enabled.
const FAILURE = `(async () => {
  const { taA, btnA } = window.__t;
  window.__toasts.length = 0;
  window.__click(btnA);
  await new Promise((r) => setTimeout(r, 50));
  window.__click(btnA);
  await new Promise((r) => setTimeout(r, 400));
  return { after: window.__state(taA), toasts: window.__toasts.slice(), micState: btnA.dataset.state, micDisabled: btnA.disabled };
})()`;

// 3. An empty transcript: the state is cleared and the "Nothing was recognised" toast shows.
const EMPTY = `(async () => {
  const { taA, btnA } = window.__t;
  window.__toasts.length = 0;
  window.__click(btnA);
  await new Promise((r) => setTimeout(r, 50));
  window.__click(btnA);
  await new Promise((r) => setTimeout(r, 400));
  return { after: window.__state(taA), toasts: window.__toasts.slice(), micState: btnA.dataset.state };
})()`;

// 4. An Escape-cancelled recording, and one with no audio chunks: the transcribing state never
// appears in either case, and the mic ends idle.
const CANCEL = `(async () => {
  const { taA, btnA } = window.__t;
  window.__click(btnA); // start
  await new Promise((r) => setTimeout(r, 50));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await new Promise((r) => setTimeout(r, 100));
  const afterEscape = window.__state(taA);
  const micAfterEscape = btnA.dataset.state;

  window.__noChunks = true;
  window.__click(btnA); // start
  await new Promise((r) => setTimeout(r, 50));
  window.__click(btnA); // stop, no data chunk delivered
  await new Promise((r) => setTimeout(r, 100));
  window.__noChunks = false;
  const afterNoChunks = window.__state(taA);
  const micAfterNoChunks = btnA.dataset.state;

  return { afterEscape, micAfterEscape, afterNoChunks, micAfterNoChunks };
})()`;

// 5. Concurrency: field A transcribing (delayed) while field B records, each showing only its own
// state; both end idle/cleared.
const CONCURRENCY = `(async () => {
  const { taA, btnA, taB, btnB } = window.__t;
  window.__click(btnA); // start A
  await new Promise((r) => setTimeout(r, 50));
  window.__click(btnA); // stop A: transcribes (delayed)
  await new Promise((r) => setTimeout(r, 100)); // A is now transcribing
  const aWhileBIdle = window.__state(taA);
  window.__click(btnB); // start B while A is still transcribing
  await new Promise((r) => setTimeout(r, 50));
  const aDuringB = window.__state(taA);
  const bDuringB = window.__state(taB);
  const micADuringB = btnA.dataset.state;
  const micBDuringB = btnB.dataset.state;
  window.__click(btnB); // stop B
  await new Promise((r) => setTimeout(r, 900)); // both finish (A's delayed transcription included)
  return {
    aWhileBIdle, aDuringB, bDuringB, micADuringB, micBDuringB,
    aAfter: window.__state(taA), bAfter: window.__state(taB),
    micAAfter: btnA.dataset.state, micBAfter: btnB.dataset.state,
  };
})()`;

// 6. The field (and its positioning box) removed from the DOM while transcription is pending: no
// uncaught error, and the mic (kept by reference, as a closed gate card would do) ends idle.
const REMOVAL = `(async () => {
  const { taA, btnA } = window.__t;
  const container = taA.parentElement;
  window.__click(btnA); // start
  await new Promise((r) => setTimeout(r, 50));
  window.__click(btnA); // stop: transcribes (delayed)
  await new Promise((r) => setTimeout(r, 50)); // busy, before the field is removed
  container.remove();
  await new Promise((r) => setTimeout(r, 900)); // let the fake CLI answer after the removal
  return { errors: window.__errors.slice(), micState: btnA.dataset.state, micDisabled: btnA.disabled };
})()`;

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (ev) => console.log(`[renderer:${ev.level}] ${ev.message}`));
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    await new Promise((r) => setTimeout(r, 1500));
    const fail = (msg) => { console.error(`voice-check: ${msg}`); app.exit(1); };
    try {
      await js(SETUP);

      process.env.FAKE_WHISPER_DELAY_MS = '600';
      delete process.env.FAKE_WHISPER_FAIL;
      process.env.FAKE_WHISPER_TEXT = 'dictated text';
      const delayed = await js(DELAYED);
      console.log('voice-check: delayed', JSON.stringify(delayed));
      if (!delayed.during.cls || delayed.during.busy !== 'true' || !delayed.during.indVisible || !/Transcribing/.test(delayed.during.indText || '')) return fail('delayed: the transcribing state is not shown while the fake CLI is pending');
      if (delayed.during.disabled) return fail('delayed: the field is disabled while transcribing');
      if (delayed.micDuring !== 'busy') return fail('delayed: the mic is not busy while transcribing');
      if (delayed.after.cls || delayed.after.busy || delayed.after.indVisible) return fail('delayed: the transcribing state is not cleared after insertion');
      if (delayed.micAfter !== 'idle') return fail('delayed: the mic did not return to idle after insertion');
      if (!delayed.inserted || !delayed.inputFired || !delayed.caretAtEnd) return fail('delayed: the transcript was not inserted at the cursor as expected');

      delete process.env.FAKE_WHISPER_DELAY_MS;
      process.env.FAKE_WHISPER_FAIL = '1';
      const failure = await js(FAILURE);
      console.log('voice-check: failure', JSON.stringify(failure));
      if (failure.after.cls || failure.after.busy || failure.after.indVisible) return fail('failure: the transcribing state is not cleared when the fake CLI fails');
      if (!failure.toasts.some((t) => /Voice input/.test(t))) return fail('failure: no error toast was shown when the fake CLI fails');
      if (failure.micState !== 'idle' || failure.micDisabled) return fail('failure: the mic did not end idle and enabled after the failure');

      delete process.env.FAKE_WHISPER_FAIL;
      process.env.FAKE_WHISPER_TEXT = '';
      const empty = await js(EMPTY);
      console.log('voice-check: empty', JSON.stringify(empty));
      if (empty.after.cls || empty.after.busy || empty.after.indVisible) return fail('empty: the transcribing state is not cleared for an empty transcript');
      if (!empty.toasts.some((t) => /Nothing was recognised/.test(t))) return fail('empty: no "Nothing was recognised" toast was shown');
      if (empty.micState !== 'idle') return fail('empty: the mic did not end idle after an empty transcript');

      process.env.FAKE_WHISPER_TEXT = 'dictated text';
      const cancel = await js(CANCEL);
      console.log('voice-check: cancel', JSON.stringify(cancel));
      if (cancel.afterEscape.cls || cancel.afterEscape.busy || cancel.afterEscape.indVisible) return fail('cancel: an Escape-cancelled recording showed the transcribing state');
      if (cancel.micAfterEscape !== 'idle') return fail('cancel: the mic did not end idle after Escape');
      if (cancel.afterNoChunks.cls || cancel.afterNoChunks.busy || cancel.afterNoChunks.indVisible) return fail('cancel: a recording with no audio chunks showed the transcribing state');
      if (cancel.micAfterNoChunks !== 'idle') return fail('cancel: the mic did not end idle after a chunk-less recording');

      process.env.FAKE_WHISPER_DELAY_MS = '600';
      const conc = await js(CONCURRENCY);
      console.log('voice-check: concurrency', JSON.stringify(conc));
      if (!conc.aDuringB.cls || conc.aDuringB.busy !== 'true') return fail('concurrency: field A lost its transcribing state once field B started recording');
      if (conc.bDuringB.cls) return fail('concurrency: field B shows the transcribing state while only recording');
      if (conc.micADuringB !== 'busy') return fail("concurrency: field A's mic is not busy while field B records");
      if (conc.micBDuringB !== 'recording') return fail("concurrency: field B's mic is not recording");
      if (conc.aAfter.cls || conc.bAfter.cls) return fail('concurrency: a transcribing state was left behind after both fields finished');
      if (conc.micAAfter !== 'idle' || conc.micBAfter !== 'idle') return fail('concurrency: a mic was left busy/recording after both fields finished');

      process.env.FAKE_WHISPER_DELAY_MS = '400';
      const removal = await js(REMOVAL);
      console.log('voice-check: removal', JSON.stringify(removal));
      if (removal.errors.length) return fail(`removal: an uncaught error was thrown after the field was removed: ${removal.errors.join('; ')}`);
      if (removal.micState !== 'idle' || removal.micDisabled) return fail('removal: the mic did not end idle and enabled after the field was removed while transcribing');
    } catch (e) {
      console.error('voice-check:', e);
      app.exit(1);
      return;
    }
    console.log('voice-check: ok');
    app.quit();
  });
});
