// @ts-check
// The secret scan of a run's commits (`type: secret_scan`, #49): gitleaks on a commit range, no agent, no
// model call. `scanSecrets` runs it and reads its JSON report; `commitRange` is what is scanned (base to
// HEAD, or from a tag); `newEntries` are the .gitleaksignore entries and the gitleaks configuration the
// range adds, for the code review. The step is run/machine-steps.js (`runSecretScanStep`).
// A finding keeps its rule, file, line and commit, never its value: gitleaks redacts its report
// (--redact), which is read from a temporary folder outside the worktree and the run folder, then deleted.
// Only a whole scan with an empty report is a pass: gitleaks exits with 1 for an error too, so findings
// have an exit code of their own, and every other ending is an error.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execShim } = require('../domains/machine/shell');
const { installHint } = require('../domains/machine/install-commands');
const { redactBaseline } = require('./redact-baseline');
const { resolveCommandAsync } = require('./providers');
const { missingIds } = require('./simulation');
const { git, tryGit } = require('./worktree');

const FOUND_EXIT_CODE = 9;
const TIMEOUT_MS = 10 * 60e3;
const IGNORE_FILE = '.gitleaksignore';
const CONFIG_FILE = '.gitleaks.toml';
// the user's git settings (diff.noprefix, color.ui, an external diff) must not change what gitleaks reads
const LOG_FORMAT = ['--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/'];

const NOT_SCANNED = 'Secrets not scanned';

/** @typedef {{ rule: string, file: string, line: number, commit: string }} Finding */

// The gitleaks of this machine, or null (also where the E2E hook makes it missing, simulation only)
async function findGitleaks() {
  if (missingIds().includes('gitleaks')) return null;
  const found = await resolveCommandAsync('gitleaks');
  return found ? found.file : null;
}

function notInstalledMessage() {
  const hint = installHint('gitleaks');
  return `${NOT_SCANNED}: gitleaks is not installed${hint ? ` (${hint})` : ''}.`;
}

/**
 * The commits to scan, as `{ head, not, from }`: `not` are the refs whose commits are not the run's, `from`
 * the commit the entries of the run are compared with ('' = the whole history). `since` (a tag, '' = the
 * whole history) wins over `refs`, of which the first that exists in each group is taken. Throws when the
 * range cannot be read.
 * @param {string} dir
 * @param {{ since?: string, refs?: string[][] }} what
 */
async function commitRange(dir, { since, refs = [] }) {
  const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], dir).catch(() => { throw new Error('the checkout has no commit'); });
  const commitOf = (ref) => tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], dir);
  const not = [];
  if (since !== undefined) {
    if (!since) return { head, not, from: '' };
    const tag = await commitOf(since);
    if (!tag) throw new Error(`${since} is not in the repository`);
    not.push(tag);
  } else {
    for (const group of refs) {
      let found = null;
      for (const ref of group) found = found || await commitOf(ref);
      if (found) not.push(found);
    }
    if (!not.length) throw new Error(`the base (${refs.flat().join(', ') || 'none named'}) is not in the repository`);
  }
  const from = await tryGit(['merge-base', head, ...not.slice(0, 1)], dir);
  return { head, not, from: from || not[0] };
}

// A .gitleaksignore's entries with the comment lines above them, their reason
function entriesOf(text) {
  const out = [];
  let reason = [];
  for (const line of String(text || '').split(/\r?\n/).map((l) => l.trim())) {
    if (!line) reason = [];
    else if (line.startsWith('#')) reason.push(line.replace(/^#+\s*/, ''));
    else out.push({ entry: line, reason: redactBaseline(reason.join(' ')) });
  }
  return out;
}

/**
 * What the range changes in what gitleaks skips: `ignored`, the committed .gitleaksignore entries the base
 * does not have, each with its reason; `config`, the gitleaks configuration files it changes.
 * @param {string} dir
 * @param {{ head: string, from: string }} range
 */
async function newEntries(dir, { head, from }) {
  const show = async (commit) => (commit ? entriesOf(await tryGit(['show', `${commit}:${IGNORE_FILE}`], dir)) : []);
  const before = new Set((await show(from)).map((e) => e.entry));
  const ignored = (await show(head)).filter((e) => !before.has(e.entry));
  const changed = from ? await tryGit(['diff', '--name-only', from, head, '--', CONFIG_FILE], dir) : '';
  return { ignored, config: changed ? changed.split('\n') : [] };
}

// gitleaks reads both files from the worktree: one that is not committed would close a finding the
// commits still have
async function uncommitted(dir) {
  const status = await tryGit(['status', '--porcelain', '--ignored', '--', IGNORE_FILE, CONFIG_FILE], dir);
  return [IGNORE_FILE, CONFIG_FILE].filter((f) => String(status || '').split('\n').some((l) => l.trim().endsWith(f)));
}

// → { code, stderr, failed }: `failed` says why gitleaks did not end by itself (a timeout, a stop)
function runGitleaks(file, args, { cwd, env, signal }) {
  return new Promise((resolve) => {
    execShim(file, args, { cwd, env, signal, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      const code = err ? err.code : 0;
      const failed = err && typeof code !== 'number' ? (err.killed ? `it was stopped after ${TIMEOUT_MS / 60e3} minutes` : String(code || err.message)) : '';
      resolve({ code, stderr: String(stderr || ''), failed });
    });
  });
}

// The last line gitleaks wrote about an error, short and redacted
function errorLine({ code, stderr, failed }) {
  if (failed) return redactBaseline(failed.split('\n')[0]).slice(0, 300);
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines.filter((l) => /\b(FTL|ERR|Error)\b/.test(l)).pop() || lines.pop() || '';
  return redactBaseline(`exit code ${code}${line ? `: ${line}` : ''}`).slice(0, 300);
}

/** @returns {Finding[] | null} the report's findings, null when it is not a report */
function readReport(file) {
  let list;
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!Array.isArray(list) || list.some((f) => !f || typeof f.RuleID !== 'string' || typeof f.File !== 'string')) return null;
  return list.map((f) => ({ rule: f.RuleID, file: f.File, line: Number(f.StartLine) || 0, commit: String(f.Commit || '') }));
}

const findingLine = (f) => `- ${f.rule} ${f.file}:${f.line} (commit ${f.commit.slice(0, 12)})`;

/**
 * gitleaks on the commits of `range` in `dir` (the checkout's top folder).
 * @param {{ dir: string, file: string, range: { head: string, not: string[] }, env?: object, signal?: AbortSignal }} what
 * @returns {Promise<{ status: 'pass' | 'fail' | 'error', findings: Finding[], message: string }>}
 */
async function scanSecrets({ dir, file, range, env, signal }) {
  const open = await uncommitted(dir);
  if (open.length) return { status: 'fail', findings: [], message: `${open.join(' and ')} changed without a commit: commit it, with the reason of each entry, or undo it. The scan reads only what is committed.` };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-'));
  const report = path.join(tmp, 'report.json');
  try {
    const commits = [range.head, ...(range.not.length ? ['--not', ...range.not] : [])];
    const ended = await runGitleaks(file, [
      'git',
      // without --log-opts gitleaks reads every branch
      `--log-opts=${[...LOG_FORMAT, ...commits].join(' ')}`,
      '--redact',
      // a `gitleaks:allow` comment has no reason and no entry the review sees
      '--ignore-gitleaks-allow',
      '--no-banner',
      '--no-color',
      '--report-format=json',
      `--report-path=${report}`,
      `--exit-code=${FOUND_EXIT_CODE}`,
      dir,
    ], { cwd: dir, env, signal });
    const findings = readReport(report);
    if (ended.code === 0 && findings && !findings.length) return { status: 'pass', findings: [], message: 'No secret found in the commits.' };
    if (ended.code === FOUND_EXIT_CODE && findings?.length) {
      return { status: 'fail', findings, message: `${findings.length} finding(s) in the commits:\n${findings.map(findingLine).join('\n')}` };
    }
    return { status: 'error', findings: [], message: `${NOT_SCANNED}: gitleaks failed (${errorLine(ended)}).` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = {
  commitRange,
  findGitleaks,
  newEntries,
  NOT_SCANNED,
  notInstalledMessage,
  scanSecrets,
};
