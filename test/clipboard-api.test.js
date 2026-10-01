// #139: Electron 44 removed clipboard.writeImage / writeBuffer / readImage / readBuffer. The
// IPC handlers in src/main.js are the only place this process touches the clipboard module (the
// renderer is sandboxed); a test stubbing `clipboard` would never notice a removed method, which
// is exactly how this bug reached the packaged app. This test reads the installed Electron's own
// type definitions instead, so it fails again the day a used method is removed or renamed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const dts = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'electron', 'electron.d.ts'), 'utf8');

function interfaceMembers(name) {
  const body = dts.match(new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n  \\}`))[1];
  return [...body.matchAll(/\n\s{4}(?:readonly )?([a-zA-Z]+)\(/g)].map((m) => m[1]);
}

const CLIPBOARD_METHODS = interfaceMembers('Clipboard');
// Removed in Electron 44 (the error this issue reports); must never come back into src/main.js.
const REMOVED_METHODS = ['writeImage', 'readImage', 'writeBuffer', 'readBuffer', 'writeBookmark', 'readBookmark', 'writeRTF', 'readRTF', 'writeHTML', 'readHTML'];

test('electron.d.ts still declares the Clipboard methods this app relies on (fails first if Electron removes one)', () => {
  for (const m of ['read', 'readText', 'write', 'writeText', 'has', 'clear']) assert.ok(CLIPBOARD_METHODS.includes(m), `Clipboard.${m} is no longer declared`);
});

test('src/main.js only calls clipboard methods that exist on the installed Electron\'s Clipboard', () => {
  const used = new Set([...mainSrc.matchAll(/\bclipboard\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
  assert.ok(used.size > 0, 'the clipboard IPC handlers moved or were renamed: nothing to check');
  for (const method of used) assert.ok(CLIPBOARD_METHODS.includes(method), `clipboard.${method} is not in electron.d.ts's Clipboard interface (removed in this Electron version?)`);
});

test('src/main.js never calls a clipboard method Electron 44 removed', () => {
  for (const method of REMOVED_METHODS) assert.doesNotMatch(mainSrc, new RegExp(`\\bclipboard\\.${method}\\(`), `clipboard.${method} was removed in Electron 44 (#139)`);
});

test('electron.d.ts still exports the ClipboardItem class the image/file handlers construct', () => {
  assert.match(dts, /class ClipboardItem \{/);
  assert.match(mainSrc, /\bClipboardItem\b/, 'src/main.js no longer imports ClipboardItem from electron');
});

test('clipboard:read / clipboard:write await the async text calls explicitly, not just return the promise', () => {
  assert.match(mainSrc, /ipcMain\.handle\('clipboard:read',\s*async\s*\(\)\s*=>\s*clipboard\.readText\(\)\)/);
  assert.match(mainSrc, /await clipboard\.writeText\(/);
});

test('clipboard:writeImage writes PNG data through write(), the replacement for the removed writeImage', () => {
  const handler = mainSrc.match(/ipcMain\.handle\('clipboard:writeImage'[\s\S]*?\n\}\);/)[0];
  assert.match(handler, /await clipboard\.write\(\[new ClipboardItem\(\{ 'image\/png':/);
});

test('clipboard:writeFile on macOS/Linux writes a file URL through write() and checks it stuck with has()', () => {
  const handler = mainSrc.match(/ipcMain\.handle\('clipboard:writeFile'[\s\S]*?\n\}\);/)[0];
  assert.match(handler, /await clipboard\.write\(\[new ClipboardItem\(/);
  assert.match(handler, /await clipboard\.has\(type\)/);
});
