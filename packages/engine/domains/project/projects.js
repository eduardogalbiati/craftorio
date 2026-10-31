// Projects: each project is a JSON file in <workspace>/projects/<id>.json pointing to
// a local folder (required) and, optionally, to a git repository.
// With no folder given, a project with a repository is cloned into <workspace>/repos/<owner>-<repo>
// (the same place git URLs given as repo_path go); one without a repository gets an empty
// <workspace>/projects/<id>/.
// #486: a project keeps its workflow set (`workflows: [{ name, origin, category? }]`) and its
// `defaultWorkflow` (a name, used instead of Settings' default for its new items); projectManifest
// reads a repository's `.multiagent/project.yaml` before the project is created.
// #639: the clone is a background job: a project has a `status` (`cloning | ready | failed`, none = ready),
// `cloneError` the reason of a failed clone; a `cloning` record no job of this process runs (the app closed
// during the clone) reads `failed`; retryClone clones a failed one again; checkAccess runs `git ls-remote`.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { execGit, gitAuthArgs, repoNameFromUrl } = require('../workspace/workspace');
const { childEnv, PLATFORM_CLIS } = require('../../engine/child-env');
const { cleanConfig } = require('../local/local-preview');
// #486: without a given default, the first checked development (solo, team or build) workflow
const { firstBuild } = require('@multiagent/shared/default-workflow');

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function slugify(name) {
  const s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'project';
}

const metaFile = (dir, id) => path.join(dir, `${id}.json`);

// #639: the clones this process runs, by project file; a new process starts with none
const jobs = new Map();
const jobKey = (dir, id) => path.resolve(metaFile(dir, id));
const INTERRUPTED = 'The clone was interrupted before it ended.';

function readProject(dir, id) {
  const p = JSON.parse(fs.readFileSync(metaFile(dir, id), 'utf8'));
  const orphan = p.status === 'cloning' && !jobs.has(jobKey(dir, id));
  const status = orphan ? 'failed' : (p.status || 'ready');
  return { ...p, id, status, ...(orphan ? { cloneError: p.cloneError || INTERRUPTED } : {}), exists: isDir(p.folder), isGit: isDir(path.join(p.folder || '', '.git')) };
}

// #639: merges `patch` into the saved record (keeps what an edit changed meanwhile); null fields are dropped
function patchMeta(dir, id, patch) {
  const next = { ...JSON.parse(fs.readFileSync(metaFile(dir, id), 'utf8')), ...patch };
  for (const k of Object.keys(patch)) if (patch[k] == null) delete next[k];
  fs.writeFileSync(metaFile(dir, id), JSON.stringify(next, null, 2));
}

// #639: the clone job: ends the record in ready (with the clone's manifest when no workflow was checked) or failed
function startClone(dir, id, { git, defaultWorkflow = null }) {
  const key = jobKey(dir, id);
  const job = (async () => {
    const p = JSON.parse(fs.readFileSync(metaFile(dir, id), 'utf8'));
    try {
      await git(['clone', p.repo, p.folder], path.dirname(p.folder));
      const patch = { status: 'ready', cloneError: null };
      if (!cleanWorkflows(p.workflows).length) {
        const workflows = cleanWorkflows((await projectManifest({ folder: p.folder }))?.workflows?.map((w) => ({ ...w, origin: 'manifest' })));
        if (workflows.length) Object.assign(patch, { workflows, defaultWorkflow: cleanWorkflowName(defaultWorkflow) || firstBuild(workflows) });
      }
      patchMeta(dir, id, patch);
    } catch (e) {
      try { patchMeta(dir, id, { status: 'failed', cloneError: String(e?.message || e) }); } catch { /* the project was removed */ }
    } finally {
      jobs.delete(key);
    }
  })();
  jobs.set(key, job);
  return job;
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
 * Creates a project. If `repo` is given and the folder is not a git repository, it returns at once
 * with status 'cloning' and clones the repository into it in the background (the folder must be
 * empty or not exist; #639); otherwise the project is 'ready' at once.
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

  const cloned = !!repo && !isDir(path.join(folder, '.git'));
  if (cloned) {
    if (isDir(folder) && fs.readdirSync(folder).length) throw new Error(`The folder ${folder} is not empty and is not a git repository; cannot clone into it.`);
    fs.mkdirSync(path.dirname(folder), { recursive: true });
  } else {
    fs.mkdirSync(folder, { recursive: true });
    if (!repo && isDir(path.join(folder, '.git'))) repo = await git(['remote', 'get-url', 'origin'], folder).then((s) => s.trim() || null, () => null);
  }

  const localPreview = cleanLocalPreview(data.localPreview);
  // #472: a repository the app cloned (not the user's own checkout) installs without its scripts
  // until the owner turns the setting off; the project dialog's own choice wins
  const ignoreInstallScripts = typeof data.ignoreInstallScripts === 'boolean' ? data.ignoreInstallScripts : cloned;
  // #486: the workflows checked in Create Project's Workflows block, and the project's default;
  // none checked for a repository being cloned (its manifest could not be read before): the clone job reads it
  const workflows = cleanWorkflows(data.workflows);
  const defaultWorkflow = workflows.length ? cleanWorkflowName(data.defaultWorkflow) || firstBuild(workflows) : null;
  const project = { name, description: data.description?.trim() || '', folder, repo, status: cloned ? 'cloning' : 'ready', ...(localPreview ? { localPreview } : {}), ...(ignoreInstallScripts ? { ignoreInstallScripts } : {}), ...(data.preferRepositoryWorkflows === true ? { preferRepositoryWorkflows: true } : {}), ...(workflows.length ? { workflows } : {}), ...(defaultWorkflow ? { defaultWorkflow } : {}), createdAt: new Date().toISOString() };
  fs.writeFileSync(metaFile(dir, id), JSON.stringify(project, null, 2));
  if (cloned) startClone(dir, id, { git, defaultWorkflow: data.defaultWorkflow });
  return readProject(dir, id);
}

/** #639: clones a 'failed' project again: removes the partial folder and returns at once as 'cloning'. */
async function retryClone(dir, id, { git = execGit } = {}) {
  const p = readProject(dir, id);
  if (p.status !== 'failed') throw new Error('Only a project whose clone failed can retry it.');
  if (!p.repo) throw new Error('The project has no repository to clone.');
  fs.rmSync(p.folder, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(p.folder), { recursive: true });
  patchMeta(dir, id, { status: 'cloning', cloneError: null });
  startClone(dir, id, { git });
  return readProject(dir, id);
}

/**
 * #639: whether `repo` can be cloned, from `git ls-remote` (never clones).
 * @returns {Promise<{ status: 'reachable' | 'no-access' | 'no-network', message?: string }>}
 */
async function checkAccess(repo, { git = lsRemote } = {}) {
  try {
    await git(['ls-remote', String(repo || '').trim(), 'HEAD']);
    return { status: 'reachable' };
  } catch (e) {
    const message = String(e?.message || e);
    // the network first: an SSH host that cannot be resolved also says "Could not read from remote repository"
    if (/Could not resolve host|Failed to connect|Couldn't connect|Connection (timed out|refused)|Network is unreachable|No such host/i.test(message)) return { status: 'no-network', message };
    return { status: 'no-access', message };
  }
}

// #639: git ls-remote with the allowlisted environment of the platform CLIs (their tokens), no prompt
function lsRemote(args, cwd) {
  const env = { ...childEnv(process.env, { platforms: PLATFORM_CLIS }), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  return new Promise((resolve, reject) => {
    execFile('git', [...gitAuthArgs(), ...args], { cwd, env, windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
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
  // #554: the repository's copy of a workflow runs even when the workspace holds the owner's edited copy
  if (patch.preferRepositoryWorkflows !== undefined) next.preferRepositoryWorkflows = !!patch.preferRepositoryWorkflows;
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
 * #486: a repository's workflows manifest (.multiagent/project.yaml, packages/engine/domains/project/project-manifest.js) before the
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
  const issues = require('../backlog/issues');
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
  const raw = require('@multiagent/shared/platforms').rawFileUrl(platform, parsed, MANIFEST_FILE);
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
  checkAccess,
  createProject,
  listProjects,
  projectDefaultWorkflow,
  projectManifest,
  readProject,
  removeProject,
  retryClone,
  slugify,
  updateProject,
};
