// Service area: releases (#260, packages/engine/domains/releases/releases.js). A project's release history and its next release
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
// (`markCards`; the store, packages/engine/domains/discovery/discovery.js, comes with #256: a checkout without it has no card).
// #489 "rc + stable": `listReleases` lists the release candidates since the last stable (one rc per
// merge into main) with the suggested stable version; `holdCandidate` puts one on Hold;
// `promoteRelease` tags a candidate's commit as the stable release (only the tag is pushed; nothing
// in simulation); `releaseTrain` is the night's end (packages/engine/service/channels/nightwatch.js): the last
// candidate is promoted, proposed or held (night.decideReleaseTrain).

const fs = require('fs');
const path = require('path');
const { readStore: readBaseHealth } = require('../../engine/base-health-store');
const simulation = require('../../engine/simulation');
const { loadWorkflow } = require('../../engine/workflow');
const backlog = require('../../domains/backlog/backlog');
const { clientError } = require('../common');
const night = require('../../domains/night/night-watch');
const projects = require('../../domains/project/projects');
const releases = require('../../domains/releases/releases');
const roadmaps = require('../../domains/roadmap/roadmap');
const runs = require('../../domains/run/runs');
const { isRelease } = require('@craftorio/shared/roadmap-model');

const RELEASE_WORKFLOW = 'release.yaml';

// The discovery card store (packages/engine/domains/discovery/discovery.js, #256), or null in a checkout that does not have it
// (it was written in parallel with #260): without the store there is no card to mark.
function cardStore() {
  try { return require('../../domains/discovery/discovery'); } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && e.message.split('\n')[0].includes('discovery')) return null;
    throw e;
  }
}

module.exports = (ctx) => {
  const idOf = (projectId) => path.basename(String(projectId));
  const isReleaseRun = (r) => path.basename(String(r?.file || '')) === RELEASE_WORKFLOW;
  const projectRuns = (project) => runs.runsForProject(runs.listRuns(ctx.ws.runs), project);
  // the roadmap's first release entry (#555) that has not shipped: { stage (its id), ...the entry }, or null
  function waitingLine(projectId) {
    const entry = roadmaps.readRoadmap(ctx.ws.backlog, projectId).stages.find((s) => isRelease(s) && s.status !== 'shipped');
    if (!entry) return null;
    const { items: _i, kind: _k, ...line } = entry;
    return { stage: entry.id, ...line };
  }

  // The next release of a project: what merged locally since the last one, named by the cut line waiting.
  function nextOf(project, list = projectRuns(project)) {
    const { ws } = ctx;
    return releases.nextRelease({
      history: releases.readReleases(ws.releases, project.id), runs: list, local: backlog.readLocal(ws.backlog, project.id),
      issues: backlog.readBacklog(ws.backlog, project.id)?.issues || [], version: waitingLine(project.id)?.name || '',
    });
  }

  // #489: the release candidates since the last stable, newest first
  const candidatesOf = (history) => releases.candidatesSinceStable(history).reverse()
    .map((c) => ({ tag: c.tag, commit: c.commit, date: c.date, runId: c.runId || null, issues: c.issues || [], held: !!c.held, stable: releases.stableVersion({ history, upTo: c.date }).version }));

  // → { projectId, releases (newest first), next, line: the cut line waiting, run: the release run in progress,
  //   candidates (#489, newest first), stable: { version, bump } suggested for a promotion }
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
      candidates: candidatesOf(history),
      stable: releases.stableVersion({ history }),
    };
  }

  // #489: Hold on a release candidate (the night's train never promotes it), or off. A tag that is
  // not a candidate is refused as the client's error (400).
  function holdCandidate({ projectId, tag, held = true }) {
    const id = projects.readProject(ctx.ws.projects, idOf(projectId)).id;
    if (!(releases.readReleases(ctx.ws.releases, id).candidates || []).some((c) => c.tag === tag)) {
      throw clientError(`There is no release candidate ${tag || '(no tag)'}: refresh the Releases screen.`);
    }
    releases.holdCandidate(ctx.ws.releases, id, tag, held !== false);
    return listReleases({ projectId });
  }

  // #489: a push of the base (packages/engine/service/areas/local-push.js) is a release candidate: its tip, the
  // version of the project's package.json, the run merged there last and the issues its commits
  // close. A project without a package.json version records none. Returns the candidate or null.
  function recordPushCandidate(projectId, { commits = [], issues = [] } = {}) {
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, idOf(projectId));
    let version = '';
    try { version = String(JSON.parse(fs.readFileSync(path.join(project.folder, 'package.json'), 'utf8')).version || ''); } catch { return null; }
    if (!version || !commits[0]?.sha) return null;
    const shas = new Set(commits.map((c) => c.sha));
    const run = projectRuns(project).find((r) => r.localMerge?.commit && shas.has(r.localMerge.commit));
    const known = backlog.readBacklog(ws.backlog, project.id)?.issues || [];
    const found = issues.map((n) => known.find((i) => i.number === n) || { number: n })
      .map((i) => ({ number: i.number, ...(i.title ? { title: i.title } : {}), labels: i.labels || [] }));
    return releases.recordCandidate(ws.releases, project.id, { commit: commits[0].sha, version, runId: run?.runId || null, issues: found });
  }

  // #489: the stable release from a release candidate's commit (or its tag), without a rebuild: the
  // tag is pushed on that commit (deploy.yml promotes its GitHub release); nothing is tagged in
  // simulation. A commit without a candidate or a version already released is refused with the
  // reason, before anything is tagged: the client's error (400); a tag that fails stays a 500.
  async function promoteRelease({ projectId, commit = '', tag = '', version = '' }) {
    const { ws } = ctx;
    const project = projects.readProject(ws.projects, idOf(projectId));
    const sha = commit || (releases.readReleases(ws.releases, project.id).candidates || []).find((c) => c.tag === tag)?.commit || '';
    let tagging = false;
    const tagOn = simulation.simulationOnly() ? async () => {} : (o) => releases.tagRelease({ repo: project.folder, ...o });
    const tagCommit = (o) => { tagging = true; return tagOn(o); };
    let out;
    try {
      out = await releases.promoteRelease({ dir: ws.releases, projectId: project.id, commit: sha, version, tagCommit });
    } catch (e) {
      throw tagging ? e : clientError(e.message);
    }
    markCards(project.id, out.tag);
    ctx.notify?.({ kind: 'run', event: 'succeeded', title: `Release ${out.tag} promoted`, body: `The release candidate ${out.rc} is the stable release ${out.tag}: its tag is on origin.`, target: { view: 'releases', projectId: project.id } }, { projectId: project.id });
    return listReleases({ projectId });
  }

  // #489: the base check on a commit: 'green' | 'red' | null (not checked there), from the last
  // check of this session, else the last green one recorded
  function baseCheckOn(projectId, commit) {
    const now = ctx.baseCheckState?.(projectId);
    if (now?.commit && now.commit === commit && ['green', 'red'].includes(now.status)) return now.status;
    return ctx.ws.root && readBaseHealth(ctx.ws.root, projectId).lastGreen?.commit === commit ? 'green' : null;
  }

  // #489: the release train at the night's end for a project: the last candidate is promoted (the
  // promote-release permission), proposed to the owner or held (on Hold, a base check not green).
  // → { action, reason, rc, tag? }
  async function releaseTrain(projectId, { allowed = [] } = {}) {
    const history = releases.readReleases(ctx.ws.releases, projectId);
    const last = releases.candidatesSinceStable(history).at(-1) || null;
    const decision = night.decideReleaseTrain({
      mergesSinceStable: releases.mergesSinceStable(history), baseCheck: last ? baseCheckOn(projectId, last.commit) : null, allowed, held: !!last?.held,
    });
    if (decision.action === 'none') return { ...decision, rc: null };
    if (decision.action === 'promote') {
      try {
        const out = await promoteRelease({ projectId, commit: last.commit });
        return { ...decision, rc: last.tag, tag: out.releases?.[0]?.tag };
      } catch (e) {
        return { action: 'hold', reason: `The promotion of ${last.tag} failed: ${e.message}`, rc: last.tag };
      }
    }
    const title = decision.action === 'propose' ? `Release ${last.tag} ready to promote` : `Release ${last.tag} held`;
    ctx.notify?.({ kind: 'oracle', event: decision.action === 'propose' ? 'escalated' : 'blocked', title, body: decision.reason, target: { view: 'releases', projectId } }, { projectId });
    return { ...decision, rc: last.tag };
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

  // A release run's stations on the Roadmap (#291): the rounds of each group of the release workflow
  // and the one it is at (`station`), from its step trail.
  const STATION_OF = { unit: 'unit', e2e: 'e2e', suite_blocked: 'e2e', fix: 'fix', regression_failed: 'fix', ship: 'ship', ship_failed: 'ship' };
  function releaseStations(run) {
    const stations = { unit: 0, e2e: 0, fix: 0, ship: 0 };
    for (const e of run.progress || []) if (STATION_OF[e.step]) stations[STATION_OF[e.step]] += 1;
    return { stations, station: STATION_OF[(run.progress || []).at(-1)?.step] || null };
  }

  // The releases the Roadmap draws (#291): the shipped ones of the history, each with its release run
  // when the history holds one, and the release runs that did not ship since the last release (the
  // newest per version: checking, waiting at Ship, on hold, failed; a simulated one that shipped),
  // holding the next release's runs. `list`: the project's runs with their live state (the Backlog's).
  // → { releases: [{ version, status, runId, mock, runs, date, tag, commit, issues, cost, tests,
  //   startedAt, durationMs, runCost, stations, station }] }, or { error, releases: [] } when the
  //   history cannot be read. `roadmap` (the roadmap's view, with its estimates): its planned release
  //   entries come last, { version, status: 'planned', runs: [], estimate } (#555)
  function roadmapReleases(project, list, roadmap) {
    const { ws } = ctx;
    if (!project) return { releases: [] };
    const error = releases.historyError(ws.releases, project.id);
    if (error) return { error, releases: [] };
    const releaseRuns = list.filter(isReleaseRun);
    const withRun = (x, run) => (run ? { ...x, runId: run.runId, mock: !!run.mock, startedAt: run.startedAt, durationMs: run.durationMs, runCost: run.costUsd, ...releaseStations(run) } : x);
    const history = releases.readReleases(ws.releases, project.id).releases;
    const shipped = history.map((h) => withRun({ ...h, status: 'shipped' }, releaseRuns.find((r) => (h.runs || []).includes(r.runId))));
    const last = history.map((h) => String(h.date || '')).sort().at(-1) || '';
    const versions = new Set(history.map((h) => h.version));
    const STATUS = { success: 'shipped', cancelled: 'held' };
    let next = null;
    const pending = [];
    for (const run of releaseRuns.filter((r) => String(r.startedAt || '') > last).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))) {
      // started without a version: an explicit label ("Release (no version)"), never the filter's 'next'
      const version = String(run.inputs?.version || '').trim() || '(no version)';
      if (versions.has(version)) continue;
      versions.add(version);
      next ??= nextOf(project, list.filter((r) => !isReleaseRun(r)));
      // waiting: at its Ship gate, in this app or in another one (its trail's last step waits)
      const waiting = run.waiting || run.progress?.at(-1)?.status === 'waiting';
      const status = run.status === 'running' ? (waiting ? 'waiting' : 'checking') : STATUS[run.status] || 'failed';
      pending.push(withRun({ version, status, runs: next.runs.map((r) => r.runId), issues: next.issues, cost: next.cost }, run));
    }
    // #555: the release entries of the roadmap not started yet, each with its run's estimate (its planned card)
    const planned = (roadmap?.stages || []).filter((s) => isRelease(s) && !s.runId && s.status !== 'shipped' && s.name && !versions.has(s.name))
      .map((s) => ({ version: s.name, status: 'planned', runs: [], estimate: s.estimate || null }));
    return { releases: [...shipped, ...pending, ...planned] };
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
    // (#735: an empty default command falls back to that npm script)
    const e2eDefault = wf.inputs?.e2e_command?.default;
    const noE2e = !!wf.inputs?.e2e_suite && (!e2eDefault || e2eDefault === 'npm run test:e2e') && !npmScript(project.folder, 'test:e2e');
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
    const wf = loadWorkflow(ctx.projectWorkflowFile(project.id, RELEASE_WORKFLOW));
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

  // A release entry's run ended without shipping (#555: `line` is the entry): the entry is held (Hold)
  // or failed and a running roadmap pauses there, once (the owner is told).
  function holdLine(projectId, line, outcome, runId) {
    const was = roadmaps.readRoadmap(ctx.ws.backlog, projectId).state;
    const message = `Release ${line.name} was not shipped (${outcome === 'held' ? 'on hold' : `its run ${runId} failed`}): the stages after its cut line wait. Resume the run from its Ship gate, or press Resume here to check the release again.`;
    roadmaps.holdRelease(ctx.ws.backlog, projectId, line.id, outcome, message);
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
    const line = roadmaps.readRoadmap(ws.backlog, projectId).stages.find((s) => isRelease(s) && s.runId === runId);
    const history = releases.readReleases(ws.releases, projectId);
    if (shipped && !summary.mock && !history.releases.some((r) => r.tag === shipped.tag)) {
      const project = projects.readProject(ws.projects, projectId);
      // the release run itself (it merged a fix) is added below, once, with its own cost
      const next = nextOf(project, projectRuns(project).filter((r) => r.runId !== runId));
      const titles = new Map((backlog.readBacklog(ws.backlog, projectId)?.issues || []).map((i) => [i.number, i.title]));
      const issues = new Map(next.issues.map((i) => [i.number, i]));
      for (const n of shipped.issues || []) if (!issues.has(n)) issues.set(n, { number: n, title: titles.get(n) || '' });
      const version = line?.name || String(summary.inputs?.version || '').trim() || shipped.tag;
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
    if (shipped && line && line.status !== 'shipped') {
      roadmaps.setRelease(ws.backlog, projectId, line.id, { status: 'shipped', shippedAt: summary.finished_at || new Date().toISOString() });
    } else if (!shipped && line?.status === 'running') {
      holdLine(projectId, line, outcome, runId);
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
  async function roadmapRelease(projectId, roadmap, { id, name }) {
    const { ws } = ctx;
    // #555: `id` is the release entry's
    const line = roadmaps.findStage(roadmap, id);
    if (!isRelease(line)) return false;
    if (line.runId && (ctx.active.has(line.runId) || ctx.runAlive(line.runId))) return false;
    if (line.runId && line.status === 'running') {
      const outcome = settleRelease(projectId, line.runId);
      if (outcome === 'shipped') return true;
      if (!outcome) holdLine(projectId, line, 'failed', line.runId);
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
    holdCandidate,
    isReleaseRun,
    listReleases,
    markReleasedIssues,
    promoteRelease,
    readReleaseSummary,
    recordPushCandidate,
    releaseTrain,
    roadmapRelease,
    roadmapReleases,
    saveReleaseNotes,
    startRelease,
  };
};
