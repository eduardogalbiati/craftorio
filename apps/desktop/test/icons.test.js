// The committed app icons (#317), made by scripts/icons.js from apps/desktop/assets/icon-source.png: the files the
// packager uses are well-formed (ICO directory, ICNS chunks, PNG size). Reads the files only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const asset = (name) => fs.readFileSync(path.join(__dirname, '..', 'assets', name));
const PNG_MAGIC = '89504e470d0a1a0a';
// width and height from a PNG's IHDR
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

test('icons: the source image is a square PNG of at least 512 px', () => {
  const src = asset('icon-source.png');
  assert.equal(src.subarray(0, 8).toString('hex'), PNG_MAGIC);
  const [w, h] = pngSize(src);
  assert.equal(w, h);
  assert.ok(w >= 512, `${w} px`);
});

test('icons: icon.png (Linux) is a 512x512 PNG', () => {
  const png = asset('icon.png');
  assert.equal(png.subarray(0, 8).toString('hex'), PNG_MAGIC);
  assert.deepEqual(pngSize(png), [512, 512]);
});

test('icons: icon.ico (Windows) has PNG entries from 16 to 256 px, the 256 px one recorded as 0', () => {
  const ico = asset('icon.ico');
  assert.equal(ico.readUInt16LE(0), 0, 'reserved');
  assert.equal(ico.readUInt16LE(2), 1, 'type 1 = icon');
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let k = 0; k < count; k++) {
    const e = 6 + 16 * k;
    const size = ico.readUInt32LE(e + 8);
    const offset = ico.readUInt32LE(e + 12);
    assert.ok(offset + size <= ico.length, `entry ${k} inside the file`);
    const img = ico.subarray(offset, offset + size);
    assert.equal(img.subarray(0, 8).toString('hex'), PNG_MAGIC, `entry ${k} is a PNG`);
    const dir = ico[e] === 0 ? 256 : ico[e];
    assert.deepEqual(pngSize(img), [dir, ico[e + 1] === 0 ? 256 : ico[e + 1]], `entry ${k}: the directory matches the image`);
    sizes.push(dir);
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
});

test('icons: icon.icns (macOS) starts with "icns", its length is the file size and its chunks fill it', () => {
  const icns = asset('icon.icns');
  assert.equal(icns.subarray(0, 4).toString('latin1'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  let at = 8;
  let chunks = 0;
  while (at < icns.length) {
    const len = icns.readUInt32BE(at + 4);
    assert.ok(len >= 8, `chunk ${icns.subarray(at, at + 4).toString('latin1')} has a length`);
    at += len;
    chunks++;
  }
  assert.equal(at, icns.length, 'the chunks end exactly at the end of the file');
  assert.ok(chunks > 0);
});
