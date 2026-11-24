// A repository's workflows manifest (#485): `.craftorio/project.yaml`, committed by the project's
// owner next to `.craftorio/local-preview.yaml` (packages/engine/domains/local/local-preview.js). It lists the workflows the
// project is worked on with: `{ name }` for a bundled or workspace workflow, `{ name, file:
// workflows/<x>.yaml }` for the repository's own copy under `.craftorio/workflows/`, each with an
// optional `category` (intake, solo, team, release, or a bundled one) and `description`; `version`
// and `requires` (the app versions it needs, e.g. `>=1.2`). Pure: parsing and checks only. What the
// repository's files may do (accepted per commit, capped) is packages/engine/engine/run/load.js's
// loadRepositoryWorkflow; the listing and the acceptance are packages/engine/service/areas/workflows.js's.
// #790: an optional `default: <name>`, the project's default development workflow (a clone takes it);
// #791: an optional `kinds` map, the workflow and inputs of each kind of work (`feature: { name }`,
// `fix: { name: fix, mode: remote }`: every key but `name` is an input; only `feature` and `fix`, a
// refactor uses the feature entry). Both must name one of the manifest's `workflows`, an entry with a
// `file` named after that file: another name is an error naming it, and that value is ignored
// (`default` null, the kind left out), as the other manifest problems are. Any error voids the whole
// manifest: no workflows, so no default and no kinds either.
// #568: an optional `triggers:` list, the platform events that start one of the manifest's workflows
// (packages/engine/domains/triggers/triggers.js validateTriggers). A refused rule is a `triggerErrors`
// entry (and a `refusedTriggers` one, for the project screen) and is ignored: it never voids the manifest
// and never enters `errors`; a manifest voided by its errors has no triggers.
// #46: an optional `products:` list, what the repository releases apart from each other: `{ id, folder,
// tag_prefix, version_command, paths? }` (folder: where its package.json or pyproject.toml is; tag_prefix:
// its tag is the prefix and the version; version_command: writes its version and changelog, commits
// nothing; paths: its other folders). A problem of a product is in `errors` like any other and in
// `productErrors`: the release run stops on it, never releasing the repository as one without products.
// The other errors do not void the products: they say nothing about the workflows.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { compareSemver } = require('../releases/semver');
const { WORKFLOW_CATEGORIES } = require('../workflow/workflow-categories');
const {
  LEGACY_PROJECT_DIR,
  projectDirName,
  projectFiles,
} = require('@craftorio/shared/project-dir');

const MANIFEST_FILE = '.craftorio/project.yaml';
// T2c: a repository set up before the rename to Craftorio keeps its manifest here
const LEGACY_MANIFEST_FILE = `${LEGACY_PROJECT_DIR}/project.yaml`;
// the project's folder of Craftorio files on disk: .craftorio, or .multiagent when only that one exists
const projectDirOf = (folder) => projectDirName((name) => fs.existsSync(path.join(String(folder), name)));

// The Workflows screen's sections a repository files its workflows under
// (#630: feature and fix, the composed set's)
const CATEGORIES = ['intake', 'solo', 'team', 'feature', 'fix', 'release'];
// the bundled workflows' own metadata.category values
const BUNDLED_CATEGORIES = WORKFLOW_CATEGORIES;

// a repository's own workflow: one YAML file right under .craftorio/workflows/
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
    errors.push(`${at}: file "${entry.file}" must be a .yaml file right under .craftorio/workflows/ (workflows/<name>.yaml).`);
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

// #791: the kinds a manifest may map (packages/shared/default-workflow.js KIND_ENTRIES; a refactor uses the Feature entry)
const { KIND_ENTRIES, label } = require('@craftorio/shared/default-workflow');
const EMPTY = () => ({ version: null, requires: null, workflows: [], default: null, kinds: {}, errors: [], products: [], productErrors: [], triggers: [], triggerErrors: [], refusedTriggers: [] });
const { validateTriggers } = require('../triggers/triggers');

// #46: a folder of the repository as a relative path with /, or null when it is outside it
function repoFolder(v) {
  const given = str(v)?.replace(/\\/g, '/');
  if (!given || given.startsWith('/') || /^[a-z]:/i.test(given)) return null;
  const folder = path.posix.normalize(given).replace(/\/$/, '');
  return folder.split('/').includes('..') ? null : folder;
}

// #46: one product -> { id, folder, tag_prefix, version_command, paths } or the reasons it is refused
function parseProduct(entry, i) {
  const at = `products[${i}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { errors: [`${at}: a product is { id, folder, tag_prefix, version_command, paths? }.`] };
  const errors = [];
  const id = str(entry.id);
  if (!id) errors.push(`${at}: a product needs an id.`);
  const folder = repoFolder(entry.folder ?? '.');
  if (!folder) errors.push(`${at}: the product's folder "${entry.folder}" must be a folder of the repository (a relative path).`);
  const command = str(entry.version_command);
  if (!command) errors.push(`${at}: a product needs a version_command (it writes the product's version and changelog).`);
  const prefix = str(entry.tag_prefix) ?? '';
  if (!/^[\w./@-]*$/.test(prefix) || /^[-./]|\.\.|\/\/|@\{/.test(prefix)) errors.push(`${at}: the product's tag_prefix "${prefix}" cannot start a git tag.`);
  const paths = entry.paths == null ? [] : [].concat(entry.paths).map(repoFolder);
  if (paths.includes(null)) errors.push(`${at}: the product's paths must be folders of the repository (relative paths).`);
  return { errors, product: { id, folder, tag_prefix: prefix, version_command: command, paths } };
}

// #46: the manifest's products, none when one of them has a problem (added to `errors`)
function parseProducts(doc, errors) {
  if (doc.products == null) return [];
  if (!Array.isArray(doc.products)) {
    errors.push('products must be a list of { id, folder, tag_prefix, version_command, paths? }.');
    return [];
  }
  const list = [];
  for (const [i, entry] of doc.products.entries()) {
    const { errors: refused, product } = parseProduct(entry, i);
    errors.push(...refused);
    if (!product) continue;
    if (product.id && list.some((p) => p.id === product.id)) errors.push(`product "${product.id}" is declared twice.`);
    const same = list.find((p) => p.tag_prefix === product.tag_prefix);
    if (same) errors.push(`products "${same.id}" and "${product.id}" have the same tag_prefix "${product.tag_prefix}": their tags would be the same.`);
    list.push(product);
  }
  return errors.length ? [] : list;
}

// #568: the manifest's triggers, checked against its own workflows' names
function parseTriggers(doc, list) {
  const { triggers, problems, refused } = validateTriggers(doc.triggers, { workflows: list.map((w) => w.name).filter(Boolean) });
  return { triggers, triggerErrors: problems.map((p) => `${MANIFEST_FILE}: ${p}`), refusedTriggers: refused };
}

// #790, #791: the file of a listed workflow whose file has another name than the entry, or null: the
// listing and the default's resolution go by the file's name, so a default or a kind naming that entry
// would fall back to another workflow without a word
function otherFile(name, list) {
  const file = list.find((w) => w.name === name)?.file;
  return file && label(path.posix.basename(file)) !== label(name) ? file : null;
}
const otherFileError = (what, name, file) => `${MANIFEST_FILE}: ${what} names "${name}", whose file is ${file}: name the entry after its file.`;

// #790: the manifest's `default`, one of its workflows (`list`), else null with the error
function parseDefault(doc, list, errors) {
  const name = str(doc.default);
  if (name == null) return null;
  if (!list.some((w) => w.name === name)) {
    errors.push(`${MANIFEST_FILE}: default "${name}" is not one of the manifest's workflows.`);
    return null;
  }
  const file = otherFile(name, list);
  if (!file) return name;
  errors.push(otherFileError('default', name, file));
  return null;
}

// #791: the manifest's `kinds` → { <kind>: { name, inputs } }, an entry it cannot use left out with its error
function parseKinds(doc, list, errors) {
  const out = {};
  const kinds = doc.kinds;
  if (kinds == null) return out;
  if (typeof kinds !== 'object' || Array.isArray(kinds)) {
    errors.push(`${MANIFEST_FILE}: kinds must be a mapping of ${KIND_ENTRIES.join(' / ')} to { name, <inputs> }.`);
    return out;
  }
  for (const key of Object.keys(kinds).filter((k) => !KIND_ENTRIES.includes(k))) {
    errors.push(`${MANIFEST_FILE}: kinds.${key} is not a kind of the map (${KIND_ENTRIES.join(' / ')}; a refactor uses the feature entry).`);
  }
  for (const kind of KIND_ENTRIES) {
    const v = kinds[kind];
    if (v == null) continue;
    const given = typeof v === 'string' ? { name: v } : v;
    const name = given && typeof given === 'object' && !Array.isArray(given) ? str(given.name) : null;
    if (!name) { errors.push(`${MANIFEST_FILE}: kinds.${kind} needs a name (one of the manifest's workflows).`); continue; }
    if (!list.some((w) => w.name === name)) { errors.push(`${MANIFEST_FILE}: kinds.${kind} names "${name}", not one of the manifest's workflows.`); continue; }
    const file = otherFile(name, list);
    if (file) { errors.push(otherFileError(`kinds.${kind}`, name, file)); continue; }
    const { name: _n, ...inputs } = given;
    out[kind] = { name, inputs };
  }
  return out;
}

/**
 * Parses a manifest's text. A manifest with errors declares no workflows, default or kinds: the
 * project runs on the workspace's workflows as without one.
 * @returns {{ version: *, requires: string|null, workflows: object[], default: string|null, kinds: object, errors: string[], products: object[], productErrors: string[] }}
 */
function parseManifest(text, { appVersion } = {}) {
  const out = EMPTY();
  let doc;
  try { doc = yaml.load(String(text ?? '')); } catch (e) {
    out.errors.push(`${MANIFEST_FILE}: not valid YAML (${e.reason || e.message}).`);
    // #46: what it declares cannot be read: a release run stops rather than take it as no products
    if (/^products\s*:/m.test(String(text))) out.productErrors.push(...out.errors);
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
  out.products = parseProducts(doc, out.productErrors);
  out.productErrors = out.productErrors.map((e) => `${MANIFEST_FILE}: ${e}`);
  out.errors.push(...out.productErrors);
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
  out.default = parseDefault(doc, list, out.errors);
  out.kinds = parseKinds(doc, list, out.errors);
  return out.errors.length ? { ...out, workflows: [], default: null, kinds: {} } : { ...out, workflows: list, ...parseTriggers(doc, list) };
}

/** The manifest of a project's folder; none: no workflows, no default, no kinds and no error. */
function readManifest(projectDir, opts = {}) {
  let text;
  let from;
  for (const rel of projectFiles('project.yaml')) {
    try { text = fs.readFileSync(path.join(projectDir, ...rel.split('/')), 'utf8'); from = rel; break; } catch { /* the next one */ }
  }
  if (text == null) return EMPTY();
  const out = parseManifest(text, opts);
  if (from === MANIFEST_FILE) return out;
  // T2c: the old folder's file, named as it is in the messages
  const named = (list) => (list || []).map((e) => (e.startsWith(MANIFEST_FILE) ? from + e.slice(MANIFEST_FILE.length) : e));
  return { ...out, errors: named(out.errors), productErrors: named(out.productErrors), ...(out.triggerErrors ? { triggerErrors: named(out.triggerErrors) } : {}) };
}

module.exports = {
  BUNDLED_CATEGORIES,
  CATEGORIES,
  LEGACY_MANIFEST_FILE,
  MANIFEST_FILE,
  parseManifest,
  projectDirOf,
  readManifest,
  requiresProblem,
  satisfies,
};
