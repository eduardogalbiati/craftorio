// The project map workflow (#372, workflows/analyze-project.yaml since #631): what its machine steps do, read-only
// on the project. The engine's `type: project_map` steps (packages/engine/engine/run/project-map-steps.js) call
// these with the project's folder and the workspace's architecture folder (<workspace>/architecture).
// - facts: the cartographer's inputs: the tracked files (`git ls-files`) counted by folder and by
//   file-name pattern (treeCounts), the manifests (manifestsOf), #371's folder city with its edges
//   between districts (packages/engine/domains/project/architecture-facts.js readCity, no plan) and the plan saved now (a refresh
//   starts from it).
// - validate: #371's validator on the plan answered (a refresh: refreshPlan(current, answered), so
//   ids and the names the owner saw stay), its verdict (CityModel.planVerdict) and a Markdown report
//   with the coverage (before and after on a refresh), the districts added and removed, the problems
//   and the unmatched files.
// - save: the plan written as architecture:savePlan writes it (the replaced one to city-plan-history/).
// - analyze (#381): the Oracle's architecture analysis of the project, run and saved as
//   architecture:analyze runs and saves it (packages/engine/domains/oracle/oracle-architecture.js analyze / saveReport), with the
//   Oracle and its agent the service gives the run; a simulation saves the simulated report.
// The cartographer's turn is the workflow's plan step; #731: drawMap runs it outside the workflow for the
// onboarding's city analysis (one Oracle turn per round, the plan step's prompt and the project-map skill,
// validated with validateMap and saved with saveMap; a simulation saves providers.js's MOCK_CITY_PLAN), and
// analyzeMap adds its cost to the report it saves, so the analysis's estimate covers both turns.

'use strict';

const path = require('path');
const skills = require('../agents/skills');
const arch = require('../oracle/oracle-architecture');
const facts = require('./architecture-facts');
const projects = require('./projects');
const { git } = require('../../engine/worktree');
const { validateSchema } = require('../workspace/json-schema');
const {
  CITY_PLAN_SCHEMA,
  MIN_COVERAGE,
  planDiff,
  planVerdict,
  refreshPlan,
} = require('@multiagent/shared/city-model');

const ROOT_FOLDER = '(root)';
const MANIFESTS = ['build.gradle', 'build.gradle.kts', 'Cargo.toml', 'go.mod', 'package.json', 'pom.xml', 'pyproject.toml'];
// the district edges the cartographer reads, heaviest first
const MAX_EDGES = 200;

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedObject = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => byString(a, b)));
const percent = (share) => `${Math.floor((Number(share) || 0) * 1000) / 10}%`;

// A file name's pattern: `*_<last word>.<ext>` when the name before its first dot has an underscore,
// else `*` and the name from its first dot, else the name itself (Makefile, .gitignore)
function patternOf(name) {
  const dot = name.indexOf('.');
  if (dot <= 0) return name;
  const stem = name.slice(0, dot);
  const rest = name.slice(dot);
  return stem.includes('_') ? `*_${stem.slice(stem.lastIndexOf('_') + 1)}${rest}` : `*${rest}`;
}

/**
 * The tree counted: { folders: { <folder, any depth>: files under it, '(root)': files at the root },
 * patterns: { <file-name pattern>: files } }, keys sorted.
 * @param {string[]} files repository-relative paths with /
 */
function treeCounts(files) {
  const folders = {};
  const patterns = {};
  for (const file of files) {
    const parts = file.split('/');
    const name = parts.pop();
    if (!parts.length) folders[ROOT_FOLDER] = (folders[ROOT_FOLDER] || 0) + 1;
    for (let i = 1; i <= parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      folders[folder] = (folders[folder] || 0) + 1;
    }
    const pattern = patternOf(name);
    patterns[pattern] = (patterns[pattern] || 0) + 1;
  }
  return { folders: sortedObject(folders), patterns: sortedObject(patterns) };
}

/** The manifests among `files`, at any depth, sorted. */
function manifestsOf(files) {
  return files.filter((f) => {
    const name = f.slice(f.lastIndexOf('/') + 1);
    return MANIFESTS.includes(name) || name.endsWith('.csproj');
  }).sort(byString);
}

async function trackedFiles(folder) {
  return String(await git(['ls-files', '-z'], folder)).split('\0').filter(Boolean).sort(byString);
}

// #371's folder city in short: its districts with their size, and the edges between districts
function folderCity(city) {
  const model = city.model;
  const districtOf = new Map(model.buildings.map((b) => [b.path, b.district]));
  let edges = model.edges;
  if (Array.isArray(edges)) {
    const count = new Map();
    for (const e of edges) {
      const from = e.kind === 'file' ? districtOf.get(e.from) : e.from;
      const to = e.kind === 'file' ? districtOf.get(e.to) : e.to;
      if (!from || !to || from === to) continue;
      const key = `${from}\n${to}`;
      count.set(key, (count.get(key) || 0) + 1);
    }
    edges = [...count].map(([key, n]) => ({ from: key.split('\n')[0], to: key.split('\n')[1], count: n }))
      .sort((a, b) => b.count - a.count || byString(a.from, b.from) || byString(a.to, b.to)).slice(0, MAX_EDGES);
  }
  return {
    districts: model.districts.map((d) => ({ id: d.id, zone: d.zone, files: d.files, lines: d.lines })),
    edges,
    edges_not_read: model.edgesNotRead,
  };
}

const notGit = (folder, state) => new Error(state === 'not-git'
  ? `The project folder ${folder} is not a git repository: there is nothing to map.`
  : `The project folder ${folder} has no commit on its default branch: there is nothing to map.`);

/**
 * The facts step: { files, folders, patterns, manifests, folder_city, current_plan }.
 * @param {{ folder: string, archRoot: string, projectId: string }} where
 */
async function mapFacts({ folder, archRoot, projectId }) {
  const exclude = arch.readSettings(archRoot, projectId).exclude;
  const city = await facts.readCity(folder, { exclude });
  if (city.state !== 'ok') throw notGit(folder, city.state);
  const files = await trackedFiles(folder);
  const { plan } = arch.readPlan(archRoot, projectId);
  return { files: files.length, ...treeCounts(files), manifests: manifestsOf(files), folder_city: folderCity(city), current_plan: plan };
}

function reportOf({ verdict, validation, before, diff }) {
  const v = validation;
  const lines = [`**Validation ${verdict.ok ? 'passed' : 'failed'}**: coverage ${percent(v.coverage)} (${v.matched} of ${v.drawn} drawn files match a district; at least ${percent(MIN_COVERAGE)} needed).`];
  if (before) {
    lines.push('', `Refresh of the saved plan: coverage before ${percent(before.coverage)}, after ${percent(v.coverage)}.`);
    lines.push(`Districts added: ${diff.added.join(', ') || 'none'}. Districts removed: ${diff.removed.join(', ') || 'none'}.`);
  }
  if (verdict.problems.length) lines.push('', 'Problems:', ...verdict.problems.map((p) => `- ${p}`));
  if (v.unmatched.length) lines.push('', `Files no district matches (the first ${v.unmatched.length}):`, ...v.unmatched.map((f) => `- ${f}`));
  const notes = [
    [v.emptyDistricts, 'empty districts'], [v.smallDistricts, 'districts under 3 files'], [v.missingPaths, 'landmark and port paths not in the repository'],
  ].filter(([xs]) => xs.length).map(([xs, what]) => `- ${what}: ${xs.join(', ')}`);
  if (notes.length) lines.push('', 'Notes (they do not fail the plan):', ...notes);
  return lines.join('\n');
}

/**
 * The validate step: the plan to save (a refresh keeps the saved plan's ids and names), its
 * validation and verdict: { ok, problems, plan, refresh, coverage, coverage_before, added, removed,
 * unmatched, validation, report }.
 * @param {{ folder: string, archRoot: string, projectId: string, proposed: any }} where
 */
async function validateMap({ folder, archRoot, projectId, proposed }) {
  const exclude = arch.readSettings(archRoot, projectId).exclude;
  const { plan: current } = arch.readPlan(archRoot, projectId);
  const plan = current ? refreshPlan(current, proposed) : proposed;
  const city = await facts.readCity(folder, { exclude, plan });
  if (city.state !== 'ok') throw notGit(folder, city.state);
  const { validation } = city;
  const verdict = planVerdict(validation);
  const before = current ? (await facts.readCity(folder, { exclude, plan: current })).validation : null;
  const diff = current ? planDiff(current, plan) : { added: [], removed: [] };
  return {
    ok: verdict.ok,
    problems: verdict.problems,
    plan,
    refresh: !!current,
    coverage: validation.coverage,
    coverage_before: before ? before.coverage : null,
    added: diff.added,
    removed: diff.removed,
    unmatched: validation.unmatched,
    validation,
    report: reportOf({ verdict, validation, before, diff }),
  };
}

/**
 * The save step: the plan written as architecture:savePlan writes it → { history } (the replaced
 * plan's file name in city-plan-history/, or null).
 * @param {{ archRoot: string, projectId: string, plan: any }} where
 */
function saveMap({ archRoot, projectId, plan }) {
  const errors = validateSchema(plan, CITY_PLAN_SCHEMA, 'plan');
  if (errors.length) throw new Error(`Invalid city plan: ${errors.slice(0, 5).join('; ')}`);
  return arch.writePlan(archRoot, projectId, plan, new Date().toISOString());
}

// The project's record (its name for the prompts), or its id when the record is missing
function projectOf(archRoot, projectId) {
  try { return projects.readProject(path.join(path.dirname(archRoot), 'projects'), projectId); } catch { return { id: projectId, name: projectId }; }
}

// #731: the project-map skill the workflow's cartographer follows, the workspace's copy first, then the
// app's bundled one (`skillsDirs`, as chain.js resolves a step's skills); '' when none has it
function mapSkill(skillsDirs) {
  try {
    return skills.skillPrompt(skills.resolveSkill(Array.isArray(skillsDirs) ? skillsDirs : [], 'project-map'));
  } catch { return ''; }
}

/**
 * #731: the cartographer's prompt outside the workflow. KEEP IN STEP with the plan step's prompt of
 * workflows/analyze-project.yaml (same facts, refresh and new-round paragraphs, same closing line), with
 * the facts step's output and, on a new round, the validator's report and the refused plan. The Oracle's
 * turn has no file tools and runs outside the repository: it reads with repo_read / repo_git and the
 * project's id, as the Oracle's analysis does (oracle-architecture.js analysisPrompt).
 */
function planPrompt(f, { project = null, previous = null, report = '', round = 0, skill = '' } = {}) {
  const json = (x) => JSON.stringify(x ?? null);
  const p = project || { id: '', name: '' };
  const lines = [
    `Write the city plan of the project "${p.name || p.id}" (projectId "${p.id}"), following the project-map skill below.`,
    `Read its manifests, the README, the agent instructions and the entry points it names before you write, with your read-only tools (repo_read, repo_git with projectId "${p.id}"); never edit a file.`,
    '',
    'The facts (counted from `git ls-files`, no model):',
    `- tracked files: ${f.files}`,
    `- manifests: ${(f.manifests || []).join(', ') || 'none'}`,
    '- files per folder (any depth, `(root)` = the files at the root):',
    json(f.folders),
    '- files per file-name pattern:',
    json(f.patterns),
    '- the folder city (districts by folder, with their files and lines) and the edges between its districts:',
    json(f.folder_city),
  ];
  if (f.current_plan) {
    lines.push('', 'This is a REFRESH. The current plan, which the owner has seen:', json(f.current_plan),
      'Start from it: keep every zone and district id and name, change only the rules (include, exclude, ignore) and add districts for what the rules miss.');
  }
  if (previous || report) {
    lines.push('', `Your previous plan failed the validation (round ${round}):`, report);
    if (previous) lines.push('', 'Your previous plan:', json(previous));
    lines.push('Fix the rules so that the problems above go away; do not add a catch-all district.');
  }
  lines.push('', 'Answer with the plan as `city_plan` in one ```json block, in the format of the project-map skill.');
  if (skill) lines.push('', skill);
  return lines.join('\n');
}

/**
 * #731: the cartographer's turn outside the workflow (the onboarding's city analysis): the facts, the plan
 * asked of the Oracle's model (one turn per round, the validator's report on the next round), validated
 * and saved → { cost_usd (the rounds' sum, null when none reported one), tokens, coverage, history,
 * rounds, simulated }. A simulation (`mock`) saves providers.js's MOCK_CITY_PLAN. Throws when the Oracle
 * refuses (`refused`) or the plan still fails the validation after `rounds` rounds, with the problems.
 * `skillsDirs`: where the project-map skill is looked up, the workspace's skills first, then the bundled ones.
 * @param {{ folder: string, archRoot: string, projectId: string, mock: boolean, oracle: any, agent: any, rounds?: number, skillsDirs?: string[] }} where
 */
async function drawMap({ folder, archRoot, projectId, mock, oracle, agent, rounds = 2, skillsDirs = [] }) {
  if (!mock && !oracle) throw new Error('The Oracle is not available to this run: the city plan needs the app service.');
  const f = await mapFacts({ folder, archRoot, projectId });
  const project = projectOf(archRoot, projectId);
  const skill = mock ? '' : mapSkill(skillsDirs);
  let cost = null;
  const tokens = { input: 0, output: 0 };
  let previous = null;
  let v = null;
  for (let round = 1; round <= Math.max(1, rounds); round++) {
    let proposed;
    if (mock) {
      proposed = require('../../engine/providers').MOCK_CITY_PLAN;
    } else {
      const refused = oracle.budgetRefusal();
      if (refused) throw Object.assign(new Error(`The Oracle refused the city plan: ${refused.text}`), { refused: true });
      const res = await oracle.oneTurn({ prompt: planPrompt(f, { project, previous, report: v?.report, round: round - 1, skill }), model: agent?.model, effort: agent?.effort, startReason: 'architecture' });
      if (res.costUsd != null && Number.isFinite(Number(res.costUsd))) cost = (cost || 0) + Number(res.costUsd);
      tokens.input += Number(res.tokens?.input) || 0;
      tokens.output += Number(res.tokens?.output) || 0;
      let answer;
      try { answer = arch.parseAnswer(res.text); } catch { answer = null; }
      proposed = answer?.city_plan;
      if (!proposed || typeof proposed !== 'object') {
        if (round < rounds) { previous = null; v = { report: 'Your answer had no `city_plan` object in a ```json block.' }; continue; }
        throw new Error('The cartographer answered no city plan (no `city_plan` object in a ```json block).');
      }
    }
    v = await validateMap({ folder, archRoot, projectId, proposed });
    if (v.ok) {
      const saved = saveMap({ archRoot, projectId, plan: v.plan });
      return { cost_usd: cost, coverage: v.coverage, history: saved?.history ?? null, rounds: round, simulated: !!mock, tokens };
    }
    if (mock) break;
    previous = proposed;
  }
  throw new Error(`The city plan did not pass the validation: ${(v?.problems || []).join('; ') || 'no problem named'}`);
}

/**
 * The analyze step (#381): the Oracle's architecture analysis of the project, saved as
 * architecture:analyze saves it → { report_id, date, findings, summary, cost_usd, simulated }.
 * `oracle` / `agent`: the service's Oracle ({ oneTurn, budgetRefusal }) and its agent; a simulation
 * (`mock`) needs neither and saves the simulated report; a real run without them fails, as does one
 * the Oracle refuses (its budget), with the reason.
 * #731: `planCostUsd` / `planTokens`, the cartographer's turn run just before (drawMap), are added to the
 * saved report's cost, so the analysis's estimate (arch.estimateCost) covers both turns.
 * @param {{ folder: string, archRoot: string, projectId: string, mock: boolean, oracle: any, agent: any, onItem?: Function, planCostUsd?: number|null, planTokens?: any }} where
 */
async function analyzeMap({ folder, archRoot, projectId, mock, oracle, agent, onItem = null, planCostUsd = null, planTokens = null }) {
  if (!mock && !oracle) throw new Error('The Oracle is not available to this run: the analysis needs the app service.');
  const exclude = arch.readSettings(archRoot, projectId).exclude;
  const { state, model } = await facts.readFacts(folder, { exclude });
  if (state !== 'ok') throw notGit(folder, state);
  const project = projectOf(archRoot, projectId);
  const out = await arch.analyze({ project, model, mock: !!mock, oracle, agent, onItem });
  if (out.refused) throw new Error(`The Oracle refused the analysis: ${out.refused.text}`);
  const date = new Date().toISOString();
  const plan = !out.simulated && planCostUsd != null && Number.isFinite(Number(planCostUsd)) ? Number(planCostUsd) : null;
  const costUsd = plan == null ? out.costUsd : (out.costUsd == null ? null : Number(out.costUsd) + plan);
  const tokens = !out.simulated && planTokens ? { ...out.tokens, input: (Number(out.tokens?.input) || 0) + (Number(planTokens.input) || 0), output: (Number(out.tokens?.output) || 0) + (Number(planTokens.output) || 0) } : out.tokens;
  const saved = arch.saveReport(archRoot, projectId, { date, head: model.head, branch: model.branch, costUsd, tokens, simulated: out.simulated, report: out.report });
  return { cost_usd: costUsd, date, findings: (out.report.findings || []).length, report_id: saved.id, simulated: out.simulated, summary: out.report.summary };
}

module.exports = {
  analyzeMap,
  drawMap,
  manifestsOf,
  mapFacts,
  planPrompt,
  saveMap,
  treeCounts,
  validateMap,
};
