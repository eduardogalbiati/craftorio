// The project map workflow (#372, workflows/project-map.yaml): what its machine steps do, read-only
// on the project. The engine's `type: project_map` steps (src/engine/run/project-map-steps.js) call
// these with the project's folder and the workspace's architecture folder (<workspace>/architecture).
// - facts: the cartographer's inputs: the tracked files (`git ls-files`) counted by folder and by
//   file-name pattern (treeCounts), the manifests (manifestsOf), #371's folder city with its edges
//   between districts (src/architecture-facts.js readCity, no plan) and the plan saved now (a refresh
//   starts from it).
// - validate: #371's validator on the plan answered (a refresh: refreshPlan(current, answered), so
//   ids and the names the owner saw stay), its verdict (CityModel.planVerdict) and a Markdown report
//   with the coverage (before and after on a refresh), the districts added and removed, the problems
//   and the unmatched files.
// - save: the plan written as architecture:savePlan writes it (the replaced one to city-plan-history/).
// No model call anywhere: the cartographer's turn is the workflow's plan step.

'use strict';

const arch = require('./oracle-architecture');
const facts = require('./architecture-facts');
const { git } = require('./engine/worktree');
const { validateSchema } = require('./json-schema');
const {
  CITY_PLAN_SCHEMA,
  MIN_COVERAGE,
  planDiff,
  planVerdict,
  refreshPlan,
} = require('./shared/city-model');

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

module.exports = {
  manifestsOf,
  mapFacts,
  saveMap,
  treeCounts,
  validateMap,
};
