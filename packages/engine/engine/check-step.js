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
// #50: without a command and a `check` script, the linter and the type checker the project itself configures and has
// installed (check-tools.js), every one of them. Their findings are compared with the base's (check-findings.js, the
// same command in the run's base checkout, asked for only when one fails): only those the change added fail the
// step; `notes` says how many were there already, what could not be compared (reported, never a failure) and
// what is not run because it rewrites files. A given command or the `check` script is never compared. The
// command `off` (any case) runs nothing.
// #67: on Windows the command's program is looked up (command-missing.js), whatever the system's language.

'use strict';

const fs = require('fs');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const { checksOff } = require('@craftorio/shared/run-inputs');
const { compareFindings, parseFindings } = require('./check-findings');
const { foundChecks } = require('./check-tools');
const { programMissing } = require('./command-missing');
const { runCommand } = require('./suite-step');
const { missingDeps } = require('./deps-cache');
const { oneLine } = require('./gate-summary');

// the findings a prompt shows at most (the log keeps all of it)
const MAX_FINDING_LINES = 40;
const DEFAULT_TIMEOUT_MS = 10 * 60e3;

// The command to run: the given one, else the project's `check` script, else null
function checkCommand(dir, command) {
  if (checksOff(command)) return null;
  const given = String(command || '').trim();
  if (given) return given;
  if (!dir) return null;
  try {
    const check = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts?.check;
    if (typeof check === 'string' && check.trim()) return 'npm run check';
  } catch { /* no package.json */ }
  return null;
}

// #50: every command the check runs, in order: checkCommand's alone, else those found in the project
function checkCommands(dir, command, { env = process.env } = {}) {
  if (checksOff(command)) return [];
  const own = checkCommand(dir, command);
  return own ? [own] : foundChecks(dir, { env }).checks.map((c) => c.command);
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

const seconds = (ms) => Math.round(ms / 1000);
const whyOf = (r, timeoutMs) => (r.timedOut ? `timed out after ${seconds(timeoutMs)} s` : r.code == null ? `could not start (${r.error})` : `exited with code ${r.code}`);
const readLog = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const quoted = (commands) => commands.map((c) => `\`${c}\``).join(', ');

// ---- #50: the tools found in the project -----------------------------------------------------------

// One found command, in the run's checkout or on the base → what it did; its log starts empty (a resumed
// run's earlier lines would count as findings)
async function runTool(check, cwd, logFile, { env, timeoutMs, signal, sweep, run, platform }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.rmSync(logFile, { force: true });
  const toolEnv = { ...env, ...check.env };
  const r = await run({ command: check.command, cwd, env: toolEnv, timeoutMs, signal, logFile, sweep });
  const text = readLog(logFile);
  const ended = !r.timedOut && r.code != null;
  return {
    code: r.code,
    environment: r.code === 0 || r.timedOut ? null : environmentOf(cwd, check.command, text, { code: r.code, env: toolEnv, platform }),
    ran: ended && !check.unready?.test(text),
    text,
    why: whyOf(r, timeoutMs),
  };
}

// The same command on the base → { result } or { reason } when there is nothing to compare with
async function runOnBase(check, logFile, opts) {
  if (opts.signal?.aborted) return { reason: 'the run stopped' };
  let base = null;
  try { base = await opts.base?.(); } catch (e) { return { reason: `the base checkout could not be prepared: ${e.message}` }; }
  if (!base?.dir || !fs.existsSync(base.dir)) return { reason: 'the run has no base checkout' };
  if (!foundChecks(base.dir, opts).checks.some((c) => c.command === check.command)) return { reason: 'the base does not have it' };
  const result = await runTool(check, base.dir, logFile.replace(/\.log$/, '-base.log'), opts);
  if (result.environment || !result.ran) return { reason: 'it could not run on the base' };
  return { dir: base.dir, result };
}

// A found command that failed, against the base → { added, old } or { reason } when it cannot be compared
function againstBase(failed, dir, base) {
  const now = parseFindings(failed.text, dir);
  const { added, old } = compareFindings(now, parseFindings(base.result.text, base.dir));
  if (added.length) return { added, old };
  // it passes on the base and names no new place: all it says is new
  if (base.result.code === 0) return { added: findingLines(failed.text), old };
  if (!now.length) return { reason: 'its output names no place to compare' };
  return base.result.code === failed.code ? { added, old } : { reason: `it exits with code ${base.result.code} there` };
}

// → { command, why } + environment, or added (new lines) and old (how many are on the base), or reason and lines
async function checkTool(check, dir, logFile, opts) {
  opts.onLog?.({ command: check.command, logFile });
  const result = await runTool(check, dir, logFile, opts);
  const out = { command: check.command, why: result.why, log: logFile, code: result.code, added: [], old: 0 };
  if (result.code === 0) return out;
  if (result.environment) return { ...out, environment: result.environment, lines: findingLines(result.text) };
  const base = result.ran ? await runOnBase(check, logFile, opts) : { reason: 'it did not run to its end' };
  const compared = base.result ? againstBase(result, dir, base) : base;
  return compared.reason ? { ...out, reason: compared.reason, lines: findingLines(result.text) } : { ...out, ...compared };
}

// What the run says besides the new findings, one line each
function notesOf(results, rewrites) {
  return [
    ...results.filter((r) => r.old).map((r) => `${r.old} finding${r.old === 1 ? '' : 's'} of \`${r.command}\` already on the base: not the change's.`),
    ...results.filter((r) => r.reason).map((r) => `\`${r.command}\` ${r.why} and could not be compared with the base (${r.reason}): reported, not blocking.`),
    ...rewrites.map((r) => `\`${r.name}\` is not run: it rewrites files (${r.why}).`),
  ];
}

// every found command in turn, up to the first that cannot run here
async function runFound({ base, checks, rewrites }, { dir, logFile, ...opts }) {
  const t0 = Date.now();
  const results = [];
  for (const check of checks) {
    results.push(await checkTool(check, dir, logFile.replace(/(\.log)?$/, `-${check.tool}.log`), { ...opts, base }));
    if (results.at(-1).environment || opts.signal?.aborted) break;
  }
  const notes = notesOf(results, rewrites);
  const failed = results.filter((r) => r.added.length);
  const broken = results.find((r) => r.environment);
  const shown = broken || failed[0] || results.find((r) => r.reason) || results[0];
  const out = { kind: 'check', command: results.map((r) => r.command).join(' && '), log: shown.log, exit_code: shown.code, duration_ms: Date.now() - t0, notes };
  const said = notes.length ? ` ${notes.join(' ')}` : '';
  if (broken) {
    return { ...out, command: broken.command, findings: broken.lines, status: 'fail', failure_kind: 'environment', cause: environmentCause(broken.environment), environment: broken.environment, message: `\`${broken.command}\` ${broken.why}:\n${broken.lines.join('\n')}` };
  }
  if (!failed.length) {
    const reported = results.flatMap((r) => r.lines || []);
    const passed = results.filter((r) => !r.reason).map((r) => r.command);
    const message = [`${passed.length ? `${quoted(passed)}: no new finding.` : 'No finding to send back.'}${said}`, ...reported].join('\n');
    return { ...out, findings: reported, status: 'pass', message };
  }
  const all = failed.flatMap((r) => r.added);
  const findings = all.slice(0, MAX_FINDING_LINES);
  const more = all.length > findings.length ? [`(and ${all.length - findings.length} more, in the logs next to ${shown.log})`] : [];
  const message = [`${quoted(failed.map((r) => r.command))}: ${all.length} new finding${all.length === 1 ? '' : 's'}, added by the change.${said}`, ...findings, ...more].join('\n');
  return { ...out, findings, status: 'fail', failure_kind: 'rules', cause: ruleCause(shown.command, shown.why, findings), message };
}

// → { kind: 'check', status: pass | fail | skipped, command, findings, message, log }
//   + on fail (#30): failure_kind 'environment' | 'rules', cause (one line, interface language for an
//   environment failure), environment { reason: deps_missing | command_missing, dir, command } when environment
// onLog({ command, logFile }) (#465): called before each command starts, its output going to that file (a found
//   tool's: <logFile>-<tool>.log, its comparison's <logFile>-<tool>-base.log, #50)
// baseCheckout (#50): () => the run's base checkout ({ dir }) or null, asked for only when a found command fails
// sweep (#390): false when dir is not a folder the run owns (a mock run checks repo_path itself):
// the command's own tree is still stopped, never the other processes running from dir (#705)
// run, platform (#67): the child process and the platform, as runSuite's
async function runCheck({ baseCheckout = /** @type {(() => Promise<{ dir: string } | null>) | null} */ (null), dir, command, logFile, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, signal, sweep = true, run = runCommand, platform = process.platform, onLog = /** @type {((info: { command: string, logFile: string }) => void) | null} */ (null) }) {
  const base = { kind: 'check', command: null, findings: [], log: null };
  if (!dir || !fs.existsSync(dir)) return { ...base, status: 'skipped', message: 'Rule checks skipped: the run has no checkout.' };
  if (checksOff(command)) return { ...base, status: 'skipped', message: 'Rule checks skipped: turned off (check_command: off).' };
  const cmd = checkCommand(dir, command);
  if (!cmd) {
    const found = foundChecks(dir, { env, platform });
    if (found.checks.length) return runFound({ ...found, base: baseCheckout }, { dir, env, logFile, onLog, platform, run, signal, sweep, timeoutMs });
    const notes = notesOf([], found.rewrites);
    const none = 'no check_command input, no `check` script in the project\'s package.json and no linter or type checker to run.';
    return { ...base, notes, status: 'skipped', message: `Rule checks skipped: ${notes.length ? notes.join(' ') : none}` };
  }
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  onLog?.({ command: cmd, logFile });
  const t0 = Date.now();
  const r = await run({ command: cmd, cwd: dir, env, timeoutMs, signal, logFile, sweep });
  const text = readLog(logFile);
  const findings = findingLines(text);
  const out = { ...base, command: cmd, findings, log: logFile, exit_code: r.code, duration_ms: Date.now() - t0 };
  if (r.code === 0) return { ...out, status: 'pass', message: `\`${cmd}\` passes.` };
  const why = whyOf(r, timeoutMs);
  const fail = { ...out, status: 'fail', message: `\`${cmd}\` ${why}:\n${findings.join('\n')}` };
  const environment = r.timedOut ? null : environmentOf(dir, cmd, text, { code: r.code, env, platform });
  if (!environment) return { ...fail, failure_kind: 'rules', cause: ruleCause(cmd, why, findings) };
  return { ...fail, failure_kind: 'environment', cause: environmentCause(environment), environment };
}

module.exports = {
  checkCommand,
  checkCommands,
  findingLines,
  runCheck,
};
