// The project's rule checks after a developer's commit (#404, `type: check`, run by
// packages/engine/engine/run/machine-steps.js runCheckStep): the step's `command` (the workflow's
// `check_command` input), or `npm run check` when the project's package.json has a `check` script;
// none: the step is skipped. The command runs in the run's checkout through the suite's runCommand
// (packages/engine/engine/suite-step.js: a shell, the whole output into a log, nothing left running), in a mock
// run too: like the test-id check, it is the project's own local, free and fast check. The output
// carries the command's last lines as the findings, never a fix.
// #30: a failure says what kind it is (`failure_kind`) with a one-line `cause` for the gates. An
// environment failure (a lockfile with no node_modules and a missing module or command, or a command
// not found) is no developer's to fix: the workflows stop at check_environment instead of develop.

'use strict';

const fs = require('fs');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const { runCommand } = require('./suite-step');
const { MANAGERS } = require('./deps-cache');
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

// #30: what a missing module or command prints (node, POSIX shells, Windows' cmd)
const MODULE_MISSING = /Cannot find module|MODULE_NOT_FOUND|Cannot find package/;
const COMMAND_MISSING = /command not found|: not found|is not recognized as an internal or external command/;
// a stack trace's lines: never the cause of a gate's brief
const STACK_NOISE = /^\s*(at |Require stack|- \/|- [A-Za-z]:\\|\^+\s*$|code: |requireStack|throw |Node\.js v|[{}[\]]+,?\s*$)|node:internal/;
const CAUSE_MAX = 240;

// #30: { reason, dir, command } when the failure comes from the environment, else null
function environmentOf(dir, cmd, code, text) {
  const commandMissing = code === 127 || COMMAND_MISSING.test(text);
  const depsMissing = MANAGERS.some((m) => fs.existsSync(path.join(dir, m.lockfile))) && !fs.existsSync(path.join(dir, 'node_modules'));
  if (depsMissing && (commandMissing || MODULE_MISSING.test(text))) return { reason: 'deps_missing', dir, command: cmd };
  if (commandMissing) return { reason: 'command_missing', dir, command: cmd };
  return null;
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
async function runCheck({ dir, command, logFile, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, signal, sweep = true, onLog = /** @type {((info: { command: string }) => void) | null} */ (null) }) {
  const base = { kind: 'check', command: null, findings: [], log: null };
  if (!dir || !fs.existsSync(dir)) return { ...base, status: 'skipped', message: 'Rule checks skipped: the run has no checkout.' };
  const cmd = checkCommand(dir, command);
  if (!cmd) return { ...base, status: 'skipped', message: 'Rule checks skipped: no check_command input and no `check` script in the project\'s package.json.' };
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  onLog?.({ command: cmd });
  const t0 = Date.now();
  const r = await runCommand({ command: cmd, cwd: dir, env, timeoutMs, signal, logFile, sweep });
  let text = '';
  try { text = fs.readFileSync(logFile, 'utf8'); } catch { /* no log */ }
  const findings = findingLines(text);
  const out = { ...base, command: cmd, findings, log: logFile, exit_code: r.code, duration_ms: Date.now() - t0 };
  if (r.code === 0) return { ...out, status: 'pass', message: `\`${cmd}\` passes.` };
  const why = r.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : r.code == null ? `could not start (${r.error})` : `exited with code ${r.code}`;
  const fail = { ...out, status: 'fail', message: `\`${cmd}\` ${why}:\n${findings.join('\n')}` };
  const environment = r.timedOut ? null : environmentOf(dir, cmd, r.code, text);
  if (!environment) return { ...fail, failure_kind: 'rules', cause: ruleCause(cmd, why, findings) };
  const cause = environment.reason === 'deps_missing'
    ? I18n.t('engine.check_deps_missing', { dir })
    : I18n.t('engine.check_command_missing', { command: cmd });
  return { ...fail, failure_kind: 'environment', cause, environment };
}

module.exports = {
  checkCommand,
  findingLines,
  runCheck,
};
