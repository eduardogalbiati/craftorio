// Generates the app icons from one source image: apps/desktop/assets/icon.ico (Windows), apps/desktop/assets/icon.icns (macOS)
// and apps/desktop/assets/icon.png (Linux, 512 px), used by apps/desktop/scripts/package.js. Runs under Electron (its nativeImage
// reads and resizes any PNG/JPEG):
//   npm run icons [-- <source.png>]   (default source: apps/desktop/assets/icon-source.png, square, 1024 px or more)
// With no source image it first draws a placeholder (a graph of three agents) into
// apps/desktop/assets/icon-source.png: replace that file with the real artwork and run it again.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { app, nativeImage } = require('electron');

const assets = path.join(__dirname, '..', 'apps', 'desktop', 'assets');
const SIZE = 1024;

// A PNG file from RGBA pixels (8 bits per channel, filter 0 on every row).
function encodePng(rgba, width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, no filter method, no interlace
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The placeholder: a rounded square (indigo to teal) with three white agents linked as a graph.
// Shapes are signed distance functions, so their edges are anti-aliased.
function placeholderPng() {
  const s = SIZE;
  const nodes = [[0.5, 0.28], [0.29, 0.68], [0.71, 0.68]].map(([x, y]) => [x * s, y * s]);
  const edges = [[0, 1], [0, 2], [1, 2]];
  const roundedSquare = (x, y) => {
    const half = s * 0.44, r = s * 0.2;
    const qx = Math.abs(x - s / 2) - half + r, qy = Math.abs(y - s / 2) - half + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const segment = (x, y, [ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const cover = (d) => Math.max(0, Math.min(1, 0.5 - d));
  const rgba = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const t = (x + y) / (2 * s);
      let [r, g, b] = [49 + (20 - 49) * t, 46 + (184 - 46) * t, 129 + (166 - 129) * t];
      const graph = Math.max(
        ...nodes.map(([nx, ny]) => cover(Math.hypot(x - nx, y - ny) - s * 0.11)),
        ...edges.map(([i, j]) => cover(segment(x, y, nodes[i], nodes[j]) - s * 0.025)),
      );
      [r, g, b] = [r, g, b].map((c) => c + (255 - c) * graph);
      rgba.set([r, g, b, 255 * cover(roundedSquare(x, y))].map(Math.round), (y * s + x) * 4);
    }
  }
  return encodePng(rgba, s, s);
}

const resized = (image, size) => image.resize({ width: size, height: size, quality: 'best' }).toPNG();

// ICO with PNG entries (Windows Vista and later); 256 px is written as 0 in the directory.
function ico(image) {
  const pngs = [16, 24, 32, 48, 64, 128, 256].map((size) => [size, resized(image, size)]);
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(([size, png], i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size % 256, e);
    header.writeUInt8(size % 256, e + 1);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs.map(([, png]) => png)]);
}

// ICNS with PNG entries: each type is a size (the @2x ones for Retina).
function icns(image) {
  const types = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const entries = types.map(([type, size]) => {
    const png = resized(image, size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'latin1');
  head.writeUInt32BE(8 + entries.reduce((n, e) => n + e.length, 0), 4);
  return Buffer.concat([head, ...entries]);
}

let exitCode = 0;
app.whenReady().then(() => {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const source = arg ? path.resolve(arg) : path.join(assets, 'icon-source.png');
  fs.mkdirSync(assets, { recursive: true });
  if (!arg && !fs.existsSync(source)) {
    fs.writeFileSync(source, placeholderPng());
    console.log(`No source image: placeholder written to ${source}`);
  }
  const image = nativeImage.createFromPath(source);
  if (image.isEmpty()) throw new Error(`Not an image: ${source}`);
  const { width, height } = image.getSize();
  if (width !== height) throw new Error(`The source image must be square (it is ${width}x${height}): ${source}`);
  fs.writeFileSync(path.join(assets, 'icon.ico'), ico(image));
  fs.writeFileSync(path.join(assets, 'icon.icns'), icns(image));
  fs.writeFileSync(path.join(assets, 'icon.png'), resized(image, 512));
  console.log(`Icons written to ${assets} (icon.ico, icon.icns, icon.png) from ${source}`);
}).catch((e) => {
  console.error('Icons failed:', e.message);
  exitCode = 1;
}).finally(() => app.exit(exitCode));
