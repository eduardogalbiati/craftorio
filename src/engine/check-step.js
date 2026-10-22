// The project's rule checks after a developer's commit (#404, `type: check`, run by
// src/engine/run/machine-steps.js runCheckStep): the step's `command` (the workflow's
// `check_command` input), or `npm run check` when the project's package.json has a `check` script;
// none: the step is skipped. The command runs in the run's checkout through the suite's runCommand
// (src/engine/suite-step.js: a shell, the whole output into a log, nothing left running), in a mock
// run too: like the test-id check, it is the project's own local, free and fast check. The output
// carries the command's last lines as the findings, never a fix.

'use strict';

const fs = require('fs');
const path = require('path');
const { runCommand } = require('./suite-step');

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

// → { kind: 'check', status: pass | fail | skipped, command, findings, message, log }
// onLog({ command }) (#465): called before the command starts, its output going to logFile
async function runCheck({ dir, command, logFile, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, signal, onLog = /** @type {((info: { command: string }) => void) | null} */ (null) }) {
  const base = { kind: 'check', command: null, findings: [], log: null };
  if (!dir || !fs.existsSync(dir)) return { ...base, status: 'skipped', message: 'Rule checks skipped: the run has no checkout.' };
  const cmd = checkCommand(dir, command);
  if (!cmd) return { ...base, status: 'skipped', message: 'Rule checks skipped: no check_command input and no `check` script in the project\'s package.json.' };
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  onLog?.({ command: cmd });
  const t0 = Date.now();
  const r = await runCommand({ command: cmd, cwd: dir, env, timeoutMs, signal, logFile });
  let text = '';
  try { text = fs.readFileSync(logFile, 'utf8'); } catch { /* no log */ }
  const findings = findingLines(text);
  const out = { ...base, command: cmd, findings, log: logFile, exit_code: r.code, duration_ms: Date.now() - t0 };
  if (r.code === 0) return { ...out, status: 'pass', message: `\`${cmd}\` passes.` };
  const why = r.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : r.code == null ? `could not start (${r.error})` : `exited with code ${r.code}`;
  return { ...out, status: 'fail', message: `\`${cmd}\` ${why}:\n${findings.join('\n')}` };
}

module.exports = {
  checkCommand,
  findingLines,
  runCheck,
};
