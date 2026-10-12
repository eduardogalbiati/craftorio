// src/external-terminal.js (#318): which terminal window the ↗ button opens on each OS, and the
// spawn command that opens it (pure: the caller injects the platform, the environment and
// `exists(name)`, true when a program is on PATH; nothing is spawned here). Windows keeps today's
// `cmd.exe /c start "<title>" /D "<cwd>" cmd /k "<command line>"`; macOS uses Terminal.app;
// Linux takes the first of $TERMINAL, x-terminal-emulator, gnome-terminal, konsole, xterm that is
// installed. Also the ↗ button of src/renderer/term-dock.js's termButtons, disabled with the reason
// when the app reports no external terminal (api.externalTerminal = { available, reason }), run in
// a vm sandbox the way test/renderer-command-hint.test.js runs command-hint.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const load = () => require('../src/external-terminal');

const only = (...names) => (name) => names.includes(name);
const none = () => false;
const SPEC = { title: 'Live terminal: dev', cwd: '/home/u/my repo', file: 'claude', args: ['--resume', 'abc-123'] };
const WIN_SPEC = { title: 'Live terminal: dev', cwd: 'C:\\Users\\u\\my repo', file: 'claude', args: ['--resume', 'abc-123'] };
const joined = (launch) => launch.args.join(' ');

// --- findTerminal -------------------------------------------------------------------------------

test('findTerminal: Windows always has a terminal (cmd)', () => {
  const t = load().findTerminal({ platform: 'win32', env: {}, exists: none });
  assert.ok(t, 'expected a terminal on Windows');
  assert.equal(typeof t.name, 'string');
});

test('findTerminal: macOS picks Terminal.app', () => {
  const t = load().findTerminal({ platform: 'darwin', env: {}, exists: none });
  assert.ok(t, 'expected a terminal on macOS');
  assert.equal(t.name, 'Terminal');
});

test('findTerminal: Linux prefers an installed $TERMINAL over every other terminal', () => {
  const t = load().findTerminal({ platform: 'linux', env: { TERMINAL: 'alacritty' }, exists: () => true });
  assert.equal(t?.name, 'alacritty');
});

test('findTerminal: Linux skips a $TERMINAL that is not installed', () => {
  const t = load().findTerminal({ platform: 'linux', env: { TERMINAL: 'alacritty' }, exists: only('xterm') });
  assert.equal(t?.name, 'xterm');
});

test('findTerminal: Linux order without $TERMINAL is x-terminal-emulator, gnome-terminal, konsole, xterm', () => {
  const { findTerminal } = load();
  const pick = (...installed) => findTerminal({ platform: 'linux', env: {}, exists: only(...installed) })?.name;
  assert.equal(pick('x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'), 'x-terminal-emulator');
  assert.equal(pick('gnome-terminal', 'konsole', 'xterm'), 'gnome-terminal');
  assert.equal(pick('konsole', 'xterm'), 'konsole');
  assert.equal(pick('xterm'), 'xterm');
});

test('findTerminal: Linux with no terminal installed returns null', () => {
  assert.equal(load().findTerminal({ platform: 'linux', env: {}, exists: none }), null);
});

// --- terminalLaunch -----------------------------------------------------------------------------

test('terminalLaunch: Windows is unchanged, cmd.exe running start ... cmd /k in the cwd', () => {
  const launch = load().terminalLaunch({ platform: 'win32', env: {}, exists: none, ...WIN_SPEC });
  assert.equal(launch.file, 'cmd.exe');
  const a = joined(launch);
  assert.ok(a.includes('start'), a);
  assert.ok(a.includes('cmd /k'), a);
  assert.ok(a.includes(WIN_SPEC.cwd), a);
  assert.ok(a.includes('claude'), a);
});

test('terminalLaunch: macOS opens Terminal.app (open or osascript) running the command in the cwd', () => {
  const launch = load().terminalLaunch({ platform: 'darwin', env: {}, exists: none, ...SPEC });
  assert.ok(launch, 'expected a launch on macOS');
  assert.ok(['open', 'osascript'].includes(launch.file), `file: ${launch.file}`);
  const a = joined(launch);
  assert.ok(a.includes('Terminal'), a);
  // `open -a Terminal <script>` may carry the command in a script file it wrote: then the args name
  // that file, so the command line is checked only when it is inline (osascript)
  if (launch.file === 'osascript') {
    assert.ok(a.includes('claude'), a);
    assert.ok(a.includes(SPEC.cwd), a);
  }
});

test('terminalLaunch: Linux with only xterm installed spawns xterm running the command in the cwd', () => {
  const launch = load().terminalLaunch({ platform: 'linux', env: {}, exists: only('xterm'), ...SPEC });
  assert.equal(launch?.file, 'xterm');
  const a = joined(launch);
  assert.ok(a.includes('claude'), a);
  assert.ok(a.includes('abc-123'), a);
  assert.ok(a.includes(SPEC.cwd), a);
});

test('terminalLaunch: Linux with TERMINAL=alacritty installed spawns alacritty', () => {
  const launch = load().terminalLaunch({ platform: 'linux', env: { TERMINAL: 'alacritty' }, exists: only('alacritty', 'xterm'), ...SPEC });
  assert.equal(launch?.file, 'alacritty');
  assert.ok(joined(launch).includes('claude'), joined(launch));
});

test('terminalLaunch: Linux with no terminal installed returns null (the ↗ button is disabled instead)', () => {
  assert.equal(load().terminalLaunch({ platform: 'linux', env: {}, exists: none, ...SPEC }), null);
});

// --- the ↗ button (src/renderer/term-dock.js termButtons) -----------------------------------------

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const dockSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'term-dock.js'), 'utf8');

function loadTermButtons(api) {
  const sandbox = { api, navigator: { platform: '' } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const esc = /const esc = \(s\) => [^\n]+;/.exec(appSrc)?.[0];
  assert.ok(esc, 'esc not found in app.js: the source moved');
  vm.runInContext(`${esc}\n${dockSrc}\nthis.termButtons = termButtons;`, sandbox);
  return sandbox.termButtons;
}

// The ↗ button and the embedded one, as primitives: { disabled, title }.
function buttons(html) {
  const read = (re) => {
    const tag = re.exec(html)?.[0];
    assert.ok(tag, `button not found in ${html}`);
    return { disabled: /\sdisabled[\s>=]/.test(tag), title: /title="([^"]*)"/.exec(tag)?.[1] || '' };
  };
  return { ext: read(/<button[^>]*data-ext="1"[^>]*>/), embedded: read(/<button(?![^>]*data-ext)[^>]*>/) };
}

const REASON = 'No terminal found: install xterm or set $TERMINAL';

test('termButtons: with no external terminal the ↗ button is disabled with the reason; the embedded one stays enabled', () => {
  const termButtons = loadTermButtons({ platform: 'linux', externalTerminal: { available: false, reason: REASON } });
  for (const kind of ['live', 'cli']) {
    const { ext, embedded } = buttons(termButtons(kind, ''));
    assert.equal(ext.disabled, true, `${kind}: ↗ should be disabled`);
    assert.ok(ext.title.includes('No terminal found'), `${kind}: title "${ext.title}"`);
    assert.equal(embedded.disabled, false, `${kind}: the embedded button should stay enabled`);
  }
});

test('termButtons: with an external terminal available the ↗ button is enabled', () => {
  const termButtons = loadTermButtons({ platform: 'darwin', externalTerminal: { available: true } });
  const { ext } = buttons(termButtons('live', ''));
  assert.equal(ext.disabled, false);
  assert.ok(ext.title.includes('external window'), ext.title);
});
