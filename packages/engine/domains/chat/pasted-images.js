// Images pasted into the AI prompt fields (#130, packages/ui-kit/paste-image.js). Each pasted image is
// written at once into the staging folder <workspace>/attachments/pending/ and its path goes with the
// field's request (run:start's attachments, approval:resolve's images, the Supervisor's attachments),
// which copies it where the turn reads it (#129). A chip removed deletes its file; what was never
// submitted is cleared at the next start (clearPending). Nothing outside the staging folder is
// written or deleted. Same formats and limits as a turn's attachments (providers.ATTACHMENT_LIMITS).

const fs = require('fs');
const path = require('path');
const { ATTACHMENT_LIMITS, sniffImage } = require('../../engine/providers');

const pendingDir = (ws) => path.join(ws.attachments, 'pending');
const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;

// A file of the staging folder (not the folder itself), or null.
function inside(dir, file) {
  const f = path.resolve(String(file || ''));
  return f.startsWith(path.resolve(dir) + path.sep) ? f : null;
}

/**
 * Writes a pasted image (base64 `data`) into the staging folder. `name` is the label shown on the
 * chip (e.g. image-1.png). Returns { name, path, size }; throws "Image too large: …" or
 * "Unsupported format" before writing anything.
 */
function saveImage(dir, { data, name } = {}) {
  const buf = Buffer.from(String(data || ''), 'base64');
  if (!buf.length) throw new Error('The pasted image is empty.');
  if (buf.length > ATTACHMENT_LIMITS.bytes) throw new Error(`Image too large: ${mb(buf.length)}, max ${mb(ATTACHMENT_LIMITS.bytes)}`);
  const type = sniffImage(buf);
  if (!type) throw new Error('Unsupported format: paste a PNG, JPEG, GIF or WebP image.');
  const ext = type === 'jpeg' ? '.jpg' : `.${type}`;
  const label = `${path.basename(String(name || 'image'), path.extname(String(name || ''))).replace(/[^\w.-]+/g, '-').slice(-60) || 'image'}${ext}`;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${label}`);
  fs.writeFileSync(file, buf);
  return { name: label, path: file, size: buf.length };
}

/** Deletes a staged image (its chip was removed). Refuses a path outside the staging folder. */
function discardImage(dir, file) {
  const f = inside(dir, file);
  if (!f) throw new Error('Only a pasted image of the staging folder can be removed.');
  fs.rmSync(f, { force: true });
  return true;
}

/** Removes what the last session staged and never submitted (called once at start). */
function clearPending(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a locked file waits for the next start */ }
}

module.exports = {
  clearPending,
  discardImage,
  pendingDir,
  saveImage,
};
