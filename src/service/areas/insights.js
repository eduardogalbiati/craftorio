// Service area: Analytics' 24/7 tab and the top bar chip (#188, src/occupancy.js), the Run tab (#228,
// src/run-analysis.js) and Repository performance's "Ask for a plan" (#197). Local and offline except
// the plan (a real-model call, refused in simulation-only mode unless `mock`).
//   occupancySnapshot  the meter over the last 24 h, 7 and 30 days, the Night watch split and its
//                      nights, the cost figures and the per-calibration split (cached; the cache is
//                      dropped on workflow.started / workflow.finished)
//   runAnalysis        one run's figures (cached in the index, src/store.js run_figures) and its
//                      comparison with the latest real successful runs of its workflow
//   performancePlan    the supervisor's plan for the files over the shared limit

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { readAppSessions } = require('../../app-sessions');
const { resolveCommand } = require('../../engine/providers');
const simulation = require('../../engine/simulation');
const night = require('../../night-watch');
const occupancy = require('../../occupancy');
const poCalibration = require('../../renderer/po-calibration');
const productOwner = require('../../product-owner');
const projects = require('../../projects');
const repoPerformance = require('../../repo-performance');
const {
  ownerAlive,
  readOwner,
} = require('../../run-owner');
const runAnalysisLib = require('../../run-analysis');
const runs = require('../../runs');
const supervisor = require('../../supervisor');
const { BUNDLED_SKILLS_DIR } = require('../common');

const DAY = 864e5;
const CACHE_MS = 60e3;
const RUN_CHOICES = 300;

const shortstat = (repo, commit) => new Promise((resolve) => {
  execFile('git', ['-C', repo, 'diff', '--shortstat', `${commit}^1`, commit], { timeout: 15e3, windowsHide: true }, (err, out) => {
    if (err) { resolve(null); return; }
    const n = (re) => Number(String(out).match(re)?.[1] || 0);
    resolve(n(/(\d+) insertion/) + n(/(\d+) deletion/));
  });
});
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

module.exports = (ctx) => {
  const factsCache = new Map(); // events.jsonl → { sig, facts }
  const linesCache = new Map(); // run id → lines changed by its local merge
  let snapshotCache = null; // { key, at, value }
  const oracleDir = () => ctx.ws.oracle || path.join(ctx.ws.root, 'oracle');

  ctx.events?.on?.('run:event', (ev) => { if (ev?.type === 'workflow.started' || ev?.type === 'workflow.finished') snapshotCache = null; });

  // the runs that may overlap the window: their night-watch facts, cached by the events file's size and time
  function factsSince(from) {
    const out = [];
    let ids = [];
    try { ids = fs.readdirSync(ctx.ws.runs); } catch { return out; }
    for (const id of ids) {
      const file = path.join(ctx.ws.runs, id, 'events.jsonl');
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (st.mtimeMs < from) continue;
      const sig = `${st.size} ${st.mtimeMs}`;
      let c = factsCache.get(file);
      if (c?.sig !== sig) {
        const events = runs.runEvents(path.dirname(file));
        const last = events.reduce((m, e) => Math.max(m, Date.parse(e.ts) || 0), 0);
        c = { sig, facts: night.runFacts(id, events), last };
        factsCache.set(file, c);
      }
      // a run that died with the app has no workflow.finished: it ends at its last event, not now
      if (c.facts.end == null && c.facts.start != null && !ownerAlive(readOwner(path.dirname(file)))) {
        out.push({ ...c.facts, end: Math.max(c.facts.start, c.last), status: 'interrupted' });
        continue;
      }
      out.push(c.facts);
    }
    return out;
  }

  // lines changed by the delivered runs (their local merge commit), for the cost per 100 lines
  async function linesOf(facts) {
    const out = {};
    for (const f of facts.filter((x) => x.status === 'success' && !x.mock)) {
      if (!linesCache.has(f.runId)) {
        const s = readJson(path.join(ctx.ws.runs, f.runId, 'summary.json'));
        const repo = s?.worktree?.repo;
        const commit = s?.local_merge?.commit;
        linesCache.set(f.runId, repo && commit && fs.existsSync(repo) ? await shortstat(repo, commit) : null);
      }
      if (linesCache.get(f.runId) != null) out[f.runId] = linesCache.get(f.runId);
    }
    return out;
  }

  // the Product Owner's plan answers of every project, for the per-calibration split (#189)
  function calibrationSplit(facts) {
    const projectList = projects.listProjects(ctx.ws.projects);
    const answers = projectList.flatMap((p) => productOwner.readConversation(ctx.ws.backlog, p.id)
      .filter((m) => m.role === 'po' && m.answer?.calibration)
      .map((m) => ({ ts: m.ts, projectId: p.id, calibration: m.answer.calibration, groups: m.answer.groups || [] })));
    if (!answers.length) return [];
    const list = facts.filter((f) => !f.mock && f.end != null).map((f) => {
      const dir = path.join(ctx.ws.runs, f.runId);
      const s = readJson(path.join(dir, 'summary.json')) || {};
      const reviewRounds = Object.entries(s.steps || {}).filter(([id]) => /review/i.test(id)).reduce((n, [, v]) => n + (Number(v?.visits) || 0), 0);
      return {
        runId: f.runId, projectId: f.projectId, startedAt: new Date(f.start).toISOString(), issues: s.issues || [], costUsd: f.cost,
        conflict: !!repoPerformance.runFacts(dir).conflictStep, reviewRounds,
      };
    });
    return repoPerformance.byCalibration({ runs: list, answers }).map((c) => ({ ...c, label: poCalibration.label(c.calibration) }));
  }

  /**
   * The 24/7 meter. `days` the long window (7 or 30, default 30); `summary`: only the last 24 h (the
   * top bar chip, no git, no nights). Simulated runs never count.
   */
  async function occupancySnapshot({ days = 30, summary = false } = {}) {
    const now = Date.now();
    const span = summary ? 1 : Math.min(90, Math.max(1, Number(days) || 30));
    const key = `${span} ${summary}`;
    if (snapshotCache?.key === key && now - snapshotCache.at < CACHE_MS) return snapshotCache.value;
    const from = now - Math.max(span, 1) * DAY;
    // the summary reads one day; the tab's cards always need the last 30 days
    const facts = factsSince((summary ? from : Math.min(from, now - 30 * DAY)) - DAY);
    const sessions = readAppSessions(ctx.ws.root);
    const appSessions = sessions.length ? sessions : null;
    const log = night.readNightLog(oracleDir());
    const nights = night.nightsOf(log).filter((n) => Date.parse(n.endedAt || n.until) >= from);
    const at = (d) => occupancy.occupancyOf({ runs: facts, from: now - d * DAY, to: now, now, appSessions, nights, log });
    const last24h = at(1);
    // the app wrote its heartbeat log only since this version: before, "app closed" is unknown
    const partialSince = appSessions && Date.parse(appSessions[0].start) > from ? appSessions[0].start : null;
    if (summary) {
      const value = { empty: last24h.empty, occupancy: last24h.occupancy, activeHours: last24h.activeHours, idleNowMinutes: last24h.idleNowMinutes, running: last24h.running, at: new Date(now).toISOString() };
      snapshotCache = { key, at: now, value };
      return value;
    }
    const lines = await linesOf(facts);
    const long = occupancy.occupancyOf({ runs: facts, from, to: now, now, appSessions, nights, log, lines });
    const week = span >= 7 ? at(7) : last24h;
    const month = span === 30 ? long : at(30);
    const usage = (() => { try { return fs.readFileSync(path.join(oracleDir(), 'usage.jsonl'), 'utf8').split('\n').map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean); } catch { return []; } })();
    const nightRows = nights.map((n) => {
      const m = night.nightMetrics({ night: n, log, runs: facts.filter((f) => !f.mock), usage, now });
      return {
        startedAt: n.startedAt, window: m.window, occupancy: m.yield.occupancy, incidents: m.incidents.count, actions: m.actions.auto,
        hoursSaved: m.hoursSaved, costUsd: m.cost.runsUsd + m.cost.watchUsd, watch: true,
      };
    });
    // the nights without the watch (00:00-08:00 local of each day no watch covered), so its gain shows
    for (const d of long.days) {
      const start = Date.parse(`${d.day}T00:00:00`);
      const end = start + 8 * 36e5;
      if (end > now || nights.some((n) => Date.parse(n.startedAt) < end && Date.parse(n.endedAt || n.until) > start)) continue;
      const o = occupancy.occupancyOf({ runs: facts, from: start, to: end, now, appSessions });
      nightRows.push({ startedAt: new Date(start).toISOString(), window: o.window, occupancy: o.occupancy, incidents: null, actions: null, hoursSaved: null, costUsd: o.costUsd, watch: false });
    }
    nightRows.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const value = {
      ...long,
      days: long.days,
      cards: {
        day: { occupancy: last24h.occupancy, activeHours: last24h.activeHours, hours: last24h.window.hours },
        week: { occupancy: week.occupancy, activeHours: week.activeHours, hours: week.window.hours, longestGap: week.longestGap },
        month: { occupancy: month.occupancy, activeHours: month.activeHours, hours: month.window.hours },
      },
      streakMinutes: last24h.streakMinutes,
      idleNowMinutes: last24h.idleNowMinutes,
      running: last24h.running,
      nights: nightRows,
      calibration: calibrationSplit(facts.filter((f) => f.start >= from)),
      partialSince,
      appLog: !!appSessions,
      span,
      at: new Date(now).toISOString(),
    };
    snapshotCache = { key, at: now, value };
    return value;
  }

  // one run's figures, cached in the index by its files' size and time
  function figuresOf(runId) {
    const dir = ctx.runFolder ? ctx.runFolder(runId) : path.join(ctx.ws.runs, runId);
    const sigOf = (f) => { try { const st = fs.statSync(path.join(dir, f)); return `${st.size}:${st.mtimeMs}`; } catch { return '-'; } };
    // costs-per-turn: figures cached before #233 counted resumed Claude turns twice
    const sig = `${sigOf('events.jsonl')} ${sigOf('summary.json')} costs-per-turn`;
    const cached = ctx.store?.runFigures?.(runId, sig);
    if (cached) return cached;
    const summary = readJson(path.join(dir, 'summary.json')) || {};
    const figures = { ...runAnalysisLib.runFigures({ summary, events: runs.runEvents(dir) }) };
    figures.runId = figures.runId || runId;
    const info = runs.readRun(ctx.ws.runs, runId);
    if (info) Object.assign(figures, { title: info.title || figures.title, projectId: info.projectId, workflow: figures.workflow || info.workflow });
    if (summary.status) ctx.store?.putRunFigures?.(runId, sig, figures);
    return figures;
  }

  /** The Run tab: `runId`'s figures and comparison; without one (or always) the runs to pick from. */
  function runAnalysis({ runId, limit } = {}) {
    const all = runs.listRuns(ctx.ws.runs);
    const choices = all.slice(0, RUN_CHOICES).map((r) => ({ runId: r.runId, title: r.title || r.workflow || r.runId, workflow: r.workflow, issues: r.issues || [], status: r.status, startedAt: r.startedAt, mock: !!r.mock }));
    if (!runId) return { runs: choices, figures: null, comparison: null };
    if (!all.some((r) => r.runId === runId) && !fs.existsSync(path.join(ctx.ws.runs, String(runId)))) throw new Error(`Run not found: ${runId}`);
    const figures = figuresOf(String(runId));
    const peers = all.filter((r) => r.runId !== figures.runId && r.workflow === figures.workflow && r.status === 'success' && !r.mock).slice(0, Number(limit) || 30);
    // a peer that cannot be read (a summary.json without its events.jsonl) is left out of the comparison
    const history = peers.flatMap((r) => { try { return [figuresOf(r.runId)]; } catch { return []; } });
    return { runs: choices, figures, comparison: runAnalysisLib.compareWithWorkflow(figures, history, { limit: Number(limit) || 30 }) };
  }

  /** "Ask for a plan" (#197): the supervisor's plan for the files over the shared limit; a real-model call unless `mock`. */
  async function performancePlan({ projectId, files, mock, question } = {}) {
    if (!mock) simulation.refuseReal('the supervisor\'s CLI (claude)');
    const perf = await ctx.repositoryPerformance({ projectId });
    const wanted = Array.isArray(files) && files.length ? new Set(files.map(String)) : null;
    const over = perf.files.filter((f) => f.recommendation && (!wanted || wanted.has(f.file)));
    const report = [
      `# Files over the shared limit (${Math.round(perf.sharedLimit * 100)}% of the runs) in ${perf.project?.name || 'the project'}`,
      `${perf.runsWithCommits} runs with commits counted.`,
      '',
      '| file | runs | share | lines now | conflicts | rule | recommendation |',
      '|---|---|---|---|---|---|---|',
      ...over.map((f) => `| ${f.file} | ${f.runs} | ${Math.round(f.share * 100)}% | ${f.lines ?? '—'} | ${f.recommendation.evidence.conflicts} | ${f.recommendation.kind} | ${f.recommendation.text} |`),
    ].join('\n');
    return supervisor.analyzeSessions({
      report, scope: 'orchestrator', mock: !!mock,
      question: question || 'Ignore the session analysis: plan how to stop parallel runs from colliding on the shared files above (the epic: features add files instead of editing shared ones). Per file, what to split, generate or move, in what order, and how a workflow or skill could keep it that way. Do not write the code.',
      reportsDir: ctx.ws.reports, skillsDirs: [ctx.ws.skills, BUNDLED_SKILLS_DIR], resolveCommand,
    });
  }

  return {
    occupancySnapshot,
    performancePlan,
    runAnalysis,
  };
};
