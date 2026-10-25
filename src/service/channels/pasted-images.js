// Images pasted into the AI prompt fields (#130, src/domains/chat/pasted-images.js, src/renderer/paste-image.js).
// A service channel rather than a desktop one, so the browser UI (npm run serve) pastes the same way:
// the renderer reads the image from the paste event and sends it as base64. Both channels only write
// or delete inside <workspace>/attachments/pending/.

const pastedImages = require('../../domains/chat/pasted-images');
const {
  args,
  BOOL,
  NUMBER,
  shape,
  STRING,
} = require('../schemas');

module.exports = (ctx) => [
  // { data (base64), name (the chip's label) } → { name, path, size }
  {
    channel: 'clipboard:saveImage',
    method: 'clipboardSaveImage',
    params: ['data', 'name'],
    schema: { params: args({ data: STRING, name: STRING }), result: shape({ name: STRING, path: STRING, size: NUMBER }, ['path']) },
    fn: ({ data, name }) => pastedImages.saveImage(pastedImages.pendingDir(ctx.ws), { data, name }),
  },
  // a chip removed before its field was submitted: deletes its staged file
  {
    channel: 'clipboard:discardImage',
    method: 'clipboardDiscardImage',
    params: ['path'],
    schema: { params: args({ path: STRING }), result: BOOL },
    fn: ({ path }) => pastedImages.discardImage(pastedImages.pendingDir(ctx.ws), path),
  },
];
