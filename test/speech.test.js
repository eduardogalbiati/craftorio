// src/speech.js: local speech-to-text with the whisper.cpp CLI. The real CLI is stood in for by
// test/fixtures/fake-whisper.js (a Windows .cmd wrapper, since src/engine/providers.js's
// resolveCommand only checks a bare command name against PATH on Windows; elsewhere the script
// itself, made executable, is the command).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const speech = require('../src/speech');
const { installCommand } = require('../src/install-commands');
const { encodeWav } = require('../src/renderer/voice.js');

const FAKE_CLI = process.platform === 'win32'
  ? path.join(__dirname, 'fixtures', 'fake-whisper.cmd')
  : path.join(__dirname, 'fixtures', 'fake-whisper.js');
if (process.platform !== 'win32') fs.chmodSync(FAKE_CLI, 0o755);

const RAW_WAV = Buffer.from(encodeWav(new Float32Array(1600))).toString('base64'); // 100ms of silence
const TINY_WAV = `data:audio/wav;base64,${RAW_WAV}`;

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function withEnv(t, vars) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
}

// Settings with a working CLI and a ready model (an absolute path, so no download/dataDir is needed).
function readySettings(dir, extra = {}) {
  const model = path.join(dir, 'model.bin');
  fs.writeFileSync(model, 'fake ggml model');
  return { voiceCommand: FAKE_CLI, voiceModel: model, voiceLanguage: 'pt', ...extra };
}

const tempVoiceDirs = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('multiagent-voice-'));

test('transcribe(): returns the CLI\'s text, joining its lines and dropping [BLANK_AUDIO] markers', async (t) => {
  const dir = tmp(t);
  withEnv(t, { FAKE_WHISPER_TEXT: 'Hello there.\n[BLANK_AUDIO]\nHow are you?\n' });
  const result = await speech.transcribe({ audio: TINY_WAV }, readySettings(dir), dir);
  assert.deepEqual(result, { text: 'Hello there. How are you?' });
});

test('transcribe(): the -l flag is settings.voiceLanguage, overridden by the language param; "auto" works', async (t) => {
  const dir = tmp(t);
  const logFile = path.join(dir, 'args.json');
  withEnv(t, { FAKE_WHISPER_LOG: logFile });
  const settings = readySettings(dir, { voiceLanguage: 'es' });
  const flagOf = (argv) => argv[argv.indexOf('-l') + 1];

  await speech.transcribe({ audio: TINY_WAV }, settings, dir);
  assert.equal(flagOf(JSON.parse(fs.readFileSync(logFile, 'utf8'))), 'es');

  await speech.transcribe({ audio: TINY_WAV, language: 'en' }, settings, dir);
  assert.equal(flagOf(JSON.parse(fs.readFileSync(logFile, 'utf8'))), 'en');

  await speech.transcribe({ audio: TINY_WAV, language: 'auto' }, settings, dir);
  assert.equal(flagOf(JSON.parse(fs.readFileSync(logFile, 'utf8'))), 'auto');
});

test('transcribe(): rejects an unknown language before running anything', async (t) => {
  const dir = tmp(t);
  await assert.rejects(
    speech.transcribe({ audio: TINY_WAV, language: 'klingon' }, readySettings(dir), dir),
    /Unknown language "klingon"/,
  );
});

test('transcribe(): a known model id that was never downloaded points to Settings', async (t) => {
  const dir = tmp(t);
  const settings = { voiceCommand: FAKE_CLI, voiceModel: 'small', voiceLanguage: 'pt' };
  await assert.rejects(
    speech.transcribe({ audio: TINY_WAV }, settings, dir),
    /"small" is not downloaded: Settings › General › Voice input/,
  );
});

test('transcribe(): an absolute model path that does not exist is reported with its path', async (t) => {
  const dir = tmp(t);
  const missing = path.join(dir, 'nope.bin');
  const settings = { voiceCommand: FAKE_CLI, voiceModel: missing, voiceLanguage: 'pt' };
  await assert.rejects(speech.transcribe({ audio: TINY_WAV }, settings, dir), (err) => {
    assert.match(err.message, /^Speech model not found:/);
    assert.ok(err.message.includes(missing), err.message);
    return true;
  });
});

test('transcribe(): a missing CLI is reported as not installed, with the install command', async (t) => {
  const dir = tmp(t);
  const settings = readySettings(dir, { voiceCommand: 'definitely-not-a-real-whisper-cli-xyz' });
  await assert.rejects(speech.transcribe({ audio: TINY_WAV }, settings, dir), /not installed[\s\S]*Install:/);
});

test('transcribe(): rejects audio that is not a WAV file, and empty audio', async (t) => {
  const dir = tmp(t);
  const settings = readySettings(dir);
  await assert.rejects(
    speech.transcribe({ audio: Buffer.from('not a wav file').toString('base64') }, settings, dir),
    /The audio is not a WAV file/,
  );
  await assert.rejects(speech.transcribe({ audio: '' }, settings, dir), /No audio to transcribe/);
  await assert.rejects(speech.transcribe({}, settings, dir), /No audio to transcribe/);
});

test('transcribe(): accepts a data: URL prefix on the base64 audio', async (t) => {
  const dir = tmp(t);
  const result = await speech.transcribe({ audio: `data:audio/wav;base64,${RAW_WAV}` }, readySettings(dir), dir);
  assert.equal(result.text, 'hello world'); // the fixture's default transcript
});

test('transcribe(): leaves no multiagent-voice-* temp folder behind, after success or a CLI failure', async (t) => {
  const dir = tmp(t);
  const settings = readySettings(dir);
  const before = tempVoiceDirs();
  await speech.transcribe({ audio: TINY_WAV }, settings, dir);
  assert.deepEqual(tempVoiceDirs(), before);

  withEnv(t, { FAKE_WHISPER_FAIL: '1' });
  await assert.rejects(speech.transcribe({ audio: TINY_WAV }, settings, dir), /Speech-to-text failed/);
  assert.deepEqual(tempVoiceDirs(), before);
});

test('status(): path is null when the command is not installed', (t) => {
  const dir = tmp(t);
  const st = speech.status({ voiceCommand: 'definitely-not-a-real-whisper-cli-xyz' }, dir);
  assert.equal(st.path, null);
  assert.equal(st.command, 'definitely-not-a-real-whisper-cli-xyz');
});

test('status(): modelReady and models[].downloaded follow the files written in modelsDir(dataDir)', (t) => {
  const dataDir = tmp(t);
  fs.mkdirSync(speech.modelsDir(dataDir), { recursive: true });
  fs.writeFileSync(path.join(speech.modelsDir(dataDir), 'ggml-tiny.bin'), 'x');
  const st = speech.status({ voiceCommand: FAKE_CLI, voiceModel: 'tiny' }, dataDir);
  assert.equal(st.path, FAKE_CLI);
  assert.equal(st.modelReady, true);
  assert.equal(st.models.find((m) => m.id === 'tiny').downloaded, true);
  assert.equal(st.models.find((m) => m.id === 'base').downloaded, false);
});

test('status(): installCommand (#147\'s play button) is only offered for the default whisper-cli command, never a custom one', (t) => {
  const dir = tmp(t);
  const custom = speech.status({ voiceCommand: 'my-custom-whisper' }, dir);
  assert.equal(custom.installCommand, null);
  const def = speech.status({}, dir); // no voiceCommand set: falls back to DEFAULT_COMMAND
  assert.equal(def.command, speech.DEFAULT_COMMAND);
  assert.equal(def.installCommand, installCommand(speech.DEFAULT_COMMAND));
});

test('modelPath(): an absolute .bin path is used as is, ignoring dataDir', (t) => {
  const dataDir = tmp(t);
  const abs = path.join(dataDir, 'custom', 'my-model.bin');
  assert.equal(speech.modelPath(abs, dataDir), abs);
});
