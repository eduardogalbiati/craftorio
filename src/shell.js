// One launcher for child processes that may need a shell (#218). Node deprecates an args array
// together with `shell: true` (DEP0190: the args are concatenated into one command line without
// escaping), and a later Node makes it an error.
//
// - runShim(file, args, opts) → ChildProcess, like spawn. `file` is a resolved command (see
//   resolveCommand in engine/providers.js). A Windows .cmd/.bat shim (npm, CLIs installed with npm)
//   runs through cmd.exe as ONE command line whose arguments are escaped for cmd.exe; a real
//   executable, and every file on Linux/macOS, runs without a shell. The arguments reach the child
//   unchanged either way.
// - execShim(file, args, opts, cb): the same with execFile's callback (err, stdout, stderr).
// - cmdLine(file, args): the escaped cmd.exe command line (exported for tests).
//
// Escaping (the scheme of cross-spawn): each argument is quoted for the child's own parser (MSVCRT:
// backslashes before a quote and at the end doubled, quotes as \"), then every cmd.exe
// metacharacter, the quotes included, is ^-escaped TWICE: cmd.exe parses the line once, then the
// batch file parses %* again. `%` is escaped too, so `%PATH%` is never expanded. A newline cannot
// cross cmd.exe (it ends the command line): it is refused rather than silently cut.

const { execFile, exec, spawn } = require('child_process');

const isShim = (file) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(file));

const META = /([()\][%!^"`<>&|;, *?])/g;

function quoteArg(arg) {
  let a = String(arg);
  if (/[\r\n]/.test(a)) throw new Error('An argument with a newline cannot be passed through cmd.exe.');
  a = a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${a}"`.replace(META, '^^^$1');
}

function cmdLine(file, args = []) {
  return [String(file).replace(META, '^$1'), ...args.map(quoteArg)].join(' ');
}

function runShim(file, args = [], opts = {}) {
  if (!isShim(file)) return spawn(file, args, { ...opts, shell: false });
  return spawn(cmdLine(file, args), { ...opts, shell: true });
}

function execShim(file, args = [], opts = {}, cb = undefined) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (!isShim(file)) return execFile(file, args, { ...opts, shell: false }, cb);
  return exec(cmdLine(file, args), opts, cb);
}

module.exports = {
  cmdLine,
  execShim,
  isShim,
  runShim,
};
