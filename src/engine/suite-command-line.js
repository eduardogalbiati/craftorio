// The suite's command line and its limit (#400, split from src/engine/suite-step.js, #553): whether a
// filtered command fits the platform's command line (COMMAND_LINE_LIMITS minus a margin), and why
// `n` test files do not. #553: a selection over the limit goes to the runner as a list file named
// by TEST_FILES_ENV (one test path per line, relative to the project) when the runner reads it
// (takesFileList: an npm script that is `node <file>`, the file naming the variable, as this
// project's scripts/test.js); writeFileList writes it and gives the command's extra environment.

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

// #553: whether the npm script `command` runs (with coverage: its `<name>:coverage` script when there
// is one, as suite-step's coverageCommand) is `node <file>` and that file reads the list of
// TEST_FILES_ENV. Any other command cannot take the list.
function takesFileList(command, cwd, coverage = false) {
  const npm = /^npm\s+(?:(test|t)|run(?:-script)?\s+([\w:.-]+))$/.exec(String(command || '').trim());
  if (!npm || !cwd) return false;
  let scripts = {};
  try { scripts = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts || {}; } catch { return false; }
  const name = npm[2] || 'test';
  const script = String((coverage && scripts[`${name}:coverage`]) || scripts[name] || '').trim();
  const file = /^node(?:\.exe)?\s+([^\s&|;<>-][^\s&|;<>]*\.[cm]?js)(?=\s|$)/.exec(script)?.[1];
  if (!file || /[&|;<>]/.test(script)) return false;
  try { return fs.readFileSync(path.resolve(cwd, file), 'utf8').includes(TEST_FILES_ENV); } catch { return false; }
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
  overCommandLine,
  takesFileList,
  TEST_FILES_ENV,
  writeFileList,
};
