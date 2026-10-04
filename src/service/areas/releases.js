// Service area: releases (#260, src/releases.js). A project's release history and its next release
// for the Releases screen (`listReleases`, the owner's notes: `saveReleaseNotes`), the release run
// (`startRelease`: the bundled release workflow with the history since the last release, started
// from the screen or by a roadmap's cut line, `roadmapRelease`) and what a release run that ended
// leaves (`afterRelease`): a shipped one is recorded in the history with its issues, runs, cost,
// test results and notes, and its cut line lets the roadmap go on; one that did not ship (Hold, a
// failure) pauses the roadmap at the line. Nothing here pushes: Ship is the run's own gate and the
// engine's `ship:` transition. A simulated release run records nothing; its Ship only opens the cut
// line of a simulated roadmap.

const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const backlog = require('../../backlog');
const projects = require('../../projects');
const releases = require('../../releases');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');

const RELEASE_WORKFLOW = 'release.yaml';

module.exports = (ctx) => {
  const idOf = (projectId) => path.basename(String(projectId));
  const isReleaseRun = (r) => path.basename(String(r?.file || '')) === RELEASE_WORKFLOW;
  const projectRuns = (project) => runs.runsForProject(runs.listRuns(ctx.ws.runs), project);
  // the roadmap's first cut line whose release has not shipped: [stage, its release], or null
  function waitingLine(projectId) {
    const stage = roadmaps.readRoadmap(ctx.ws.backlog, projectId).stages.find((s) => s.release && s.release.status !== 'shipped');
    return stage ? { stage: stage.id, ...stage.release } : null;
  }

  // The next release of a project: what merged locally since the last one, named by the cut line waiting.
  function nextOf(project, list = projectRuns(project)) {
    const { ws } = ctx;
    return releases.nextRelease({
      history: releases.readReleases(ws.releases, project.id), runs: list, local: backlog.readLocal(ws.backlog, project.id),
      issues: backlog.readBacklog(ws.backlog, project.id)?.issues || [], version: waitingLine(project.id)?.name || '',
    });
  }

  // → { projectId, releases (newest first), next, line: the cut line waiting, run: the release run in progress }
  function listReleases({ projectId } = {}) {
    if (!projectId) return { projectId: null, releases: [], next: null, line: null, run: null };
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, idOf(projectId));
    const list = projectRuns(project);
    const history = releases.readReleases(ws.releases, project.id);
    const live = [...ctx.active.values()].find((r) => r.projectId === project.id && isReleaseRun(r));
    return {
      projectId: project.id,
      releases: [...history.releases].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
      next: nextOf(project, list),
      line: waitingLine(project.id),
      run: live ? { runId: live.runId, mock: !!live.mock, waiting: live.approvals.size > 0 } : null,
    };
  }

  function saveReleaseNotes({ projectId, notes }) {
    releases.saveNextNotes(ctx.ws.releases, idOf(projectId), notes);
    return listReleases({ projectId });
  }

  // The release workflow's inputs for a project: its folder, the base its local runs merge into, the
  // release's name and the history since the last release (for the developer a red suite calls).
  function releaseInputs(wf, project, version) {
    const { ws } = ctx;
    const list = projectRuns(project);
    const local = backlog.readLocal(ws.backlog, project.id);
    const base = list.find((r) => r.localMerge?.base)?.localMerge.base || local?.base || null;
    const name = String(version || '').trim();
    const inputs = {
      task: `Check the release${name ? ` ${name}` : ''} of ${project.name}: the whole unit suite and the whole E2E suite, then Ship or Hold.`,
      version: name,
      history: releases.historyText(nextOf(project, list), { runsDir: ws.runs, commits: local?.commits || [] }),
    };
    for (const [k, def] of Object.entries(wf.inputs || {})) {
      if (k in inputs) continue;
      if (/^base(_branch)?$/.test(k)) { if (base) inputs[k] = base; } else if ((def?.type || 'string') === 'string' && /path|dir/i.test(k)) inputs[k] = project.folder;
    }
    return Object.fromEntries(Object.entries(inputs).filter(([k]) => wf.inputs?.[k]));
  }

  // Starts the project's release run (one at a time). `simulated`: a simulation (nothing is run or pushed).
  async function startRelease({ projectId, version = '', simulated = false }) {
    const project = projects.readProject(ctx.ws.projects, idOf(projectId));
    const going = [...ctx.active.values()].find((r) => r.projectId === project.id && isReleaseRun(r));
    if (going) throw new Error(`A release run of ${project.name} is in progress (${going.runId}): answer its Ship gate, or stop it first.`);
    const wf = loadWorkflow(ctx.workflowPath(RELEASE_WORKFLOW).file);
    return ctx.startWorkflowRun({ file: RELEASE_WORKFLOW, inputs: releaseInputs(wf, project, version || waitingLine(project.id)?.name), mock: !!simulated, projectId: project.id });
  }

  const readSummary = (runId) => {
    try { return JSON.parse(fs.readFileSync(path.join(ctx.ws.runs, path.basename(String(runId)), 'summary.json'), 'utf8')); } catch { return null; }
  };

  // What a release run that ended leaves (idempotent: the run's event and the roadmap's dispatcher
  // both call it). A real shipped run is recorded once in the project's history (by its tag) and the
  // cut line that started it becomes shipped; a run that did not ship is the dispatcher's
  // (`roadmapRelease` pauses the roadmap). → 'shipped' | 'held' | 'failed' | null (no recorded end)
  function settleRelease(projectId, runId, summary = readSummary(runId)) {
    if (!summary) return null;
    const { ws } = ctx;
    const shipped = summary.status === 'success' && summary.release ? summary.release : null;
    const outcome = shipped ? 'shipped' : summary.status === 'cancelled' ? 'held' : 'failed';
    const stage = roadmaps.readRoadmap(ws.backlog, projectId).stages.find((s) => s.release?.runId === runId);
    const history = releases.readReleases(ws.releases, projectId);
    if (shipped && !summary.mock && !history.releases.some((r) => r.tag === shipped.tag)) {
      const project = projects.readProject(ws.projects, projectId);
      const next = nextOf(project);
      const titles = new Map((backlog.readBacklog(ws.backlog, projectId)?.issues || []).map((i) => [i.number, i.title]));
      const issues = new Map(next.issues.map((i) => [i.number, i]));
      for (const n of shipped.issues || []) if (!issues.has(n)) issues.set(n, { number: n, title: titles.get(n) || '' });
      const version = stage?.release.name || String(summary.inputs?.version || '').trim() || shipped.tag;
      releases.recordRelease(ws.releases, projectId, {
        version, tag: shipped.tag, date: summary.finished_at || new Date().toISOString(), commit: shipped.commit, base: shipped.base,
        issues: [...issues.values()].sort((a, b) => a.number - b.number),
        runs: [...next.runs.map((r) => r.runId), runId],
        cost: Math.round((next.cost + (Number(summary.cost_usd) || 0)) * 100) / 100,
        tests: releases.testResults(summary.steps),
        // the owner's notes; generated ones are written again with the release's own name
        notes: next.generated ? releases.releaseNotes({ version, issues: [...issues.values()], runs: next.runs }) : next.notes,
      });
    }
    if (shipped && stage && stage.release.status !== 'shipped') {
      roadmaps.setRelease(ws.backlog, projectId, stage.id, { status: 'shipped', shippedAt: summary.finished_at || new Date().toISOString() });
    }
    return outcome;
  }

  // A release run ended: its outcome is settled, the project's commits not pushed are counted again
  // (a ship pushed them) and the roadmap goes on (or pauses at the line).
  async function afterRelease(run, ev) {
    if (!isReleaseRun(run) || !run.projectId || !ctx.ws) return;
    const outcome = settleRelease(run.projectId, run.runId, ev.summary);
    if (outcome !== 'shipped' || run.mock) return;
    const release = ev.summary.release;
    ctx.notify({ kind: 'run', event: 'succeeded', title: `Release ${release.tag} shipped`, body: `The local ${release.base} and the tag ${release.tag} are on origin.`, target: { view: 'releases', projectId: run.projectId } }, { projectId: run.projectId });
    await ctx.refreshLocal(run.projectId, { fetch: false, base: release.base });
  }

  // A roadmap reached a cut line (#260, roadmaps.advance `release`): its release run starts once
  // (the stages after the line wait for it). A run that ended without shipping pauses the roadmap
  // at the line; Resume then starts a new release run. → true when the roadmap changed (dispatch again).
  async function roadmapRelease(projectId, roadmap, { stage: stageId, name }) {
    const { ws } = ctx;
    const line = roadmaps.findStage(roadmap, stageId)?.release;
    if (!line) return false;
    if (line.runId && (ctx.active.has(line.runId) || ctx.runAlive(line.runId))) return false;
    if (line.runId && line.status === 'running') {
      const outcome = settleRelease(projectId, line.runId) || 'failed';
      if (outcome === 'shipped') return true;
      roadmaps.setRelease(ws.backlog, projectId, stageId, { status: outcome });
      const message = `Release ${name} was not shipped (${outcome === 'held' ? 'on hold' : `its run ${line.runId} failed`}): the stages after its cut line wait. Resume the run from its Ship gate, or press Resume here to check the release again.`;
      roadmaps.updateRoadmap(ws.backlog, projectId, (r) => (r.state === 'running' ? { ...r, state: 'paused', pausedBy: null, error: message } : null));
      ctx.notify({ kind: 'run', event: 'failed', title: 'Roadmap paused', body: message.slice(0, 180), target: { view: 'roadmap', projectId } }, { projectId });
      return false;
    }
    const mock = !!roadmap.simulated;
    if (ctx.slotProblem({ mock, projectId })) return false;
    try {
      const started = await startRelease({ projectId, version: name, simulated: mock });
      roadmaps.setRelease(ws.backlog, projectId, stageId, { status: 'running', runId: started.runId });
    } catch (e) {
      const message = `Could not start the release run of ${name}: ${e.message}`;
      roadmaps.updateRoadmap(ws.backlog, projectId, (r) => ({ ...r, state: 'paused', pausedBy: null, error: message }));
      ctx.notify({ kind: 'run', event: 'failed', title: 'Roadmap paused', body: message.slice(0, 180), target: { view: 'roadmap', projectId } }, { projectId });
    }
    return false;
  }

  /** Every released issue of a project: number → the version that shipped it (the Backlog's cards). */
  const releasedIssues = (projectId) => releases.releasedIssues(releases.readReleases(ctx.ws.releases, idOf(projectId)));

  return {
    afterRelease,
    listReleases,
    releasedIssues,
    roadmapRelease,
    saveReleaseNotes,
    startRelease,
  };
};
