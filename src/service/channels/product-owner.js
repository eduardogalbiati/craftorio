// The Backlog's Product Owner (#105, src/domains/po/product-owner.js): questions about a project's backlog and
// the conversation kept per project. Read-only: it proposes, the owner applies (Assign, roadmap).
// `mock` (the screen's developer mode) and MULTIAGENT_SIMULATION_ONLY answer from the simulated
// Product Owner: no model call, no cost. po:ask's `issues` (#169): the issues the owner selected on
// the Backlog and sent to the Product Owner, read in full and planned with suggested extra issues.
// Registering an issue (#117): `mode: 'issue'` drafts an issue in the same conversation; po:attach
// stores a pasted or dropped file; po:file files the draft on the owner's click (create, append to
// an existing issue's body, or comment), then syncs the backlog; po:discard drops it. `preview`
// and MULTIAGENT_SIMULATION_ONLY only preview: never gh/glab.
// po:file's `epic`: a new issue joins its draft's epic (#138). po:split files a proposed split of an
// issue too big for one run (#124); po:epic creates an epic or places issues in one (#138). Both
// run only on the owner's click, preview like po:file, and sync the backlog after a real write.
// po:decongest (#150) files one hot spot of an answer's `decongest` as an issue, previewing like po:file.
// po:ask's `scenario` (#148, simulated only): forces the simulated answer (MOCK_SCENARIOS). Every
// real answer raises a `po` notice (#149, src/domains/workspace/notifications.js); a simulated or stopped one does not.
// po:ask's progress is pushed on chat:progress ('po', the project id) and chat:cancel stops it (#180).
// po:ask's `calibration` (#189): a Speed ↔ Quality step for this question only (the saved one is unchanged).
// po:request (#240): another agent's request (the Oracle's) in the Product Owner's inbox
// (productOwner.handleRequest). Each mechanical kind runs the code of the owner's own button (Add to
// roadmap: roadmaps.propose; Assign: ctx.assignWorkflow; the Roadmap's skip and saved stages and the
// issue writes: the action functions, ctx.performAction); `plan` is a po:ask question. A request from
// the Oracle leaves a short line in its chat, linking to the result message here.
// #241: po:request is the Product Owner's end of the Oracle's request_agent (ctx.productOwnerRequest);
// a request waiting for the owner's click is a card in the drawer, run or dropped by po:requestAct.

const path = require('path');
const agents = require('../../domains/agents/agents');
const backlog = require('../../domains/backlog/backlog');
const DefaultWorkflow = require('../../shared/default-workflow');
const Language = require('../../shared/language');
const notifier = require('../../domains/workspace/notifications');
const productOwner = require('../../domains/po/product-owner');
const projects = require('../../domains/project/projects');
const roadmaps = require('../../domains/roadmap/roadmap');
const runs = require('../../domains/run/runs');
const simulation = require('../../engine/simulation');
const usage = require('../../domains/usage/usage');
const workspace = require('../../domains/workspace/workspace');
const { resolveCommand } = require('../../engine/providers');
const { isArchived } = require('../../shared/backlog-archive');
const { requireObject } = require('../common');
const {
  ANY,
  args,
  FLAG,
  INT,
  ISSUE_NUMBER,
  listOf,
  MESSAGES,
  nullable,
  NUMBER,
  OBJECT,
  orNone,
  PROJECT_ID,
  REQUEST_ANSWER,
  shape,
  STRING,
} = require('../schemas');

// Every drawer channel works on one project's conversation; `at` names one of its answers
const onProject = (properties = {}, required = []) => args({ projectId: PROJECT_ID, ...properties }, ['projectId', ...required]);
const AT = { type: ['string', 'integer'], description: 'An answer of the conversation (its time or index).' };
// what filing on the platform answers (the Backlog synced again after a real filing, syncError when that failed)
const FILED = OBJECT;

module.exports = (ctx) => {
  const project = (projectId) => path.basename(String(projectId));
  // The synced backlog, its platform and the project: what every write to the platform needs.
  const target = (projectId) => {
    const id = project(projectId);
    const data = backlog.readBacklog(ctx.ws.backlog, id);
    if (!data) throw new Error('Sync the backlog first: the Product Owner writes to the synced repository.');
    const p = projects.readProject(ctx.ws.projects, id);
    const platform = data.platform || workspace.readSettings(ctx.ws).backlogPlatform || backlog.DEFAULT_PLATFORM;
    return { id, data, p, platform, repo: data.repo || p?.repo };
  };
  // After a real write the Backlog shows the new or updated issues right away.
  const resync = async (res, { id, p, platform }) => {
    if (res.preview) return res;
    try {
      return { ...res, backlog: ctx.withIssueRuns(await backlog.syncBacklog({ dir: ctx.ws.backlog, project: p, platform })) };
    } catch (e) {
      return { ...res, syncError: e.message, backlog: ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, id)) };
    }
  };
  // What any Product Owner turn runs with: its agent, the project's folder, the skills and its budget (no backlog needed).
  const agentOptions = (id, simulated, settings = workspace.readSettings(ctx.ws)) => ({
    backlogDir: ctx.ws.backlog,
    projectId: id,
    folder: projects.readProject(ctx.ws.projects, id)?.folder,
    agent: agents.readAgent(ctx.ws.agents, agents.PRODUCT_OWNER_ID),
    skillsDirs: [ctx.ws.skills, ctx.BUNDLED_SKILLS_DIR],
    resolveCommand,
    // its own past calls and the Oracle's are in no run: add them to what the runs used this month
    budget: simulated ? null : usage.withPeerUsage(usage.budgetBaseline({ runsDir: ctx.ws.runs, settings, extraRuns: ctx.agentUsageRuns() }), productOwner.monthUsage(ctx.ws.backlog, new Date(), settings.timeZone), settings.prices),
    language: settings.language, // #327, #328: the turn's [Language] line, the simulated draft's headings
  });
  // What every question to the Product Owner reads: the synced backlog, the runs, the workflows, its agent and budget.
  const askOptions = (id, simulated) => {
    const p = projects.readProject(ctx.ws.projects, id);
    const data = ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, id));
    if (!data) throw new Error('Sync the backlog first: the Product Owner reads the synced issues.');
    const settings = workspace.readSettings(ctx.ws);
    return {
      ...agentOptions(id, simulated, settings),
      runsDir: ctx.ws.runs,
      data,
      activeRuns: ctx.activeRuns().filter((r) => r.projectId === id),
      runs: runs.runsForProject(runs.listRuns(ctx.ws.runs), p),
      workflows: ctx.listWorkflows().filter((w) => !w.error && w.inputs?.task),
      defaultWorkflow: projects.projectDefaultWorkflow(p, settings.defaultWorkflow), // #195; #486: the project's own first
      mock: simulated,
      // #206: the prices of the estimates
      prices: settings.prices || {},
      timeZone: settings.timeZone, // #273: the owner's zone in the turn's prompt
    };
  };
  // a discovery card's commit proposal asks the same Product Owner (#258, src/service/channels/discovery.js)
  ctx.productOwnerOptions = askOptions;
  // the Refactor tab's ranking reads no issue (#357, src/service/channels/refactor.js)
  ctx.productOwnerAgentOptions = agentOptions;

  // ---- the inbox's mechanical kinds (#240): the code of the owner's own buttons ------------------
  const numbersOf = (list) => [...new Set((Array.isArray(list) ? list : [list]).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const refs = (numbers) => numbers.map((n) => `#${n}`).join(', ');
  const syncedIssues = (id) => {
    const issues = backlog.readBacklog(ctx.ws.backlog, id)?.issues;
    if (!issues) throw new Error('Sync the backlog first: the Product Owner plans the synced issues.');
    return issues;
  };
  const REQUESTS = {
    'issue.file': (p, { mock }) => ctx.performAction('issue.file', p, { mock }),
    'issue.update': (p, { mock }) => ctx.performAction('issue.update', p, { mock }),
    // the Backlog's Assign: the issues go to the plain queue on a workflow ({ issues, workflow, inputs?, group? })
    'queue.assign': async (p, { mock }) => {
      const numbers = numbersOf(p.issues ?? p.numbers);
      if (!numbers.length) throw new Error('Say which issues to queue (issues).');
      if (!p.workflow) throw new Error('Say which workflow runs them (workflow).');
      const kept = ctx.keptWorkForIssues(numbers);
      if (kept) throw new Error(`${kept.text} Nothing was queued: the owner decides between resuming that run and starting from scratch.`);
      await ctx.assignWorkflow({ projectId: p.projectId, numbers, workflow: p.workflow, inputs: p.inputs || {}, mock, group: !!p.group });
      return { text: `${refs(numbers)} queued on ${path.basename(String(p.workflow))}${p.group ? ' (one run)' : ''}.` };
    },
    // the Product Owner's Add to roadmap: a new planned stage at the end ({ issues, workflow?, inputs?, group? });
    // the workflow defaults to the project's default workflow (#486), else Settings', as the Product Owner's own plans do
    'roadmap.add': async (p) => {
      const id = p.projectId;
      const numbers = numbersOf(p.issues);
      if (!numbers.length) throw new Error('Say which issues to add (issues).');
      const issues = syncedIssues(id);
      const unknown = numbers.filter((n) => !issues.some((i) => i.number === n));
      if (unknown.length) throw new Error(`${refs(unknown)} ${unknown.length > 1 ? 'are' : 'is'} not in the synced backlog.`);
      // propose leaves archived issues out silently: refuse them here, so none is reported as added
      const archived = numbers.filter((n) => isArchived(issues.find((i) => i.number === n)));
      if (archived.length) throw new Error(`${refs(archived)} ${archived.length > 1 ? 'are' : 'is'} archived: restore ${archived.length > 1 ? 'them' : 'it'} in the Backlog before planning. Nothing was added.`);
      const files = ctx.listWorkflows().filter((w) => !w.error && w.inputs?.task).map((w) => w.file);
      const workflow = p.workflow ? path.basename(String(p.workflow)) : DefaultWorkflow.resolve(projects.projectDefaultWorkflow(projects.readProject(ctx.ws.projects, id), workspace.readSettings(ctx.ws).defaultWorkflow), files).file;
      if (!files.includes(workflow)) throw new Error(`Workflow ${workflow} is not installed, or has no task input to receive an issue.`);
      const inputs = p.inputs && typeof p.inputs === 'object' ? p.inputs : {};
      const items = p.group ? [{ workflow, inputs, issues: numbers }] : numbers.map((n) => ({ workflow, inputs, issues: [n] }));
      const { roadmap, dropped } = roadmaps.propose(ctx.ws.backlog, id, [{ items }], { issues, alive: ctx.runAlive });
      const added = numbers.filter((n) => !dropped.includes(n));
      if (!added.length) throw new Error(`${refs(numbers)} ${numbers.length > 1 ? 'are' : 'is'} already planned in the roadmap: nothing was added.`);
      return { text: `${added.map((n) => `#${n} ${issues.find((i) => i.number === n).title}`).join('; ')}: added to the roadmap in stage ${roadmap.stages.length} (${workflow})${dropped.length ? `; ${refs(dropped)} already planned` : ''}.` };
    },
    // the Roadmap's drag of a planned item to another stage ({ itemId, stage: its number, 1-based; one past the last adds a stage })
    'roadmap.move': (p, { mock }) => {
      const read = roadmaps.readRoadmap(ctx.ws.backlog, p.projectId);
      const stages = read.stages || [];
      const item = stages.flatMap((s) => s.items || []).find((x) => x.id === String(p.itemId || ''));
      if (!item) throw new Error(`Roadmap item ${p.itemId} does not exist.`);
      if (item.status !== 'planned') throw new Error(`Roadmap item ${p.itemId} is ${item.status}: only a planned item moves.`);
      const to = Number(p.stage);
      if (!Number.isInteger(to) || to < 1 || to > stages.length + 1) throw new Error(`Stage ${p.stage} does not exist: say a stage number from 1 to ${stages.length + 1}.`);
      const next = stages.map((s) => ({ ...s, items: (s.items || []).filter((x) => x.id !== item.id) }));
      if (to > next.length) next.push({ name: '', note: '', items: [] });
      next[to - 1].items.push(item);
      // #287: based on this read; a roadmap written before the action runs gets the move only
      return ctx.performAction('roadmap.stages', { projectId: p.projectId, stages: next, base: read.updatedAt }, { mock });
    },
    // the Roadmap's saved edit: the whole stages, regrouped ({ stages, append? })
    'roadmap.regroup': (p, { mock }) => ctx.performAction('roadmap.stages', p, { mock }),
    // the Roadmap's Skip on an item ({ itemId })
    'roadmap.skip': (p, { mock }) => ctx.performAction('roadmap.item', { ...p, action: 'skip' }, { mock }),
  };
  const performer = (id, mock) => (kind, params) => REQUESTS[kind]({ ...params, projectId: id }, { mock: !!mock || simulation.simulationOnly() });
  // #241: which requests wait for the owner's click (the Night watch's permissions, content) and the night log
  // (`byModel`: the Oracle's request_agent; by day its CONFIRM_KINDS wait too)
  const rules = (id, byContent = false, byModel = false) => ctx.inboxRules?.('product-owner', { project: id, byContent, byModel, confirmKinds: productOwner.CONFIRM_KINDS }) || {};
  // a request from the Oracle (or the owner's click on one) leaves a short line in the Oracle's chat
  const sent = (out, id) => {
    if (out.from !== 'oracle') return;
    ctx.oracleService?.()?.requested({ to: 'product-owner', ref: out.ref, ownerTs: out.ownerTs, requestKind: out.kind, projectId: id, text: out.text, costUsd: out.costUsd, error: out.error, pending: out.pending });
  };
  const answer = (out) => ({ ok: out.ok, text: out.text, costUsd: out.costUsd, ...(out.error ? { error: out.error } : {}), ...(out.pending ? { pending: true } : {}) });
  const request = async ({ projectId, mock, byContent, byModel, ...input } = {}) => {
    const id = project(projectId || '');
    // no project, no conversation to record it in
    let known = null;
    try {
      known = projectId ? projects.readProject(ctx.ws.projects, id) : null;
    } catch {
      // readProject throws for a missing project file
    }
    if (!known) {
      const error = `Unknown project: ${projectId || '(none)'}`;
      return { ok: false, text: error, costUsd: 0, error };
    }
    const simulated = !!mock || simulation.simulationOnly();
    const out = await productOwner.handleRequest({
      backlogDir: ctx.ws.backlog,
      projectId: id,
      request: input,
      perform: performer(id, mock),
      ask: ({ question, request: tag }) => productOwner.ask({ ...askOptions(id, simulated), question, mode: 'plan', request: tag }),
      ...rules(id, !!byContent, !!byModel),
    });
    sent(out, id);
    return answer(out);
  };
  // the Oracle's request_agent sends here (src/service/channels/oracle.js)
  ctx.productOwnerRequest = request;

  return [
    {
      channel: 'po:ask',
      method: 'askProductOwner',
      params: ['projectId', 'question', 'mock', 'mode', 'attachments', 'issues', 'scenario', 'calibration', 'cost', 'workflow', 'inputs'],
      schema: {
        params: onProject({
          question: STRING,
          mock: FLAG,
          mode: nullable(STRING),
          attachments: ANY,
          issues: ANY,
          scenario: ANY,
          calibration: ANY,
          cost: ANY,
          workflow: nullable(STRING),
          inputs: ANY,
        }),
        result: shape({ message: OBJECT, messages: MESSAGES }, ['messages']),
      },
      fn: async ({ projectId, question, mock, mode, attachments, issues, scenario, calibration, cost, workflow, inputs }) => {
        const id = project(projectId);
        const p = projects.readProject(ctx.ws.projects, id);
        const simulated = !!mock || simulation.simulationOnly();
        const base = askOptions(id, simulated);
        // #180: its progress is pushed on chat:progress; chat:cancel ('po', id) stops it
        const turn = ctx.chatTurns.start('po', id);
        let out;
        try {
          out = await productOwner.ask({
            ...base,
            question,
            mode: mode === 'issue' ? 'issue' : 'plan',
            attachments: Array.isArray(attachments) ? attachments : [],
            // #169: the Backlog's selection sent to the Product Owner (plan mode)
            selection: Array.isArray(issues) ? issues : [],
            // #148: the drawer's simulation-only scenario picker (ignored for a real call)
            scenario: simulated && typeof scenario === 'string' && scenario ? scenario : null,
            // #189: the drawer's calibration chip, for this question only (null: the saved one)
            calibration: calibration ?? null,
            // #205: the drawer's Cost chip, for this question only (null: the saved one); #206: the prices of the estimates
            cost: cost ?? null,
            // #235: the drawer's workflow (every group on it) and its options (in every group's inputs)
            workflow: typeof workflow === 'string' && workflow ? workflow : null,
            inputs: inputs && typeof inputs === 'object' && !Array.isArray(inputs) ? inputs : null,
            onItem: turn.onItem,
            signal: turn.signal,
          });
        } finally {
          turn.end(turn.stopped() ? 'stopped' : out?.message?.error ? 'failed' : 'done');
        }
        // #149: the bell and a desktop notice for a real answer only (not while the window shows this
        // project's drawer); a simulated one shows the avatar's unread dot only
        if (!simulated && !out.message?.stopped) ctx.notify?.(notifier.productOwnerNotice({ project: { id, name: p?.name }, message: out.message }), { projectId: id });
        return out;
      },
    },
    {
      channel: 'po:attach',
      method: 'attachProductOwnerFile',
      params: ['projectId', 'name', 'data'],
      schema: { params: onProject({ name: STRING, data: STRING }), result: shape({ name: STRING, path: STRING, size: NUMBER }, ['path']) },
      fn: ({ projectId, name, data }) => productOwner.saveAttachment(ctx.ws.backlog, project(projectId), { name, data }),
    },
    { channel: 'po:clear', method: 'clearProductOwner', params: ['projectId'], schema: { params: onProject(), result: MESSAGES }, fn: ({ projectId }) => productOwner.clearConversation(ctx.ws.backlog, project(projectId)) },
    {
      channel: 'po:discard',
      method: 'discardProductOwnerDraft',
      params: ['projectId', 'at'],
      schema: { params: onProject({ at: AT }), result: MESSAGES },
      fn: ({ projectId, at }) => productOwner.discardDraft(ctx.ws.backlog, project(projectId), at, ctx.ws.runs),
    },
    // Returns fileDraft's result plus, after a real filing, the backlog synced again (syncError when that failed).
    {
      channel: 'po:file',
      method: 'fileProductOwnerDraft',
      params: ['projectId', 'at', 'action', 'number', 'preview', 'epic'],
      schema: { params: onProject({ at: AT, action: nullable(STRING), number: nullable(ISSUE_NUMBER), preview: FLAG, epic: FLAG }), result: FILED },
      fn: async ({ projectId, at, action, number, preview, epic }) => {
        const t = target(projectId);
        const res = await productOwner.fileDraft({
          backlogDir: ctx.ws.backlog,
          projectId: t.id,
          runsDir: ctx.ws.runs,
          at,
          action,
          number,
          preview: !!preview || simulation.simulationOnly(),
          platform: t.platform,
          repo: t.repo,
          cached: (t.data.issues || []).find((i) => i.number === Number(number)) || null,
          placeEpic: !!epic,
          timeZone: workspace.readSettings(ctx.ws).timeZone, // #273: the drawer previews the same day
          issuesLanguage: Language.issuesLanguage(workspace.readSettings(ctx.ws)), // #328
          epicList: t.data.epics || [],
        });
        return resync(res, t);
      },
    },
    // #150: one hot spot of an answer's `decongest` filed as an issue on the owner's click (preview like po:file)
    {
      channel: 'po:decongest',
      method: 'fileProductOwnerDecongest',
      params: ['projectId', 'at', 'index', 'preview'],
      schema: { params: onProject({ at: AT, index: INT, preview: FLAG }), result: FILED },
      fn: async ({ projectId, at, index, preview }) => {
        const t = target(projectId);
        const res = await productOwner.fileDecongest({
          backlogDir: ctx.ws.backlog, projectId: t.id, runsDir: ctx.ws.runs, at, index, preview: !!preview || simulation.simulationOnly(), platform: t.platform, repo: t.repo,
        });
        return resync(res, t);
      },
    },
    {
      channel: 'po:split',
      method: 'splitProductOwnerIssue',
      params: ['projectId', 'at', 'split', 'preview'],
      schema: { params: onProject({ at: AT, split: ANY, preview: FLAG }), result: FILED },
      fn: async ({ projectId, at, split, preview }) => {
        const t = target(projectId);
        const res = await productOwner.applySplit({
          backlogDir: ctx.ws.backlog, projectId: t.id, runsDir: ctx.ws.runs, at, split, preview: !!preview || simulation.simulationOnly(), platform: t.platform, repo: t.repo, data: t.data,
          timeZone: workspace.readSettings(ctx.ws).timeZone, // #273
          issuesLanguage: Language.issuesLanguage(workspace.readSettings(ctx.ws)), // #328
        });
        return resync(res, t);
      },
    },
    {
      channel: 'po:epic',
      method: 'applyProductOwnerEpic',
      params: ['projectId', 'at', 'key', 'epic', 'issues', 'preview'],
      schema: { params: onProject({ at: AT, key: ANY, epic: ANY, issues: ANY, preview: FLAG }), result: FILED },
      fn: async ({ projectId, at, key, epic, issues, preview }) => {
        const t = target(projectId);
        const res = await productOwner.applyEpicProposal({
          backlogDir: ctx.ws.backlog, projectId: t.id, runsDir: ctx.ws.runs, at, key, epic, issues, preview: !!preview || simulation.simulationOnly(), platform: t.platform, repo: t.repo, data: t.data,
          issuesLanguage: Language.issuesLanguage(workspace.readSettings(ctx.ws)), // #328
        });
        return resync(res, t);
      },
    },
    { channel: 'po:history', method: 'productOwnerHistory', params: ['projectId'], schema: { params: onProject(), result: MESSAGES }, fn: ({ projectId }) => productOwner.readConversation(ctx.ws.backlog, project(projectId)) },
    // #240: another agent's request: { projectId, kind, params, reason, from, ref, byContent?, mock } →
    // { ok, text, costUsd, error?, pending? }; a refused or failed request is ok: false (recorded in the
    // conversation too), never a throw. #241: under the Night watch, a kind it does not allow is a card
    // waiting for the owner's click (pending).
    {
      channel: 'po:request',
      method: 'productOwnerRequest',
      params: 'opts',
      // params: the request kind's own (src/domains/po/product-owner.js checks them per kind)
      schema: {
        params: args({ projectId: orNone(PROJECT_ID), kind: STRING, params: ANY, reason: ANY, from: ANY, ref: ANY, byContent: FLAG, mock: FLAG }),
        result: REQUEST_ANSWER,
      },
      fn: (opts) => request(requireObject(opts, 'options')),
    },
    // #241: the owner's click on a request card in the drawer: { projectId, ref, action: 'do' | 'dismiss' | 'undo', mock } →
    // { ok, text, costUsd, error?, messages }
    {
      channel: 'po:requestAct',
      method: 'productOwnerRequestAct',
      params: 'opts',
      schema: { params: onProject({ ref: ANY, action: STRING, mock: FLAG }), result: { ...REQUEST_ANSWER, properties: { ...REQUEST_ANSWER.properties, messages: MESSAGES } } },
      fn: async (arg) => {
        const { projectId, ref, action, mock } = requireObject(arg, 'options');
        const id = project(projectId);
        const out = await productOwner.actRequest({
          backlogDir: ctx.ws.backlog, projectId: id, input: { ref, action },
          perform: performer(id, mock), restore: ctx.restoreAction, after: rules(id).after,
        });
        sent(out, id);
        return { ...answer(out), messages: productOwner.readConversation(ctx.ws.backlog, id) };
      },
    },
  ];
};
