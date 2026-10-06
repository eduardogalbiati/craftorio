// The Oracle (#122, src/oracle.js): the app-wide master agent's persistent conversation, its memory,
// its state (busy, paused by budget, owning process) and its read-only tools (src/oracle-tools.js,
// served over its own bridge). One Oracle per workspace root. `mock` (the drawer's developer mode)
// and MULTIAGENT_SIMULATION_ONLY answer from the simulated Oracle: no model call, no cost.
// Its spend counts in the monthly budgets with the runs' and the Product Owner's.
// Part 2 (#123):
// - wake-ups: the service's run events (src/oracle-wake.js) wake it in batches; a run of this
//   workspace seen in progress in another app process wakes it too (checked every minute). A
//   simulated batch (every run in it simulated, or simulation only) gets the simulated Oracle.
// - actions: its cards (src/oracle-actions.js) run here with the app's own functions, only from
//   oracle:act (the owner's "Do it") or under the Night watch. Under MULTIAGENT_SIMULATION_ONLY the
//   actions that reach outside the workspace (issues, git commits, stopping processes) only preview.
//   Every backup is a copy in <oracle dir>/backups/ (Undo puts it back).
// - delegation: the Product Owner (a plan, an issue draft), the supervisor (a run diagnosis) and a
//   read-only analyzer (a run's tool calls and costs, no model); only the answer and its cost come
//   back, recorded in the chat. #184: the checker runs a test command on a scratch checkout of a
//   branch (src/oracle-check.js, no model); a long one is a check.run card.
// - oracle:changed is pushed when a message is added (a wake-up, a card, a result).
// - inboxes (#240): ctx.performAction runs an action's code for the owners' inboxes (po:request,
//   supervisor:request); a request the Oracle sent gets a short line in its chat (requested()).
// - routing (#241): the Oracle changes nothing itself. Its request_agent tool (oracle:requestAgent)
//   sends a change to the owner's inbox (ctx.productOwnerRequest, ctx.supervisorRequest); a card it
//   proposes of a kind an owner holds (oracle-actions.js ownerOf) is routed there too. ctx.inboxRules
//   tells an inbox which requests wait for the owner's click (a paid run, the Night watch's
//   permissions, content the Oracle read) and logs the night's in the night log; ctx.checkAction and
//   ctx.restoreAction check a card before it waits and put back an action's backup (the owner's Undo).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const actions = require('../../oracle-actions');
const agentInbox = require('../../agent-inbox');
const agents = require('../../agents');
const backlog = require('../../backlog');
const night = require('../../night-watch');
const notifier = require('../../notifications');
const oracle = require('../../oracle');
const oracleCheck = require('../../oracle-check');
const productOwner = require('../../product-owner');
const projects = require('../../projects');
const roadmaps = require('../../roadmap');
const runs = require('../../runs');
const simulation = require('../../engine/simulation');
const supervisor = require('../../supervisor');
const usage = require('../../usage');
const workspace = require('../../workspace');
const { createBridge, mcpCommand } = require('../../supervisor-bridge');
const { createWake } = require('../../oracle-wake');
const { oracleTools } = require('../../oracle-tools');
const { resolveCommand } = require('../../engine/providers');
const { stopProcessesIn } = require('../../engine/processes');

const ELSEWHERE_MS = 60e3;
const DELEGATE_TEXT = 8000;
const COMMIT_BRANCHES = ['main', 'master'];

const git = (folder, args) => new Promise((resolve, reject) => {
  execFile('git', ['-C', folder, ...args], { timeout: 30e3, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(String(stdout).trim())));
});
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
// who turned the Night watch on (#172): the account, and the screen it was turned on from
const nightBy = (from) => `${process.env.USERNAME || process.env.USER || 'the owner'} (${String(from || 'the Oracle drawer').slice(0, 60)})`;
const inside = (root, p) => { const r = path.relative(path.resolve(root), path.resolve(p)); return !r.startsWith('..') && !path.isAbsolute(r); };

module.exports = (ctx) => {
  const hooks = {};
  const tools = oracleTools(ctx, hooks);
  const bridge = createBridge({ tools: () => tools });
  const oracles = new Map(); // workspace root → its Oracle (the workspace can change)
  const dir = () => ctx.ws.oracle || path.join(ctx.ws.root, 'oracle');
  const simulated = (opts) => !!opts?.mock || simulation.simulationOnly();
  const pid = (projectId) => path.basename(String(projectId || ''));
  const runMock = (runId) => {
    const live = ctx.liveRun(runId);
    if (live) return !!live.mock;
    try { return !!supervisor.readEvents(ctx.runFolder(runId)).find((e) => e.type === 'workflow.started')?.mock; } catch { return false; }
  };

  // ---- performing the actions (#123) ---------------------------------------------------------
  const backupDir = () => path.join(dir(), 'backups');
  const backupPath = (id, name) => { fs.mkdirSync(backupDir(), { recursive: true }); return path.join(backupDir(), `${id}-${name}`); };
  const synced = (projectId) => backlog.readBacklog(ctx.ws.backlog, pid(projectId))?.issues || [];
  const issueTarget = (projectId) => {
    const id = pid(projectId);
    const data = backlog.readBacklog(ctx.ws.backlog, id);
    if (!data) throw new Error('Sync the backlog first: the issue is written to the synced repository.');
    const p = projects.readProject(ctx.ws.projects, id);
    const platform = data.platform || workspace.readSettings(ctx.ws).backlogPlatform || backlog.DEFAULT_PLATFORM;
    return { id, data, platform, repo: data.repo || p?.repo };
  };
  const snapshotRoadmap = (a, projectId) => {
    const file = backupPath(a.id, 'roadmap.json');
    fs.writeFileSync(file, JSON.stringify(roadmaps.readRoadmap(ctx.ws.backlog, pid(projectId)), null, 2));
    return { text: 'A copy of the roadmap was taken first.', undo: { type: 'roadmap', projectId: pid(projectId), file } };
  };
  const preview = (what) => ({ ok: true, preview: true, text: `Simulation only: nothing was changed. The app would ${what}.` });

  // #184: a check on a scratch checkout of a project's branch (src/oracle-check.js), in the Oracle's folder
  const check = ({ projectId, branch, command }, timeoutMs) => {
    const p = projects.readProject(ctx.ws.projects, pid(projectId));
    if (!p?.folder) throw new Error(`Unknown project: ${projectId}`);
    return oracleCheck.runCheck({ folder: p.folder, branch, command, checksDir: path.join(dir(), 'checks'), timeoutMs });
  };

  // the step a retry resumes from (throws when the run cannot be retried)
  const retryStep = ({ runId }) => {
    const o = ctx.resumeOptions({ runId });
    if (o.active) throw new Error('The run is still in progress.');
    if (!o.suggested) throw new Error('No step can be resumed without crossing a decided human gate.');
    return o.suggested;
  };

  const PERFORM = {
    'check.run': async (a) => {
      // the action is done when the check ran, whatever its result (the text says pass or fail)
      return { text: (await check(a.params, oracleCheck.LONG_MS)).text };
    },
    'dispatch.restart': async () => {
      await ctx.dispatchRoadmaps();
      await ctx.dispatchQueue();
      return { text: 'The roadmaps and queues were dispatched: the next planned items start when they can.' };
    },
    'issue.file': async (a, { sim }) => {
      const p = a.params;
      const t = issueTarget(p.projectId);
      const file = backupPath(a.id, 'issue.md');
      fs.writeFileSync(file, String(p.body));
      const cmd = backlog.issueCreateCommand({ platform: t.platform, repo: t.repo, title: p.title, labels: Array.isArray(p.labels) ? p.labels.map(String) : [], file, text: String(p.body) });
      if (sim) return preview(`run ${cmd.display}`);
      const out = await backlog.execCli(cmd.cli, cmd.args);
      return { text: `Filed: ${String(out).trim() || p.title}` };
    },
    'issue.update': async (a, { sim }) => {
      const p = a.params;
      const t = issueTarget(p.projectId);
      const mode = p.mode === 'comment' ? 'comment' : 'replace';
      const file = backupPath(a.id, 'issue.md');
      fs.writeFileSync(file, String(p.body));
      const cmd = backlog.issueSaveCommand({ platform: t.platform, repo: t.repo, number: p.number, mode, file, text: String(p.body) });
      if (sim) return preview(`run ${cmd.display}`);
      let backup = null;
      if (mode === 'replace') {
        const before = (await backlog.fetchIssue({ platform: t.platform, repo: t.repo, number: Number(p.number) })).body || '';
        const copy = backupPath(a.id, 'issue-before.md');
        fs.writeFileSync(copy, before);
        backup = { text: 'The previous description was saved first.', undo: { type: 'issue', projectId: t.id, number: Number(p.number), file: copy } };
      }
      await backlog.execCli(cmd.cli, cmd.args);
      return { text: mode === 'comment' ? `Commented on #${p.number}.` : `Updated the text of #${p.number}.`, backup };
    },
    'process.stop': async (a, { sim }) => {
      const folder = path.resolve(String(a.params.folder));
      const allowed = [ctx.ws.root, ...projects.listProjects(ctx.ws.projects).map((x) => x.folder)].filter(Boolean);
      if (!allowed.some((root) => inside(root, folder))) throw new Error(`${folder} is neither in the workspace nor in a project's folder.`);
      if (sim) return preview(`stop the processes started in ${folder}`);
      const found = await stopProcessesIn(folder);
      return { text: found.length ? `Stopped ${found.filter((x) => x.stopped).length} of ${found.length} process(es): ${found.map((x) => `${x.pid} ${path.basename(x.exe || '')}`).join(', ')}.` : 'No process held the folder.' };
    },
    'roadmap.item': async (a) => {
      const p = a.params;
      const id = pid(p.projectId);
      const item = roadmaps.findItem(roadmaps.readRoadmap(ctx.ws.backlog, id), String(p.itemId));
      if (!item) throw new Error('This roadmap item no longer exists.');
      if (p.action === 'retry' && !(item.runId && ctx.runAlive(item.runId))) {
        const issues = backlog.itemIssues(item);
        const kept = (item.runId && ctx.keptWorkOfRun(item.runId, issues)) || ctx.keptWorkForIssues(issues);
        // fresh (#172): from scratch over the kept work, as the Backlog's confirmed retry does
        if (kept && p.fresh) ctx.allowKeptWork(id, item.id);
        else if (kept) throw new Error(`${kept.text} Resume that run instead (run.resume), or retry with fresh: true to start from scratch.`);
      }
      const backup = snapshotRoadmap(a, id);
      roadmaps.itemAction(ctx.ws.backlog, id, String(p.itemId), p.action, { alive: ctx.runAlive });
      await ctx.dispatchRoadmaps();
      return { text: `Roadmap item ${p.itemId}: ${p.action === 'skip' ? 'skipped' : 'planned again'}.`, backup };
    },
    'roadmap.stages': async (a) => {
      const id = pid(a.params.projectId);
      // append (#164, #172): every item already planned keeps its stage and its order; only new items come in
      if (a.params.append) {
        const before = roadmaps.readRoadmap(ctx.ws.backlog, id).stages || [];
        const ids = (stages) => stages.map((s) => (s.items || []).map((x) => x.id));
        const kept = ids(a.params.stages).map((list, i) => list.filter((x) => (ids(before)[i] || []).includes(x)));
        if (ids(before).some((list, i) => JSON.stringify(list) !== JSON.stringify(kept[i] || []))) throw new Error('An append may only add items: a planned item moved or disappeared. Nothing was saved.');
      }
      const backup = snapshotRoadmap(a, id);
      // #284: `disabled` is the owner's switch: whatever the Oracle sends, the stored value is kept
      const stages = (a.params.stages || []).map((s) => { const { disabled, ...rest } = s || {}; return rest; });
      roadmaps.saveStages(ctx.ws.backlog, id, stages, { issues: synced(id), alive: ctx.runAlive });
      await ctx.dispatchRoadmaps();
      return { text: `The roadmap of ${id} was saved (validated, ${a.params.stages.length} stage(s)).`, backup };
    },
    'run.resume': async (a, { mock }) => {
      const out = await ctx.resumeRun({ runId: a.params.runId, step: a.params.step, instruction: a.params.instruction || null, mock });
      return { text: `Resumed from ${a.params.step}: run ${out.runId}.` };
    },
    'run.retry': async (a, { mock }) => {
      const step = retryStep(a.params);
      const out = await ctx.resumeRun({ runId: a.params.runId, step, mock });
      return { text: `Retried from ${step}: run ${out.runId}.` };
    },
    'run.stop': async (a) => {
      const run = ctx.liveRun(a.params.runId);
      if (!run && ctx.runAlive(a.params.runId)) throw new Error(`Run ${a.params.runId} runs in another app window: stop it there.`);
      if (!run) throw new Error(`Run ${a.params.runId} is not in progress.`);
      run.stop();
      return { text: `Run ${a.params.runId} was stopped.` };
    },
    'skill.restore': async (a) => {
      const id = path.basename(String(a.params.id));
      const copy = backupPath(a.id, `skill-${id}`);
      fs.cpSync(path.join(ctx.ws.skills, id), copy, { recursive: true });
      await ctx.restoreSkill(id);
      return { text: `Skill ${id} is the bundled default again (the edited copy is in the trash).`, backup: { text: 'A copy of the edited skill was kept.', undo: { type: 'dir', target: path.join(ctx.ws.skills, id), file: copy } } };
    },
    'workflow.commit': async (a, { sim }) => {
      const p = a.params;
      const project = projects.readProject(ctx.ws.projects, pid(p.projectId));
      if (!project?.folder || !fs.existsSync(project.folder)) throw new Error(`Unknown project, or its folder is missing: ${p.projectId}`);
      const branch = await git(project.folder, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (!COMMIT_BRANCHES.includes(branch)) throw new Error(`The repository is on ${branch}, not on its main branch: nothing was committed.`);
      const rels = p.files.map((f) => String(f.path).replace(/\\/g, '/'));
      const dirty = await git(project.folder, ['status', '--porcelain', '--', ...rels]);
      if (dirty) throw new Error(`These files have uncommitted changes: ${dirty.split('\n').join('; ')}. Nothing was committed.`);
      if (sim) return preview(`write ${rels.join(', ')} and commit them on the local ${branch}`);
      for (const f of p.files) {
        const target = path.resolve(project.folder, String(f.path));
        if (!inside(project.folder, target)) throw new Error(`${f.path} is outside the repository.`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, f.content);
      }
      await git(project.folder, ['add', '--', ...rels]);
      await git(project.folder, ['commit', '-m', String(p.message), '--', ...rels]);
      const sha = await git(project.folder, ['rev-parse', '--short', 'HEAD']);
      return { text: `Committed ${sha} on the local ${branch} (not pushed). git revert ${sha} undoes it.` };
    },
    'workflow.restore': async (a) => {
      const file = path.basename(String(a.params.file));
      const copy = backupPath(a.id, `workflow-${file}`);
      fs.copyFileSync(path.join(ctx.ws.workflows, file), copy);
      await ctx.restoreWorkflow(file);
      return { text: `Workflow ${file} is the bundled default again (the edited copy is in the trash).`, backup: { text: 'A copy of the edited workflow was kept.', undo: { type: 'file', target: path.join(ctx.ws.workflows, file), file: copy } } };
    },
  };

  async function perform(a, { mock } = {}) {
    const fn = PERFORM[a.kind];
    if (!fn) throw new Error(`Unknown action: ${a.kind}`);
    const out = await fn(a, { mock: !!mock, sim: simulation.simulationOnly() });
    return { ok: true, ...out };
  }
  // #240: the owners' inboxes (po:request, supervisor:request) run their mechanical kinds with these
  // same functions, checked like a card; the backups go to the Oracle's folder, as a card's do
  ctx.performAction = (kind, params, { mock } = {}) => {
    actions.ACTIONS[kind]?.check?.(params);
    return perform({ id: `request-${Date.now().toString(36)}`, kind, params }, { mock });
  };
  // #241: what can be known before a request waits for the owner's click (it is refused at once otherwise)
  const PRECHECK = {
    'run.resume': ({ runId, step }) => {
      const o = ctx.resumeOptions({ runId });
      if (o.active) throw new Error('The run is still in progress.');
      if (!(o.steps || []).some((x) => x.id === step)) throw new Error(`Run ${runId} has no step ${step}.`);
    },
    'run.retry': (p) => { retryStep(p); },
  };
  ctx.checkAction = (kind, params) => {
    actions.ACTIONS[kind]?.check?.(params);
    PRECHECK[kind]?.(params);
  };
  ctx.restoreAction = (undo) => restore(null, undo);
  // How an owner's inbox takes a request now (agent-inbox.js handle's wait / check / after): a kind in
  // clickKinds, a request content asked for (byContent), a kind of confirmKinds the Oracle's model asked
  // for by day (byModel), a kind the Night watch does not allow, or one more watch action on an item that
  // already had LOOP_CAP tonight waits for the owner's click; under the watch, what the owner ran and
  // what waits are in the night log.
  // `owner`: 'product-owner' | 'supervisor'; `project`: the PO's project, added to the params it checks.
  ctx.inboxRules = (owner, { clickKinds = [], confirmKinds = [], project = null, byContent = false, byModel = false } = {}) => {
    // the watch in force: the Night watch, or by day Self-healing's standing watch (#278)
    const watch = actions.watchState(dir(), workspace.readSettings(ctx.ws));
    const allowed = night.readPermissions(dir()).allowed;
    const withProject = (params) => (project ? { ...params, projectId: project } : params);
    // the watch actions the owners already ran alone on this item tonight (as nightDecision counts them)
    const actionsOn = (params) => {
      const { target } = night.targetOf(withProject(params));
      const since = actions.watchSince(watch);
      return night.readNightLog(dir()).filter((e) => e.type === 'oracle.action' && e.auto && e.target === target && (!since || e.ts >= since)).length;
    };
    // by day under Self-healing the owner's own requests (not the Oracle's model) keep the daytime rules
    const ruling = watch.selfHealing && !byModel ? { ...watch, active: false } : watch;
    const why = (kind, params) => {
      if (byContent) return { reason: 'content', text: 'Content the Oracle read asked for it: it waits for the owner\'s click.' };
      const text = agentInbox.waitReason(kind, params, { clickKinds, confirmKinds: byModel ? confirmKinds : [], watch: ruling, allowed });
      if (text) return { reason: 'permission', text };
      if (ruling.active && actionsOn(params) >= night.LOOP_CAP) return { reason: 'loop', text: `The item already had ${night.LOOP_CAP} watch actions ${watch.selfHealing ? 'today' : 'tonight'}: it waits for the owner's click.` };
      return null;
    };
    return {
      wait: (kind, params) => why(kind, params)?.text || null,
      check: (kind, params) => ctx.checkAction(kind, withProject(params)),
      after: (r) => {
        if (!watch.active) return;
        const where = night.targetOf(withProject(r.params));
        const permission = night.permissionOf(r.kind, r.params);
        if (r.pending) night.logNight(dir(), 'oracle.blocked', { actionId: r.ref, kind: r.kind, ...where, reason: why(r.kind, r.params)?.reason || 'permission', owner, requestedBy: r.from });
        else night.logNight(dir(), 'oracle.action', { actionId: r.ref, kind: r.kind, title: r.text, ...where, permission, auto: !!r.auto, ok: r.ok, result: r.text, owner, requestedBy: r.from });
      },
    };
  };

  // Undo: puts back the backup an action took.
  async function restore(a, undo) {
    if (!undo?.file || !fs.existsSync(undo.file)) throw new Error('The backup is no longer there.');
    switch (undo.type) {
      case 'roadmap':
        roadmaps.writeRoadmap(ctx.ws.backlog, undo.projectId, JSON.parse(fs.readFileSync(undo.file, 'utf8')));
        await ctx.dispatchRoadmaps();
        return { text: `The roadmap of ${undo.projectId} is back to its copy from before the action.` };
      case 'file':
        fs.copyFileSync(undo.file, undo.target);
        return { text: `${path.basename(undo.target)} is back to the edited copy.` };
      case 'dir':
        fs.rmSync(undo.target, { recursive: true, force: true });
        fs.cpSync(undo.file, undo.target, { recursive: true });
        return { text: `${path.basename(undo.target)} is back to the edited copy.` };
      case 'issue': {
        const t = issueTarget(undo.projectId);
        const cmd = backlog.issueSaveCommand({ platform: t.platform, repo: t.repo, number: undo.number, mode: 'replace', file: undo.file, text: fs.readFileSync(undo.file, 'utf8') });
        if (simulation.simulationOnly()) return { text: `Simulation only: the app would run ${cmd.display}.` };
        await backlog.execCli(cmd.cli, cmd.args);
        return { text: `The description of #${undo.number} is back.` };
      }
      default:
        throw new Error('This backup cannot be put back.');
    }
  }

  // ---- delegation (#123) -----------------------------------------------------------------------
  async function askProductOwner({ projectId, question, mode, sim }) {
    const id = pid(projectId);
    const p = projects.readProject(ctx.ws.projects, id);
    if (!p) throw new Error(`Unknown project: ${projectId}`);
    const data = ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, id));
    if (!data) throw new Error('Sync the backlog first: the Product Owner reads the synced issues.');
    const settings = workspace.readSettings(ctx.ws);
    const out = await productOwner.ask({
      backlogDir: ctx.ws.backlog, projectId: id, runsDir: ctx.ws.runs, question, data,
      activeRuns: ctx.activeRuns().filter((r) => r.projectId === id),
      runs: runs.runsForProject(runs.listRuns(ctx.ws.runs), p),
      workflows: ctx.listWorkflows().filter((w) => !w.error && w.inputs?.task),
      defaultWorkflow: settings.defaultWorkflow, // #195
      folder: p.folder, agent: agents.readAgent(ctx.ws.agents, agents.PRODUCT_OWNER_ID),
      skillsDirs: [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand,
      budget: sim ? null : usage.withPeerUsage(usage.budgetBaseline({ runsDir: ctx.ws.runs, settings, extraRuns: ctx.agentUsageRuns() }), productOwner.monthUsage(ctx.ws.backlog), settings.prices),
      mock: sim, mode,
    });
    const m = out.message || {};
    const draft = m.issue?.draft;
    const text = [m.text, draft ? `Draft: ${draft.title}\n\n${draft.body || ''}` : ''].filter(Boolean).join('\n\n');
    return { text, costUsd: m.costUsd || 0, model: m.model || null, error: !!m.error, ref: `the Product Owner's conversation of ${id}` };
  }

  // A run's tool calls and costs, read from its files (no model): per step and agent, per tool.
  function analyzeRunUse(runId) {
    const runDir = ctx.runFolder(runId);
    const calls = new Map();
    const perStep = new Map();
    const where = new Map(); // session id → { agent, step } (session.opened), the step updated per turn
    let failed = 0;
    for (const e of runs.runEvents(runDir, { activity: true })) {
      if (e.type === 'session.opened') where.set(e.session_id, { agent: e.session?.agent, step: e.session?.step_id });
      if (e.type === 'session.message_sent' && where.has(e.session_id)) where.get(e.session_id).step = e.step_id || where.get(e.session_id).step;
      if (e.type !== 'session.stream') continue;
      if (e.item?.kind === 'tool_result') { failed++; continue; }
      if (e.item?.kind !== 'tool_call') continue;
      calls.set(e.item.name, (calls.get(e.item.name) || 0) + 1);
      const s = where.get(e.session_id) || {};
      const key = `${s.step || '?'} (${s.agent || '?'})`;
      perStep.set(key, (perStep.get(key) || 0) + 1);
    }
    let sessions = [];
    try { sessions = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8')).sessions || []; } catch { /* still running */ }
    const total = sessions.reduce((s, x) => s + (Number(x.cost_usd) || 0), 0);
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `- ${k}: ${n}`).join('\n') || '- none';
    return {
      text: [
        `Run ${path.basename(runDir)}: ${[...calls.values()].reduce((s, n) => s + n, 0)} tool calls, ${failed} failed tool results, cost $${total.toFixed(2)}${sessions.length ? '' : ' (no summary yet: the run is in progress)'}.`,
        `Tool calls per tool:\n${top(calls)}`,
        `Tool calls per step (agent):\n${top(perStep)}`,
        `Cost per session:\n${sessions.map((x) => `- ${x.agent || x.name || x.id || '?'} (${x.model || x.provider || '?'}): $${(Number(x.cost_usd) || 0).toFixed(2)}, ${x.turns ?? '?'} turns`).join('\n') || '- none'}`,
      ].join('\n\n'),
      costUsd: 0, model: null, error: false, ref: `run ${path.basename(runDir)}`,
    };
  }

  async function delegate({ to, question, projectId, runId, branch, command } = {}, { mock } = {}) {
    const sim = simulated({ mock });
    const q = String(question || '').trim();
    if (!q) throw new Error('Say what to ask.');
    let out;
    try {
      if (to === 'product-owner' || to === 'issue-draft') out = await askProductOwner({ projectId, question: q, mode: to === 'issue-draft' ? 'issue' : 'plan', sim });
      else if (to === 'supervisor') {
        if (!runId) throw new Error('Say which run (runId) the supervisor should look at.');
        if (sim && !runMock(runId)) throw new Error('Simulation only: the supervisor would analyze a real run with a model.');
        const res = await supervisor.analyzeRun({ runDir: ctx.runFolder(runId), question: q, workflowsDir: ctx.workflowDirs(), skillsDirs: [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand });
        const a = res.analysis || {};
        out = {
          text: [a.summary, a.root_cause && `Root cause: ${a.root_cause}`, ...(a.recommendations || []).map((r) => `- ${r.title}${r.action && r.action !== 'none' ? ` (${r.action}${r.step ? ` from ${r.step}` : ''})` : ''}`)].filter(Boolean).join('\n\n'),
          costUsd: res.costUsd || 0, model: res.model || null, error: false, ref: path.relative(ctx.ws.root, res.artifactPath),
        };
      } else if (to === 'analyzer') {
        if (!runId) throw new Error('Say which run (runId) to analyze.');
        out = analyzeRunUse(runId);
      } else if (to === 'checker') {
        // #184: no model; a test command runs with MULTIAGENT_SIMULATION_ONLY=1, stopped after ~2 min
        const res = await check({ projectId, branch, command }, oracleCheck.QUICK_MS);
        out = { text: res.text, costUsd: 0, model: null, error: false, ref: `a check of ${branch}` };
      } else throw new Error(`Unknown agent: ${to}`);
    } catch (e) {
      out = { text: e.message || String(e), costUsd: 0, model: null, error: true, ref: null };
    }
    const text = cut(String(out.text || '(no answer)'), DELEGATE_TEXT);
    get().delegated({ to, question: q, text, costUsd: out.costUsd, model: out.model, error: out.error, ref: out.ref });
    return { to, text, costUsd: out.costUsd || 0, error: out.error, ref: out.ref };
  }

  // ---- routing to the owners (#241) -------------------------------------------------------------
  // request_agent: { to: 'po' | 'supervisor', kind, params, reason, projectId?, requestedBy?, mock } →
  // the owner's answer { ok, text, costUsd, error?, pending? }; the owner records it in its conversation
  // and the Oracle's chat gets a short line. An unknown `to` is refused here and recorded nowhere.
  async function requestAgent({ to, kind, params, reason, projectId, requestedBy, mock } = {}) {
    const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
    const send = to === 'po' ? ctx.productOwnerRequest : to === 'supervisor' ? ctx.supervisorRequest : null;
    if (!send) {
      const error = `Unknown agent: ${to || '(none)'}. request_agent goes to po (the Product Owner: issues, roadmap, queue) or supervisor (the Supervisor: runs, workflows, skills).`;
      return { ok: false, text: error, costUsd: 0, error };
    }
    const ref = `oracle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return send({
      ...(to === 'po' ? { projectId: projectId || p.projectId } : {}),
      kind, params: p, reason, from: 'oracle', ref, byContent: requestedBy === 'content', byModel: true, mock: simulated({ mock }),
    });
  }

  // A card of a kind an owner holds goes to that owner's inbox instead (the Oracle has no write path).
  // `fromOracle`: false only for the owner's own card (oracle:propose with requestedBy 'owner').
  async function proposeOrRoute(input = {}, { fromOracle = true } = {}) {
    const route = actions.ownerOf(input.kind, input.params);
    if (!route || !fromOracle) return get().propose(input, { mock: simulation.simulationOnly() });
    if (!route.kind) throw new Error(`${input.kind} (${input.params?.action || '?'}) is the owner's click on the Roadmap: no agent takes it. Tell the owner, or use request_agent (po: roadmap.skip, roadmap.regroup; supervisor: run.retry, run.resume).`);
    const out = await requestAgent({ to: route.to, kind: route.kind, params: route.params, reason: input.why, requestedBy: input.requestedBy });
    return { routed: true, to: route.to, kind: route.kind, ...out };
  }

  // ---- the Oracle of the workspace -------------------------------------------------------------
  const get = () => {
    const root = ctx.ws.root;
    if (!oracles.has(root)) {
      oracles.set(root, oracle.createOracle({
        dir, tools: () => tools, bridge, mcpCommand: () => mcpCommand(!!ctx.host?.isPackaged, resolveCommand),
        skillsDirs: () => [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR], resolveCommand, refuseReal: simulation.refuseReal,
        agent: () => agents.readAgent(ctx.ws.agents, agents.ORACLE_ID),
        settings: () => workspace.readSettings(ctx.ws),
        // the runs' spend, the Oracle's own days, the Supervisor chat's (#280) and the Product Owner's calls this month
        budget: () => {
          const settings = workspace.readSettings(ctx.ws);
          const base = usage.budgetBaseline({ runsDir: ctx.ws.runs, settings, extraRuns: ctx.agentUsageRuns() });
          return usage.withPeerUsage(base, productOwner.monthUsage(ctx.ws.backlog), settings.prices);
        },
        perform, restore,
        notify: (n) => ctx.notify?.(notifier.oracleNotice(n)),
        onChange: (m) => ctx.events.emit('oracle:changed', { id: m.id, role: m.role, kind: m.kind || null }),
        // the morning summary (#172): src/service/channels/nightwatch.js
        onNightEnd: (w) => ctx.events.emit('nightwatch:ended', w),
      }));
    }
    return oracles.get(root);
  };
  // the Night watch screen's channel (#172) reads the Oracle's state and switches the watch through it
  ctx.oracleService = get;

  // ---- wake-ups (#123) ---------------------------------------------------------------------------
  const wake = createWake({
    events: ctx.events,
    settings: () => workspace.readSettings(ctx.ws),
    file: () => path.join(dir(), 'wake.json'),
    projectOf: (runId) => ctx.liveRun(runId)?.projectId || null,
    projectRunning: (projectId) => roadmaps.readRoadmap(ctx.ws.backlog, projectId).state === 'running',
    onWake: ({ lines, runIds, notices }) => (ctx.ws ? get().wake({ lines, runIds, notices, mock: simulation.simulationOnly() || runIds.every(runMock) }) : { skipped: 'no-workspace' }),
    onChange: () => ctx.events.emit('oracle:changed', { kind: 'wake' }),
    nightWatch: () => !!ctx.ws && actions.watchState(dir(), workspace.readSettings(ctx.ws)).active,
  });
  // #278: Self-healing's findings (src/service/channels/nightwatch.js) wake the Oracle with their
  // evidence, as lines: one short turn, simulated when every run is → oracle.wake's result
  ctx.oracleFindings = ({ lines, runIds = [] }) => get().wake({ findings: lines, runIds, mock: simulation.simulationOnly() || (runIds.length > 0 && runIds.every(runMock)) });
  // ... in the wake-ups' own scope (settings.oracle.wakeScope): every run but the muted ones, or the
  // runs and roadmaps the Oracle watches; never when wake-ups are off
  ctx.oracleFindingsScope = (runId) => {
    const s = wake.state();
    if (s.wakeScope === 'off') return false;
    const project = ctx.liveRun(runId)?.projectId || null;
    const watched = (s.watching || []).some((w) => w.runId === runId || (!!w.projectId && w.projectId === project));
    return watched || (s.wakeScope === 'all' && !(s.muted || []).includes(runId));
  };
  // runs of this workspace in progress in another app process (#112): each wakes the Oracle once
  const seenElsewhere = new Set();
  const elsewhere = setInterval(() => {
    try {
      if (!ctx.ws || wake.state().wakeScope === 'off') return;
      for (const r of runs.listRuns(ctx.ws.runs)) {
        if (r.status !== 'running' || seenElsewhere.has(r.runId) || ctx.runIsLive(r.runId) || !ctx.runAlive(r.runId)) continue;
        seenElsewhere.add(r.runId);
        wake.take({ type: 'run.elsewhere', run_id: r.runId, ts: new Date().toISOString() });
      }
    } catch { /* checked again next minute */ }
  }, ELSEWHERE_MS);
  elsewhere.unref?.();

  hooks.propose = (input) => proposeOrRoute(input);
  hooks.delegate = (input) => delegate(input);
  hooks.requestAgent = (input) => requestAgent(input);
  hooks.watch = (input) => wake.watch(input || {});

  const withState = (out) => ({ ...out, messages: get().history(), state: get().state() });
  // Every oracle channel with input takes one object (`params: 'opts'`), the way the renderer calls
  // them (`api.oracleAct({ actionId, mock })`): positional params would wrap that object again (#187).
  return [
    // { question, screen, images, mock, mockContextTokens } → { message, messages, state } or { refused, ... };
    // images: pasted screenshots ({ dataUrl }, oracle.ATTACHMENT_LIMITS); mockContextTokens (simulated
    // only) makes the answer report that context size (compaction checks)
    {
      channel: 'oracle:ask',
      method: 'askOracle',
      params: 'opts',
      fn: async (opts = {}) => {
        const mock = simulated(opts);
        // #180: its progress is pushed on chat:progress; chat:cancel ('oracle') stops it
        const turn = ctx.chatTurns.start('oracle');
        let out;
        try {
          out = await get().ask({ question: opts.question, screen: opts.screen, images: opts.images, context: opts.context || null, mock, mockContextTokens: mock ? opts.mockContextTokens : undefined, onItem: turn.onItem, signal: turn.signal });
        } finally {
          turn.end(turn.stopped() ? 'stopped' : out?.message?.error || !out ? 'failed' : 'done');
        }
        return out;
      },
    },
    // the owner's "Do it" on an action card (#123): performs exactly that card, once → { ok, text, messages, state }
    { channel: 'oracle:act', method: 'oracleAct', params: 'opts', fn: ({ actionId, mock } = {}) => get().act(actionId, { mock: simulated({ mock }) }) },
    // a pasted image of the conversation (its file name in a user message's attachments) → data: URL or null
    { channel: 'oracle:attachment', method: 'oracleAttachment', params: 'name', fn: (name) => get().attachment(name) },
    // asks another agent (product-owner, issue-draft, supervisor, analyzer, checker) → { to, text, costUsd, error, ref }; recorded in the chat
    {
      channel: 'oracle:delegate',
      method: 'oracleDelegate',
      params: 'opts',
      fn: ({ mock, ...input } = {}) => delegate(input, { mock }),
    },
    { channel: 'oracle:dismiss', method: 'oracleDismiss', params: 'opts', fn: ({ actionId } = {}) => get().dismiss(actionId) },
    { channel: 'oracle:history', method: 'oracleHistory', fn: () => get().history() },
    // #184: { text (pasted, e.g. a Claude Code memory index), base (the draft; default the saved memory) } →
    // { text }: the draft with the pasted decisions added; nothing is saved (the owner saves it)
    { channel: 'oracle:importMemory', method: 'importOracleMemory', params: 'opts', fn: (opts) => get().importMemory(opts || {}) },
    // the owner read the conversation up to { at } (default now) → { readAt }: the unread badge counts after it
    { channel: 'oracle:markRead', method: 'markOracleRead', params: 'opts', fn: (opts) => get().markRead(opts?.at) },
    { channel: 'oracle:memory', method: 'oracleMemory', fn: () => get().memory() },
    // mutes (on) or unmutes one run's wake-ups → the wake-up state
    { channel: 'oracle:mute', method: 'muteOracleRun', params: 'opts', fn: ({ runId, on } = {}) => wake.mute(runId, on !== false) },
    // the Night watch: { on, until (ISO, at most 24 h ahead), from (the screen it was turned on from) } → { nightWatch, messages, state }
    { channel: 'oracle:nightWatch', method: 'setOracleNightWatch', params: 'opts', fn: ({ on, until, from } = {}) => get().setNightWatch({ on, until, by: nightBy(from) }) },
    // the owner proposes a card themselves (or a check): { kind, params, why } → { id, status, ... };
    // #241: a card requested by the Oracle or by content, of a kind an owner holds, goes to that owner's
    // inbox → { routed, to, kind, ok, text, ... }
    {
      channel: 'oracle:propose',
      method: 'oracleProposeAction',
      params: 'opts',
      fn: async (input = {}) => withState(await proposeOrRoute(input, { fromOracle: input.requestedBy !== 'owner' })),
    },
    // #241: the request_agent tool's function: { to: 'po' | 'supervisor', kind, params, reason, projectId?, requestedBy?, mock } →
    // { ok, text, costUsd, error?, pending? } (pending: a card waits for the owner's click in the owner's chat)
    { channel: 'oracle:requestAgent', method: 'oracleRequestAgent', params: 'opts', fn: (input = {}) => requestAgent(input) },
    // a new session from a handoff note; the messages and the memory are kept
    { channel: 'oracle:reset', method: 'resetOracle', params: 'opts', fn: (opts) => get().reset({ mock: simulated(opts) }) },
    { channel: 'oracle:saveMemory', method: 'saveOracleMemory', params: 'text', fn: (text) => get().saveMemory(text) },
    // { busy, paused, today, owner, model, effort, contextTokens, compactAtTokens, nightWatch, ... }
    { channel: 'oracle:state', method: 'oracleState', fn: () => get().state() },
    { channel: 'oracle:tools', method: 'listOracleTools', fn: () => tools.map(({ name, description }) => ({ name, description })) },
    { channel: 'oracle:undo', method: 'oracleUndo', params: 'opts', fn: ({ actionId } = {}) => get().undo(actionId) },
    // watch a run ({ runId }) or a project's roadmap ({ projectId }) until it ends; on: false stops
    { channel: 'oracle:watch', method: 'oracleWatch', params: 'opts', fn: (input) => wake.watch(input || {}) },
    // the batch waiting for the wake-up window now (the owner's "wake now", checks) → the wake's answer or null
    { channel: 'oracle:wakeNow', method: 'wakeOracleNow', fn: () => wake.flush() },
    // { muted, watching, wakeScope, wakeOn, pending }
    { channel: 'oracle:wakeState', method: 'oracleWakeState', fn: () => ({ ...wake.state(), pending: wake.pending() }) },
    // a message was added to the conversation (a wake-up, a card, a result): { id, role, kind }
    { event: 'oracle:changed', method: 'onOracleChanged' },
  ];
};
