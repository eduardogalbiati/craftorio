// Voice input (#82): transcribe a recording made in the renderer, the speech-to-text status shown
// in Settings › Voice input, and the model download (see packages/engine/domains/chat/speech.js).

const speech = require('../../domains/chat/speech');
const workspace = require('../../domains/workspace/workspace');
const { ensureMicrophoneAccess } = require('../../domains/chat/mic-permission');
const {
  args,
  BOOL,
  nullable,
  OBJECT,
  shape,
  STRING,
} = require('../schemas');

module.exports = (ctx) => [
  // audio: the recording (base64 WAV); language: none for the settings' one → { text }
  {
    channel: 'audio:transcribe',
    method: 'transcribeAudio',
    params: ['audio', 'language'],
    schema: { params: args({ audio: STRING, language: nullable(STRING) }), result: shape({ text: STRING }, ['text']) },
    fn: ({ audio, language } = {}) => speech.transcribe({ audio, language }, workspace.readSettings(ctx.ws), ctx.host.userDataDir),
  },
  { channel: 'audio:status', method: 'speechStatus', schema: { result: OBJECT }, fn: () => speech.status(workspace.readSettings(ctx.ws), ctx.host.userDataDir) },
  // #318: macOS asks for the microphone before the first recording (packages/engine/domains/chat/mic-permission.js); a host
  // without Electron's systemPreferences (the engine server, a browser) never blocks it
  { channel: 'voice:mic-access', method: 'micAccess', schema: { result: shape({ ok: BOOL, error: STRING }, ['ok']) }, fn: () => ensureMicrophoneAccess({ systemPreferences: ctx.host.systemPreferences }) },
  {
    channel: 'audio:downloadModel',
    method: 'downloadSpeechModel',
    params: ['model'],
    schema: { params: args({ model: nullable(STRING) }), result: OBJECT },
    fn: async ({ model } = {}) => {
      await speech.downloadModel(model, ctx.host.userDataDir);
      return speech.status(workspace.readSettings(ctx.ws), ctx.host.userDataDir);
    },
  },
];
