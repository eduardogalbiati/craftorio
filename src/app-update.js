// Self-healing applies merged fixes to the app (#279): when the app runs from a source checkout and a
// project of the workspace is the app's own repository, the fixes its runs merge into that clone's
// local main are fast-forwarded into the app folder, then the app restarts and the roadmap goes on.
// No service and no model call here: git, the intent file and the cycle, with the pause, the runs,
// the install, the notifications and the restart injected (src/service/areas/app-update.js wires them).
//
// The source is always the clone's local main (never the network). The update is refused, with
// nothing changed, when the app folder has uncommitted changes or the history is not a fast-forward.
// Dependencies are installed only when package-lock.json changed; a failed install puts the app
// folder back on the previous commit.
//
// The intent, <workspace>/oracle/app-update.json { from, to, subjects, roadmaps, appDir, at }, is
// written just before the restart. The new process reads it at start (afterRestart): within
// AFTER_MS of `at`, it sets the paused roadmaps back to running (before the start-up dispatch) and
// deletes it; later, the new code did not start in time: the file stays and the app shows a banner
// with the command to go back, until the owner dismisses it.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const night = require('./night-watch');
const roadmapModel = require('./roadmap');

const AFTER_MS = 2 * 60 * 1000;
const PAUSE_REASON = 'Updating the app';
const POLL_MS = 15000;
const REASON_PACKAGED = 'the packaged app updates with a new install';
const REASON_NO_PROJECT = "no project of this workspace is this app's repository";

const short = (sha) => String(sha || '').slice(0, 7);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).toString().trim();
}

function tryGit(cwd, args) {
  try { return git(cwd, args); } catch { return null; }
}

// The commit of the clone's local main (main, else master).
function mainOf(dir) {
  for (const ref of ['refs/heads/main', 'refs/heads/master']) {
    const sha = tryGit(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (sha) return { ref, sha };
  }
  return null;
}

// A remote URL reduced to host/owner/repo (or a resolved path for a local remote), to compare two clones.
function normalizeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  const scp = /^[^@/\\]+@([^:/\\]+):(.+)$/.exec(u);
  const s = scp ? `${scp[1]}/${scp[2]}` : /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u.replace(/^[a-z][a-z0-9+.-]*:\/\/([^@/]+@)?/i, '') : path.resolve(u);
  return s.replace(/\\/g, '/').replace(/\.git\/?$/i, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * Which project of the workspace is the source of the app's updates: same `origin` URL as the app
 * folder, or a clone whose local main contains the app's commit. { ok: true, project, dir, head,
 * short, behind } or { ok: false, reason } (the reason the Settings row shows).
 */
function findSource({ appDir, isPackaged = false, projects = [] } = {}) {
  if (isPackaged) return { ok: false, reason: REASON_PACKAGED };
  const appHead = appDir && tryGit(appDir, ['rev-parse', 'HEAD']);
  if (!appHead) return { ok: false, reason: 'this app does not run from a git checkout' };
  const appOrigin = normalizeUrl(tryGit(appDir, ['remote', 'get-url', 'origin']));
  for (const p of projects) {
    if (!p || !p.dir || !fs.existsSync(p.dir)) continue;
    if (path.resolve(p.dir) === path.resolve(appDir)) continue;
    const main = mainOf(p.dir);
    if (!main) continue;
    const known = tryGit(p.dir, ['cat-file', '-e', `${appHead}^{commit}`]) !== null;
    const sameOrigin = !!appOrigin && appOrigin === normalizeUrl(tryGit(p.dir, ['remote', 'get-url', 'origin']));
    const contains = known && tryGit(p.dir, ['merge-base', '--is-ancestor', appHead, main.sha]) !== null;
    if (!sameOrigin && !contains) continue;
    const behind = known ? Number(tryGit(p.dir, ['rev-list', '--count', `${appHead}..${main.sha}`])) || 0 : 0;
    return { ok: true, project: { id: p.id, name: p.name }, dir: p.dir, head: main.sha, short: short(main.sha), behind };
  }
  return { ok: false, reason: REASON_NO_PROJECT };
}

/**
 * Fast-forwards the app folder to the source clone's local main. { ok: true, from, to, subjects,
 * installed } or { ok: false, reason } with the folder as it was. `install({ cwd })` runs only when
 * package-lock.json changed; when it throws, the folder goes back to `from`.
 */
async function applyUpdate({ appDir, sourceDir, install }) {
  const dirty = tryGit(appDir, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty === null) return { ok: false, reason: 'the app folder is not a git checkout' };
  if (dirty) return { ok: false, reason: 'the app folder has uncommitted changes' };
  const main = mainOf(sourceDir);
  if (!main) return { ok: false, reason: 'the source clone has no local main' };
  const from = git(appDir, ['rev-parse', 'HEAD']);
  try {
    git(appDir, ['fetch', '--no-tags', '--quiet', path.resolve(sourceDir), main.ref]);
  } catch (e) {
    return { ok: false, reason: `the app folder could not read the source clone (${firstLine(e)})` };
  }
  const to = git(appDir, ['rev-parse', 'FETCH_HEAD']);
  if (to === from) return { ok: false, reason: 'the app is already up to date' };
  if (tryGit(appDir, ['merge-base', '--is-ancestor', from, to]) === null) {
    return { ok: false, reason: `the update is not a fast-forward: the app folder has commits that the source's main does not have (${short(from)})` };
  }
  const subjects = git(appDir, ['log', '--format=%s', `${from}..${to}`]).split('\n').filter(Boolean);
  const lockChanged = tryGit(appDir, ['diff', '--quiet', from, to, '--', 'package-lock.json']) === null;
  try {
    git(appDir, ['merge', '--ff-only', '--quiet', to]);
  } catch (e) {
    return { ok: false, reason: `the fast-forward failed (${firstLine(e)})` };
  }
  if (lockChanged) {
    try {
      await install({ cwd: appDir });
    } catch (e) {
      tryGit(appDir, ['reset', '--hard', '--quiet', from]);
      return { ok: false, reason: `the dependencies did not install (${firstLine(e)}); the app folder is back on ${short(from)}` };
    }
  }
  return { ok: true, from, to, subjects, installed: lockChanged };
}

/**
 * The Undo of an update ("Go back to <from>"): moves the app folder back to `to`, an ancestor of its
 * commit (nothing is lost: the source clone's main still has the commits). Same result and refusals
 * as applyUpdate; `subjects` are the commits taken out.
 */
async function goBack({ appDir, to, install }) {
  const dirty = tryGit(appDir, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty === null) return { ok: false, reason: 'the app folder is not a git checkout' };
  if (dirty) return { ok: false, reason: 'the app folder has uncommitted changes' };
  const from = git(appDir, ['rev-parse', 'HEAD']);
  const target = tryGit(appDir, ['rev-parse', '--verify', '--quiet', `${to}^{commit}`]);
  if (!target) return { ok: false, reason: `the app folder does not know the commit ${short(to)}` };
  if (target === from) return { ok: false, reason: `the app is already on ${short(to)}` };
  if (tryGit(appDir, ['merge-base', '--is-ancestor', target, from]) === null) return { ok: false, reason: `${short(to)} is not an earlier commit of the app folder` };
  const subjects = git(appDir, ['log', '--format=%s', `${target}..${from}`]).split('\n').filter(Boolean);
  const lockChanged = tryGit(appDir, ['diff', '--quiet', target, from, '--', 'package-lock.json']) === null;
  try {
    git(appDir, ['reset', '--keep', '--quiet', target]);
  } catch (e) {
    return { ok: false, reason: `the app folder could not go back (${firstLine(e)})` };
  }
  if (lockChanged) {
    try {
      await install({ cwd: appDir });
    } catch (e) {
      tryGit(appDir, ['reset', '--keep', '--quiet', from]);
      return { ok: false, reason: `the dependencies did not install (${firstLine(e)}); the app folder is back on ${short(from)}` };
    }
  }
  return { ok: true, from, to: target, subjects, installed: lockChanged };
}

function firstLine(e) {
  const s = String((e && e.stderr && e.stderr.toString()) || (e && e.message) || e || '').trim();
  return s.split('\n')[0].slice(0, 200);
}

/**
 * Whether an event calls for an update: Self-healing and the switch on, the source ahead, and a
 * roadmap stage that ended (the one trigger since #285: a merged item alone never updates the app).
 */
function updateDue({ selfHealing, on, event, behind } = {}) {
  if (!selfHealing || !on || !(Number(behind) > 0) || !event) return false;
  return event.type === 'stage-done';
}

// ---- the intent ---------------------------------------------------------------------------------

const intentFile = (workspaceDir) => path.join(workspaceDir, 'oracle', 'app-update.json');

function writeIntent(workspaceDir, intent, { now = Date.now() } = {}) {
  const file = intentFile(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = { ...intent, at: new Date(now).toISOString() };
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function readIntent(workspaceDir) {
  try { return JSON.parse(fs.readFileSync(intentFile(workspaceDir), 'utf8')); } catch { return null; }
}

function dismissFailedUpdate(workspaceDir) {
  fs.rmSync(intentFile(workspaceDir), { force: true });
}

const backCommand = (intent) => `git -C "${intent.appDir}" checkout ${short(intent.from)}`;

// The intent as the failed-update banner shows it, when it is older than AFTER_MS (else null).
function failedUpdate(workspaceDir, { now = Date.now() } = {}) {
  const intent = readIntent(workspaceDir);
  if (!intent) return null;
  const at = Date.parse(intent.at);
  if (Number.isFinite(at) && now - at <= AFTER_MS) return null;
  return { status: 'failed', from: intent.from, to: intent.to, subjects: intent.subjects || [], appDir: intent.appDir, at: intent.at, command: backCommand(intent) };
}

/**
 * Called by the new process at start, before the roadmap dispatch: null without an intent; within
 * AFTER_MS of the intent, resumes the roadmaps it paused, deletes it and returns { status: 'updated',
 * from, to, subjects, resumed: [projectId] }; later, keeps it and returns the failed update.
 */
function afterRestart(workspaceDir, { now = Date.now(), backlogDir = path.join(workspaceDir, 'backlog') } = {}) {
  const intent = readIntent(workspaceDir);
  if (!intent) return null;
  const failed = failedUpdate(workspaceDir, { now });
  if (failed) return failed;
  const resumed = [];
  for (const id of intent.roadmaps || []) {
    try {
      roadmapModel.updateRoadmap(backlogDir, id, (rm) => {
        // a roadmap the owner paused (or resumed) since is left as it is
        if (rm.state !== 'paused' || rm.error !== PAUSE_REASON) return null;
        resumed.push(id);
        return { ...rm, state: 'running', pausedBy: null, error: null };
      });
    } catch { /* a roadmap removed since: nothing to resume */ }
  }
  dismissFailedUpdate(workspaceDir);
  return { status: 'updated', from: intent.from, to: intent.to, subjects: intent.subjects || [], resumed };
}

// ---- the cycle ----------------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The whole update, in order: pause (nothing new starts), wait for every run in progress (a run at a
 * human gate is waited for, never answered; the owner is told once), update, write the intent, log
 * and announce it, restart. A refusal or a failed install resumes the roadmaps and tells the owner.
 * `cancelled()` (optional) stops the wait without resuming (the owner took over); `apply` (optional,
 * applyUpdate by default) changes the app folder: goBack for the Undo.
 */
async function runUpdateCycle({ workspaceDir, appDir, sourceDir, pause, resume, activeRuns, pollMs = POLL_MS, install, notify, relaunch, cancelled = () => false, now = () => Date.now(), apply = applyUpdate }) {
  const roadmaps = (await pause(PAUSE_REASON)) || [];
  let gateTold = false;
  for (;;) {
    const runs = (await activeRuns()) || [];
    if (!runs.length) break;
    if (cancelled()) return { ok: false, reason: 'cancelled' };
    const atGate = runs.filter((r) => r.gate);
    if (atGate.length && !gateTold) {
      gateTold = true;
      notify({ title: 'App update waits for a human gate', body: `${atGate.map((r) => r.runId).join(', ')} waits for your decision at a gate; the app updates when every run in progress has ended.` });
    }
    await sleep(pollMs);
  }
  const refuse = async (reason) => {
    await resume(roadmaps);
    notify({ title: 'The app was not updated', body: `${reason}. Nothing was changed; the roadmap resumed.`, ok: false });
    return { ok: false, reason, roadmaps };
  };
  const res = await apply({ appDir, sourceDir, install });
  if (!res.ok) return refuse(res.reason);
  const intent = writeIntent(workspaceDir, { from: res.from, to: res.to, subjects: res.subjects, roadmaps, appDir }, { now: now() });
  night.logNight(path.join(workspaceDir, 'oracle'), 'oracle.action', {
    actionId: `app-update-${now()}`, permission: 'Self-healing', kind: 'app.update', title:`Updated the app: ${short(res.from)} → ${short(res.to)}`, from: res.from, to: res.to, subjects: res.subjects,
    target: appDir, auto: true, ok: true, result: 'restart', undo: `Go back to ${short(res.from)}`,
  });
  notify({ title: `Updating the app: ${short(res.from)} → ${short(res.to)}, ${plural(res.subjects.length, 'commit')}`, body: `${res.subjects.slice(0, 5).join('; ')}${res.subjects.length > 5 ? '; …' : ''}. The app restarts now.` });
  try {
    await relaunch();
  } catch (e) {
    dismissFailedUpdate(workspaceDir);
    await resume(roadmaps);
    notify({ title: 'The app did not restart', body: `${firstLine(e)}. The app folder is on ${short(res.to)}: restart the app to run it; the roadmap resumed.`, ok: false });
    return { ok: false, reason: firstLine(e), roadmaps };
  }
  return { ok: true, ...res, roadmaps, intent };
}

module.exports = {
  AFTER_MS,
  afterRestart,
  applyUpdate,
  dismissFailedUpdate,
  failedUpdate,
  findSource,
  goBack,
  intentFile,
  normalizeUrl,
  PAUSE_REASON,
  readIntent,
  runUpdateCycle,
  updateDue,
  writeIntent,
};
