// The suite's command line and its limit (#400, split from src/engine/suite-step.js, #553): whether a
// filtered command fits the platform's command line (COMMAND_LINE_LIMITS minus a margin), and why
// `n` test files do not. #553: a selection over the limit goes to the runner as a list file named
// by TEST_FILES_ENV (one test path per line, relative to the project) when the runner reads it
// (takesFileList: an npm script that is `node <file>`, the file naming the variable, as this
// project's scripts/test.js); writeFileList writes it and gives the command's extra environment;
// ignoredList tells, by the round's own counts, a runner that ran the whole suite anyway.

const fs = require('fs');
const path = require('path');

// The longest command line per platform (#400): cmd.exe takes 8,191 characters (spawn wraps the
// command in `cmd.exe /d /s /c "…"`, hence the margin); `sh -c` gets it as one argument, at most
// MAX_ARG_STRLEN (128 KiB) on Linux; macOS's ARG_MAX (1 MiB) also holds the environment.
const COMMAND_LINE_LIMITS = {
  darwin: { name: 'macOS', chars: 256 * 1024 },
  linux: { name: 'Linux', chars: 128 * 1024 },
  win32: { name: 'Windows', chars: 8191 },
};
const COMMAND_LINE_MARGIN = 100;
// #553: the environment variable naming a file of test paths (one per line) the runner runs instead
// of files on its command line (scripts/test.js), for a selection over the command-line limit
const TEST_FILES_ENV = 'MULTIAGENT_TEST_FILES';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Whether a command fits the platform's command line (#400), with COMMAND_LINE_MARGIN to spare.
const commandLineOf = (platform) => COMMAND_LINE_LIMITS[platform] || COMMAND_LINE_LIMITS.linux;
const fitsCommandLine = (command, platform = process.platform) => String(command || '').length <= commandLineOf(platform).chars - COMMAND_LINE_MARGIN;
// Why `n` test files cannot go on the command (#400), e.g. "319 test files would put the command
// over the Windows command-line limit of 8,191 characters"
function overCommandLine(n, platform = process.platform) {
  const { name, chars } = commandLineOf(platform);
  return `${plural(n, 'test file')} would put the command over the ${name} command-line limit of ${chars.toLocaleString('en-US')} characters`;
}

// The npm script a command runs (`npm test`, `npm run <name>`, optionally `-- <args>`; cwd: where its
// package.json is), shared by suite-step's coverageCommand and takesFileList. → null for any other
// command or without cwd; else { name, rest (' -- <args>' or ''), args, scripts (null when
// package.json cannot be read), coverageName (`<name>:coverage` when that script exists), script
// (the script that runs, trimmed: with coverage its coverageName's when there is one) }.
function npmScriptOf(command, cwd, { coverage = false } = {}) {
  const npm = /^npm\s+(?:(test|t)|run(?:-script)?\s+([\w:.-]+))(\s+--\s+(.*))?$/.exec(String(command || '').trim());
  if (!npm || !cwd) return null;
  const name = npm[2] || 'test';
  let scripts = null;
  try { scripts = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts || {}; } catch { /* unreadable: scripts stays null */ }
  const coverageName = scripts?.[`${name}:coverage`] ? `${name}:coverage` : null;
  const script = String((scripts && ((coverage && coverageName && scripts[coverageName]) || scripts[name])) || '').trim();
  return { name, rest: npm[3] || '', args: npm[4] || '', scripts, coverageName, script };
}

// #553: whether the npm script `command` runs (with coverage: its `<name>:coverage` script when there
// is one, as suite-step's coverageCommand) is `node <file>` and that file reads the list of
// TEST_FILES_ENV. Any other command cannot take the list.
function takesFileList(command, cwd, coverage = false) {
  const npm = npmScriptOf(command, cwd, { coverage });
  if (!npm?.scripts || npm.rest) return false;
  const file = /^node(?:\.exe)?\s+([^\s&|;<>-][^\s&|;<>]*\.[cm]?js)(?=\s|$)/.exec(npm.script)?.[1];
  if (!file || /[&|;<>]/.test(npm.script)) return false;
  try { return fs.readFileSync(path.resolve(cwd, file), 'utf8').includes(TEST_FILES_ENV); } catch { return false; }
}

// #553: whether a round run through the list ran more than the list, by its own counts: the agent
// reporter's per-file counts (`file_counts`) naming a file outside `files`, or as many tests as the
// run's whole suite (`wholeTests`, its passed + failed). → why, or null when the list held.
function ignoredList(out, { files, wholeTests = 0 }) {
  const norm = (f) => String(f || '').split('\\').join('/').replace(/^\.\//, '');
  const listed = new Set(files.map(norm));
  const outside = Object.keys(out.file_counts || {}).filter((f) => !listed.has(norm(f)));
  if (outside.length) return `the runner ran ${plural(outside.length, 'test file')} outside the list (${outside.slice(0, 3).join(', ')}${outside.length > 3 ? ', …' : ''})`;
  const ran = (out.passed || 0) + (out.failed || 0);
  if (wholeTests > 0 && ran >= wholeTests) return `the runner ran ${plural(ran, 'test')}, as many as the run's whole suite (${wholeTests})`;
  return null;
}

// #553: a list round whose runner ignored the list (ignoredList) ran the whole suite (without the
// suite slot): reported as a whole run (scope `full`, `list_ignored`, the why in selection.why).
// → the why, or the round's `tooLong` without a list or when the list held.
function listIgnored(out, { list, files, wholeTests, log, tooLong }) {
  const ignored = list ? ignoredList(out, { files, wholeTests }) : null;
  if (!ignored) return tooLong;
  const why = `${ignored}: it ignored the list of ${TEST_FILES_ENV}`;
  out.scope = 'full';
  out.list_ignored = true;
  out.selection = { ...(out.selection || { files }), why: `${out.selection?.why ? `${out.selection.why}; ` : ''}${why}, so the whole suite ran` };
  log('warn', `suite: ${why}: reported as a whole run`);
  return why;
}

// #553: the list file of a round whose files go through the list (`list`), in its temp folder,
// named after the round's log; `out.files_list` names it. → the command's extra environment ({}
// without a list). Only the round's own command gets it, never the reruns alone nor the base check.
function writeFileList(out, { list, tmpDir, files, logName, round, runDir }) {
  if (!list || !tmpDir) return {};
  const file = path.join(tmpDir, `${logName || `suite-${round}`}.files.txt`);
  fs.writeFileSync(file, `${files.join('\n')}\n`);
  out.files_list = path.relative(runDir, file).split(path.sep).join('/');
  return { [TEST_FILES_ENV]: file };
}

module.exports = {
  fitsCommandLine,
  ignoredList,
  listIgnored,
  npmScriptOf,
  overCommandLine,
  takesFileList,
  TEST_FILES_ENV,
  writeFileList,
};
