// Voice input (#82): local speech-to-text with the whisper.cpp CLI (`whisper-cli`), found like the
// agent CLIs (resolveCommand), and the ggml models it reads, downloaded from Settings into the
// user's app data folder (not the workspace: models are big and machine-specific). The renderer
// records and sends a 16 kHz mono WAV (base64) on 'audio:transcribe'; the audio is written to a
// temp folder only for the CLI and deleted right after, nothing is kept.

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const {
  homebrewInstalled,
  resolveCommand,
} = require('./engine/providers');
const {
  installCommand,
  installHint,
} = require('./install-commands');
const { execShim } = require('./shell');

const DEFAULT_COMMAND = 'whisper-cli';
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
// size/quality trade-off shown in Settings (sizes of the ggml files)
const MODELS = [
  { id: 'tiny', label: 'Tiny', size: '75 MB', note: 'fastest, rough on Portuguese' },
  { id: 'base', label: 'Base', size: '142 MB', note: 'fast, fair quality' },
  { id: 'small', label: 'Small', size: '466 MB', note: 'good quality, a few seconds per sentence' },
  { id: 'large-v3-turbo-q5_0', label: 'Large v3 turbo (q5)', size: '547 MB', note: 'best quality for its size, slower' },
  { id: 'medium', label: 'Medium', size: '1.5 GB', note: 'very good quality, slow' },
];
const LANGUAGES = ['auto', 'pt', 'en', 'es', 'fr', 'de', 'it'];
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 3 * 60 * 1000;
// macOS: install-commands' hint, per call (#398: brew install whisper-cpp only with Homebrew)
const installHintFor = () => (process.platform === 'win32'
  ? 'download whisper-bin-x64.zip from https://github.com/ggml-org/whisper.cpp/releases, unzip it and add the folder to PATH (or set the path of whisper-cli.exe in Settings › General › Voice input)'
  : process.platform === 'darwin' ? installHint(DEFAULT_COMMAND, 'darwin', { brew: homebrewInstalled('darwin') }) : 'build whisper.cpp (https://github.com/ggml-org/whisper.cpp) and put whisper-cli in PATH');

// Where downloaded models live: <user data>/speech-models. `dataDir` is the app's user data folder
// (Electron's userData); without one (the engine server, tests) the OS's per-user app data folder
// (#318): %APPDATA% on Windows (unchanged, so an existing folder is reused), ~/Library/Application
// Support on macOS, $XDG_CONFIG_HOME or ~/.config on Linux. `host` is for tests.
function appDataBase({ platform, env, home }) {
  if (platform === 'win32') return env.APPDATA || path.win32.join(home, '.config');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support');
  return env.XDG_CONFIG_HOME || path.posix.join(home, '.config');
}

function modelsDir(dataDir, host = {}) {
  const { platform = process.platform, env = process.env, home = os.homedir() } = host;
  const flavour = platform === 'win32' ? path.win32 : path.posix;
  const base = dataDir || flavour.join(appDataBase({ platform, env, home }), 'multiagent-orchestrator');
  return flavour.join(base, 'speech-models');
}

// A model id from MODELS, or an absolute path to a ggml .bin file.
function modelPath(model, dataDir) {
  if (model && path.isAbsolute(model)) return model;
  return path.join(modelsDir(dataDir), `ggml-${model || 'small'}.bin`);
}

const knownModel = (id) => MODELS.find((m) => m.id === id) || null;

// What Settings shows: the CLI found (or null), each model with whether it is downloaded.
function status(settings, dataDir) {
  const command = settings.voiceCommand || DEFAULT_COMMAND;
  const resolved = resolveCommand(command);
  return {
    command,
    path: resolved ? resolved.file : null,
    installHint: installHintFor(),
    // the command run by the play button (#147), only for the default CLI
    installCommand: command === DEFAULT_COMMAND ? installCommand(DEFAULT_COMMAND, process.platform, { brew: homebrewInstalled() }) : null,
    modelsDir: modelsDir(dataDir),
    model: settings.voiceModel,
    modelReady: fs.existsSync(modelPath(settings.voiceModel, dataDir)),
    models: MODELS.map((m) => ({ ...m, downloaded: fs.existsSync(modelPath(m.id, dataDir)) })),
    languages: LANGUAGES,
    language: settings.voiceLanguage,
  };
}

function decodeWav(audio) {
  if (typeof audio !== 'string' || !audio) throw new Error('No audio to transcribe.');
  const buf = Buffer.from(audio.replace(/^data:[^,]*,/, ''), 'base64');
  if (buf.length > MAX_AUDIO_BYTES) throw new Error('The recording is too long to transcribe.');
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('The audio is not a WAV file.');
  return buf;
}

function runWhisper(resolved, args) {
  return new Promise((resolve, reject) => {
    // a .cmd/.bat runs through cmd.exe with escaped arguments (shell.js)
    execShim(resolved.file, args, { windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') return reject(new Error(`The speech-to-text CLI is not installed (command "${resolved.file}" not found). Install: ${installHintFor()}`));
      if (err) return reject(new Error(`Speech-to-text failed: ${(`${stderr || ''}`.trim().split(/\r?\n/).pop() || err.message).slice(0, 300)}`));
      resolve(String(stdout || ''));
    });
  });
}

// Transcribes a base64 WAV with whisper.cpp. language: a code, 'auto', or empty (the setting).
// Resolves { text }; the temp folder (audio and transcript) is always removed.
async function transcribe({ audio, language }, settings, dataDir) {
  const wav = decodeWav(audio);
  const command = settings.voiceCommand || DEFAULT_COMMAND;
  const resolved = resolveCommand(command);
  if (!resolved || (path.isAbsolute(command) && !fs.existsSync(resolved.file))) {
    throw new Error(`The speech-to-text CLI is not installed (command "${command}" not found). Install: ${installHintFor()}`);
  }
  const model = modelPath(settings.voiceModel, dataDir);
  if (!fs.existsSync(model)) {
    throw new Error(knownModel(settings.voiceModel)
      ? `The speech model "${settings.voiceModel}" is not downloaded: Settings › General › Voice input › Download.`
      : `Speech model not found: ${model}`);
  }
  const lang = String(language || settings.voiceLanguage || 'auto').trim().toLowerCase();
  if (!/^[a-z]{2,3}$|^auto$/.test(lang)) throw new Error(`Unknown language "${lang}".`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-voice-'));
  try {
    const input = path.join(dir, 'audio.wav');
    const base = path.join(dir, 'transcript');
    fs.writeFileSync(input, wav);
    const stdout = await runWhisper(resolved, ['-m', model, '-f', input, '-l', lang, '-nt', '-np', '-otxt', '-of', base]);
    const txt = fs.existsSync(`${base}.txt`) ? fs.readFileSync(`${base}.txt`, 'utf8') : stdout;
    return { text: cleanTranscript(txt) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// whisper's text output: one segment per line, and markers for silence or noise ([BLANK_AUDIO]).
function cleanTranscript(txt) {
  return String(txt || '')
    .replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)\]|\((?:silence|music|noise)\)/gi, ' ')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ')
    .replace(/\s+/g, ' ').trim();
}

// Downloads a model from MODELS into modelsDir (a .part file renamed once complete).
const downloading = new Map();
function downloadModel(id, dataDir) {
  if (!knownModel(id)) return Promise.reject(new Error(`Unknown speech model "${id}".`));
  const dest = modelPath(id, dataDir);
  if (fs.existsSync(dest)) return Promise.resolve(dest);
  if (downloading.has(dest)) return downloading.get(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const p = new Promise((resolve, reject) => {
    const get = (url, hops) => {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
          res.resume();
          return get(new URL(res.headers.location, url).href, hops + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Model download failed: HTTP ${res.statusCode}.`)); }
        const out = fs.createWriteStream(part);
        res.pipe(out);
        out.on('finish', () => out.close(() => { fs.renameSync(part, dest); resolve(dest); }));
        out.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };
    get(`${MODEL_URL}ggml-${id}.bin`, 0);
  }).catch((e) => { fs.rmSync(part, { force: true }); throw e; })
    .finally(() => downloading.delete(dest));
  downloading.set(dest, p);
  return p;
}

module.exports = {
  cleanTranscript,
  DEFAULT_COMMAND,
  downloadModel,
  LANGUAGES,
  modelPath,
  MODELS,
  modelsDir,
  status,
  transcribe,
};
