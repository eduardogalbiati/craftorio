// Whether a failed command's program does not exist on Windows (#67), for the check step (check-step.js)
// and the suite step (suite-step.js). cmd says it in the system's language and code page, and exits 1
// (npm too): the text is never read, the program is looked up the way cmd does (the command's folder,
// then PATH, with PATHEXT; a script of package.json has the node_modules/.bin folders before PATH).
// Only the first program is looked up, and only when it must have run: anything this file cannot
// decide (another separator than `&&`, `%VAR%`, a group, no PATH or PATHEXT, a script shell other
// than cmd) is not missing. Linux and macOS never get here: their shells exit 127.

'use strict';

const fs = require('fs');
const path = require('path');
const { npmScriptOf } = require('./suite-command-line');

// cmd's exit code in a batch file
const CMD_NOT_FOUND = 9009;
// what a missing command exits with: cmd's own code, npm's, or CMD_NOT_FOUND
const MISSING_CODES = [1, CMD_NOT_FOUND];
// how many `npm run` a script may go through before its program
const MAX_SCRIPT_DEPTH = 5;
// the commands of cmd itself
const INTERNAL_COMMANDS = new Set([
  'assoc',
  'break',
  'call',
  'cd',
  'chdir',
  'cls',
  'color',
  'copy',
  'date',
  'del',
  'dir',
  'echo',
  'endlocal',
  'erase',
  'exit',
  'for',
  'ftype',
  'goto',
  'if',
  'md',
  'mkdir',
  'mklink',
  'move',
  'path',
  'pause',
  'popd',
  'prompt',
  'pushd',
  'rd',
  'rem',
  'ren',
  'rename',
  'rmdir',
  'set',
  'setlocal',
  'shift',
  'start',
  'time',
  'title',
  'type',
  'ver',
  'verify',
  'vol',
]);
// npm adds its own node-gyp to a script's PATH
const NPM_PROVIDED = 'node-gyp';

// The exit code a shell gives to a missing command, whatever the output says
const isMissingCode = (code, platform = process.platform) => code === 127 || (platform === 'win32' && code === CMD_NOT_FOUND);

// Windows' variable names have no case; with two spellings Node passes the first one, sorted
function envValue(env, name) {
  const key = Object.keys(env).sort().find((k) => k.toUpperCase() === name);
  return key ? String(env[key] || '') : '';
}

const listOf = (value) => value.split(';').map((v) => v.trim().replace(/"/g, '')).filter(Boolean);

// The first command of a command line, when its failure fails the whole line (alone or before `&&`), else null
function firstCommand(command) {
  const text = String(command || '').replace(/\d?[<>]&\d/g, ' ').trim();
  // quoted text separates nothing; the same length, so that the index holds in `text`
  const masked = text.replace(/"[^"]*"/g, (q) => 'q'.repeat(q.length));
  if (/["^|\r\n]/.test(masked) || /&/.test(masked.replace(/&&/g, '  '))) return null;
  const end = masked.indexOf('&&');
  return (end < 0 ? text : text.slice(0, end)).trim();
}

// The program a command names, as cmd splits it ({ name, quoted }), or null when it cannot be told
function programOf(command) {
  const quoted = /^"([^"]+)"(?=[\s,;=<>]|$)/.exec(command);
  const name = quoted ? quoted[1] : /^[^\s"<>,;=]+(?=[\s<>,;=]|$)/.exec(command)?.[0];
  return name && !/[%()@]/.test(name) ? { name, quoted: !!quoted } : null;
}

// Whether a file is there; one that cannot be read (a Store alias, a folder without access) is
function fileThere(file) {
  try { return fs.statSync(file).isFile(); } catch (e) { return !['ENOENT', 'ENOTDIR'].includes(/** @type {any} */ (e).code); }
}

const isInternal = (name) => INTERNAL_COMMANDS.has(/^([a-z]+)(?=[.:\\/+]|$)/i.exec(name)?.[1].toLowerCase() || '');

// Whether cmd finds a program (a path, or a name) from cwd, in `dirs`, with the extensions `exts`
function programThere(name, { cwd, dirs, exts }) {
  const file = name.replace(/[\\/]/g, path.sep);
  // cmd never runs a name without an extension as it is
  const names = [...(path.extname(file) ? [file] : []), ...exts.map((e) => file + e)];
  const folders = file.includes(path.sep) ? [''] : ['', ...dirs];
  return folders.some((d) => names.some((n) => fileThere(path.resolve(cwd, d, n))));
}

// The node_modules/.bin folders npm puts before PATH for a script of cwd's package.json
function binDirs(cwd) {
  const dirs = [];
  for (let dir = path.resolve(cwd), last = ''; dir !== last; last = dir, dir = path.dirname(dir)) dirs.push(path.join(dir, 'node_modules', '.bin'));
  return dirs;
}

// Whether npm runs the scripts in a shell the project or the user chose (.npmrc), whose rules are not cmd's
function ownScriptShell(cwd, env) {
  if (envValue(env, 'NPM_CONFIG_SCRIPT_SHELL')) return true;
  return [cwd, envValue(env, 'USERPROFILE')].filter(Boolean).some((dir) => {
    try { return /^\s*script-shell\s*=/m.test(fs.readFileSync(path.join(dir, '.npmrc'), 'utf8')); } catch { return false; }
  });
}

// The command npm runs first for `npm test` / `npm run x`: its `pre` script, else the script; null for
// any other command, or a script this file cannot follow
function npmFirstScript(command, { cwd, env }) {
  const npm = npmScriptOf(command, cwd);
  if (!npm || ownScriptShell(cwd, env)) return null;
  return npm.scripts?.[`pre${npm.name}`] || npm.script || null;
}

// where: { cwd, env, dirs (PATH's, after the .bin folders in a script), exts }; depth: the scripts gone through
function firstProgramMissing(command, where, depth = 0) {
  const first = firstCommand(command);
  const program = first && programOf(first);
  if (!first || !program) return false;
  const { name, quoted } = program;
  if (!quoted && isInternal(name)) return false;
  if (depth && name.toLowerCase() === NPM_PROVIDED) return false;
  // cmd ends an unquoted program at a slash (`ping/n`): missing only when both readings are
  const readings = quoted ? [name] : [...new Set([name, name.split('/')[0]])].filter(Boolean);
  if (!readings.some((r) => programThere(r, where))) return true;
  const script = depth < MAX_SCRIPT_DEPTH ? npmFirstScript(first, where) : null;
  if (!script) return false;
  return firstProgramMissing(script, depth ? where : { ...where, dirs: [...binDirs(where.cwd), ...where.dirs] }, depth + 1);
}

// Whether a command that ended with `code` failed because its program (or the one its npm script
// starts) does not exist: Windows only, false when it cannot be told.
// `env`: the environment the command ran with
function programMissing(command, { code, timedOut = false, cwd, env = process.env, platform = process.platform }) {
  if (platform !== 'win32' || timedOut || !MISSING_CODES.includes(code)) return false;
  const dirs = listOf(envValue(env, 'PATH'));
  const exts = listOf(envValue(env, 'PATHEXT'));
  if (!dirs.length || !exts.length) return false;
  return firstProgramMissing(command, { cwd, env, dirs, exts });
}

module.exports = {
  isMissingCode,
  programMissing,
};
