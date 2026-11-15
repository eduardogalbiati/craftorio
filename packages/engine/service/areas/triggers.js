// Service area: platform triggers (#568, packages/engine/domains/triggers/triggers.js). The rules are the
// `triggers:` of a project's `.multiagent/project.yaml` at the checkout's HEAD (accepted per commit, as
// the repository workflows: areas/repository-workflows.js headManifest), never an uncommitted edit. A
// project polls only when the owner turned it on in Settings (settings.triggers.enabled[<id>]) and the
// interval (settings.triggers.intervalMinutes, default 2, 0 = off) is set: one watcher per project,
// driven by one unref'd timer (TICK_MS) that also picks up a changed setting or a new commit.
// A matching event starts its run like a roadmap item: the budget cap holds a real start (the event waits
// for the next poll), the occupancy slots and the memory guard apply in ctx.startWorkflowRun, the merge
// queue inside the run; the run's human gates ask the owner and nothing here answers a gate or merges.
// The run's meta.json gets `trigger: { kind, id, url }` (run-pr.js writeTrigger) and the issue or PR
// it came from one comment with the run's id (gh issue comment / glab issue|mr note). Under
// MULTIAGENT_SIMULATION_ONLY=1 the platform is never read nor written and a run would be a mock one.
// The state (seen event ids, the last event, the runs started) is <workspace>/backlog/triggers/<id>.json;
// the project page reads it with the rules through triggers:status (channels/triggers.js).

const path = require('path');
const projects = require('../../domains/project/projects');
const workspace = require('../../domains/workspace/workspace');
const backlog = require('../../domains/backlog/backlog');
const issues = require('../../domains/backlog/issues');
const runPr = require('../../domains/run/run-pr');
const simulation = require('../../engine/simulation');
const { loadWorkflow } = require('../../engine/workflow');
const { resolveRunInputs } = require('../../domains/project/project-run-defaults');
const { runDefaultsNow } = require('../seed-runs');
const triggers = require('../../domains/triggers/triggers');
const platformEvents = require('../../domains/triggers/platform-events');

// how often the watchers are looked at (each polls on its own interval)
const TICK_MS = 30 * 1000;

module.exports = (ctx) => {
  const stateDir = () => path.join(ctx.ws.backlog, 'triggers');
  const plain = (projectId) => path.basename(String(projectId));

  // Settings › Execution › Platform triggers: { enabled: { <id>: true }, intervalMs }
  function triggerSettings() {
    const t = workspace.readSettings(ctx.ws).triggers || {};
    const minutes = Number(t.intervalMinutes ?? 2);
    return { enabled: t.enabled && typeof t.enabled === 'object' ? t.enabled : {}, intervalMs: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60000) : 0 };
  }

  // the project's trigger rules at HEAD: { triggers, refused, problems, head }
  function rulesOf(project) {
    const found = ctx.headManifest(project);
    const m = found?.manifest;
    if (!m) return { triggers: [], refused: [], problems: [], head: null };
    // a manifest voided by its errors declares no trigger: its errors are the Workflows screen's
    return { triggers: m.triggers || [], refused: m.refusedTriggers || [], problems: m.triggerErrors || [], head: found.head };
  }

  // the workflow file a rule names: the manifest entry's file when it has one, else <name>.yaml
  function workflowFile(project, name) {
    const entry = ctx.headManifest(project)?.manifest?.workflows?.find((w) => w.name === name);
    const file = entry?.file ? path.posix.basename(entry.file) : name;
    return /\.ya?ml$/i.test(file) ? file : `${file}.yaml`;
  }

  // the rule's inputs over the project's run defaults (as run:start fills them, channels/runs.js)
  function withDefaults(project, file, inputs) {
    let wf = null;
    try { wf = loadWorkflow(ctx.projectWorkflowFile(project.id, file)); } catch { return inputs; }
    if (!project.folder || !wf?.inputs) return inputs;
    const { values, sources } = resolveRunInputs({ typed: inputs, project: runDefaultsNow(ctx, project), workflow: { inputs: wf.inputs } });
    const out = { ...inputs };
    for (const [k, v] of Object.entries(values)) if (sources[k] === 'project') out[k] = v;
    return out;
  }

  // the roadmap's way to start a run: null when it must wait (budget, a busy slot), the event stays unseen
  async function startTriggeredRun(project, { workflow, inputs, trigger, mock }) {
    const sim = !!mock || simulation.simulationOnly();
    if (!sim && ctx.budgetBlock({}, 0)) return null;
    if (ctx.slotProblem({ mock: sim, projectId: project.id })) return null;
    const file = workflowFile(project, workflow);
    const started = await ctx.startWorkflowRun({
      file, inputs: withDefaults(project, file, inputs), mock: sim, projectId: project.id,
      notices: [{ level: 'info', message: `Started by a platform trigger (${trigger.kind}${trigger.url ? `: ${trigger.url}` : ''}).` }],
    });
    if (started?.runDir) runPr.writeTrigger(started.runDir, trigger);
    return started;
  }

  // the platform's events of a project (never read under simulation-only)
  function readerOf(project) {
    const platform = backlog.platformOf(project);
    const repo = issues.parseRepoUrl(project.repo)?.path;
    return async ({ since }) => {
      if (simulation.simulationOnly() || !repo) return [];
      return platform === 'gitlab'
        ? platformEvents.readGitlabEvents({ project: repo, since, exec: issues.execCli })
        : platformEvents.readGithubEvents({ repo, since, exec: issues.execCli });
    };
  }

  // the one report on the issue or PR (never under simulation-only, never for a CI run)
  function commenterOf(project) {
    const platform = backlog.platformOf(project);
    return async ({ event, runId, workflow }) => {
      if (simulation.simulationOnly()) return;
      let repo;
      try { repo = issues.cliTarget(platform, project.repo); } catch { return; }
      const body = `The orchestrator started run \`${runId}\` (workflow \`${workflow}\`) from this ${event.kind === 'pr_comment' ? 'comment' : 'label'}. Its human gates wait for the owner's approval: a trigger never merges.`;
      const c = platformEvents.commentCommand({ platform, repo, event, body });
      if (c) await issues.execCli(c.cli, c.args);
    };
  }

  const watchers = new Map(); // projectId -> { key, watcher, nextAt, busy }
  let timer = null;

  // creates, replaces or drops each project's watcher from the settings and its HEAD manifest
  function syncWatchers() {
    const { enabled, intervalMs } = triggerSettings();
    const wanted = new Set();
    for (const project of projects.listProjects(ctx.ws.projects)) {
      if (project.error || !enabled[project.id] || !intervalMs) continue;
      const { triggers: rules, head } = rulesOf(project);
      if (!rules.length) continue;
      wanted.add(project.id);
      const key = JSON.stringify({ head, intervalMs, repo: project.repo || null });
      if (watchers.get(project.id)?.key === key) continue;
      const watcher = triggers.createTriggerWatcher({
        project: plain(project.id), rules, stateDir: stateDir(), intervalMs, enabled: true,
        readEvents: readerOf(project),
        startRun: (args) => startTriggeredRun(project, args),
        comment: commenterOf(project),
      });
      watchers.set(project.id, { key, watcher, nextAt: watchers.get(project.id)?.nextAt ?? 0, busy: false });
    }
    for (const id of [...watchers.keys()]) if (!wanted.has(id)) watchers.delete(id);
  }

  async function tick() {
    try { syncWatchers(); } catch (e) { console.error('triggers:', e.message); return; }
    for (const w of watchers.values()) {
      if (w.busy || Date.now() < w.nextAt) continue;
      w.busy = true;
      try {
        const res = await w.watcher.pollOnce();
        if (res.error) console.error('triggers poll:', res.error);
      } finally {
        w.nextAt = Date.now() + w.watcher.nextDelayMs();
        w.busy = false;
      }
    }
  }

  // (Re)starts the watchers of the open workspace (setWorkspace calls it)
  function watchTriggers() {
    stopTriggers();
    timer = setInterval(() => { tick().catch((e) => console.error('triggers:', e.message)); }, TICK_MS);
    timer.unref?.();
  }

  function stopTriggers() {
    if (timer) clearInterval(timer);
    timer = null;
    watchers.clear();
  }

  /**
   * A project's triggers for its page: the rules at HEAD, the ignored ones with their problem, the owner's
   * switch, the interval and what the watcher saw and started.
   */
  function triggersStatus({ projectId }) {
    let project = null;
    try { project = projects.readProject(ctx.ws.projects, projectId); } catch { /* an unknown project: nothing */ }
    const { enabled, intervalMs } = triggerSettings();
    const { triggers: rules, refused, problems } = project ? rulesOf(project) : { triggers: [], refused: [], problems: [] };
    const state = triggers.readTriggerState(stateDir(), plain(projectId));
    return { enabled: !!enabled[projectId], intervalMs, rules, refused, problems, lastEvent: state.lastEvent, runs: state.runs.slice().reverse() };
  }

  return {
    stopTriggers,
    triggersStatus,
    watchTriggers,
  };
};
