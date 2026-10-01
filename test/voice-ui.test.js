// UI check for voice input (#82): test/fixtures/voice-check.js opens the app, records a (faked)
// mic click on #duo-prompt and checks the transcript lands at the cursor. Like the Electron part of
// test/screenshot.test.js, it only runs with MULTIAGENT_UI_TESTS=1 (CI's Windows job has a step for
// it): it needs the Electron binary and a display. Run it locally when you change voice.js, the mic
// button's wiring, or the audio:transcribe channel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');

// Located without require('electron'), which would download the binary when it is missing.
const electron = (() => {
  const dir = path.join(root, 'node_modules', 'electron');
  try { const p = path.join(dir, 'dist', fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim()); return fs.existsSync(p) ? p : null; } catch { return null; }
})();
const skip = process.env.MULTIAGENT_UI_TESTS !== '1' ? 'set MULTIAGENT_UI_TESTS=1 to open the app' : false;

test('the mic button inserts a mocked transcript at the cursor, with an input event', { skip, timeout: 60000 }, async () => {
  if (!electron) throw new Error('the Electron binary is not installed: run `node node_modules/electron/install.js`');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const { code, out } = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(root, 'test', 'fixtures', 'voice-check.js')], { cwd: root, env, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`still running after 50s\n${out}`)); }, 50000);
    child.on('exit', (c) => { clearTimeout(timer); resolve({ code: c, out }); });
  });
  assert.equal(code, 0, out);
  assert.match(out, /voice-check: ok/);
});
