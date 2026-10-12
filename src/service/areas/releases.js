// Service area: releases (#260, src/releases.js). A project's release history and its next release
// for the Releases screen (`listReleases`, the owner's notes: `saveReleaseNotes`, a shipped release's
// summary its release run wrote, #290: `readReleaseSummary`), the release run
// (`startRelease`: the bundled release workflow with the history since the last release, started
// from the screen or by a roadmap's cut line, `roadmapRelease`) and what a release run that ended
// leaves (`afterRelease`): a shipped one is recorded in the history with its issues, runs, cost,
// test results and notes, and its cut line lets the roadmap go on; one that did not ship (Hold, a
// failure) pauses the roadmap at the line. A release run named like the waiting cut line is that
// line's run, whoever started it. Nothing here pushes: Ship is the run's own gate and the engine's
// `ship:` transition. A simulated release run records nothing; its Ship only opens the cut line of
// a simulated roadmap. `markReleasedIssues` marks the Backlog's issues a release shipped; the
// discovery cards linked to them are marked in the card store when the release is recorded
// (`markCards`; the store, src/discovery.js, comes with #256: a checkout without it has no card).

const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const backlog = require('../../backlog');
const projects = require('../../projects');
const releases = require('../../releases');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');

const RELEASE_WORKFLOW = 'release.yaml';

// The discovery card store (src/discovery.js, #256), or null in a checkout that does not have it
// (it was written in parallel with #260): without the store there is no card to mark.
function cardStore() {
  try { return require('../../discovery'); } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && e.message.split('\n')[0].includes('discovery')) return null;
    throw e;
  }
}

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
      // #290: `summary` when its release run wrote release-summary.md (readReleaseSummary reads it)
      releases: [...history.releases].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .map((r) => (summaryFile(r) && fs.existsSync(summaryFile(r)) ? { ...r, summary: true } : r)),
      next: nextOf(project, list),
      line: waitingLine(project.id),
      run: live ? { runId: live.runId, mock: !!live.mock, waiting: live.approvals.size > 0 } : null,
    };
  }

  // #290: a release's summary, written by its release run (the last of its runs) in its folder
  function summaryFile(release) {
    const runId = [].concat(release?.runs || []).slice(-1)[0];
    return typeof runId === 'string' && /^[\w-]+$/.test(runId) ? path.join(ctx.ws.runs, runId, 'release-summary.md') : null;
  }

  // → { version, runId, text }: the release summary of a shipped release (Releases screen)
  function readReleaseSummary({ projectId, version } = {}) {
    if (!projectId) throw new Error('No project.');
    const release = releases.readReleases(ctx.ws.releases, idOf(projectId)).releases.find((r) => r.version === version);
    if (!release) throw new Error(`No release ${version} in this project.`);
    const file = summaryFile(release);
    let text = null;
    try { text = file && fs.readFileSync(file, 'utf8'); } catch { /* no summary */ }
    if (!text) throw new Error(`The release run of ${version} left no release summary.`);
    return { version, runId: path.basename(path.dirname(file)), text };
  }

  function saveReleaseNotes({ projectId, notes }) {
    // a project that exists (readProject throws otherwise): notes are never kept for an unknown id
    releases.saveNextNotes(ctx.ws.releases, projects.readProject(ctx.ws.projects, idOf(projectId)).id, notes);
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
    // the default E2E command is an npm script: a project without it has no E2E suite to run (a
    // missing script would read as a red suite and call the developer for nothing)
    const noE2e = !!wf.inputs?.e2e_suite && wf.inputs?.e2e_command?.default === 'npm run test:e2e' && !npmScript(project.folder, 'test:e2e');
    const inputs = {
      task: `Check the release${name ? ` ${name}` : ''} of ${project.name}: the whole unit suite${noE2e ? ' (the project has no test:e2e script: no E2E suite)' : ' and the whole E2E suite'}, then Ship or Hold.`,
      version: name,
      history: releases.historyText(nextOf(project, list), { runsDir: ws.runs, commits: local?.commits || [] }),
      ...(noE2e ? { e2e_suite: 'skip' } : {}),
    };
    for (const [k, def] of Object.entries(wf.inputs || {})) {
      if (k in inputs) continue;
      if (/^base(_branch)?$/.test(k)) { if (base) inputs[k] = base; } else if ((def?.type || 'string') === 'string' && /path|dir/i.test(k)) inputs[k] = project.folder;
    }
    return Object.fromEntries(Object.entries(inputs).filter(([k]) => wf.inputs?.[k]));
  }

  // Starts the project's release run (one at a time). `simulated`: a simulation (nothing is run or
  // pushed). A run named like the roadmap's waiting cut line is that line's release run, whoever
  // started it (the roadmap, or the owner on the Releases screen): shipping it opens the line, and a
  // roadmap paused at the line (a held or failed release) waits for it again. A simulation only takes
  // the line of a simulated roadmap.
  async function startRelease({ projectId, version = '', simulated = false }) {
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, idOf(projectId));
    const going = [...ctx.active.values()].find((r) => r.projectId === project.id && isReleaseRun(r));
    if (going) throw new Error(`A release run of ${project.name} is in progress (${going.runId}): answer its Ship gate, or stop it first.`);
    const wf = loadWorkflow(ctx.workflowPath(RELEASE_WORKFLOW).file);
    const line = waitingLine(project.id);
    const name = String(version || '').trim() || line?.name || '';
    const started = await ctx.startWorkflowRun({ file: RELEASE_WORKFLOW, inputs: releaseInputs(wf, project, name), mock: !!simulated, projectId: project.id });
    if (line && line.name === name && !!simulated === !!roadmaps.readRoadmap(ws.backlog, project.id).simulated) {
      roadmaps.takeRelease(ws.backlog, project.id, line.stage, started.runId);
    }
    return started;
  }

  // Whether the project's package.json has this npm script.
  function npmScript(folder, script) {
    try { return !!JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')).scripts?.[script]; } catch { return false; }
  }

  const readSummary = (runId) => {
    try { return JSON.parse(fs.readFileSync(path.join(ctx.ws.runs, path.basename(String(runId)), 'summary.json'), 'utf8')); } catch { return null; }
  };

  // A cut line's release run ended without shipping: the line is held (Hold) or failed and a running
  // roadmap pauses there, once (the owner is told).
  function holdLine(projectId, stage, outcome, runId) {
    const was = roadmaps.readRoadmap(ctx.ws.backlog, projectId).state;
    const message = `Release ${stage.release.name} was not shipped (${outcome === 'held' ? 'on hold' : `its run ${runId} failed`}): the stages after its cut line wait. Resume the run from its Ship gate, or press Resume here to check the release again.`;
    roadmaps.holdRelease(ctx.ws.backlog, projectId, stage.id, outcome, message);
    if (was === 'running') ctx.notify({ kind: 'run', event: 'failed', title: 'Roadmap paused', body: message.slice(0, 180), target: { view: 'roadmap', projectId } }, { projectId });
  }

  // The discovery cards linked to an issue of the recorded release (found by its tag) become Released
  // (a card already released is left alone). A card that cannot be written is logged: it never
  // keeps the release from being settled.
  function markCards(projectId, tag) {
    try {
      const store = cardStore();
      const release = store && releases.readReleases(ctx.ws.releases, projectId).releases.find((r) => r.tag === tag);
      if (release) releases.releaseCards(store, ctx.ws.discovery, projectId, { version: release.version, issues: (release.issues || []).map((i) => i.number) });
    } catch (e) {
      console.error(`release ${tag}: discovery cards not marked Released:`, e.message);
    }
  }

  // What a release run that ended leaves (idempotent: the run's event and the roadmap's dispatcher
  // both call it). A real shipped run is recorded once in the project's history (by its tag), the
  // discovery cards linked to its issues are marked Released (`markCards`) and the cut line it was
  // started for becomes shipped; a run that did not ship holds its line (`holdLine`).
  // → 'shipped' | 'held' | 'failed' | null (no recorded end)
  function settleRelease(projectId, runId, summary = readSummary(runId)) {
    if (!summary) return null;
    const { ws } = ctx;
    // a real release that went out (it has its commit) is shipped whatever the run did next (a build
    // that failed after the push and the tag); a simulated one only when its run succeeded
    const shipped = summary.release && (summary.release.commit || summary.status === 'success') ? summary.release : null;
    const outcome = shipped ? 'shipped' : summary.status === 'cancelled' ? 'held' : 'failed';
    const stage = roadmaps.readRoadmap(ws.backlog, projectId).stages.find((s) => s.release?.runId === runId);
    const history = releases.readReleases(ws.releases, projectId);
    if (shipped && !summary.mock && !history.releases.some((r) => r.tag === shipped.tag)) {
      const project = projects.readProject(ws.projects, projectId);
      // the release run itself (it merged a fix) is added below, once, with its own cost
      const next = nextOf(project, projectRuns(project).filter((r) => r.runId !== runId));
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
    if (shipped && !summary.mock) markCards(projectId, shipped.tag);
    if (shipped && stage && stage.release.status !== 'shipped') {
      roadmaps.setRelease(ws.backlog, projectId, stage.id, { status: 'shipped', shippedAt: summary.finished_at || new Date().toISOString() });
    } else if (!shipped && stage?.release.status === 'running') {
      holdLine(projectId, stage, outcome, runId);
    }
    return outcome;
  }

  // A release run ended: its outcome is settled (the roadmap goes on, or pauses at the line) and the
  // project's commits not pushed are counted again (a Ship pushed them, maybe before it failed).
  async function afterRelease(run, ev) {
    if (!isReleaseRun(run) || !run.projectId || !ctx.ws) return;
    const outcome = settleRelease(run.projectId, run.runId, ev.summary);
    if (run.mock) return;
    const release = outcome === 'shipped' ? ev.summary.release : null;
    if (release) ctx.notify({ kind: 'run', event: 'succeeded', title: `Release ${release.tag} shipped`, body: `The local ${release.base} and the tag ${release.tag} are on origin.`, target: { view: 'releases', projectId: run.projectId } }, { projectId: run.projectId });
    await ctx.refreshLocal(run.projectId, { fetch: false, base: release?.base || run.inputs?.base_branch || null });
  }

  // A roadmap reached a cut line (#260, roadmaps.advance `release`): its release run starts once
  // (the stages after the line wait for it). A run that ended without shipping pauses the roadmap
  // at the line (its end usually did already: `afterRelease`; here for a run that ended while the
  // app was closed, or died without a summary); a line already held or failed means the owner
  // pressed Resume: the release is checked again. → true when the roadmap changed (dispatch again).
  async function roadmapRelease(projectId, roadmap, { stage: stageId, name }) {
    const { ws } = ctx;
    const stage = roadmaps.findStage(roadmap, stageId);
    const line = stage?.release;
    if (!line) return false;
    if (line.runId && (ctx.active.has(line.runId) || ctx.runAlive(line.runId))) return false;
    if (line.runId && line.status === 'running') {
      const outcome = settleRelease(projectId, line.runId);
      if (outcome === 'shipped') return true;
      if (!outcome) holdLine(projectId, stage, 'failed', line.runId);
      return false;
    }
    const mock = !!roadmap.simulated;
    if (ctx.slotProblem({ mock, projectId })) return false;
    try {
      // (startRelease records the run on the line)
      await startRelease({ projectId, version: name, simulated: mock });
    } catch (e) {
      const message = `Could not start the release run of ${name}: ${e.message}`;
      roadmaps.updateRoadmap(ws.backlog, projectId, (r) => ({ ...r, state: 'paused', pausedBy: null, error: message }));
      ctx.notify({ kind: 'run', event: 'failed', title: 'Roadmap paused', body: message.slice(0, 180), target: { view: 'roadmap', projectId } }, { projectId });
    }
    return false;
  }

  /** The Backlog's issues with the ones a release shipped marked Released (`released`: the first version that shipped them). */
  function markReleasedIssues(projectId, issues) {
    // newest first, so the oldest release that shipped an issue is the one it keeps
    const shipped = [...releases.readReleases(ctx.ws.releases, idOf(projectId)).releases].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return shipped.reduce((list, r) => releases.markReleased({ issues: list }, { version: r.version, issues: (r.issues || []).map((i) => i.number) }).issues, issues);
  }

  return {
    afterRelease,
    listReleases,
    markReleasedIssues,
    readReleaseSummary,
    roadmapRelease,
    saveReleaseNotes,
    startRelease,
  };
};
