// Service area: usage, budgets and prices (the Usage screen, src/usage.js) and analytics (tokens
// and session metrics over a date range, src/analytics.js), with the supervisor's report on it, and
// Analytics' Repository performance tab (src/repo-performance.js, #159) and Agents tab (#280,
// src/agents-usage.js: what the Oracle, the Product Owner and the Supervisor chat cost).
// `agentUsageRuns` is the spend that is in no run folder, for Usage and every monthly budget check.

const path = require('path');
const { resolveCommand } = require('../../engine/providers');
const simulation = require('../../engine/simulation');
const workspace = require('../../workspace');
const projects = require('../../projects');
const usage = require('../../usage');
const agentsUsage = require('../../agents-usage');
const analytics = require('../../analytics');
const oracle = require('../../oracle');
const productOwner = require('../../product-owner');
const supervisorChat = require('../../supervisor-chat');
const repoPerformance = require('../../repo-performance');
const roadmap = require('../../roadmap');
const runs = require('../../runs');
const { readLocalUsage } = require('../../local-usage');
const { storeFor } = require('../../store');
const supervisor = require('../../supervisor');
const {
  BUNDLED_SKILLS_DIR,
  folderMatcher,
  num,
} = require('../common');

module.exports = (ctx) => {
  const oracleDir = () => ctx.ws.oracle || path.join(ctx.ws.root, 'oracle');
  const supervisorDir = () => ctx.ws.supervisor || path.join(ctx.ws.root, 'supervisor');

  // The Oracle's and (#280) the Supervisor chat's spend is in no run folder: their days are added as
  // runs (computeUsage's and budgetBaseline's `extraRuns`). The Product Owner's month joins the
  // budget checks through usage.withPeerUsage.
  function agentUsageRuns() {
    return [...oracle.usageRuns(oracleDir()), ...supervisorChat.usageRuns(supervisorDir())];
  }

  // Analytics' Agents tab (#280): the three agents' totals, days and sessions in a range of UTC days,
  // and the Oracle's spend today against its daily budget
  function agentsSnapshot({ from, to } = {}) {
    const range = analytics.dateRange({ from, to });
    const out = agentsUsage.agentsAnalytics({
      oracle: oracle.usageLines(oracleDir()), productOwner: productOwner.usageLines(ctx.ws.backlog), supervisor: supervisorChat.usageTurns(supervisorDir()),
      from: range.from, to: range.to,
    });
    const { dailyBudgetUsd } = oracle.oracleSettings(workspace.readSettings(ctx.ws));
    out.agents.oracle.today = { spentUsd: oracle.spentOn(oracleDir()), limitUsd: dailyBudgetUsd };
    return out;
  }

  function usageSnapshot(scope = 'orchestrator') {
    const live = [...ctx.active.values()].filter((r) => r.status === 'running' && !r.mock).map((r) => ({
      run_id: r.runId, workflow: r.wf.metadata?.name, started_at: new Date(r.startedAt).toISOString(), sessions: [...r.sessions.values()].map((x) => r.snapshot(x)),
    }));
    const installed = Object.fromEntries(usage.PROVIDERS.map((p) => [p.id, !!resolveCommand(p.command)]));
    const local = scope === 'machine' ? readLocalUsage() : null;
    const out = usage.computeUsage({ runsDir: ctx.ws.runs, settings: workspace.readSettings(ctx.ws), live, installed, scope, local, extraRuns: agentUsageRuns() });
    // #206: today's (or tonight's) spending against the budget, for the top bar ("$38 / $60 today")
    let spending = null;
    try { spending = ctx.budgetNow(); } catch (e) { console.error('budget:', e); }
    return { ...out, spending };
  }

  // The CLIs' transcripts are read in both scopes: they add tool calls, prompts, files... to run sessions.
  function analyticsSnapshot({ scope, from, to } = {}) {
    const within = folderMatcher();
    const projectList = projects.listProjects(ctx.ws.projects);
    const projectOf = (cwd) => {
      const p = cwd && projectList.find((x) => [x.folder, ...(x.previousFolders || [])].some((d) => within(cwd, d)));
      return p ? { id: p.id, name: p.name } : null;
    };
    return analytics.computeAnalytics({
      runsDir: ctx.ws.runs, local: readLocalUsage(), settings: workspace.readSettings(ctx.ws), projects: projectList, projectOf,
      scope: scope === 'machine' ? 'machine' : 'orchestrator', from, to,
    });
  }

  // Analytics' Repository performance tab (#159): one project's runs in a range, from the run folders,
  // the index and the project's local clone. Default project: the one with the latest run.
  async function repositoryPerformance({ projectId, from, to, marker } = {}) {
    const started = Date.now();
    const projectList = projects.listProjects(ctx.ws.projects);
    const all = runs.listRuns(ctx.ws.runs).filter((r) => !r.mock);
    const project = projectList.find((p) => p.id === projectId)
      || projectList.find((p) => all.some((r) => runs.projectOf(r, projectList)?.id === p.id)) || projectList[0] || null;
    const list = project ? runs.runsForProject(all, project) : [];
    const stages = project ? roadmap.readRoadmap(ctx.ws.backlog, project.id).stages.map((s, i) => ({
      name: s.name || `Stage ${i + 1}`, runIds: s.items.flatMap((x) => [x.runId, ...(x.runs || [])].filter(Boolean)),
    })) : [];
    const perf = await repoPerformance.repositoryPerformance({
      runs: list, repo: project?.isGit ? project.folder : null, store: storeFor(ctx.ws.runs), from, to, marker, stages,
    });
    return {
      ...perf,
      // #197: the project picker: every project, one without a git folder listed with the reason
      projects: projectList.map((p) => ({
        id: p.id, name: p.name, folder: p.folder || null, isGit: !!p.isGit,
        reason: p.isGit ? null : p.folder ? 'Its folder is not a git repository: no commits to count.' : 'It has no folder.',
      })),
      project: project ? { id: project.id, name: project.name, folder: project.folder, isGit: !!project.isGit } : null,
      elapsedMs: Date.now() - started,
    };
  }

  // The supervisor's report on the range; it calls a real model unless `mock` (the UI asks first).
  // attachments: images for the question (#129)
  async function analyzeAnalytics({ scope, from, to, question, mock, attachments } = {}) {
    if (!mock) simulation.refuseReal('the supervisor\'s CLI (claude)');
    const a = analyticsSnapshot({ scope, from, to });
    return supervisor.analyzeSessions({
      report: analytics.analyticsReport(a), from: a.from, to: a.to, scope: a.scope, question, mock: !!mock,
      attachments: Array.isArray(attachments) ? attachments : [],
      reportsDir: ctx.ws.reports, skillsDirs: [ctx.ws.skills, BUNDLED_SKILLS_DIR], resolveCommand,
    });
  }

  function setBudget({ provider, budget, scope }) {
    if (!usage.PROVIDERS.some((p) => p.id === provider)) throw new Error(`Unknown provider: ${provider}`);
    const budgets = { ...workspace.readSettings(ctx.ws).budgets };
    budgets[provider] = {
      monthlyUsd: num(budget?.monthlyUsd), monthlyTokens: num(budget?.monthlyTokens),
      blockOnLimit: budget?.blockOnLimit !== false, countOutside: !!budget?.countOutside,
    };
    workspace.writeSettings(ctx.ws, { budgets });
    return usageSnapshot(scope);
  }

  function setPrice({ model, price, scope }) {
    if (!String(model || '').trim()) throw new Error('Model is required.');
    const prices = { ...workspace.readSettings(ctx.ws).prices };
    const clean = { input: +price?.input || 0, output: +price?.output || 0, cache_read: +price?.cache_read || 0 };
    if (!clean.input && !clean.output && !clean.cache_read) delete prices[model];
    else prices[model] = clean;
    workspace.writeSettings(ctx.ws, { prices });
    return usageSnapshot(scope);
  }

  return {
    agentsSnapshot,
    agentUsageRuns,
    analyticsSnapshot,
    analyzeAnalytics,
    repositoryPerformance,
    setBudget,
    setPrice,
    usageSnapshot,
  };
};
