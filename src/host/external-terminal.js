// The terminal window the ↗ button opens (#318), per OS, and the spawn that opens it. Pure: the
// caller (src/host/main.js openConsole) injects the platform, the environment and `exists(name)`, true
// when a program is installed; nothing is spawned here.
//   Windows  cmd.exe /c start "<title>" /D "<cwd>" cmd /k "<command line>" (unchanged; the title
//            without "&|<>^, which cmd.exe would parse, SEC-27)
//   macOS    Terminal.app through osascript (`do script`), which ships with the OS
//   Linux    the first installed of $TERMINAL, x-terminal-emulator, gnome-terminal, konsole, xterm
// On macOS and Linux the window runs `cd <cwd> && <command>`, then the user's shell, so it stays
// open on exit like `cmd /k`. Terminal.app does not inherit the app's environment: the variables
// the command needs (`childEnv` differing from `env`, e.g. ELECTRON_RUN_AS_NODE) are exported in
// the command line. No terminal found (Linux): terminalLaunch is null and externalTerminal says why,
// so the renderer disables the button (src/renderer/term-dock.js termButtons).

const { shQuote } = require('../domains/machine/shell');

const LINUX_TERMINALS = [
  'x-terminal-emulator',
  'gnome-terminal',
  'konsole',
  'xterm',
];
const NO_TERMINAL = 'No terminal found: install xterm or set $TERMINAL';

function findTerminal({ platform = process.platform, env = process.env, exists }) {
  if (platform === 'win32') return { name: 'cmd' };
  if (platform === 'darwin') return { name: 'Terminal' };
  const candidates = [env.TERMINAL, ...LINUX_TERMINALS].filter(Boolean);
  const name = candidates.find((n) => exists(n));
  return name ? { name } : null;
}

// What the renderer needs to enable the ↗ button: { available, reason? }.
function externalTerminal(opts) {
  return findTerminal(opts) ? { available: true } : { available: false, reason: NO_TERMINAL };
}

const winQuote = (a) => `"${String(a).replace(/"/g, '""')}"`;
// cmd.exe parses `start "<title>"` itself and `""` is no escape there: a title from a session or
// agent name could end the quotes and chain a command (SEC-27), so its metacharacters are dropped,
// and % too (cmd.exe expands %VAR% inside the quotes)
const winTitle = (s) => String(s ?? '').replace(/["&|<>^%]/g, '');
const appleString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// The variables of childEnv to set (or unset) in a terminal that does not inherit it.
function envPrefix(childEnv, env) {
  if (!childEnv) return '';
  const valid = (k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k);
  const set = Object.entries(childEnv).filter(([k, v]) => valid(k) && env[k] !== v).map(([k, v]) => `export ${k}=${shQuote(v)}; `);
  const unset = Object.keys(env).filter((k) => valid(k) && !(k in childEnv)).map((k) => `unset ${k}; `);
  return [...unset, ...set].join('');
}

function posixLine({ cwd, file, args, childEnv, env }) {
  const command = [file, ...args].map(shQuote).join(' ');
  return `${envPrefix(childEnv, env)}cd ${shQuote(cwd)} && ${command}; exec "\${SHELL:-/bin/sh}"`;
}

// { file, args, options } to spawn (detached, stdio ignored, by the caller), or null when no
// terminal is installed. `childEnv` is the command's environment (the spec's `env`).
function terminalLaunch({ platform = process.platform, env = process.env, exists, title, cwd, file, args = [], childEnv }) {
  const terminal = findTerminal({ platform, env, exists });
  if (!terminal) return null;
  if (platform === 'win32') {
    const cmdline = [file, ...args].map(winQuote).join(' ');
    return {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', `start "${winTitle(title)}" /D ${winQuote(cwd)} cmd /k "${cmdline}"`],
      options: { windowsVerbatimArguments: true, env: childEnv },
    };
  }
  if (platform === 'darwin') {
    const line = posixLine({ cwd, file, args, childEnv, env });
    return {
      file: 'osascript',
      args: ['-e', 'tell application "Terminal"', '-e', 'activate', '-e', `do script ${appleString(line)}`, '-e', 'end tell'],
      options: {},
    };
  }
  // the terminal inherits childEnv from the spawn, and its shell from the terminal
  const shell = ['sh', '-c', posixLine({ cwd, file, args })];
  const byName = {
    'gnome-terminal': ['--title', title, '--working-directory', cwd, '--', ...shell],
    konsole: ['--workdir', cwd, '-e', ...shell],
    xterm: ['-T', title, '-e', ...shell],
  };
  return { file: terminal.name, args: byName[terminal.name] || ['-e', ...shell], options: { cwd, env: childEnv } };
}

module.exports = {
  externalTerminal,
  findTerminal,
  NO_TERMINAL,
  terminalLaunch,
};
