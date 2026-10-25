// src/domains/chat/pasted-images.js (#130): the staging folder a pasted image is saved into before a field
// submits it (<workspace>/attachments/pending/), and src/service/channels/pasted-images.js, the
// clipboard:saveImage / clipboard:discardImage channels that wrap it for both the desktop app and
// the browser UI (src/service/index.js clearPastedImages).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clearPending, discardImage, pendingDir, saveImage } = require('../../src/domains/chat/pasted-images');
const { ATTACHMENT_LIMITS } = require('../../src/engine/providers');
const { setupWorkspace } = require('../../src/domains/workspace/workspace');
const { createService } = require('../../src/service');

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------
// saveImage
// ---------------------------------------------------------------------------

test('saveImage writes a PNG inside the staging folder and returns { name, path, size }', (t) => {
  const dir = path.join(tmpDir(t, 'pasted-save-'), 'pending');
  const out = saveImage(dir, { data: PNG_1PX.toString('base64'), name: 'image-1.png' });
  assert.equal(out.name, 'image-1.png');
  assert.equal(out.size, PNG_1PX.length);
  assert.ok(out.path.startsWith(dir + path.sep), out.path);
  assert.ok(fs.existsSync(out.path));
  assert.deepEqual(fs.readFileSync(out.path), PNG_1PX);
});

test('saveImage refuses an image over the limit, naming its size and the limit, and writes nothing', (t) => {
  const dir = tmpDir(t, 'pasted-big-');
  const big = Buffer.concat([PNG_1PX, Buffer.alloc(ATTACHMENT_LIMITS.bytes + 1024 * 1024)]);
  assert.throws(() => saveImage(dir, { data: big.toString('base64'), name: 'big.png' }), /Image too large: 11 MB, max 10 MB/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('saveImage refuses bytes that are not a supported image, and an empty data string', (t) => {
  const dir = tmpDir(t, 'pasted-unsupported-');
  assert.throws(() => saveImage(dir, { data: Buffer.from('hello').toString('base64'), name: 'notes.png' }), /Unsupported format/);
  assert.throws(() => saveImage(dir, { data: '', name: 'empty.png' }), /The pasted image is empty\./);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('saveImage names a JPEG with a .jpg extension, whatever the pasted name says', (t) => {
  const dir = tmpDir(t, 'pasted-jpeg-');
  const out = saveImage(dir, { data: JPEG_HEADER.toString('base64'), name: 'photo.jpeg' });
  assert.match(out.name, /\.jpg$/);
  assert.ok(fs.existsSync(out.path));
});

// ---------------------------------------------------------------------------
// discardImage
// ---------------------------------------------------------------------------

test('discardImage deletes a staged file', (t) => {
  const dir = tmpDir(t, 'pasted-discard-');
  const out = saveImage(dir, { data: PNG_1PX.toString('base64'), name: 'a.png' });
  assert.equal(discardImage(dir, out.path), true);
  assert.ok(!fs.existsSync(out.path));
});

test('discardImage refuses a path outside the staging folder: a "../" escape, the folder itself, a sibling prefix and an unrelated absolute path', (t) => {
  const dir = path.join(tmpDir(t, 'pasted-escape-'), 'pending');
  fs.mkdirSync(dir, { recursive: true });
  const escaped = path.join(dir, '..', 'evil.png');
  fs.writeFileSync(escaped, 'x');
  assert.throws(() => discardImage(dir, escaped), /Only a pasted image of the staging folder can be removed\./);
  assert.throws(() => discardImage(dir, dir), /Only a pasted image of the staging folder can be removed\./);

  const sibling = `${dir}-evil`;
  fs.mkdirSync(sibling, { recursive: true });
  const siblingFile = path.join(sibling, 'file.png');
  fs.writeFileSync(siblingFile, 'x');
  assert.throws(() => discardImage(dir, siblingFile), /Only a pasted image of the staging folder can be removed\./);

  const unrelated = path.join(tmpDir(t, 'pasted-unrelated-'), 'file.png');
  fs.writeFileSync(unrelated, 'x');
  assert.throws(() => discardImage(dir, unrelated), /Only a pasted image of the staging folder can be removed\./);
});

// ---------------------------------------------------------------------------
// clearPending
// ---------------------------------------------------------------------------

test('clearPending removes the staging folder and tolerates one that does not exist', (t) => {
  const dir = tmpDir(t, 'pasted-clear-');
  const pending = path.join(dir, 'pending');
  saveImage(pending, { data: PNG_1PX.toString('base64'), name: 'a.png' });
  assert.ok(fs.existsSync(pending));
  clearPending(pending);
  assert.ok(!fs.existsSync(pending));
  assert.doesNotThrow(() => clearPending(pending));
});

// ---------------------------------------------------------------------------
// The service channels (desktop and browser UI) and workspace layout
// ---------------------------------------------------------------------------

function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pasted-svc-'));
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  // shutdown (closes index.db) must run before the directory is removed, or rmSync hits EPERM on Windows
  t.after(() => service.shutdown());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ws = setupWorkspace(dir, { persist: false });
  service.setWorkspace(ws);
  return { service, ws };
}

test('the workspace layout has an "attachments" folder (pasted images stage under it)', (t) => {
  const { ws } = makeService(t);
  assert.equal(ws.attachments, path.join(ws.root, 'attachments'));
});

test('the manifest declares clipboard:saveImage and clipboard:discardImage with their params', (t) => {
  const { service } = makeService(t);
  const entries = Object.fromEntries(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e]));
  assert.equal(entries['clipboard:saveImage'].method, 'clipboardSaveImage');
  assert.deepEqual(entries['clipboard:saveImage'].params, ['data', 'name']);
  assert.equal(entries['clipboard:discardImage'].method, 'clipboardDiscardImage');
  assert.deepEqual(entries['clipboard:discardImage'].params, ['path']);
});

test('clipboard:saveImage writes under <workspace>/attachments/pending/, and clipboard:discardImage removes it again', (t) => {
  const { service, ws } = makeService(t);
  const out = service.api['clipboard:saveImage']({ data: PNG_1PX.toString('base64'), name: 'shot.png' });
  assert.ok(out.path.startsWith(path.join(ws.attachments, 'pending') + path.sep));
  assert.ok(fs.existsSync(out.path));
  assert.equal(service.api['clipboard:discardImage']({ path: out.path }), true);
  assert.ok(!fs.existsSync(out.path));
});

test('clipboard:saveImage refuses an unsupported format through the service the same way', (t) => {
  const { service } = makeService(t);
  assert.throws(() => service.api['clipboard:saveImage']({ data: Buffer.from('hello').toString('base64'), name: 'notes.png' }), /Unsupported format/);
});

test('service.clearPastedImages empties the staging folder, and is a no-op without an open workspace', (t) => {
  const { service, ws } = makeService(t);
  const out = service.api['clipboard:saveImage']({ data: PNG_1PX.toString('base64'), name: 'left.png' });
  assert.ok(fs.existsSync(out.path));
  service.clearPastedImages();
  assert.ok(!fs.existsSync(path.join(ws.attachments, 'pending')));

  const bare = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  assert.doesNotThrow(() => bare.clearPastedImages());
});
