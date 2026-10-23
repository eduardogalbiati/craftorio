// Projects: each project is a JSON file in <workspace>/projects/<id>.json pointing to
// a local folder (required) and, optionally, to a git repository.
// With no folder given, a project with a repository is cloned into <workspace>/repos/<owner>-<repo>
// (the same place git URLs given as repo_path go); one without a repository gets an empty
// <workspace>/projects/<id>/.
// #486: a project keeps its workflow set (`workflows: [{ name, origin, category? }]`) and its
// `defaultWorkflow` (a name, used instead of Settings' default for its new items); projectManifest
// reads a repository's `.multiagent/project.yaml` before the project is created.

const fs = require('fs');
const path = require('path');
const { execGit, repoNameFromUrl } = require('./workspace');
const { cleanConfig } = require('./local-preview');
// #486: without a given default, the first checked development (solo, team or build) workflow
const { firstBuild } = require('./shared/default-workflow');

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function slugify(name) {
  const s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'project';
}

const metaFile = (dir, id) => path.join(dir, `${id}.json`);

function readProject(dir, id) {
  const p = JSON.parse(fs.readFileSync(metaFile(dir, id), 'utf8'));
  return { ...p, id, exists: isDir(p.folder), isGit: isDir(path.join(p.folder || '', '.git')) };
}

function listProjects(dir) {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const id = f.slice(0, -5);
      try { return readProject(dir, id); } catch (e) { return { id, name: id, error: e.message }; }
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id));
}

/**
 * Creates a project. If `repo` is given and the folder is not a git repository,
 * clones the repository into it (the folder must be empty or not exist).
 * @param {{ name: string, folder?: string, repo?: string, description?: string }} data
 * @param {{ git?: Function, reposDir?: string }} opts reposDir: <workspace>/repos
 */
async function createProject(dir, data, { git = execGit, reposDir = null } = {}) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Enter the project name.');
  fs.mkdirSync(dir, { recursive: true });

  let id = slugify(name);
  for (let i = 2; fs.existsSync(metaFile(dir, id)); i++) id = `${slugify(name)}-${i}`;

  let repo = data.repo?.trim() || null;
  const defaultFolder = repo && reposDir ? path.join(reposDir, repoNameFromUrl(repo)) : path.join(dir, id);
  const folder = path.resolve(data.folder?.trim() || defaultFolder);

  let cloned = false;
  if (repo && !isDir(path.join(folder, '.git'))) {
    if (isDir(folder) && fs.readdirSync(folder).length) throw new Error(`The folder ${folder} is not empty and is not a git repository; cannot clone into it.`);
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    await git(['clone', repo, folder], path.dirname(folder));
    cloned = true;
  } else {
    fs.mkdirSync(folder, { recursive: true });
    if (!repo && isDir(path.join(folder, '.git'))) repo = await git(['remote', 'get-url', 'origin'], folder).then((s) => s.trim() || null, () => null);
  }

  const localPreview = cleanLocalPreview(data.localPreview);
  // #472: a repository the app cloned (not the user's own checkout) installs without its scripts
  // until the owner turns the setting off; the project dialog's own choice wins
  const ignoreInstallScripts = typeof data.ignoreInstallScripts === 'boolean' ? data.ignoreInstallScripts : cloned;
  // #486: the workflows checked in Create Project's Workflows block, and the project's default;
  // none checked for a repository just cloned (its manifest could not be read before): the clone's manifest
  let workflows = cleanWorkflows(data.workflows);
  if (!workflows.length && cloned) workflows = cleanWorkflows((await projectManifest({ folder }))?.workflows?.map((w) => ({ ...w, origin: 'manifest' })));
  const defaultWorkflow = workflows.length ? cleanWorkflowName(data.defaultWorkflow) || firstBuild(workflows) : null;
  const project = { name, description: data.description?.trim() || '', folder, repo, ...(localPreview ? { localPreview } : {}), ...(ignoreInstallScripts ? { ignoreInstallScripts } : {}), ...(workflows.length ? { workflows } : {}), ...(defaultWorkflow ? { defaultWorkflow } : {}), createdAt: new Date().toISOString() };
  fs.writeFileSync(metaFile(dir, id), JSON.stringify(project, null, 2));
  return readProject(dir, id);
}

function updateProject(dir, id, patch) {
  const cur = JSON.parse(fs.readFileSync(metaFile(dir, id), 'utf8'));
  const next = { ...cur };
  if (patch.name !== undefined) next.name = String(patch.name).trim() || cur.name;
  if (patch.description !== undefined) next.description = String(patch.description).trim();
  if (patch.repo !== undefined) next.repo = String(patch.repo).trim() || null;
  // push the local base after every successful local merge (software-development-local-hero)
  if (patch.autoPush !== undefined) next.autoPush = !!patch.autoPush;
  // #138: a new issue the Product Owner registers joins the existing epic it matches clearly, with no extra click
  if (patch.autoEpic !== undefined) next.autoEpic = !!patch.autoEpic;
  // #472: the dependency install of a run skips the packages' scripts (--ignore-scripts)
  if (patch.ignoreInstallScripts !== undefined) next.ignoreInstallScripts = !!patch.ignoreInstallScripts;
  // how to run a run's worktree from a gate (Run locally); overrides the workflow's orchestrator.local_preview
  if (patch.localPreview !== undefined) next.localPreview = cleanLocalPreview(patch.localPreview);
  // the fingerprint of the declared run command the owner confirmed (#115): a changed one asks again
  if (patch.localPreviewConfirmed !== undefined) next.localPreviewConfirmed = patch.localPreviewConfirmed ? String(patch.localPreviewConfirmed) : null;
  // #485: the repository workflows the owner accepted, { <file>: { commit, blob } } (a changed file asks again)
  if (patch.acceptedWorkflows !== undefined) next.acceptedWorkflows = { ...(patch.acceptedWorkflows || {}) };
  // #486: the project's workflow set ({ name, origin, category? }) and its default for new items
  if (patch.workflows !== undefined) next.workflows = cleanWorkflows(patch.workflows);
  if (patch.defaultWorkflow !== undefined) next.defaultWorkflow = cleanWorkflowName(patch.defaultWorkflow);
  // #360: each analysis seed's deterministic tool, { <seed id>: command }, run instead of the Oracle
  if (patch.seedTools !== undefined) next.seedTools = Object.fromEntries(Object.entries(patch.seedTools || {}).filter(([, c]) => String(c || '').trim()).map(([k, c]) => [k, String(c).trim()]));
  if (patch.folder !== undefined) {
    const folder = path.resolve(String(patch.folder).trim());
    if (!isDir(folder)) throw new Error(`Folder does not exist: ${folder}`);
    if (cur.folder && path.resolve(cur.folder) !== folder) next.previousFolders = [...new Set([...(cur.previousFolders || []), cur.folder])];
    next.folder = folder;
  }
  fs.writeFileSync(metaFile(dir, id), JSON.stringify(next, null, 2));
  return readProject(dir, id);
}

// { install, command, url, cwd?, env? } with empty fields dropped; null without a command (the action is hidden)
const cleanLocalPreview = (v) => cleanConfig(v);

// #486: a workflow's name without its .yaml suffix; null when empty
const cleanWorkflowName = (v) => String(v ?? '').trim().replace(/\.ya?ml$/i, '') || null;

// #486: [{ name, origin, category? }], one per name, in the given order
function cleanWorkflows(list) {
  const seen = new Set();
  const out = [];
  for (const w of Array.isArray(list) ? list : []) {
    const name = cleanWorkflowName(w?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const category = String(w.category ?? '').trim();
    out.push({ name, origin: String(w.origin ?? '').trim() || 'workspace', ...(category ? { category } : {}) });
  }
  return out;
}

/** #486: the workflow file a project's new items use (`<name>.yaml`), else `fallback` (Settings' default). */
function projectDefaultWorkflow(project, fallback = null) {
  const name = cleanWorkflowName(project?.defaultWorkflow);
  return name ? `${name}.yaml` : fallback;
}

const AFTER_CLONE = 'The repository could not be read without credentials: its workflows manifest will be read after cloning.';

/**
 * #486: a repository's workflows manifest (.multiagent/project.yaml, src/project-manifest.js) before the
 * project exists: from a local folder, or from a remote repository through its provider's contents
 * API (gh api / glab api), else an unauthenticated raw read for a public one. Never clones.
 * @param {{ url?: string, folder?: string }} target
 * @returns {Promise<{ workflows: object[], errors?: string[], pending?: true, message?: string }|null>}
 *   null: no manifest; errors: the manifest's own (invalid YAML, an unknown category), shown by the block
 */
async function projectManifest(target, { exec, fetch = globalThis.fetch } = {}) {
  const { MANIFEST_FILE, parseManifest } = require('./project-manifest');
  const entries = (text) => {
    const { workflows, errors } = parseManifest(text);
    return { workflows, ...(errors.length ? { errors } : {}) };
  };
  if (target?.folder) {
    const file = path.join(String(target.folder), ...MANIFEST_FILE.split('/'));
    if (!fs.existsSync(file)) return null;
    return entries(fs.readFileSync(file, 'utf8'));
  }
  const issues = require('./issues');
  const parsed = issues.parseRepoUrl(target?.url);
  if (!parsed) return null;
  const platform = issues.platformOfHost(parsed.host);
  const adapter = platform && issues.adapterOf(platform);
  if (adapter?.fileCommand) {
    const { cli, args } = adapter.fileCommand(parsed, MANIFEST_FILE);
    try {
      const out = await (exec || issues.execCli)(cli, args);
      return entries(decodeContents(out));
    } catch (e) {
      if (/\b404\b|not found/i.test(String(e?.message))) return null;
    }
  }
  // no CLI that can read it: a public repository's raw file
  const raw = require('./shared/platforms').rawFileUrl(platform, parsed, MANIFEST_FILE);
  try {
    const res = typeof fetch === 'function' ? await fetch(raw) : null;
    if (res?.ok) return entries(await res.text());
  } catch { /* offline: read after cloning */ }
  return { workflows: [], pending: true, message: AFTER_CLONE };
}

// gh api's contents JSON ({ content: base64 }) or a raw file's text
function decodeContents(out) {
  try {
    const doc = JSON.parse(out);
    if (doc && typeof doc.content === 'string') return Buffer.from(doc.content, doc.encoding || 'base64').toString('utf8');
  } catch { /* the raw text */ }
  return String(out ?? '');
}

/** Removes only the project entry; the project folder is not deleted. */
function removeProject(dir, id) {
  fs.rmSync(metaFile(dir, id), { force: true });
  return true;
}


module.exports = {
  createProject,
  listProjects,
  projectDefaultWorkflow,
  projectManifest,
  readProject,
  removeProject,
  slugify,
  updateProject,
};
