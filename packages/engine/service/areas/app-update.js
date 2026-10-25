// Service area: Self-healing applies merged fixes to the app (#279, packages/engine/domains/workspace/app-update.js). The source
// (the workspace project that is this app's repository) for Settings and the roadmap cards; the
// trigger the roadmap calls when a marked item merged or a stage ended (appUpdateEvent); the cycle
// with the roadmaps and the Backlog queues paused, the runs in progress waited for, `npm install`
// only on a lockfile change and the restart through the host (apps/desktop/host/main.js, as app:relaunch does);
// and, at the start of the new process, the intent read before the roadmap dispatch
// (appUpdateAfterRestart). Never in simulation-only mode, never without a host that can restart.

const path = require('path');
const appUpdate = require('../../domains/workspace/app-update');
const backlog = require('../../domains/backlog/backlog');
const { resolveCommand } = require('../../engine/providers');
const notifier = require('../../domains/workspace/notifications');
const projects = require('../../domains/project/projects');
const roadmaps = require('../../domains/roadmap/roadmap');
const { runShim } = require('../../domains/machine/shell');
const simulation = require('../../engine/simulation');
const workspace = require('../../domains/workspace/workspace');

// the app folder of a source checkout: packages/engine/service/areas → its root
const { appRoot } = require('../../domains/workspace/app-root');

const APP_DIR = appRoot();
const SOURCE_TTL_MS = 15000;

// `npm install` in the app folder (not `npm ci`: the running Electron's files stay in place)
function npmInstall({ cwd }) {
  return new Promise((resolve, reject) => {
    const npm = resolveCommand('npm');
    if (!npm) { reject(new Error('npm not found in PATH')); return; }
    let child;
    try {
      child = runShim(npm.file, ['install', '--no-audit', '--no-fund'], { cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) { reject(e); return; }
    let err = '';
    child.stderr.on('data', (d) => { err = `${err}${d}`.slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`npm install exited with ${code}: ${err.trim().split('\n').pop() || ''}`))));
  });
}

module.exports = (ctx) => {
  const { host } = ctx;
  let cycle = null; // the cycle in progress
  let cached = null; // { root, at, source }
  const appDir = () => host.appDir || APP_DIR;
  const notice = (n) => ctx.notify(notifier.oracleNotice({ ...n, ok: n.ok !== false }));

  // { ok, project, short, behind } or { ok: false, reason }; `fresh` reads git again (the Settings screen)
  function appUpdateSource({ fresh = false } = {}) {
    if (!ctx.ws) return { ok: false, reason: 'no workspace is open' };
    if (!fresh && cached?.root === ctx.ws.root && Date.now() - cached.at < SOURCE_TTL_MS) return cached.source;
    const list = projects.listProjects(ctx.ws.projects).map((p) => ({ id: p.id, name: p.name, dir: p.folder }));
    const source = appUpdate.findSource({ appDir: appDir(), isPackaged: !!host.isPackaged, projects: list });
    cached = { root: ctx.ws.root, at: Date.now(), source };
    return source;
  }

  // what the Settings row and the roadmap cards show (no folder paths)
  function appUpdateState({ fresh = true } = {}) {
    const s = appUpdateSource({ fresh });
    return s.ok
      ? { applies: true, project: s.project, short: s.short, behind: s.behind, updating: !!cycle }
      : { applies: false, reason: s.reason, updating: !!cycle };
  }

  // nothing new starts: the running roadmaps pause with the reason, and the Backlog queues with items
  function pauseAll(reason) {
    const { backlog: dir } = ctx.ws;
    const ids = [];
    for (const id of roadmaps.roadmapProjects(dir)) {
      roadmaps.updateRoadmap(dir, id, (r) => {
        if (r.state !== 'running') return null;
        ids.push(id);
        return { ...r, state: 'paused', pausedBy: null, error: reason };
      });
    }
    backlog.pauseAll(dir, reason);
    return ids;
  }

  // a refusal: what the cycle paused (and nobody changed since) goes on
  async function resumeAll(ids) {
    const { backlog: dir } = ctx.ws;
    for (const id of ids || []) {
      try { roadmaps.updateRoadmap(dir, id, (r) => (r.state === 'paused' && r.error === appUpdate.PAUSE_REASON ? { ...r, state: 'running', pausedBy: null, error: null } : null)); } catch (e) { console.error('app update resume:', id, e.message); }
    }
    for (const id of backlog.queuedProjects(dir)) {
      try { if (backlog.readQueue(dir, id).error === appUpdate.PAUSE_REASON) backlog.setPaused(dir, id, false); } catch (e) { console.error('app update queue:', id, e.message); }
    }
    await ctx.dispatchRoadmaps();
    ctx.dispatchQueue().catch((e) => console.error('backlog dispatch:', e));
  }

  function startCycle({ sourceDir = null, apply } = {}) {
    if (cycle) throw new Error('The app is already updating.');
    if (!host.relaunch) throw new Error('This app cannot restart itself: update it by hand.');
    simulation.refuseReal('an app update');
    let paused = [];
    // the owner resumed every roadmap the cycle paused: the wait stops, nothing is updated
    const cancelled = () => paused.length > 0 && paused.every((id) => roadmaps.readRoadmap(ctx.ws.backlog, id).error !== appUpdate.PAUSE_REASON);
    cycle = appUpdate.runUpdateCycle({
      workspaceDir: ctx.ws.root,
      appDir: appDir(),
      sourceDir,
      apply,
      pause: (reason) => { paused = pauseAll(reason); return paused; },
      resume: resumeAll,
      activeRuns: () => [...ctx.active.entries()].map(([runId, live]) => ({ runId, gate: (live.approvals?.size || 0) > 0 })),
      install: npmInstall,
      notify: notice,
      relaunch: () => {
        ctx.prepareRestart({});
        host.relaunch();
      },
      cancelled,
    }).catch(async (e) => {
      console.error('app update:', e);
      notice({ title: 'The app was not updated', body: e.message, ok: false });
      await resumeAll(paused).catch(() => {});
      return { ok: false, reason: e.message };
    }).finally(() => { cycle = null; cached = null; });
    return cycle;
  }

  // Called by the roadmap (areas/roadmap.js advanceRoadmap) with { type: 'stage-done' }: true when
  // the cycle started (the caller starts nothing more).
  function appUpdateEvent(event) {
    if (cycle || !ctx.ws || !host.relaunch || simulation.simulationOnly()) return false;
    const o = workspace.readSettings(ctx.ws).oracle || {};
    const due = (behind) => appUpdate.updateDue({ selfHealing: o.selfHealing === true, on: o.appUpdate === true, event, behind });
    if (!due(1)) return false;
    let source;
    try { source = appUpdateSource({ fresh: true }); } catch (e) { console.error('app update source:', e.message); return false; }
    if (!source.ok || !due(source.behind)) return false;
    startCycle({ sourceDir: source.dir });
    return true;
  }

  // The Undo of an app.update ("Go back to <from>"): the same cycle, the app folder moved back.
  function appUpdateBack({ to }) {
    if (!/^[0-9a-f]{7,40}$/i.test(String(to || ''))) throw new Error('Go back to which commit? Give its hash.');
    if (host.isPackaged) throw new Error('The packaged app updates with a new install.');
    startCycle({ apply: (o) => appUpdate.goBack({ ...o, to: String(to) }) });
    return { started: true };
  }

  // At the start of a process (areas/workspace.js setWorkspace, before the roadmap dispatch): the
  // roadmaps an update paused run again; a late intent stays for the banner (appUpdateFailed).
  function appUpdateAfterRestart() {
    let res = null;
    try { res = appUpdate.afterRestart(ctx.ws.root, { backlogDir: ctx.ws.backlog }); } catch (e) { console.error('app update intent:', e.message); return null; }
    if (res?.status !== 'updated') return res;
    const n = res.subjects.length;
    const first = res.resumed[0];
    const stage = first ? roadmaps.currentStage(roadmaps.readRoadmap(ctx.ws.backlog, first)) + 1 : 0;
    const resumed = !res.resumed.length ? 'no roadmap was waiting for it'
      : `the roadmap resumed${stage > 0 ? ` at stage ${stage}` : ''}${res.resumed.length > 1 ? ` (${res.resumed.length} roadmaps)` : ''}`;
    notice({ title: `Updated the app: ${String(res.from).slice(0, 7)} → ${String(res.to).slice(0, 7)}`, body: `Updated (${n} commit${n === 1 ? '' : 's'}); ${resumed}.` });
    return res;
  }

  return {
    appUpdateAfterRestart,
    appUpdateBack,
    appUpdateEvent,
    appUpdateFailed: () => (ctx.ws ? appUpdate.failedUpdate(ctx.ws.root) : null),
    appUpdateState,
    dismissAppUpdate: () => { if (ctx.ws) appUpdate.dismissFailedUpdate(ctx.ws.root); return true; },
  };
};
