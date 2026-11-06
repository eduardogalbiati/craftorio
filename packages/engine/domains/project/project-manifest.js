// A repository's workflows manifest (#485): `.multiagent/project.yaml`, committed by the project's
// owner next to `.multiagent/local-preview.yaml` (packages/engine/domains/local/local-preview.js). It lists the workflows the
// project is worked on with: `{ name }` for a bundled or workspace workflow, `{ name, file:
// workflows/<x>.yaml }` for the repository's own copy under `.multiagent/workflows/`, each with an
// optional `category` (intake, solo, team, release, or a bundled one) and `description`; `version`
// and `requires` (the app versions it needs, e.g. `>=1.2`). Pure: parsing and checks only. What the
// repository's files may do (accepted per commit, capped) is packages/engine/engine/run/load.js's
// loadRepositoryWorkflow; the listing and the acceptance are packages/engine/service/areas/workflows.js's.
// #790: an optional `default: <name>`, the project's default development workflow (a clone takes it);
// #791: an optional `kinds` map, the workflow and inputs of each kind of work (`feature: { name }`,
// `fix: { name: fix, mode: remote }`: every key but `name` is an input). Both must name one of the
// manifest's `workflows`: another name is an error naming it, and that value is ignored (`default`
// null, the kind left out), as the other manifest problems are. Any error voids the whole manifest:
// no workflows, so no default and no kinds either.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { WORKFLOW_CATEGORIES } = require('../workflow/workflow-categories');

const MANIFEST_FILE = '.multiagent/project.yaml';

// The Workflows screen's sections a repository files its workflows under
// (#630: feature and fix, the composed set's)
const CATEGORIES = ['intake', 'solo', 'team', 'feature', 'fix', 'release'];
// the bundled workflows' own metadata.category values
const BUNDLED_CATEGORIES = WORKFLOW_CATEGORIES;

// a repository's own workflow: one YAML file right under .multiagent/workflows/
const REPO_FILE = /^workflows\/[^/\\]+\.ya?ml$/i;

// '1.2' -> '1.2.0' (the parts a range leaves out are 0), a leading `v` and a pre-release dropped
const fullVersion = (v) => {
  const parts = String(v).trim().replace(/^v/i, '').split(/[-+]/)[0].split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).map((p) => String(Number(p) || 0)).join('.');
};

// Whether the app version satisfies a range of space-separated comparators (`>=1.2 <2`, `1.4.0`);
// null when the range cannot be read.
function satisfies(appVersion, range) {
  const { compareSemver } = require('../releases/releases');
  const comparators = String(range).trim().split(/\s+/).filter(Boolean);
  if (!comparators.length) return null;
  const app = fullVersion(appVersion);
  for (const c of comparators) {
    const m = /^(>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2})$/.exec(c);
    if (!m) return null;
    const d = compareSemver(app, fullVersion(m[2]));
    const ok = { '>=': d >= 0, '<=': d <= 0, '>': d > 0, '<': d < 0, '=': d === 0 }[m[1] || '='];
    if (!ok) return false;
  }
  return true;
}

const str = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

// One manifest entry -> { name, file, category, description } or the reasons it is refused
function parseEntry(entry, i) {
  const at = `workflows[${i}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { errors: [`${at}: an entry is { name, file?, category?, description? }.`] };
  const errors = [];
  const name = str(entry.name);
  if (!name) errors.push(`${at}: an entry needs a name.`);
  const file = str(entry.file)?.replace(/\\/g, '/') ?? null;
  if (file != null && (!REPO_FILE.test(file) || file.split('/').includes('..'))) {
    errors.push(`${at}: file "${entry.file}" must be a .yaml file right under .multiagent/workflows/ (workflows/<name>.yaml).`);
  }
  const category = str(entry.category);
  if (category && !CATEGORIES.includes(category) && !BUNDLED_CATEGORIES.includes(category)) {
    errors.push(`${at}: unknown category "${category}" (one of ${[...CATEGORIES, ...BUNDLED_CATEGORIES].join(', ')}).`);
  }
  return { errors, workflow: { name, file, category, description: str(entry.description) } };
}

/**
 * Why a `requires` range shuts this app out (the manifest's, or an imported workflow's, #488);
 * null when it is absent or satisfied.
 */
function requiresProblem(appVersion, range) {
  if (!range) return null;
  const ok = satisfies(appVersion, range);
  if (ok === null) return `requires "${range}" is not a version range (e.g. >=1.2).`;
  return ok ? null : `requires app version ${range}, this app is ${appVersion}.`;
}

// #791: the kinds a manifest may map (packages/shared/default-workflow.js KINDS; refactor uses the Feature entry)
const { KINDS } = require('@multiagent/shared/default-workflow');
const EMPTY = () => ({ version: null, requires: null, workflows: [], default: null, kinds: {}, errors: [] });

// #790: the manifest's `default`, one of its workflows (`seen`), else null with the error
function parseDefault(doc, seen, errors) {
  const name = str(doc.default);
  if (name == null) return null;
  if (seen.has(name)) return name;
  errors.push(`${MANIFEST_FILE}: default "${name}" is not one of the manifest's workflows.`);
  return null;
}

// #791: the manifest's `kinds` → { <kind>: { name, inputs } }, an entry naming an unknown workflow left out with its error
function parseKinds(doc, seen, errors) {
  const out = {};
  const kinds = doc.kinds;
  if (kinds == null) return out;
  if (typeof kinds !== 'object' || Array.isArray(kinds)) {
    errors.push(`${MANIFEST_FILE}: kinds must be a mapping of ${KINDS.join(' / ')} to { name, <inputs> }.`);
    return out;
  }
  for (const kind of KINDS) {
    const v = kinds[kind];
    if (v == null) continue;
    const given = typeof v === 'string' ? { name: v } : v;
    const name = given && typeof given === 'object' && !Array.isArray(given) ? str(given.name) : null;
    if (!name) { errors.push(`${MANIFEST_FILE}: kinds.${kind} needs a name (one of the manifest's workflows).`); continue; }
    if (!seen.has(name)) { errors.push(`${MANIFEST_FILE}: kinds.${kind} names "${name}", not one of the manifest's workflows.`); continue; }
    const { name: _n, ...inputs } = given;
    out[kind] = { name, inputs };
  }
  return out;
}

/**
 * Parses a manifest's text. A manifest with errors declares no workflows, default or kinds: the
 * project runs on the workspace's workflows as without one.
 * @returns {{ version: *, requires: string|null, workflows: object[], default: string|null, kinds: object, errors: string[] }}
 */
function parseManifest(text, { appVersion } = {}) {
  const out = EMPTY();
  let doc;
  try { doc = yaml.load(String(text ?? '')); } catch (e) {
    out.errors.push(`${MANIFEST_FILE}: not valid YAML (${e.reason || e.message}).`);
    return out;
  }
  if (doc == null) return out;
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    out.errors.push(`${MANIFEST_FILE}: expected a mapping with version, requires and workflows.`);
    return out;
  }
  out.version = doc.version ?? null;
  out.requires = str(doc.requires);
  const problem = appVersion ? requiresProblem(appVersion, out.requires) : null;
  if (problem) out.errors.push(`${MANIFEST_FILE}: ${problem}`);
  if (doc.workflows != null && !Array.isArray(doc.workflows)) {
    out.errors.push(`${MANIFEST_FILE}: workflows must be a list of { name, file?, category? }.`);
    return { ...out, workflows: [] };
  }
  const list = [];
  const seen = new Set();
  for (const [i, entry] of (doc.workflows || []).entries()) {
    const { errors, workflow } = parseEntry(entry, i);
    out.errors.push(...errors.map((e) => `${MANIFEST_FILE}: ${e}`));
    if (!workflow) continue;
    if (workflow.name && seen.has(workflow.name)) out.errors.push(`${MANIFEST_FILE}: workflow "${workflow.name}" is declared twice.`);
    if (workflow.name) seen.add(workflow.name);
    list.push(workflow);
  }
  // #790, #791: the default and the kinds, each checked against the names above; a wrong name drops
  // that value and counts as a manifest error like any other
  out.default = parseDefault(doc, seen, out.errors);
  out.kinds = parseKinds(doc, seen, out.errors);
  return out.errors.length ? { ...out, workflows: [], default: null, kinds: {} } : { ...out, workflows: list };
}

/** The manifest of a project's folder; none: no workflows, no default, no kinds and no error. */
function readManifest(projectDir, opts = {}) {
  let text;
  try { text = fs.readFileSync(path.join(projectDir, ...MANIFEST_FILE.split('/')), 'utf8'); } catch {
    return EMPTY();
  }
  return parseManifest(text, opts);
}

module.exports = {
  BUNDLED_CATEGORIES,
  CATEGORIES,
  MANIFEST_FILE,
  parseManifest,
  readManifest,
  requiresProblem,
  satisfies,
};
