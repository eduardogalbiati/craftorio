// #139: Electron 44 removed clipboard.writeImage / writeBuffer / readImage / readBuffer. The
// IPC handlers in apps/desktop/host/main.js are the only place this process touches the clipboard module (the
// renderer is sandboxed); a test stubbing `clipboard` would never notice a removed method, which
// is exactly how this bug reached the packaged app. This test reads the installed Electron's own
// type definitions instead, so it fails again the day a used method is removed or renamed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'host', 'main.js'), 'utf8');
const dts = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'node_modules', 'electron', 'electron.d.ts'), 'utf8');

function interfaceMembers(name) {
  const body = dts.match(new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n  \\}`))[1];
  return [...body.matchAll(/\n\s{4}(?:readonly )?([a-zA-Z]+)\(/g)].map((m) => m[1]);
}

const CLIPBOARD_METHODS = interfaceMembers('Clipboard');
// Removed in Electron 44 (the error this issue reports); must never come back into apps/desktop/host/main.js.
const REMOVED_METHODS = ['writeImage', 'readImage', 'writeBuffer', 'readBuffer', 'writeBookmark', 'readBookmark', 'writeRTF', 'readRTF', 'writeHTML', 'readHTML'];

test('electron.d.ts still declares the Clipboard methods this app relies on (fails first if Electron removes one)', () => {
  for (const m of ['read', 'readText', 'write', 'writeText', 'has', 'clear']) assert.ok(CLIPBOARD_METHODS.includes(m), `Clipboard.${m} is no longer declared`);
});

test('apps/desktop/host/main.js only calls clipboard methods that exist on the installed Electron\'s Clipboard', () => {
  const used = new Set([...mainSrc.matchAll(/\bclipboard\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
  assert.ok(used.size > 0, 'the clipboard IPC handlers moved or were renamed: nothing to check');
  for (const method of used) assert.ok(CLIPBOARD_METHODS.includes(method), `clipboard.${method} is not in electron.d.ts's Clipboard interface (removed in this Electron version?)`);
});

test('apps/desktop/host/main.js never calls a clipboard method Electron 44 removed', () => {
  for (const method of REMOVED_METHODS) assert.doesNotMatch(mainSrc, new RegExp(`\\bclipboard\\.${method}\\(`), `clipboard.${method} was removed in Electron 44 (#139)`);
});

test('electron.d.ts still exports the ClipboardItem class the image/file handlers construct', () => {
  assert.match(dts, /class ClipboardItem \{/);
  assert.match(mainSrc, /\bClipboardItem\b/, 'apps/desktop/host/main.js no longer imports ClipboardItem from electron');
});

// the handlers register through the IPC sender guard (#467: ipc = guardIpc(ipcMain, ...)) or directly
const HANDLE = String.raw`\b(?:ipc|ipcMain)\.handle`;
const handlerOf = (channel) => {
  const m = mainSrc.match(new RegExp(`${HANDLE}\\('${channel}'[\\s\\S]*?\\n\\}\\);`));
  assert.ok(m, `apps/desktop/host/main.js answers ${channel}`);
  return m[0];
};

test('clipboard:read / clipboard:write await the async text calls explicitly, not just return the promise', () => {
  assert.match(mainSrc, new RegExp(`${HANDLE}\\('clipboard:read',\\s*async\\s*\\(\\)\\s*=>\\s*clipboard\\.readText\\(\\)\\)`));
  assert.match(mainSrc, /await clipboard\.writeText\(/);
});

test('clipboard:writeImage writes PNG data through write(), the replacement for the removed writeImage', () => {
  const handler = handlerOf('clipboard:writeImage');
  assert.match(handler, /await clipboard\.write\(\[new ClipboardItem\(\{ 'image\/png':/);
});

test('clipboard:writeFile on macOS/Linux writes a file URL through write() and checks it stuck with has()', () => {
  const handler = handlerOf('clipboard:writeFile');
  assert.match(handler, /await clipboard\.write\(\[new ClipboardItem\(/);
  assert.match(handler, /await clipboard\.has\(type\)/);
});
