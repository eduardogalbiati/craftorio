// Main stays green (#405): the tests known to fail on a project's base, and the base check.
// - recordPreexisting: each failure a run counted as pre-existing (#211, #396: it fails on the base
//   too) is recorded per project, keyed by file + test: first_seen, last_seen, the runs that saw it.
//   Seen by a second run (or already tracked), it files one bug issue, then updates it. This is the
//   one store of those failures: the engine records each run's (record only), the service files.
//   A test red again after a green check reopens its issue and gets a fix item again.
// - #695: one issue per cause, not per test: the failures of one report are grouped by test file and
//   first red commit, each group files one issue (`Red on the base: <file> (19 tests)`, every test in
//   its body) or comments on the one an entry of the group has (the newly red tests, last seen); the
//   "Fix the base" item holds one issue per group.
// - runBaseCheck: once per roadmap stage, after a merge outside the roadmap (#749), and at once after
//   a merge "not tested green"; skipped (no suite) when nothing a test reads merged since the last
//   green check (the tip is lastGreen's commit, or only docs/** and *.md changed). The whole suite runs on a clean detached checkout of the base tip (<workspace>/worktrees/
//   base-check-<project>), with no agent, in simulation (CRAFTORIO_SIMULATION_ONLY=1), one check at
//   a time, deferred while a release run holds the base. A red test files a bug issue naming the
//   commit range (last green, first red) and the log; with Settings › Execution's onRed 'fix' a
//   fix item, mode auto, goes in a new stage before the roadmap's current one (packages/engine/domains/roadmap/roadmap.js
//   insertFrontStage). It never pushes, never answers a gate and never touches a running item.
//   #527: it holds the machine-wide `suite` slot (packages/engine/engine/machine-slot.js, #455) for its suite, so
//   no run's whole suite loads the machine meanwhile; no fix item for an issue a live run works on
//   (the dispatcher skips a base-health item whose issue has one).
//   #613: with failures, a second round runs only the failed tests' files (one call, same checkout,
//   slot still held; a timing failure too, nothing runs a third time); only a test red twice is
//   recorded (confirmed_at) and filed; red then green is logged ("red in the whole suite, green on the
//   re-run") and kept as a flaky sighting. A second round that throws or errors counts as red.
// - knownFailures: what the Roadmap shows ("N known failures on the base", backlog:get baseFailures).
// Store: <workspace>/backlog/base-health/<project id>.json ({ failures, lastGreen, lastCheck, flaky }: #598,
// lastCheck { commit, at, status green | red | error | no_tests } is the last check that reached the base's
// checkout, lastGreen the last green one, #613 flaky the sightings { test, file, commit, at }; a check
// stopped before it, waiting for the slot or on a folder that is not a repository, records nothing); the logs and
// issue bodies next to it, in <project id>/ (the store itself: packages/engine/engine/base-health-store.js, so
// the engine records a run's failures without this module). Wired by packages/engine/service/areas/base-health.js.

const fs = require('fs');
const path = require('path');
const issues = require('../backlog/issues');
const roadmaps = require('../roadmap/roadmap');
const { LOCAL } = require('@craftorio/shared/default-workflow');
const {
  git,
  prepareBaseWorktree,
  removeWorktree,
} = require('../../engine/worktree');
const { suiteEnv } = require('../../engine/suite-step');
const {
  acquireSlot,
  slotDir,
  SUITE_MAX_HOLD_MS,
  SUITE_SLOT,
  SUITE_SLOT_ENV,
} = require('../../engine/machine-slot');
const {
  addFlaky,
  addSightings,
  HISTORY,
  knownFailures,
  readStore,
  slug,
  storeDir,
  upsert,
  withStore,
  writeStore,
} = require('../../engine/base-health-store');

const ON_RED = ['off', 'issue', 'fix'];
const LOG_TAIL_LINES = 60;
// #749: a file no test reads (docs, Markdown): commits touching only these need no base check
const UNTESTED = (file) => file.startsWith('docs/') || file.endsWith('.md');

// #749: why the check needs no suite (the tip is the last green commit, or only untested files
// changed since it) → the reason, or null to run the suite (an unreachable commit runs it too)
async function nothingNew(repo, base, lastGreen) {
  if (!lastGreen) return { tip: null, reason: null };
  const tip = await git(['rev-parse', '--verify', `${base}^{commit}`], repo).catch(() => null);
  if (!tip) return { tip: null, reason: null };
  if (tip === lastGreen) return { tip, reason: 'the base tip is the last green commit' };
  const changed = await git(['diff', '--name-only', lastGreen, tip], repo).catch(() => null);
  if (changed === null) return { tip, reason: null };
  const files = changed.split('\n').map((f) => f.trim()).filter(Boolean);
  return { tip, reason: files.every(UNTESTED) ? 'only docs changed since the last green commit' : null };
}

const short = (c) => String(c || '').slice(0, 12) || 'unknown';
const stamp = (at) => String(at).replace(/[:.]/g, '-');

// #695: one issue per cause, the failures of one test file red since the same commit (no file: the test alone)
const causeOf = (entry) => (entry.file ? `${normFile(entry.file)}\n${entry.first_red_commit || ''}` : `\n\n${entry.test}`);
function groupByCause(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = causeOf(entry);
    if (!groups.has(key)) groups.set(key, { file: entry.file ? normFile(entry.file) : '', entries: [] });
    groups.get(key).entries.push(entry);
  }
  return [...groups.values()];
}

// `Red on the base: <file> (19 tests)`; one test: `<file> (<test>)`; no file: the test
function groupTitle({ file, entries }) {
  if (!file) return `Red on the base: ${entries[0].test}`;
  return `Red on the base: ${file} (${entries.length > 1 ? `${entries.length} tests` : entries[0].test})`;
}

function issueBody({ file, entries }, { commit, lastGreen, logFile, logText, runId }) {
  const tail = String(logText || '').split(/\r?\n/).slice(-LOG_TAIL_LINES).join('\n').trim();
  const [first] = entries;
  const runs = [...new Set(entries.flatMap((e) => e.runs || []))];
  const seen = entries.map((e) => e.first_seen).sort()[0];
  const last = entries.map((e) => e.last_seen).sort().pop();
  return [
    entries.length > 1
      ? `${entries.length} tests in \`${file}\` fail on the base:`
      : `The test \`${first.test}\` in \`${file || '(unknown file)'}\` fails on the base.`,
    ...(entries.length > 1 ? ['', ...entries.map((e) => `- ${e.test}`)] : []),
    '',
    `- Last green commit: ${lastGreen ? short(lastGreen) : 'unknown (no green base check yet)'}`,
    `- First red commit: ${short(first.first_red_commit || commit)}`,
    ...(commit && first.first_red_commit && commit !== first.first_red_commit ? [`- Still red at: ${short(commit)}`] : []),
    `- First seen: ${seen}; last seen: ${last}`,
    `- Runs that counted it as pre-existing: ${runs.length ? runs.join(', ') : 'none yet'}`,
    ...(runId ? [`- Seen by run ${runId}`] : []),
    ...(first.reason ? ['', '```', first.reason, '```'] : []),
    ...(logFile ? ['', `Log: ${logFile}`] : []),
    ...(tail ? ['', '```', tail, '```'] : []),
    '',
    'Filed by the orchestrator (main stays green, #405; one issue per cause, #695).',
  ].join('\n');
}

// Files the group's bug issue, or updates the ones its entries have (a comment naming the tests
// new to the group) → { url, number, action, test, title }; the entries without an issue get the
// first one. A store from before #695 holds one issue per test: each of them is still updated.
async function fileIssue(ws, projectId, group, { platform, repo, exec, ...ctx }) {
  const p = issues.adapterOf(platform);
  const target = issues.cliTargetOrName(platform, repo);
  const at = new Date().toISOString();
  const dir = path.join(storeDir(ws), slug(projectId));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp(at)}-issue.md`);
  const text = issueBody(group, ctx);
  fs.writeFileSync(file, text);
  const { entries } = group;
  const title = groupTitle(group);
  const test = group.file || entries[0].test;
  const known = [...new Map(entries.filter((e) => e.issue?.number).map((e) => [e.issue.number, e.issue])).values()];
  if (known.length) {
    const [open] = known;
    const added = entries.filter((e) => !e.issue?.number).map((e) => e.test);
    let reopened = false;
    for (const issue of known) {
      const n = String(issue.number);
      // red again after a green check: the issue (closed with its fix, most likely) is reopened
      const reopen = entries.some((e) => e.reopen && e.issue?.number === issue.number);
      if (reopen) {
        const r = p.issueReopenCommand(target, n);
        await Promise.resolve(exec(r.cli, r.args)).catch(() => { /* already open */ });
        reopened = true;
      }
      const head = `${reopen ? 'Red again on the base.' : 'Still red on the base.'} Last seen: ${at}.${added.length ? `\n\nNewly red: ${added.join('; ')}` : ''}`;
      const c = p.issueSaveCommand({ target, n, mode: 'comment', file, text: `${head}\n\n${text}` });
      await exec(c.cli, c.args);
    }
    for (const e of entries) { if (!e.issue?.number) e.issue = open; delete e.reopen; }
    return { url: open.url, number: open.number, action: reopened ? 'reopened' : 'updated', test, title };
  }
  // the bug label when the repository has it (GitLab creates a missing one itself)
  let labels = ['bug'];
  if (p.readsLabels) {
    const l = p.labelListCommand(target);
    labels = await Promise.resolve(exec(l.cli, l.args)).then((out) => (p.parseLabelNames(out).includes('bug') ? ['bug'] : []), () => []);
  }
  const c = p.issueCreateCommand({ target, title: title.slice(0, 200), labels, file, text });
  const url = String(await exec(c.cli, c.args) || '').match(/https?:\/\/\S+/)?.[0] || null;
  const number = Number(url?.match(/\/issues\/(\d+)/)?.[1]) || null;
  for (const e of entries) e.issue = url ? { url, number } : null;
  return { url, number, action: 'created', test, title };
}

// The fix item, mode auto, in a new stage before the roadmap's current one → the item or null.
// #527: none for an issue a live run works on (liveRunForIssues); the item is marked source 'base-health'.
// #695: one issue per group.
function addFixItem(ws, projectId, filed, workflow, liveRunForIssues) {
  const list = filed.filter((x) => x.number && !liveRunForIssues?.([{ number: x.number }]))
    .filter((x, i, all) => all.findIndex((y) => y.number === x.number) === i)
    .map((x) => ({ number: x.number, title: x.title, url: x.url }));
  if (!list.length) return null;
  const stage = roadmaps.insertFrontStage(path.join(ws, 'backlog'), projectId, {
    name: 'Fix the base',
    note: 'Added by the base check (#405): a test is red on the base.',
    items: [{ workflow: workflow || LOCAL, inputs: { mode: 'auto' }, issues: list, reason: 'Main stays green: the base has a red test.', source: 'base-health' }],
  });
  return stage?.items[0] || null;
}

// Whether `opts` can file issues (setting not off, a platform, a repository and a way to run its CLI)
const canReport = (opts) => (opts.onRed || 'fix') !== 'off' && !!opts.exec && !!opts.platform && !!(opts.ghRepo || opts.repo) && !!issues.adapterOf(opts.platform);

// Files (or updates) the issues of `entries`, one per cause (#695), and, with onRed 'fix', a fix
// item for them (none when the roadmap plans their issues already)
async function report(ws, projectId, entries, opts) {
  const { onRed = 'fix' } = opts;
  const repo = opts.ghRepo || opts.repo;
  if (!entries.length || !canReport(opts)) return { issues: [], fixItem: null };
  const filed = [];
  for (const group of groupByCause(entries)) {
    try { filed.push(await fileIssue(ws, projectId, group, { ...opts, repo })); } catch (e) { console.error(`base health: issue for ${group.file || group.entries[0].test}:`, e.message); }
  }
  const fixItem = onRed === 'fix' && filed.length ? addFixItem(ws, projectId, filed, opts.workflow, opts.liveRunForIssues) : null;
  return { issues: filed.map(({ url, action, test }) => ({ url, action, test })), fixItem };
}

/**
 * A run's pre-existing failures (the suite step's preexisting_failures): recorded, and an issue filed
 * once two runs saw a failure (updated by every later sighting). Without exec/platform/repo: record
 * only (the engine's suite step records through packages/engine/engine/base-health-store.js recordSightings); the service's call for the same run
 * then files what is due (`reported`: the runs whose sighting went to the issue already).
 * @param {string} ws the workspace root
 * @param {{ projectId: string, runId?: string, commit?: string, failures: object[], at?: string,
 *   onRed?: string, platform?: string, repo?: string, exec?: Function, workflow?: string }} opts
 */
function recordPreexisting(ws, opts) {
  const { projectId, runId, commit, failures = [], at = new Date().toISOString() } = opts;
  if (!projectId || !failures.length) return Promise.resolve({ issues: [], fixItem: null });
  return withStore(ws, projectId, async () => {
    const store = readStore(ws, projectId);
    const due = addSightings(store, { runId, commit, failures, at });
    writeStore(ws, projectId, store);
    if (!canReport(opts)) return { issues: [], fixItem: null };
    for (const entry of due) entry.reported = [...(entry.reported || []), runId].slice(-HISTORY);
    const out = await report(ws, projectId, due, { ...opts, commit, lastGreen: store.lastGreen?.commit, runId });
    writeStore(ws, projectId, store);
    return out;
  });
}

// One base check at a time, whatever the project (each runs a whole suite)
let tail = Promise.resolve();
function serialize(fn) {
  const next = tail.then(fn, fn);
  tail = next.catch(() => {});
  return next;
}

const normFile = (f) => String(f || '').split('\\').join('/');

// #613 (widens #527's timing-only re-run): the second round, one call to rerunFiles with the distinct
// files of the failed tests, in the check's checkout while the slot is held → { red, flaky }: red the
// failures red again (same test and file), those without a file and all of them when the round throws
// or returns an error (timed out, did not start); flaky the ones green on the re-run. Without
// rerunFiles, all of them red.
async function confirmTwice(failures, { rerunFiles, cwd, env, commit, load, log }) {
  const files = [...new Set(failures.filter((f) => f.file).map((f) => f.file))];
  if (typeof rerunFiles !== 'function' || !files.length) return { red: failures, flaky: [] };
  let r;
  try { r = await rerunFiles({ cwd, env, files, commit }); } catch (e) { r = { failures: [], error: e.message }; }
  if (!r || r.error) {
    log('warn', `base check: the re-run of ${files.length} file(s) failed (${r?.error || 'no result'}): its tests count as red`);
    return { red: failures, flaky: [] };
  }
  const again = new Set((r.failures || []).filter((f) => f?.test).map((f) => `${normFile(f.file)}\n${f.test}`));
  const red = [];
  const flaky = [];
  for (const f of failures) (!f.file || again.has(`${normFile(f.file)}\n${f.test}`) ? red : flaky).push(f);
  if (flaky.length) {
    let runs = [];
    try { runs = (typeof load === 'function' ? load() : []) || []; } catch { runs = []; }
    for (const f of flaky) log('info', `base check: ${f.test} (${f.file}) red in the whole suite, green on the re-run (load: ${runs.length ? runs.join(', ') : 'no run active'})`);
  }
  return { red, flaky };
}

/**
 * The base check: the suite on a clean checkout of the local base tip; a red test files its issue
 * and, with onRed 'fix', a fix item. → { status: green | red | deferred | skipped | error | no_tests (#71), commit, issues, fixItem }
 * #749: `skipped` (with `reason`, `commit` the tip) when the tip is the store's lastGreen commit or
 * the commits since it touch only files no test reads (UNTESTED); never for trigger 'not-green'.
 * `onStart` is called once the check holds the suite slot, or is about to skip (the service
 * coalesces merges until then, the check reading the tip after it);
 * trigger is 'merge', 'not-green' or 'stage' (the end of a roadmap stage).
 * #527: it takes the machine-wide `suite` slot first (waiting for a run's whole suite, `slot.onWait`
 * and a log line say so), frees it however it ends.
 * #613: with failures, a second round (`rerunFiles`) runs only the failed tests' files; a test is
 * recorded (confirmed_at: what a run's suite may count as pre-existing) and filed only when red in
 * both rounds; red then green is a flaky sighting (the store's `flaky`), nothing filed.
 * @param {string} ws the workspace root
 * @param {{ projectId: string, repo: string, base: string, platform?: string, ghRepo?: string,
 *   trigger?: string, onRed?: string, releaseHoldsBase?: () => boolean,
 *   runSuite: ({ cwd, env, commit }) => Promise<{ failures: object[], log?: string, error?: string, noTests?: boolean }>,
 *   rerunFiles?: ({ cwd, env, files, commit }) => Promise<{ failures: object[], log?: string, error?: string }>,
 *   slot?: { dir?: string, holder?: string, onWait?: Function, pollMs?: number },
 *   liveRunForIssues?: (issues: object[]) => object|null, load?: () => string[], onStart?: () => void,
 *   exec?: Function, workflow?: string, log?: Function }} opts
 */
function runBaseCheck(ws, opts) {
  const deferred = { status: 'deferred', commit: null, issues: [], fixItem: null };
  if (opts.releaseHoldsBase?.()) return Promise.resolve(deferred);
  return serialize(async () => {
    // a release may have taken the base while this check waited for the one before
    if (opts.releaseHoldsBase?.()) return deferred;
    const { projectId, repo, base, log = () => {} } = opts;
    const onRed = ON_RED.includes(opts.onRed) ? opts.onRed : 'fix';
    // #749: nothing a test reads merged since the last green check: no suite ("not tested green" always runs)
    if (opts.trigger !== 'not-green') {
      const { tip, reason } = await nothingNew(repo, base, readStore(ws, projectId).lastGreen?.commit);
      if (reason) {
        opts.onStart?.();
        // a merge that joined while the tip was read is on a newer tip: the suite runs for it
        const now = await git(['rev-parse', '--verify', `${base}^{commit}`], repo).catch(() => null);
        if (now === tip) {
          log('info', `base check skipped at ${short(tip)}: ${reason}`);
          return { status: 'skipped', reason, commit: tip, issues: [], fixItem: null };
        }
      }
    }
    const dir = path.join(ws, 'worktrees', `base-check-${slug(projectId)}`);
    // #527: one whole suite at a time per machine (#455), the base check's included
    const slot = opts.slot || {};
    let held;
    try {
      held = await acquireSlot(SUITE_SLOT, {
        dir: slot.dir || slotDir(), holder: slot.holder || `base-check ${projectId}`, pollMs: slot.pollMs, waitMs: 2 * SUITE_MAX_HOLD_MS,
        onWait: (holder) => {
          log('info', `base check waiting for the suite slot (run ${holder?.holder || '?'}, pid ${holder?.pid ?? '?'})`);
          slot.onWait?.(holder);
        },
      });
    } catch (e) {
      return { status: 'error', error: e.message, commit: null, issues: [], fixItem: null };
    }
    // #749: the merges that came while the check waited for the slot share it (the tip is read below)
    opts.onStart?.();
    let info;
    let result;
    let failures = [];
    let flaky = [];
    try {
      info = await prepareBaseWorktree({ repo, base, dir, log, remote: false });
      if (!info) return { status: 'error', error: `${repo} is not a git repository`, commit: null, issues: [], fixItem: null };
      // the check's own screenshot slot (#210), as each run's suite has; its children inherit the suite slot
      const env = { ...suiteEnv(process.env, { locksDir: path.join(ws, 'worktrees', `base-check-${slug(projectId)}-locks`) }).env, [SUITE_SLOT_ENV]: held.token };
      try {
        result = await opts.runSuite({ cwd: info.workDir, env, commit: info.commit });
        failures = (result?.failures || []).filter((f) => f?.test);
        if (failures.length) ({ red: failures, flaky } = await confirmTwice(failures, { ...opts, cwd: info.workDir, env, commit: info.commit, log }));
      } catch (e) {
        result = { failures: [], log: '', error: e.message };
      }
    } finally {
      if (info) await removeWorktree({ repo: info.repo, dir: info.dir, remote: false, log }).catch(() => {});
      held.release();
    }
    const underLoad = (result?.failures || []).filter((f) => f?.test).length > 0;
    const at = new Date().toISOString();
    return withStore(ws, projectId, async () => {
      const store = readStore(ws, projectId);
      // #598: when the base was last checked, however it ended (lastGreen stays the last green commit)
      const checked = (status) => { store.lastCheck = { commit: info.commit, at, status }; };
      // #613: the tests red in the whole suite, green on the re-run
      if (flaky.length) addFlaky(store, flaky, { commit: info.commit, at });
      // #527, #613: red only in the whole suite, green on the re-run: not a green suite either, nothing recorded but the check
      if (!failures.length && underLoad && !result?.error) {
        checked('green');
        writeStore(ws, projectId, store);
        return { status: 'green', alone: true, commit: info.commit, issues: [], fixItem: null };
      }
      if (!failures.length) {
        if (result?.error) {
          checked('error');
          writeStore(ws, projectId, store);
          return { status: 'error', error: result.error, commit: info.commit, issues: [], fixItem: null };
        }
        // #71: the project has no tests: nothing was tested, so not green (lastGreen stays)
        if (result?.noTests) {
          checked('no_tests');
          writeStore(ws, projectId, store);
          return { status: 'no_tests', commit: info.commit, issues: [], fixItem: null };
        }
        // green: the known failures are fixed (their entries keep the issue, should the test go red again)
        checked('green');
        store.lastGreen = { commit: info.commit, at };
        for (const f of store.failures) if (!f.fixed_at) f.fixed_at = at;
        writeStore(ws, projectId, store);
        return { status: 'green', commit: info.commit, issues: [], fixItem: null };
      }
      const dirLog = path.join(storeDir(ws), slug(projectId));
      fs.mkdirSync(dirLog, { recursive: true });
      const logFile = path.join(dirLog, `${stamp(at)}-suite.log`);
      fs.writeFileSync(logFile, String(result.log || ''));
      // #527, #613: confirmed by this check (red in both rounds): a run's suite may count it as pre-existing
      const entries = failures.map((f) => Object.assign(upsert(store, f, at, info.commit), { base_check: { at, commit: info.commit, trigger: opts.trigger || 'merge' }, confirmed_at: at }));
      checked('red');
      writeStore(ws, projectId, store);
      const out = await report(ws, projectId, entries, { ...opts, onRed, commit: info.commit, lastGreen: store.lastGreen?.commit, logFile, logText: result.log });
      writeStore(ws, projectId, store);
      return { status: 'red', commit: info.commit, ...out };
    });
  });
}

// the base check's suite log, next to its checkout (kept until the next check of the project, #465)
const baseCheckLog = (ws, projectId) => path.join(ws, 'worktrees', `base-check-${slug(projectId)}-suite.log`);

module.exports = {
  baseCheckLog,
  knownFailures,
  ON_RED,
  recordPreexisting,
  runBaseCheck,
};
