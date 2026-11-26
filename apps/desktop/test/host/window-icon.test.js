// The app's windows carry its icon on Windows and Linux, also from the source code (npm start), where
// Electron's default icon showed on Windows (owner, 2026-11-26).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sideWindowOptions, windowIcon } = require('../../host/side-window');

test('windowIcon: the .ico on Windows, the .png on Linux, none on macOS (its bundle), and the files exist', () => {
  assert.match(windowIcon('win32'), /assets[\\/]icon\.ico$/);
  assert.match(windowIcon('linux'), /assets[\\/]icon\.png$/);
  assert.equal(windowIcon('darwin'), null);
  for (const p of ['win32', 'linux']) assert.ok(fs.existsSync(windowIcon(p)), windowIcon(p));
});

test('the side windows and the main window take that icon', () => {
  const opts = sideWindowOptions({ dirname: __dirname, min: { width: 1, height: 1 }, defaults: {}, title: 't' });
  assert.equal(opts.icon || null, windowIcon());
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'host', 'main.js'), 'utf8');
  assert.match(main, /icon: windowIcon\(\)/);
  assert.match(main, /app\.dock\.setIcon/);
});
