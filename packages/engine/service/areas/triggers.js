// Service area: platform triggers (#568, packages/engine/domains/triggers/triggers.js). The rules are the
// `triggers:` of a project's `.craftorio/project.yaml` at the checkout's HEAD (accepted per commit, as
// the repository workflows: areas/repository-workflows.js headManifest), never an uncommitted edit. A
// project polls only when the owner turned it on in Settings (settings.triggers.enabled[<id>]) and the
// interval (settings.triggers.intervalMinutes, default 2, 0 = off) is set: one watcher per project,
// driven by one unref'd timer (TICK_MS) that also picks up a changed setting or a new commit.
// A matching event starts its run like a roadmap item: the budget cap holds a real start (the event waits
// for the next poll), the occupancy slots and the memory guard apply in ctx.startWorkflowRun, the merge
// queue inside the run; the run's human gates ask the owner and nothing here answers a gate or merges.
// The run's meta.json gets `trigger: { kind, id, url }` (run-pr.js writeTrigger), an issue event's run
// its issue (`issues:`, the #112 duplicate-work guard), and the issue or PR it came from one comment
// with the run's id and the human gate it reaches (or its end), through the platform adapters
// (backlog.js issueSaveCommand / prCommentCommand). A rule naming a repository workflow the owner has
// not accepted at HEAD is refused with it (#485). Under
// CRAFTORIO_SIMULATION_ONLY=1 the platform is never read nor written and a run would be a mock one.
// The state (seen event ids, the last event, the runs started) is <workspace>/backlog/triggers/<id>.json;
// the project page reads it with the rules through triggers:status (channels/triggers.js).

const fs = require('fs');
const path = require('path');
const projects = require('../../domains/project/projects');
const workspace = require('../../domains/workspace/workspace');
const backlog = require('../../domains/backlog/backlog');
const issues = require('../../domains/backlog/issues');
const runPr = require('../../domains/run/run-pr');
const runs = require('../../domains/run/runs');
const simulation = require('../../engine/simulation');
const { withProjectDefaults } = require('../seed-runs');
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

  // the workflow file a manifest entry names: its file when it has one, else <name>.yaml
  function fileOf(manifest, name) {
    const entry = manifest?.workflows?.find((w) => w.name === name);
    const file = entry?.file ? path.posix.basename(entry.file) : name;
    return { file: /\.ya?ml$/i.test(file) ? file : `${file}.yaml`, repository: !!entry?.file };
  }

  // the project's trigger rules at HEAD: { triggers, refused, problems, head }. A rule naming a repository
  // workflow the owner has not accepted at this commit (#485) is refused with it: the rule is accepted
  // with its workflow, a commit that changes the workflow asks the owner again before a trigger runs it.
  function rulesOf(project) {
    const found = ctx.headManifest(project);
    const m = found?.manifest;
    if (!m) return { triggers: [], refused: [], problems: [], head: null };
    // a manifest voided by its errors declares no trigger: its errors are the Workflows screen's
    const out = { triggers: [], refused: [...(m.refusedTriggers || [])], problems: [...(m.triggerErrors || [])], head: found.head };
    let repoItems = null;
    for (const rule of m.triggers || []) {
      const { file, repository } = fileOf(m, rule.workflow);
      if (repository) {
        repoItems = repoItems || (ctx.repositoryWorkflows(project.id).items || []);
        if (!repoItems.some((w) => w.file === file && w.accepted)) {
          const problem = `workflow "${rule.workflow}" is a repository workflow not accepted at this commit: accept it on the Workflows screen first.`;
          out.problems.push(problem);
          out.refused.push({ on: rule.on, label: rule.label || null, mention: rule.mention || null, branch: rule.branch || null, workflow: rule.workflow, problem });
          continue;
        }
      }
      out.triggers.push(rule);
    }
    return out;
  }

  // the issue a run started from an issue event is recorded on (#112: the duplicate-work guard, the Backlog)
  const issuesOf = (event) => (event?.issue?.number != null
    ? backlog.recordedIssues([{ number: Number(event.issue.number), url: event.url || null, title: null }])
    : null);

  // the roadmap's way to start a run: null when it must wait (budget, a busy slot), the event stays unseen
  async function startTriggeredRun(project, { workflow, inputs, trigger, mock, event }) {
    const sim = !!mock || simulation.simulationOnly();
    if (!sim && ctx.budgetBlock({}, 0)) return null;
    if (ctx.slotProblem({ mock: sim, projectId: project.id })) return null;
    // #90: an outside issue of the synced backlog the owner has not approved holds its event (unseen, read again
    // after the Approve); an approved one's task says it came from outside. The hold is logged: the trigger card's
    // event waits with no run, and the log says why
    let notice = '';
    try {
      notice = issuesOf(event) ? backlog.outsideRunNotice(ctx.ws.backlog, project.id, issuesOf(event)) : '';
    } catch (err) {
      console.error(`[triggers] ${project.id}: ${trigger.kind} event held: ${err.message}`);
      return null;
    }
    const { file } = fileOf(ctx.headManifest(project)?.manifest, workflow);
    const resolved = backlog.withOutsideNotice(withProjectDefaults(ctx, { file, inputs, projectId: project.id }), notice);
    const started = await ctx.startWorkflowRun({
      file, inputs: resolved, mock: sim, projectId: project.id,
      issues: issuesOf(event),
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
      return platformEvents.readEvents({ platform, repo, since, exec: issues.execCli });
    };
  }

  // The one report on the issue or PR (never under simulation-only, never for a CI run): the watcher
  // hands the started run over (commenterOf), the report waits in <stateDir>/<project>.reports.json until
  // the run reaches its first human gate or ends (sendReports, each tick), then comments once.
  const reportsFile = (projectId) => path.join(stateDir(), `${plain(projectId)}.reports.json`);
  const readReports = (projectId) => { try { return JSON.parse(fs.readFileSync(reportsFile(projectId), 'utf8')); } catch { return []; } };
  function writeReports(projectId, list) {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(reportsFile(projectId), JSON.stringify(list, null, 2));
  }

  function commenterOf(project) {
    return async ({ event, runId, workflow }) => {
      const number = event.kind === 'issue_labeled' ? event.issue?.number : event.kind === 'pr_comment' ? event.pr?.number : null;
      if (simulation.simulationOnly() || number == null) return;
      writeReports(project.id, [...readReports(project.id), { runId, workflow, kind: event.kind, number: Number(number) }]);
    };
  }

  // what the run reached: the first gate it asks at ({ gate }), its end ({ ended }), or null (still going)
  function reachedOf(runId) {
    let events = [];
    try { events = runs.runEvents(ctx.runFolder(runId)); } catch { return null; }
    const gate = events.find((e) => e.type === 'approval.requested');
    if (gate) return { gate: gate.step_id || gate.approval_id };
    const end = events.find((e) => e.type === 'workflow.finished');
    return end ? { ended: end.status || 'finished' } : null;
  }

  async function sendReport(project, r, reached) {
    const platform = backlog.platformOf(project);
    const where = reached.gate
      ? `It waits at the human gate \`${reached.gate}\` for the owner's approval: a trigger never answers a gate and never merges.`
      : `It ended (${reached.ended}) without reaching a human gate.`;
    const text = `The orchestrator started run \`${r.runId}\` (workflow \`${r.workflow}\`) from this ${r.kind === 'pr_comment' ? 'comment' : 'label'}. ${where}\n`;
    const file = path.join(ctx.runFolder(r.runId), 'trigger-report.md');
    fs.writeFileSync(file, text);
    const c = r.kind === 'pr_comment'
      ? backlog.prCommentCommand({ platform, repo: project.repo, number: r.number, file, text })
      : backlog.issueSaveCommand({ platform, repo: project.repo, number: r.number, mode: 'comment', file, text });
    await issues.execCli(c.cli, c.args);
  }

  async function sendReports(project) {
    const pending = readReports(project.id);
    if (!pending.length) return;
    const left = [];
    for (const r of pending) {
      const reached = simulation.simulationOnly() ? null : reachedOf(r.runId);
      if (!reached) { if (!simulation.simulationOnly()) left.push(r); continue; }
      // one try: the report is best effort, never repeated
      try { await sendReport(project, r, reached); } catch (e) { console.error(`triggers ${project.id}: the report on #${r.number} failed: ${e.message}`); }
    }
    writeReports(project.id, left);
  }

  const watchers = new Map(); // projectId -> { key, watcher, nextAt, busy }
  let timer = null;

  // creates, replaces or drops each project's watcher from the settings and its HEAD manifest
  function syncWatchers() {
    const { enabled, intervalMs } = triggerSettings();
    const wanted = new Set();
    const all = projects.listProjects(ctx.ws.projects);
    for (const project of all) {
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
    return all;
  }

  async function tick() {
    let all;
    try { all = syncWatchers(); } catch (e) { console.error('triggers:', e.message); return; }
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
    // the reports of runs started earlier, also of a project whose triggers were turned off since
    for (const project of all) if (!project.error) await sendReports(project);
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
    return { enabled: !!enabled[projectId], intervalMs, rules, refused, problems, lastEvent: state.lastEvent, lastError: state.lastError, runs: state.runs.slice().reverse() };
  }

  return {
    stopTriggers,
    triggersStatus,
    watchTriggers,
  };
};
