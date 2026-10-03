// src/service/channels/voice.js: the audio:transcribe, audio:status and audio:downloadModel
// channels, wired into the engine service (manifest + the models kept under host.userDataDir, not
// the workspace). See test/speech.test.js for src/speech.js itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../src/workspace');
const { createService } = require('../src/service');
const { encodeWav } = require('../src/renderer/voice.js');

const FAKE_CLI = process.platform === 'win32'
  ? path.join(__dirname, 'fixtures', 'fake-whisper.cmd')
  : path.join(__dirname, 'fixtures', 'fake-whisper.js');
if (process.platform !== 'win32') fs.chmodSync(FAKE_CLI, 0o755);

const TINY_WAV = `data:audio/wav;base64,${Buffer.from(encodeWav(new Float32Array(1600))).toString('base64')}`;

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-channels-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeService(t) {
  const userDataDir = tmp(t);
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, userDataDir } });
  t.after(() => service.shutdown());
  service.setWorkspace(setupWorkspace(tmp(t), { persist: false }));
  return { service, userDataDir };
}

test('the manifest declares audio:transcribe, audio:status and audio:downloadModel with their methods', (t) => {
  const { service } = makeService(t);
  const byChannel = Object.fromEntries(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e.method]));
  assert.equal(byChannel['audio:transcribe'], 'transcribeAudio');
  assert.equal(byChannel['audio:status'], 'speechStatus');
  assert.equal(byChannel['audio:downloadModel'], 'downloadSpeechModel');
});

test('audio:status reads the settings and the models under host.userDataDir', (t) => {
  const { service, userDataDir } = makeService(t);
  const st = service.api['audio:status']();
  assert.equal(st.command, 'whisper-cli'); // default setting (src/workspace.js DEFAULT_SETTINGS)
  assert.equal(st.modelsDir, path.join(userDataDir, 'speech-models'));
  assert.equal(st.modelReady, false); // nothing downloaded in the fresh temp userDataDir
});

test('audio:transcribe runs the engine configured in settings and returns its text', async (t) => {
  const { service, userDataDir } = makeService(t);
  const model = path.join(userDataDir, 'speech-models', 'ggml-small.bin');
  fs.mkdirSync(path.dirname(model), { recursive: true });
  fs.writeFileSync(model, 'fake model');
  service.api['settings:set']({ voiceCommand: FAKE_CLI });

  const result = await service.api['audio:transcribe']({ audio: TINY_WAV });
  assert.deepEqual(result, { text: 'hello world' });
});

test('audio:transcribe reports a missing CLI without crashing the service', async (t) => {
  const { service, userDataDir } = makeService(t);
  const model = path.join(userDataDir, 'speech-models', 'ggml-small.bin');
  fs.mkdirSync(path.dirname(model), { recursive: true });
  fs.writeFileSync(model, 'fake model');
  service.api['settings:set']({ voiceCommand: 'definitely-not-a-real-whisper-cli-xyz' });

  await assert.rejects(service.api['audio:transcribe']({ audio: TINY_WAV }), /not installed/);
});
