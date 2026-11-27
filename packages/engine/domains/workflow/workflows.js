// Workflows: one YAML file per workflow in <workspace>/workflows. The app folder only holds the
// bundled defaults (workflows/*.yaml), which are seeded into the workspace like the skills
// (packages/engine/domains/seed/seed.js): copied once, untouched copies updated by new app versions, edited copies kept
// ("a newer default exists"), user-created and deleted files left alone.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const yaml = require('js-yaml');
const { seedBundle, bundleStatus, restoreBundled } = require('../seed/seed');
const { projectDirOf, readManifest } = require('../project/project-manifest');
const { bundledDir } = require('../workspace/app-root');
const { aliasOf } = require('@craftorio/shared/default-workflow');

const BUNDLED_WORKFLOWS_DIR = bundledDir('workflows');
const isWorkflowFile = (f) => /\.ya?ml$/i.test(f);
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// The `default:` lines of a workflow's top-level `inputs:` (#203), as text: { input: { start, end,
// value } } (line indexes, end exclusive; value = the text after `default:` plus a block scalar's
// lines). Read as text, not parsed, so the file's comments and layout stay as they are.
function inputDefaults(lines) {
  const out = {};
  const start = lines.findIndex((l) => /^inputs:\s*(#.*)?$/.test(l));
  if (start < 0) return out;
  let input = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && !/^#/.test(l)) break; // the next top-level key
    const key = /^ {2}([A-Za-z0-9_]+):\s*(#.*)?$/.exec(l);
    if (key) { input = key[1]; continue; }
    const def = input && /^ {4}default:(.*)$/.exec(l);
    if (!def) continue;
    let end = i + 1;
    // a block scalar (default: |) goes on with its deeper lines
    if (/^\s*[|>][-+]?\s*$/.test(def[1])) while (end < lines.length && (/^ {5,}/.test(lines[end]) || !lines[end].trim())) end++;
    out[input] = { start: i, end, value: [def[1], ...lines.slice(i + 1, end)].join('\n') };
  }
  return out;
}

const readLines = (dir, id) => fs.readFileSync(path.join(dir, id), 'utf8').split('\n');

const WORKFLOW_KIND = {
  list: (dir) => fs.readdirSync(dir).filter((f) => isWorkflowFile(f) && isFile(path.join(dir, f))).sort(),
  exists: (dir, id) => isFile(path.join(dir, id)),
  hash: (dir, id) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, id))).digest('hex'),
  copy: (srcDir, destDir, id) => fs.writeFileSync(path.join(destDir, id), fs.readFileSync(path.join(srcDir, id))),
  remove: (dir, id) => fs.rmSync(path.join(dir, id), { force: true }),
  // #203: a copy changed only in its inputs' defaults is not "frozen" (packages/engine/domains/seed/seed.js): the hash
  // without the default values, and the new version written with the user's values
  baseHash: (dir, id) => {
    const lines = readLines(dir, id);
    const defs = inputDefaults(lines);
    for (const d of Object.values(defs).sort((a, b) => b.start - a.start)) lines.splice(d.start, d.end - d.start, '    default: <default>');
    return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
  },
  carryOver: (srcDir, destDir, id) => {
    const lines = readLines(srcDir, id);
    const src = inputDefaults(lines);
    const mine = inputDefaults(readLines(destDir, id));
    // an input whose default line the new version no longer has: nothing safe to write
    if (Object.keys(mine).some((k) => !src[k])) return false;
    for (const [k, d] of Object.entries(src).sort((a, b) => b[1].start - a[1].start)) {
      if (mine[k] && mine[k].value !== d.value) lines.splice(d.start, d.end - d.start, ...`    default:${mine[k].value}`.split('\n'));
    }
    fs.writeFileSync(path.join(destDir, id), lines.join('\n'));
    return true;
  },
};

/** Copies/updates the bundled workflows into the workspace folder. Returns the files copied or updated. */
const seedWorkflows = (srcDir, destDir) => seedBundle(srcDir, destDir, WORKFLOW_KIND);

/** { [file]: { origin: 'default'|'modified'|'custom', updateAvailable, restorable } } for the workspace folder. */
const workflowStatus = (srcDir, destDir) => bundleStatus(srcDir, destDir, WORKFLOW_KIND);

/** Replaces the user's copy of a bundled workflow with the default. */
const restoreWorkflow = (srcDir, destDir, file) => restoreBundled(srcDir, destDir, WORKFLOW_KIND, path.basename(String(file || '')));

// the ids of the human_approval steps of a parsed workflow, nested steps (parallel, loops) included
function gateIds(node, out = new Set()) {
  if (Array.isArray(node)) for (const v of node) gateIds(v, out);
  else if (node && typeof node === 'object') {
    if (node.type === 'human_approval' && node.id != null) out.add(String(node.id));
    for (const v of Object.values(node)) gateIds(v, out);
  }
  return out;
}

/**
 * The human gates (human_approval step ids) the workspace copy of a bundled workflow has and its
 * default lacks: what a restore would remove (#399, the control channel refuses it). A copy that
 * cannot be read or parsed has none to keep.
 */
function addedGates(srcDir, destDir, file) {
  const name = path.basename(String(file || ''));
  const read = (dir) => { try { return yaml.load(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return null; } };
  const bundled = gateIds(read(srcDir));
  return [...gateIds(read(destDir))].filter((id) => !bundled.has(id));
}

/**
 * Finds a workflow file. Absolute paths are used as they are; a name or relative path is looked up
 * in the folders in order (workspace first, then the bundled defaults).
 * #485: with `repo` (a checkout of the project), a workflow its .craftorio/project.yaml declares
 * with a `file` wins (origin 'repository'), then the folders; a malformed manifest is ignored.
 * @returns {{ file: string, dir: string|null, fallback: boolean, origin?: string, entry?: object }}
 *   fallback: found only in a later folder (e.g. the user deleted the workspace copy). origin (with
 *   `repo` only): repository, workspace or bundled. Throws if not found anywhere.
 * #554: the owner's edited workspace copy (origin modified or custom) wins over the repository's
 * copy of the same name, unless `preferRepository` (the project's "prefer the repository's workflows").
 */
function resolveWorkflow(file, dirs, { repo = null, preferRepository = false } = {}) {
  if (!file) throw new Error('No workflow file given.');
  if (path.isAbsolute(file)) return { file, dir: null, fallback: false };
  // #630: an old bundled name (a saved manifest, roadmap or default) runs its new workflow with the
  // old variant's inputs, unless the project's own manifest declares that name
  const alias = aliasOf(file);
  if (alias && !(repo && repositoryEntry(readManifest(repo).workflows, file))) {
    return { ...resolveWorkflow(alias.file, dirs, { repo, preferRepository }), inputs: alias.inputs, alias: path.basename(String(file)) };
  }
  const entry = repo ? repositoryEntry(readManifest(repo).workflows, file) : null;
  const edited = entry && !preferRepository ? editedWorkspaceCopy([file, `${file}.yaml`, path.posix.basename(entry.file)], dirs) : null;
  if (edited) return { file: path.join(dirs[0], edited), dir: dirs[0], fallback: false, origin: 'workspace' };
  if (entry) {
    const dir = path.join(repo, projectDirOf(repo));
    return { file: path.join(dir, ...entry.file.split('/')), dir, fallback: false, origin: 'repository', entry };
  }
  const list = dirs.filter(Boolean);
  for (const [i, dir] of list.entries()) {
    const candidate = path.join(dir, file);
    if (isFile(candidate)) return { file: candidate, dir, fallback: i > 0, ...(repo ? { origin: i === 0 ? 'workspace' : 'bundled' } : {}) };
  }
  throw new Error(`Workflow not found: "${file}" (searched in ${list.join(', ')})`);
}

// #485: the manifest entry with a `file` a workflow name means: its name, its name + .yaml, or its
// file's basename
function repositoryEntry(entries, file) {
  const want = String(file || '');
  return (entries || []).find((e) => e.file && [e.name, `${e.name}.yaml`, path.posix.basename(e.file)].includes(want)) || null;
}

// #554: the first of `names` the workspace (dirs[0]) holds as the owner's edited copy (origin
// modified or custom against the bundled dirs[1]), or null (an untouched default copy, or none)
function editedWorkspaceCopy(names, [workspaceDir, bundledDir] = []) {
  if (!workspaceDir) return null;
  const status = workflowStatus(bundledDir, workspaceDir);
  return names.map((n) => path.basename(String(n || ''))).find((n) => ['modified', 'custom'].includes(status[n]?.origin)) || null;
}

// #97: is the file a run takes a bundled default (the app's copy, or the workspace's copy of one, edited or
// not), whose providers follow the chosen orchestrator AI? false for a custom workspace workflow or one
// from elsewhere (a project's repository); undefined when the file is not in either folder (a resume's copy:
// the workflow's name decides, orchestrator-models.js followsOrchestrator).
function isBundledWorkflowFile(file, workspaceDir, bundledDir = BUNDLED_WORKFLOWS_DIR) {
  const dir = path.resolve(path.dirname(String(file || '')));
  if (bundledDir && dir === path.resolve(bundledDir)) return true;
  if (workspaceDir && dir === path.resolve(workspaceDir)) {
    const origin = workflowStatus(bundledDir, workspaceDir)[path.basename(String(file))]?.origin;
    return !!origin && origin !== 'custom';
  }
  return undefined;
}

module.exports = {
  addedGates,
  BUNDLED_WORKFLOWS_DIR,
  editedWorkspaceCopy,
  isBundledWorkflowFile,
  isWorkflowFile,
  repositoryEntry,
  resolveWorkflow,
  restoreWorkflow,
  seedWorkflows,
  WORKFLOW_KIND,
  workflowStatus,
};
