// packages/ui-kit/voice.js: its pure helpers (encodeWav, insertText, formatElapsed) are exported via
// module.exports when there is no `document` (see the file's own header comment), so they can be
// required directly in Node; the DOM wiring (mic button, MediaRecorder) is a UI check instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeWav, formatElapsed, insertText } = require('../voice.js');

test('insertText: inserted at the cursor of an empty field, with the caret right after it', () => {
  const out = insertText('', 'hello', 0, 0);
  assert.deepEqual(out, { value: 'hello', caret: 5 });
});

test('insertText: spaces the inserted text from non-space neighbours on both sides', () => {
  const out = insertText('beforeafter', 'X', 6, 6); // cursor right between the two words
  assert.equal(out.value, 'before X after');
  assert.equal(out.value.slice(0, out.caret), 'before X');
});

test('insertText: no extra space is added next to existing whitespace', () => {
  const out = insertText('before  after', 'X', 7, 7); // cursor between the two existing spaces
  assert.equal(out.value, 'before X after');
});

test('insertText: replaces a selection (start !== end) instead of inserting at a point', () => {
  const out = insertText('one two three', 'TWO', 4, 7); // "two" selected
  assert.equal(out.value, 'one TWO three');
  assert.equal(out.value.slice(out.caret - 3, out.caret), 'TWO');
});

test('insertText: empty (or whitespace-only) text is a no-op, caret stays put', () => {
  assert.deepEqual(insertText('hello', '', 2, 2), { value: 'hello', caret: 2 });
  assert.deepEqual(insertText('hello', '   ', 2, 2), { value: 'hello', caret: 2 });
});

test('formatElapsed: minutes:seconds, seconds zero-padded', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(5000), '0:05');
  assert.equal(formatElapsed(65000), '1:05');
  assert.equal(formatElapsed(600000), '10:00');
});

test('encodeWav: a RIFF/WAVE header for 16 kHz mono 16-bit PCM, with the right data size', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const bytes = encodeWav(samples, 16000);
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buf.toString('ascii', 12, 16), 'fmt ');
  assert.equal(buf.readUInt16LE(20), 1); // PCM
  assert.equal(buf.readUInt16LE(22), 1); // mono
  assert.equal(buf.readUInt32LE(24), 16000); // sample rate
  assert.equal(buf.readUInt16LE(34), 16); // bits per sample
  assert.equal(buf.toString('ascii', 36, 40), 'data');
  assert.equal(buf.readUInt32LE(40), samples.length * 2);
  assert.equal(buf.length, 44 + samples.length * 2);
});

test('encodeWav: clamps samples outside [-1, 1] instead of wrapping', () => {
  const bytes = encodeWav(new Float32Array([2, -2]), 16000);
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(buf.readInt16LE(44), 0x7fff); // +2 clamps to +1 -> max positive 16-bit sample
  assert.equal(buf.readInt16LE(46), -0x8000); // -2 clamps to -1 -> min 16-bit sample
});

test('encodeWav: silence (all zero samples) still produces a valid, correctly sized header', () => {
  const bytes = encodeWav(new Float32Array(1600), 16000); // 100ms of silence
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(buf.readUInt32LE(40), 3200);
  assert.ok([...bytes.slice(44)].every((b) => b === 0));
});
