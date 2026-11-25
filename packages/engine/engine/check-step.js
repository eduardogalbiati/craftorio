// The project's rule checks after a developer's commit (#404, `type: check`, run by
// packages/engine/engine/run/machine-steps.js runCheckStep): the step's `command` (the workflow's
// `check_command` input), or `npm run check` when the project's package.json has a `check` script;
// none: the step is skipped. The command runs in the run's checkout (or the step's `dir`, #63) through the suite's runCommand
// (packages/engine/engine/suite-step.js: a shell, the whole output into a log, nothing left running), in a mock
// run too: like the test-id check, it is the project's own local, free and fast check. The output
// carries the command's last lines as the findings, never a fix.
// #30: a failure says what kind it is (`failure_kind`) with a one-line `cause` for the gates. An
// environment failure (a lockfile with no installed dependencies, deps-cache's missingDeps, and a missing
// module or command, or a command not found) is no developer's to fix: the workflows stop at check_environment instead of develop.
// #67: on Windows the command's program is looked up (command-missing.js), whatever the system's language.

'use strict';

const fs = require('fs');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const { programMissing } = require('./command-missing');
const { runCommand } = require('./suite-step');
const { missingDeps } = require('./deps-cache');
const { oneLine } = require('./gate-summary');

// the findings a prompt shows at most (the log keeps all of it)
const MAX_FINDING_LINES = 40;
const DEFAULT_TIMEOUT_MS = 10 * 60e3;

// The command to run: the given one, else the project's `check` script, else null
function checkCommand(dir, command) {
  const given = String(command || '').trim();
  if (given) return given;
  if (!dir) return null;
  try {
    const check = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts?.check;
    if (typeof check === 'string' && check.trim()) return 'npm run check';
  } catch { /* no package.json */ }
  return null;
}

// The meaningful lines of a check's log: no blank lines, no npm banner (`> name@1.0.0 check`)
function findingLines(text) {
  return String(text || '').split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^> /.test(l) && !/^npm (ERR!|error)/.test(l))
    .slice(-MAX_FINDING_LINES);
}

// #30: what a missing module or command prints (node, POSIX shells, Windows' cmd). A missing command is
// exit code 127 first; the text only as the shell's own line (`sh: 1: x: not found`, `bash: line 1: x:
// command not found`, `zsh: command not found: x`), never a check's finding like `docs: a.md: not found`.
// cmd's text is translated: the English one only finds a command missing inside a script (#67)
const MODULE_MISSING = /Cannot find module|MODULE_NOT_FOUND|Cannot find package/;
const COMMAND_MISSING = /^(?:\S*\/)?(?:sh|bash|dash|zsh|ksh)(?::| \d+:)? (?:line \d+: |\d+: )?(?:\S+: (?:command )?not found|command not found: \S+)\s*$|is not recognized as an internal or external command/m;
// a stack trace's lines: never the cause of a gate's brief
const STACK_NOISE = /^\s*(at |Require stack|- \/|- [A-Za-z]:\\|\^+\s*$|code: |requireStack|throw |Node\.js v|[{}[\]]+,?\s*$)|node:internal/;
const CAUSE_MAX = 240;

// #30: { reason, dir, command } (+ manager, install for deps_missing) when the failure comes from the
// environment, else null; missing dependencies: deps-cache's missingDeps, the onboarding's rule too
function environmentOf(dir, cmd, text, { code, env, platform }) {
  const commandMissing = code === 127 || COMMAND_MISSING.test(text) || programMissing(cmd, { code, cwd: dir, env, platform });
  const deps = missingDeps(dir);
  if (deps && (commandMissing || MODULE_MISSING.test(text))) return { reason: 'deps_missing', dir, command: cmd, manager: deps.manager, install: deps.install };
  if (commandMissing) return { reason: 'command_missing', dir, command: cmd };
  return null;
}

// #30: the environment failure's one-line cause, in the interface language (npm ci for npm, the
// manager's own install for pnpm and yarn)
function environmentCause(env) {
  if (env.reason !== 'deps_missing') return I18n.t('engine.check_command_missing', { command: env.command });
  return env.manager === 'npm'
    ? I18n.t('engine.check_deps_missing', { dir: env.dir })
    : I18n.t('engine.check_deps_missing_with', { install: env.install, dir: env.dir });
}

// #30: a rule failure's cause: the command, why, and its first meaningful finding (an `Error: ...` line first)
function ruleCause(cmd, why, findings) {
  const useful = findings.filter((l) => !STACK_NOISE.test(l));
  const first = useful.find((l) => /^\s*\w*Error\b/.test(l)) || useful[0] || '';
  return oneLine(`\`${cmd}\` ${why}${first ? `: ${first.trim()}` : ''}`, CAUSE_MAX);
}

// → { kind: 'check', status: pass | fail | skipped, command, findings, message, log }
//   + on fail (#30): failure_kind 'environment' | 'rules', cause (one line, interface language for an
//   environment failure), environment { reason: deps_missing | command_missing, dir, command } when environment
// onLog({ command }) (#465): called before the command starts, its output going to logFile
// sweep (#390): false when dir is not a folder the run owns (a mock run checks repo_path itself):
// the command's own tree is still stopped, never the other processes running from dir (#705)
// run, platform (#67): the child process and the platform, as runSuite's
async function runCheck({ dir, command, logFile, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, signal, sweep = true, run = runCommand, platform = process.platform, onLog = /** @type {((info: { command: string }) => void) | null} */ (null) }) {
  const base = { kind: 'check', command: null, findings: [], log: null };
  if (!dir || !fs.existsSync(dir)) return { ...base, status: 'skipped', message: 'Rule checks skipped: the run has no checkout.' };
  const cmd = checkCommand(dir, command);
  if (!cmd) return { ...base, status: 'skipped', message: 'Rule checks skipped: no check_command input and no `check` script in the project\'s package.json.' };
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  onLog?.({ command: cmd });
  const t0 = Date.now();
  const r = await run({ command: cmd, cwd: dir, env, timeoutMs, signal, logFile, sweep });
  let text = '';
  try { text = fs.readFileSync(logFile, 'utf8'); } catch { /* no log */ }
  const findings = findingLines(text);
  const out = { ...base, command: cmd, findings, log: logFile, exit_code: r.code, duration_ms: Date.now() - t0 };
  if (r.code === 0) return { ...out, status: 'pass', message: `\`${cmd}\` passes.` };
  const why = r.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : r.code == null ? `could not start (${r.error})` : `exited with code ${r.code}`;
  const fail = { ...out, status: 'fail', message: `\`${cmd}\` ${why}:\n${findings.join('\n')}` };
  const environment = r.timedOut ? null : environmentOf(dir, cmd, text, { code: r.code, env, platform });
  if (!environment) return { ...fail, failure_kind: 'rules', cause: ruleCause(cmd, why, findings) };
  return { ...fail, failure_kind: 'environment', cause: environmentCause(environment), environment };
}

module.exports = {
  checkCommand,
  findingLines,
  runCheck,
};
