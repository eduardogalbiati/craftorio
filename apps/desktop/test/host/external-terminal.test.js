// apps/desktop/host/external-terminal.js (#318): which terminal window the ↗ button opens on each OS, and the
// spawn command that opens it (pure: the caller injects the platform, the environment and
// `exists(name)`, true when a program is on PATH; nothing is spawned here). Windows keeps today's
// `cmd.exe /c start "<title>" /D "<cwd>" cmd /k "<command line>"`; macOS uses Terminal.app;
// Linux takes the first of $TERMINAL, x-terminal-emulator, gnome-terminal, konsole, xterm that is
// installed. Also the ↗ button of packages/ui-kit/term-dock.js's termButtons, disabled with the reason
// when the app reports no external terminal (api.externalTerminal = { available, reason }), run in
// a vm sandbox the way test/renderer-command-hint.test.js runs command-hint.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');

const load = () => require('../../host/external-terminal');

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

// --- quoting, the environment and the per-terminal argument shapes ------------------------------

// The `sh -c` line a Linux terminal runs: the last argument of its launch.
const shLine = (launch) => launch.args[launch.args.length - 1];
// The AppleScript `do script "<line>"` argument of the macOS launch.
const doScript = (launch) => launch.args.find((a) => a.startsWith('do script '));

test('terminalLaunch: Linux quotes a cwd with spaces and an argument with a single quote for sh', () => {
  const launch = load().terminalLaunch({ platform: 'linux', env: {}, exists: only('xterm'), ...SPEC, args: ["it's", 'two words'] });
  const line = shLine(launch);
  assert.ok(line.includes("cd '/home/u/my repo' && "), line);
  assert.ok(line.includes("'it'\\''s'"), line);
  assert.ok(line.includes("'two words'"), line);
  assert.deepEqual(launch.args.slice(-3, -1), ['sh', '-c']);
});

test('terminalLaunch: macOS escapes double quotes and backslashes inside the AppleScript string', () => {
  const launch = load().terminalLaunch({ platform: 'darwin', env: {}, exists: none, ...SPEC, args: ['say "hi"', 'C:\\x'] });
  const script = doScript(launch);
  assert.ok(script, launch.args.join(' | '));
  assert.ok(script.startsWith('do script "') && script.endsWith('"'), script);
  const body = script.slice('do script "'.length, -1);
  assert.ok(body.includes('\\"hi\\"'), body);
  assert.ok(body.includes('C:\\\\x'), body);
  // once the escapes are removed, no bare double quote is left to end the string early
  assert.equal(body.replace(/\\\\/g, '').replace(/\\"/g, '').includes('"'), false, body);
});

test('terminalLaunch: macOS exports only the variables that differ and unsets the removed ones', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/u', ELECTRON_RUN_AS_NODE: '1' };
  const childEnv = { PATH: '/opt/bin:/usr/bin', HOME: '/Users/u', MULTIAGENT_X: 'a b' };
  const script = doScript(load().terminalLaunch({ platform: 'darwin', env, exists: none, ...SPEC, childEnv }));
  assert.ok(script.includes('unset ELECTRON_RUN_AS_NODE;'), script);
  assert.ok(script.includes("export PATH='/opt/bin:/usr/bin';"), script);
  assert.ok(script.includes("export MULTIAGENT_X='a b';"), script);
  assert.equal(script.includes('export HOME'), false, script);
  // the environment is set before the command runs
  assert.ok(script.indexOf('unset ELECTRON_RUN_AS_NODE') < script.indexOf('cd '), script);
  assert.ok(script.indexOf('export PATH') < script.indexOf('cd '), script);
});

test('terminalLaunch: macOS without a command environment exports nothing', () => {
  const script = doScript(load().terminalLaunch({ platform: 'darwin', env: { PATH: '/usr/bin' }, exists: none, ...SPEC }));
  assert.equal(/\b(export|unset) /.test(script), false, script);
});

test('terminalLaunch: Linux hands the command environment and the cwd to the terminal spawn', () => {
  const childEnv = { PATH: '/opt/bin', MULTIAGENT_X: '1' };
  const launch = load().terminalLaunch({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: only('xterm'), ...SPEC, childEnv });
  assert.equal(launch.options.cwd, SPEC.cwd);
  assert.equal(launch.options.env.MULTIAGENT_X, '1');
  assert.equal(/\b(export|unset) /.test(shLine(launch)), false, shLine(launch));
});

test('terminalLaunch: gnome-terminal gets its title and working directory, then the command after --', () => {
  const { args } = load().terminalLaunch({ platform: 'linux', env: {}, exists: only('gnome-terminal'), ...SPEC });
  assert.equal(args[args.indexOf('--working-directory') + 1], SPEC.cwd);
  assert.equal(args[args.indexOf('--title') + 1], SPEC.title);
  assert.deepEqual(args.slice(args.indexOf('--'), args.indexOf('--') + 3), ['--', 'sh', '-c']);
});

test('terminalLaunch: konsole gets --workdir, then the command after -e', () => {
  const { args } = load().terminalLaunch({ platform: 'linux', env: {}, exists: only('konsole'), ...SPEC });
  assert.equal(args[args.indexOf('--workdir') + 1], SPEC.cwd);
  assert.deepEqual(args.slice(args.indexOf('-e'), args.indexOf('-e') + 3), ['-e', 'sh', '-c']);
});

test('terminalLaunch: xterm gets its title with -T; an unknown $TERMINAL gets the generic -e form', () => {
  const { terminalLaunch } = load();
  const xterm = terminalLaunch({ platform: 'linux', env: {}, exists: only('xterm'), ...SPEC }).args;
  assert.equal(xterm[xterm.indexOf('-T') + 1], SPEC.title);
  const other = terminalLaunch({ platform: 'linux', env: { TERMINAL: 'alacritty' }, exists: only('alacritty'), ...SPEC }).args;
  assert.deepEqual(other.slice(0, 3), ['-e', 'sh', '-c']);
});

test('externalTerminal: available where a terminal is found, else unavailable with the reason', () => {
  const { externalTerminal } = load();
  assert.equal(externalTerminal({ platform: 'win32', env: {}, exists: none }).available, true);
  assert.equal(externalTerminal({ platform: 'darwin', env: {}, exists: none }).available, true);
  assert.equal(externalTerminal({ platform: 'linux', env: {}, exists: only('konsole') }).available, true);
  const missing = externalTerminal({ platform: 'linux', env: {}, exists: none });
  assert.equal(missing.available, false);
  assert.match(missing.reason, /No terminal found/);
});

// --- the ↗ button (packages/ui-kit/term-dock.js termButtons) -----------------------------------------

const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'packages', 'ui-kit', 'app.js'), 'utf8');
const dockSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'packages', 'ui-kit', 'term-dock.js'), 'utf8');

function loadTermButtons(api) {
  const sandbox = { api, navigator: { platform: '' } };
  sandbox.window = sandbox;
  withI18n(sandbox);
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
