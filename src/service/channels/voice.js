// Voice input (#82): transcribe a recording made in the renderer, the speech-to-text status shown
// in Settings › Voice input, and the model download (see src/speech.js).

const speech = require('../../speech');
const workspace = require('../../workspace');

module.exports = (ctx) => [
  {
    channel: 'audio:transcribe',
    method: 'transcribeAudio',
    params: ['audio', 'language'],
    fn: ({ audio, language } = {}) => speech.transcribe({ audio, language }, workspace.readSettings(ctx.ws), ctx.host.userDataDir),
  },
  { channel: 'audio:status', method: 'speechStatus', fn: () => speech.status(workspace.readSettings(ctx.ws), ctx.host.userDataDir) },
  {
    channel: 'audio:downloadModel',
    method: 'downloadSpeechModel',
    params: ['model'],
    fn: async ({ model } = {}) => {
      await speech.downloadModel(model, ctx.host.userDataDir);
      return speech.status(workspace.readSettings(ctx.ws), ctx.host.userDataDir);
    },
  },
];
