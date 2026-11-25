// The Oracle's architecture analysis of a project (#356): one turn, outside its conversation, that
// reads the facts model (packages/shared/architecture-model.js: hotspots, co-change pairs, languages)
// and checks the top hotspots with its read-only repository tools (repo_read, repo_git). It
// answers a report in the agents language (#327: the [Language] line of oneTurn), { summary, areas: [{ area, verdict }], findings: [{ kind, title,
// files: [{ path, lines }], evidence, severity, refactor }] }, checked against REPORT_SCHEMA
// (packages/shared/architecture-report.js, shared with the Refactor proposals workflow, #378) with
// validateSchema (#338): an invalid answer is an error, never half a report. It never edits code
// and never prescribes a fix to a run (the supervisor rule): #730 the owner files a finding as an issue
// from the Health tab (filed.json: the issue of each finding filed, by findingKey). The turn runs on the Oracle's model in its daily budget
// (packages/engine/domains/oracle/oracle.js oneTurn / budgetRefusal); simulated (mock, CRAFTORIO_SIMULATION_ONLY): a report
// derived from the facts, no model, no cost.
// Reports are saved per project as <workspace>/architecture/<project id>/<stamp>.json
// ({ id, date, project_id, head, costUsd, tokens, simulated, report }); compareReports marks each
// finding new or kept against the previous report and lists the gone ones; estimateCost is the
// mean cost of the 5 newest real reports. The project's city plan (#371) is stored next to them,
// city-plan.json, the plans it replaced in city-plan-history/ (never listed as reports).
// Service: packages/engine/fronts/analyser/channels/architecture.js.

'use strict';

const fs = require('fs');
const path = require('path');
const { validateSchema } = require('../workspace/json-schema');
const { KINDS, REPORT_SCHEMA, SEVERITIES } = require('@craftorio/shared/architecture-report');

const ESTIMATE_BASIS = 5;
const PROMPT_ROWS = 15;
const SETTINGS_FILE = 'settings.json';
const CITY_PLAN_FILE = 'city-plan.json';
const FILED_FILE = 'filed.json';
const PLAN_HISTORY_DIR = 'city-plan-history';

// The JSON of an answer: an object, a ```json fence (the last one), or the text itself
function parseAnswer(input) {
  if (input && typeof input === 'object') return input;
  const text = String(input ?? '');
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  const body = fences.length ? fences[fences.length - 1][1] : text;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error('no JSON object found');
  }
}

/** { report } (a valid report) or { error } (never a partial report). */
function validateReport(input) {
  let value;
  try {
    value = parseAnswer(input);
  } catch (e) {
    return { error: `The Oracle's answer is not a JSON report (${e.message}).` };
  }
  const errors = validateSchema(value, REPORT_SCHEMA, 'report');
  if (errors.length) return { error: `The Oracle's answer is not a valid architecture report: ${errors.slice(0, 5).join('; ')}.` };
  return { report: { summary: value.summary, areas: value.areas, findings: value.findings } };
}

// A finding's identity across reports: its kind and its sorted file paths
const findingKey = (f) => `${f.kind}:${(f.files || []).map((x) => x.path).sort().join(',')}`;

/** The current findings marked 'new' or 'kept' against `previous`, and the previous ones now gone. */
function compareReports(previous, current) {
  const before = new Set(((previous && previous.findings) || []).map(findingKey));
  const now = new Set(((current && current.findings) || []).map(findingKey));
  return {
    findings: ((current && current.findings) || []).map((f) => ({ ...f, status: before.has(findingKey(f)) ? 'kept' : 'new' })),
    gone: ((previous && previous.findings) || []).filter((f) => !now.has(findingKey(f))).map((f) => ({ ...f, status: 'gone' })),
  };
}

/** { usd, basis }: the mean cost of the 5 newest real (not simulated) reports, or null. */
function estimateCost(saved) {
  // a real turn whose CLI reported no cost (costUsd null) is not a $0 analysis
  const real = (saved || []).filter((r) => r && !r.simulated && r.costUsd != null && Number.isFinite(Number(r.costUsd)) && Number.isFinite(Date.parse(r.date)))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, ESTIMATE_BASIS);
  if (!real.length) return null;
  return { usd: real.reduce((sum, r) => sum + Number(r.costUsd), 0) / real.length, basis: real.length };
}

/**
 * #74: estimateCost of the project's own records (`listOf(projectId)`), else of the other projects' under `root`
 * (<workspace>/architecture, one folder per project): a project just imported has no run of its own.
 */
function estimateFromOthers(root, projectId, listOf) {
  const own = estimateCost(listOf(projectId));
  if (own) return own;
  let others = [];
  try { others = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== projectId).map((d) => d.name); } catch { /* nothing saved yet */ }
  return estimateCost(others.flatMap(listOf));
}

// ---------- the turn ----------

const hotspotLine = (r) => `- ${r.file}: ${r.lines} lines, ${r.commits} commits, rank ${r.rank}${r.complexity != null ? `, complexity ${r.complexity} (worst function ${r.worst}, ${r.quadrant})` : ''}${r.co_change ? `, changes with ${r.co_change.file} (${Math.round(r.co_change.share * 100)}%)` : ''}`;

/** The analysis prompt: the facts model (never recomputed by the Oracle) and the report's schema. */
function analysisPrompt({ project, model }) {
  const files = model.files.slice(0, PROMPT_ROWS);
  const pairs = model.pairs.slice(0, PROMPT_ROWS);
  return [
    `Architecture analysis of the project "${project.name}" (projectId "${project.id}"), at ${model.branch || 'HEAD'} ${model.head ? model.head.commit : ''}.`,
    'The numbers below were computed by the app from git; interpret them, never recompute them. Read the top hotspots and the co-changing files with your read-only tools (repo_read, repo_git with this projectId) before you claim anything. Never edit code and never prescribe a fix to a run: each finding suggests one refactor, sized as one issue, for the owner\'s Refactor tab.',
    '',
    `Languages (lines): ${model.languages.map((l) => `${l.language} ${l.lines}`).join(', ') || 'none'}.`,
    `Commits in the window: ${model.commits}${model.shallow ? ' (shallow clone: history is cut)' : ''}; mass changes: ${model.mass_changes.length}; excluded files: ${Object.entries(model.excluded).filter(([, n]) => n).map(([g, n]) => `${g} ${n}`).join(', ') || 'none'}.`,
    `Complexity: ${model.complexity.status === 'measured' ? `${model.complexity.metric} from ${model.complexity.tool}` : `not measured (${model.complexity.status})`}.`,
    '',
    'Top hotspots (lines x commits):',
    ...files.map(hotspotLine),
    '',
    'Files that change together (share of the commits of either file):',
    ...(pairs.length ? pairs.map((p) => `- ${p.a} + ${p.b}: ${p.together} commits together (${Math.round(p.share * 100)}%)`) : ['- none']),
    '',
    `Answer with one JSON object in a \`\`\`json fence, its prose in the language the Language line names for documents (English when there is none), matching this schema. kind is one of ${KINDS.join(', ')}; severity is one of ${SEVERITIES.join(', ')}; files give the lines ("12-40") your evidence points to.`,
    JSON.stringify(REPORT_SCHEMA),
  ].join('\n');
}

const topArea = (file) => (file.includes('/') ? file.split('/')[0] : '.');

/** The simulated report: derived from the facts, no model. */
function mockReport(model) {
  const top = model.files[0];
  const pair = model.pairs[0];
  const areas = [...new Set(model.files.map((f) => topArea(f.file)))].sort().map((area) => {
    const own = model.files.filter((f) => topArea(f.file) === area);
    return { area, verdict: `Simulated: ${own.length} file(s), ${own.reduce((s, f) => s + f.lines, 0)} lines.` };
  });
  const findings = [];
  if (top) {
    findings.push({
      kind: 'oversized-unit', title: `${top.file} is the top hotspot`, severity: 'low',
      files: [{ path: top.file, lines: `1-${Math.max(1, top.lines)}` }],
      evidence: `${top.lines} lines changed in ${top.commits} commit(s), hotspot rank 1.`,
      refactor: `Simulated: read ${top.file} and move its most-changed part into its own module.`,
    });
  }
  if (pair) {
    findings.push({
      kind: 'missing-abstraction', title: `${pair.a} and ${pair.b} change together`, severity: 'low',
      files: [{ path: pair.a, lines: '1' }, { path: pair.b, lines: '1' }],
      evidence: `${pair.together} commits changed both (${Math.round(pair.share * 100)}% of either file's).`,
      refactor: 'Simulated: find the rule both files repeat and give it one home.',
    });
  }
  return {
    summary: `Simulated analysis, no model was called: ${model.files.length} file(s) in ${model.languages.length} language(s); ${top ? `the top hotspot is ${top.file}` : 'no hotspot'}.`,
    areas,
    findings,
  };
}

/**
 * One analysis: { report, costUsd, tokens, simulated } or { refused } (the Oracle's budget).
 * `oracle`: { oneTurn, budgetRefusal } of packages/engine/domains/oracle/oracle.js; `agent`: the Oracle's { model, effort }.
 * Throws on an invalid answer (its cost is already recorded in the Oracle's usage).
 */
async function analyze({ project, model, mock, oracle, agent, onItem = null }) {
  if (mock) return { report: mockReport(model), costUsd: 0, tokens: {}, simulated: true };
  const refused = oracle.budgetRefusal();
  if (refused) return { refused };
  // a fresh session each time: usage.jsonl reads a null startReason as a resumed one (#280)
  const res = await oracle.oneTurn({ prompt: analysisPrompt({ project, model }), model: agent.model, effort: agent.effort, onItem, startReason: 'architecture' });
  const out = validateReport(res.text);
  if (out.error) throw new Error(out.error);
  return { report: out.report, costUsd: res.costUsd, tokens: res.tokens || {}, simulated: false };
}

// ---------- the saved reports ----------

const projectDir = (root, projectId) => path.join(root, path.basename(String(projectId)));
const isReportFile = (name) => name.endsWith('.json') && name !== SETTINGS_FILE && name !== CITY_PLAN_FILE && name !== FILED_FILE;

/** The saved reports of a project, newest first. */
function listReports(root, projectId) {
  const dir = projectDir(root, projectId);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).filter(isReportFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (saved && saved.report) out.push({ ...saved, id: saved.id || name.slice(0, -5) });
    } catch { /* a broken file is not a report */ }
  }
  return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || String(b.id).localeCompare(String(a.id)));
}

/** Saves a report ({ date, ... }) under its stamp; the saved entry. */
function saveReport(root, projectId, entry) {
  const dir = projectDir(root, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const id = entry.date.replace(/[:.]/g, '-');
  const saved = { ...entry, id, project_id: projectId };
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(saved, null, 2)}\n`);
  return saved;
}

/** The project's Architecture settings ({ exclude: [pattern] }). */
function readSettings(root, projectId) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(projectDir(root, projectId), SETTINGS_FILE), 'utf8'));
    return { exclude: Array.isArray(s.exclude) ? s.exclude.map(String) : [] };
  } catch {
    return { exclude: [] };
  }
}

function writeSettings(root, projectId, settings) {
  const dir = projectDir(root, projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

/** #730: the findings filed as issues, by findingKey: { [key]: { issue, issueUrl, reportId, at } }. */
function readFiled(root, projectId) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(projectDir(root, projectId), FILED_FILE), 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}

/** Records the issue a finding (its findingKey) was filed as; the record. */
function recordFiled(root, projectId, key, filed) {
  const dir = projectDir(root, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const all = { ...readFiled(root, projectId), [key]: filed };
  fs.writeFileSync(path.join(dir, FILED_FILE), `${JSON.stringify(all, null, 2)}\n`);
  return filed;
}

/**
 * The project's city plan (#371): { plan (null: none saved, or unreadable), error (why a saved
 * plan could not be read, naming the file) | null }.
 */
function readPlan(root, projectId) {
  const file = path.join(projectDir(root, projectId), CITY_PLAN_FILE);
  if (!fs.existsSync(file)) return { plan: null, error: null };
  try {
    const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (plan && typeof plan === 'object' && !Array.isArray(plan)) return { plan, error: null };
    return { plan: null, error: `${CITY_PLAN_FILE} is not a JSON object: the plan was not read` };
  } catch (err) {
    return { plan: null, error: `${CITY_PLAN_FILE} could not be read (${err.message}): the plan was not read` };
  }
}

/**
 * Writes the project's city plan (checked by the caller); the plan it replaces moves to
 * city-plan-history/<stamp>.json. Returns { history: the history file name, or null }.
 */
function writePlan(root, projectId, plan, date) {
  const dir = projectDir(root, projectId);
  const file = path.join(dir, CITY_PLAN_FILE);
  fs.mkdirSync(dir, { recursive: true });
  let history = null;
  if (fs.existsSync(file)) {
    const historyDir = path.join(dir, PLAN_HISTORY_DIR);
    fs.mkdirSync(historyDir, { recursive: true });
    const stamp = date.replace(/[:.]/g, '-');
    for (let n = 0; !history || fs.existsSync(path.join(historyDir, history)); n++) history = `${stamp}${n ? `-${n}` : ''}.json`;
    fs.renameSync(file, path.join(historyDir, history));
  }
  fs.writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
  return { history };
}

module.exports = {
  analysisPrompt,
  analyze,
  compareReports,
  estimateCost,
  estimateFromOthers,
  findingKey,
  KINDS,
  listReports,
  mockReport,
  parseAnswer,
  readFiled,
  readPlan,
  readSettings,
  recordFiled,
  REPORT_SCHEMA,
  saveReport,
  SEVERITIES,
  validateReport,
  writePlan,
  writeSettings,
};
