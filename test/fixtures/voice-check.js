// UI check for voice input (#82, no real audio, no real CLI, no real model): opens the app in a
// scratch workspace, points its voice settings at fake-whisper.js (test/fixtures), navigates to
// Write & Review, stubs only the browser APIs a real microphone would need (getUserMedia,
// MediaRecorder, AudioContext/OfflineAudioContext), "clicks" the mic button twice (start, then
// stop) and checks the mocked transcript lands at the cursor of #duo-prompt with an input event.
// `window.api` is exposed through contextBridge (src/preload.js): its methods cannot be
// monkey-patched from the page, so the real audio:transcribe channel runs, against the fake CLI.
// See scripts/smoke.js (the pattern this follows) and test/voice-ui.test.js (the runner, gated by
// MULTIAGENT_UI_TESTS=1 like test/screenshot.test.js).
// Usage: npx electron test/fixtures/voice-check.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
process.env.MULTIAGENT_SIMULATION_ONLY = '1';
process.env.FAKE_WHISPER_TEXT = 'dictated text';
const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-voice-check-ws-'));
process.env.MULTIAGENT_WORKSPACE = wsDir;

// A scratch user data folder with the "model" already "downloaded", so Settings needs no network.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-voice-check-data-'));
app.setPath('userData', userDataDir);
fs.mkdirSync(path.join(userDataDir, 'speech-models'), { recursive: true });
fs.writeFileSync(path.join(userDataDir, 'speech-models', 'ggml-small.bin'), 'fake model');

const FAKE_CLI = process.platform === 'win32'
  ? path.join(__dirname, 'fake-whisper.cmd')
  : path.join(__dirname, 'fake-whisper.js');
if (process.platform !== 'win32') fs.chmodSync(FAKE_CLI, 0o755);

require('../../src/main');

setTimeout(() => { console.error('voice-check: timed out'); app.exit(1); }, 30000);

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (ev) => console.log(`[renderer:${ev.level}] ${ev.message}`));
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    await new Promise((r) => setTimeout(r, 1500));
    let result;
    try {
      result = await js(`(async () => {
        await api.setSettings({ voiceCommand: ${JSON.stringify(FAKE_CLI)} });
        document.querySelector('[data-view="duo"]').click();
        const ta = document.querySelector('#duo-prompt');
        const btn = ta._voiceBtn;
        if (!btn) throw new Error('no mic button attached to #duo-prompt');

        // Stubs: a fake microphone and a fake (no-op) audio codec; never real audio.
        navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
        window.MediaRecorder = class {
          constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
          start() { this.state = 'recording'; }
          stop() {
            this.state = 'inactive';
            this.ondataavailable?.({ data: new Blob(['x']) });
            this.onstop?.();
          }
        };
        window.AudioContext = class { async decodeAudioData() { return { duration: 0.1 }; } close() {} };
        window.OfflineAudioContext = class {
          createBufferSource() { return { connect() {}, start() {} }; }
          async startRendering() { return { getChannelData: () => new Float32Array(10) }; }
        };

        const toasts = [];
        window.showToast = (title, detail) => toasts.push(title + ': ' + detail);

        let inputFired = false;
        ta.addEventListener('input', () => { inputFired = true; });
        ta.focus();
        ta.setSelectionRange(5, 5);
        const before = ta.value;

        const click = () => {
          btn.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
          btn.dispatchEvent(new PointerEvent('pointerup'));
        };
        click(); // starts recording
        await new Promise((r) => setTimeout(r, 50));
        click(); // stops, transcribes (the fake CLI) and inserts at the cursor
        await new Promise((r) => setTimeout(r, 500));

        return { before, after: ta.value, inputFired, caretAtEnd: ta.selectionStart === ta.selectionEnd, toasts };
      })()`);
    } catch (e) {
      console.error('voice-check:', e);
      app.exit(1);
      return;
    }
    console.log('voice-check result:', JSON.stringify(result));
    const inserted = result.after !== result.before && result.after.includes('dictated text');
    if (!inserted || !result.inputFired || !result.caretAtEnd) {
      console.error('voice-check: the transcript was not inserted at the cursor as expected');
      app.exit(1);
      return;
    }
    console.log('voice-check: ok');
    app.quit();
  });
});
