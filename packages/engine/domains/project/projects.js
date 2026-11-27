// Projects: each project is a JSON file in <workspace>/projects/<id>.json pointing to
// a local folder (required) and, optionally, to a git repository.
// With no folder given, a project with a repository is cloned into <workspace>/repos/<owner>-<repo>
// (the same place git URLs given as repo_path go); one without a repository gets an empty
// <workspace>/projects/<id>/.
// #486: a project keeps its workflow set (`workflows: [{ name, origin, category? }]`) and its
// `defaultWorkflow` (a name); projectManifest reads a repository's `.craftorio/project.yaml` before
// the project is created. #790: the default comes from the project and its manifest only
// (projectDefaultWorkflow: the one order of packages/shared/default-workflow.js projectDefault, the
// clone taking the manifest's `default`); #791: `workflowKinds` ({ feature?, fix?: { name, inputs } },
// the clone saving the manifest's `kinds`) and workflowForKind(project, kind), the workflow and
// inputs of a Feature or a Fix (DefaultWorkflow.kindEntry's order, the manifest read here);
// withManifest(project): the record the screens get, with its manifest's `default` and `kinds`.
// #639: the clone is a background job: a project has a `status` (`cloning | ready | failed`, none = ready),
// `cloneError` the reason of a failed clone; a `cloning` record no job of this process runs (the app closed
// during the clone) reads `failed`; retryClone clones a failed one again; checkAccess runs `git ls-remote`.
// #640: cloneJob lets the onboarding (packages/engine/service/areas/project-onboarding.js) wait for a clone.
// #745: `platform` (github / gitlab) for a host its URL does not name (shared/platforms projectPlatform);
// #735: `kind` (backend / frontend / full-stack) and `runDefaults` the owner set (project-run-defaults.js).
// #741: `onboarding: { step, picks, finished }`, the new-project wizard's state (service/areas/project-onboarding.js).
// #742: ownedFolder / folderChanges: the checks before a removal deletes the project's folder.
// #633: `workModel` (light / standard / full, spec R9), how work on the project is documented, picked at onboarding.
// #105: a folder on this computer given as a file:// URL is the clone's `source` (the clone's origin, where a run
// pushes), not the project's repository: `repo` is the folder's own origin when it is a git URL, else none (local backlog).

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const {
  cloneFolder,
  execGit,
  isGitUrl,
  pushableUrl,
} = require('../workspace/workspace');
const { insideFolder } = require('../machine/platform-paths');
const { childEnv, PLATFORM_CLIS } = require('../../engine/child-env');
const { cleanConfig } = require('../local/local-preview');
// #486: without a given default, the first checked development (solo, team or build) workflow;
// #790 / #791: the default's order and the kinds' (shared with the screens)
const {
  KIND_ENTRIES,
  firstBuild,
  kindEntry,
  projectDefault,
} = require('@craftorio/shared/default-workflow');
const { readManifest } = require('./project-manifest');
// #632: a project's id, the rule the onboarding wizard shows too (re-exported for agents, skills, discovery);
// #633: the work models a project may keep
const {
  WORK_MODELS,
  slugify,
} = require('@craftorio/shared/onboarding-model');
const { findPlatform } = require('@craftorio/shared/platforms');
// #735: the kinds and the keys a project's run defaults may override (read at call time: no load cycle)
const runDefaultsModule = () => require('./project-run-defaults');

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

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

// #639: the clone job: ends the record in ready (with the clone's manifest when no workflow was checked) or failed.
// #790: the manifest's `default` is the project's default (a given one wins); #791: its `kinds` map is saved too.
function startClone(dir, id, { git, defaultWorkflow = null }) {
  const key = jobKey(dir, id);
  const job = (async () => {
    try {
      const p = JSON.parse(fs.readFileSync(metaFile(dir, id), 'utf8'));
      // #79: cloned with the URL runs can push with (SSH when the platform CLI's protocol is ssh); #105: from the folder
      const { url } = await pushableUrl(p.source || p.repo);
      await git(['clone', url, p.folder], path.dirname(p.folder));
      const patch = { status: 'ready', cloneError: null };
      if (!cleanWorkflows(p.workflows).length) {
        const manifest = await projectManifest({ folder: p.folder });
        const workflows = cleanWorkflows(manifest?.workflows?.map((w) => ({ ...w, origin: 'manifest' })));
        if (workflows.length) Object.assign(patch, { workflows, defaultWorkflow: cleanWorkflowName(defaultWorkflow) || manifest.default || firstBuild(workflows) });
        const workflowKinds = cleanWorkflowKinds(manifest?.kinds);
        if (workflowKinds && !cleanWorkflowKinds(p.workflowKinds)) patch.workflowKinds = workflowKinds;
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

// a new record's status: ready without a clone; #640: failed with the access check's reason, never cloned
const cloneState = (cloned, cloneError) => (!cloned ? { status: 'ready' } : cloneError ? { status: 'failed', cloneError: String(cloneError) } : { status: 'cloning' });

/** #640: the clone job this process runs for the project (a promise that never rejects), null when none runs. */
const cloneJob = (dir, id) => jobs.get(jobKey(dir, id)) || null;

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

const notEmpty = (folder) => isDir(folder) && fs.readdirSync(folder).length > 0;

// createProject's folder: its parent for a clone (the folder itself empty or missing), else the folder
// (#632 fresh: empty or missing) → the repository, read from the folder's origin when none was given
async function prepareFolder(folder, { repo, cloned, fresh, git }) {
  if (cloned) {
    if (notEmpty(folder)) throw new Error(`The folder ${folder} is not empty and is not a git repository; cannot clone into it.`);
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    return repo;
  }
  if (fresh && notEmpty(folder)) throw new Error(`The folder ${folder} is not empty; a new project needs an empty folder.`);
  fs.mkdirSync(folder, { recursive: true });
  if (!repo && isDir(path.join(folder, '.git'))) return git(['remote', 'get-url', 'origin'], folder).then((s) => s.trim() || null, () => null);
  return repo;
}

// #105: the origin of the folder a file:// URL names, kept when it is a git URL (a platform's repository); else null
async function folderRemote(source, git) {
  let folder;
  try { folder = fileURLToPath(source); } catch { return null; }
  const origin = await git(['remote', 'get-url', 'origin'], folder).then((s) => String(s || '').trim(), () => '');
  return origin && isGitUrl(origin) ? origin : null;
}

// #105: the given repository, or for a file:// folder its remote (folderRemote) and the folder as the clone's source
async function repoAndSource(given, git) {
  const repo = String(given || '').trim() || null;
  if (!repo || !/^file:\/\//i.test(repo)) return { repo, source: null };
  return { repo: await folderRemote(repo, git), source: repo };
}

/**
 * Creates a project. If `repo` is given and the folder is not a git repository, it returns at once
 * with status 'cloning' and clones the repository into it in the background (the folder must be
 * empty or not exist; #639); otherwise the project is 'ready' at once.
 * @param {{ name: string, folder?: string, repo?: string, description?: string, kind?: string | null }} data
 * @param {{ git?: Function, reposDir?: string, cloneError?: string }} opts reposDir: <workspace>/repos;
 *   cloneError (#640, the access check refused the repository): the project is saved 'failed' with
 *   that reason and nothing is cloned (retryClone clones it); fresh (#632, a new project): its folder must be
 *   empty or not exist
 */
async function createProject(dir, data, /** @type {{ git?: typeof execGit, reposDir?: string | null, cloneError?: string | null, fresh?: boolean }} */ { git = execGit, reposDir = null, cloneError = null, fresh = false } = {}) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Enter the project name.');
  fs.mkdirSync(dir, { recursive: true });

  let id = slugify(name);
  for (let i = 2; fs.existsSync(metaFile(dir, id)); i++) id = `${slugify(name)}-${i}`;

  const resolved = await repoAndSource(data.repo, git);
  const { source } = resolved;
  let { repo } = resolved;
  const from = source || repo;
  // #84: the clone's own name, or its free sibling (name-2…) when that folder holds something else
  const defaultFolder = from && reposDir ? cloneFolder(from, reposDir).dir : path.join(dir, id);
  const folder = path.resolve(data.folder?.trim() || defaultFolder);

  const cloned = !!from && !isDir(path.join(folder, '.git'));
  const prepared = await prepareFolder(folder, { repo: from, cloned, fresh, git });
  if (!source) repo = prepared;

  const localPreview = cleanLocalPreview(data.localPreview);
  // #472: a repository the app cloned (not the user's own checkout) installs without its scripts
  // until the owner turns the setting off; the project dialog's own choice wins
  const ignoreInstallScripts = typeof data.ignoreInstallScripts === 'boolean' ? data.ignoreInstallScripts : cloned;
  // #486: the workflows checked in Create Project's Workflows block, and the project's default;
  // none checked for a repository being cloned (its manifest could not be read before): the clone job reads it
  const workflows = cleanWorkflows(data.workflows);
  const defaultWorkflow = cleanWorkflowName(data.defaultWorkflow) || (workflows.length ? firstBuild(workflows) : null);
  // #791: the workflow of each kind, given (the wizard's or a caller's) or the manifest's at the clone
  const workflowKinds = cleanWorkflowKinds(data.workflowKinds);
  // #745: the platform the wizard picked for a host its URL does not name; #735: the confirmed kind
  const platform = cleanPlatform(data.platform);
  const kind = cleanKind(data.kind);
  const project = { name, description: data.description?.trim() || '', folder, repo, ...(source ? { source } : {}), ...(platform ? { platform } : {}), ...(kind ? { kind } : {}), ...cloneState(cloned, cloneError), ...(localPreview ? { localPreview } : {}), ...(ignoreInstallScripts ? { ignoreInstallScripts } : {}), ...(data.preferRepositoryWorkflows === true ? { preferRepositoryWorkflows: true } : {}), ...(workflows.length ? { workflows } : {}), ...(defaultWorkflow ? { defaultWorkflow } : {}), ...(workflowKinds ? { workflowKinds } : {}), createdAt: new Date().toISOString() };
  fs.writeFileSync(metaFile(dir, id), JSON.stringify(project, null, 2));
  if (project.status === 'cloning') startClone(dir, id, { git, defaultWorkflow: data.defaultWorkflow });
  return readProject(dir, id);
}

/** #639: clones a 'failed' project again: removes the partial folder and returns at once as 'cloning'. */
async function retryClone(dir, id, { git = execGit } = {}) {
  const p = readProject(dir, id);
  if (p.status !== 'failed') throw new Error('Only a project whose clone failed can retry it.');
  if (!p.source && !p.repo) throw new Error('The project has no repository to clone.');
  fs.rmSync(p.folder, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(p.folder), { recursive: true });
  patchMeta(dir, id, { status: 'cloning', cloneError: null });
  startClone(dir, id, { git });
  return readProject(dir, id);
}

/**
 * #639: whether `repo` can be cloned, from `git ls-remote` (never clones); 'no-git' when git is not installed.
 * @returns {Promise<{ status: 'reachable' | 'no-access' | 'no-network' | 'no-git', message?: string }>}
 */
async function checkAccess(repo, { git = lsRemote } = {}) {
  try {
    await git(['ls-remote', String(repo || '').trim(), 'HEAD']);
    return { status: 'reachable' };
  } catch (e) {
    const message = String(e?.message || e);
    if (e?.code === 'ENOENT') return { status: 'no-git', message };
    // the network first: an SSH host that cannot be resolved also says "Could not read from remote repository"
    if (e?.code === 'ETIMEDOUT' || /Could not resolve host|Failed to connect|Couldn't connect|Connection (timed out|refused)|timed out|Network is unreachable|No such host/i.test(message)) return { status: 'no-network', message };
    return { status: 'no-access', message };
  }
}

// #639: git ls-remote with the allowlisted environment of the platform CLIs (their tokens), no prompt;
// the SSH agent's socket passes too, so an SSH URL the clone (full environment) reaches answers 'reachable'
const lsRemote = (args, cwd) => execGit(args, cwd, { env: childEnv(process.env, { platforms: PLATFORM_CLIS, passthrough: ['SSH_AUTH_SOCK', 'SSH_AGENT_PID'] }), timeout: 30000 });

function updateProject(dir, id, patch) {
  const cur = JSON.parse(fs.readFileSync(metaFile(dir, id), 'utf8'));
  const next = { ...cur };
  if (patch.name !== undefined) next.name = String(patch.name).trim() || cur.name;
  if (patch.description !== undefined) next.description = String(patch.description).trim();
  if (patch.repo !== undefined) next.repo = String(patch.repo).trim() || null;
  // #138: a new issue the Product Owner registers joins the existing epic it matches clearly, with no extra click
  if (patch.autoEpic !== undefined) next.autoEpic = !!patch.autoEpic;
  // #472: the dependency install of a run skips the packages' scripts (--ignore-scripts)
  if (patch.ignoreInstallScripts !== undefined) next.ignoreInstallScripts = !!patch.ignoreInstallScripts;
  // #554: the repository's copy of a workflow runs even when the workspace holds the owner's edited copy
  if (patch.preferRepositoryWorkflows !== undefined) next.preferRepositoryWorkflows = !!patch.preferRepositoryWorkflows;
  // #810: a merge from the app (the PR monitor's card) deletes the merged branch
  if (patch.deleteBranchAfterMerge !== undefined) next.deleteBranchAfterMerge = !!patch.deleteBranchAfterMerge;
  // how to run a run's worktree from a gate (Run locally); overrides the workflow's orchestrator.local_preview
  if (patch.localPreview !== undefined) next.localPreview = cleanLocalPreview(patch.localPreview);
  // the fingerprint of the declared run command the owner confirmed (#115): a changed one asks again
  if (patch.localPreviewConfirmed !== undefined) next.localPreviewConfirmed = patch.localPreviewConfirmed ? String(patch.localPreviewConfirmed) : null;
  // #485: the repository workflows the owner accepted, { <file>: { commit, blob } } (a changed file asks again)
  if (patch.acceptedWorkflows !== undefined) next.acceptedWorkflows = { ...(patch.acceptedWorkflows || {}) };
  patchWorkflows(next, patch);
  // #360: each analysis seed's deterministic tool, { <seed id>: command }, run instead of the Oracle
  if (patch.seedTools !== undefined) next.seedTools = Object.fromEntries(Object.entries(patch.seedTools || {}).filter(([, c]) => String(c || '').trim()).map(([k, c]) => [k, String(c).trim()]));
  // #745: the project's git platform (github / gitlab) for a self-hosted host; null: read from the URL
  if (patch.platform !== undefined) next.platform = cleanPlatform(patch.platform);
  // #738: the owner's fork of the repository (Fork + PR, cleanFork)
  if (patch.fork !== undefined) next.fork = cleanFork(patch.fork, cur.repo);
  // #735: backend / frontend / full-stack as the owner confirmed it, and the run defaults edited on the project page
  if (patch.kind !== undefined) next.kind = cleanKind(patch.kind);
  if (patch.runDefaults !== undefined) next.runDefaults = cleanRunDefaults(patch.runDefaults);
  // #741: the new-project wizard's state (its step, the owner's picks, finished), so an onboarding resumes
  if (patch.onboarding !== undefined) next.onboarding = cleanOnboarding(patch.onboarding);
  // #633: the work model picked at onboarding (light / standard / full); any other value keeps the previous one
  if (WORK_MODELS.includes(patch.workModel)) next.workModel = patch.workModel;
  if (patch.folder !== undefined) moveFolder(next, cur, patch.folder, jobs.has(jobKey(dir, id)));
  fs.writeFileSync(metaFile(dir, id), JSON.stringify(next, null, 2));
  return readProject(dir, id);
}

// updateProject's workflows. #486: the project's set ({ name, origin, category? }) and its default for new
// items; #791: the workflow and inputs of each kind of work ({ feature?, fix?: { name, inputs } }); null or
// empty: none of its own. The Feature entry is the default workflow: whoever saves a new default (the
// Overview's Make default and Remove, the wizard's Finish) moves a saved Feature entry to it, its inputs kept
function patchWorkflows(next, patch) {
  const before = next.defaultWorkflow;
  if (patch.workflows !== undefined) next.workflows = cleanWorkflows(patch.workflows);
  if (patch.defaultWorkflow !== undefined) next.defaultWorkflow = cleanWorkflowName(patch.defaultWorkflow);
  if (patch.workflowKinds !== undefined) next.workflowKinds = cleanWorkflowKinds(patch.workflowKinds);
  else if (next.workflowKinds?.feature && next.defaultWorkflow && next.defaultWorkflow !== before) {
    next.workflowKinds = { ...next.workflowKinds, feature: { ...next.workflowKinds.feature, name: next.defaultWorkflow } };
  }
}

// updateProject's folder change: the old folder joins previousFolders; #639: a project whose clone failed,
// pointed at another folder (cloned by hand), is ready, so Retry never removes the owner's folder
function moveFolder(next, cur, value, cloning) {
  const folder = path.resolve(String(value).trim());
  if (!isDir(folder)) throw new Error(`Folder does not exist: ${folder}`);
  const moved = !cur.folder || path.resolve(cur.folder) !== folder;
  if (moved && cur.folder) next.previousFolders = [...new Set([...(cur.previousFolders || []), cur.folder])];
  if (moved && cur.status && cur.status !== 'ready' && !cloning) {
    next.status = 'ready';
    delete next.cloneError;
  }
  next.folder = folder;
}

// { install, command, url, cwd?, env? } with empty fields dropped; null without a command (the action is hidden)
const cleanLocalPreview = (v) => cleanConfig(v);

// #745: a known platform's id (github, gitlab), else null
const cleanPlatform = (v) => findPlatform(v)?.id || null;
// #738: the owner's fork of the repository (Fork + PR): { url (origin), upstream (the original), dependentPr? },
// null: none. dependentPr: how a dependent roadmap item's PR opens, 'wait-and-rebase' (default, not stored)
// or 'depends-on' (at once, "Depends on #<parent's PR>")
function cleanFork(v, repo) {
  if (!v?.url) return null;
  return {
    url: String(v.url).trim(),
    upstream: String(v.upstream || repo || '').trim() || null,
    ...(v.dependentPr === 'depends-on' ? { dependentPr: 'depends-on' } : {}),
  };
}
// #735: backend / frontend / full-stack, else null (detected from the facts)
const cleanKind = (v) => (runDefaultsModule().KINDS.includes(v) ? v : null);
// #735: the run defaults the owner set on the project page, only the known keys, empty ones dropped
function cleanRunDefaults(v) {
  const out = {};
  for (const k of runDefaultsModule().OVERRIDABLE) {
    const val = v?.[k];
    if (Array.isArray(val)) out[k] = val.map((s) => String(s).trim()).filter(Boolean);
    else if (typeof val === 'string' && val.trim()) out[k] = val.trim();
  }
  return Object.keys(out).length ? out : null;
}

// #741: the wizard's state, { step (a step id), picks (an object), finished }; null: none
function cleanOnboarding(v) {
  if (!v || typeof v !== 'object') return null;
  const picks = v.picks && typeof v.picks === 'object' && !Array.isArray(v.picks) ? JSON.parse(JSON.stringify(v.picks)) : {};
  return { step: String(v.step || 'start'), picks, finished: v.finished === true };
}

// #486: a workflow's name without its .yaml suffix; null when empty
const cleanWorkflowName = (v) => String(v ?? '').trim().replace(/\.ya?ml$/i, '') || null;

// #486: [{ name, origin, category?, variant?, ci? }], one per name, in the given order; #729: the
// variant and the CI pick of the new-project wizard's step 3 kept
function cleanWorkflows(list) {
  const seen = new Set();
  const out = [];
  const opt = (key, v) => { const s = typeof v === 'string' ? v.trim() : ''; return s ? { [key]: s } : {}; };
  for (const w of Array.isArray(list) ? list : []) {
    const name = cleanWorkflowName(w?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const category = String(w.category ?? '').trim();
    out.push({ name, origin: String(w.origin ?? '').trim() || 'workspace', ...(category ? { category } : {}), ...opt('variant', w.variant), ...opt('ci', w.ci) });
  }
  return out;
}

// #791: { <kind>: { name, inputs } } with only the known kinds, each a workflow name and a plain object of inputs; null when empty
function cleanWorkflowKinds(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const kind of KIND_ENTRIES) {
    const e = v[kind];
    const name = cleanWorkflowName(typeof e === 'string' ? e : e?.name);
    if (!name) continue;
    const inputs = e?.inputs && typeof e.inputs === 'object' && !Array.isArray(e.inputs) ? e.inputs : {};
    out[kind] = { name, inputs: JSON.parse(JSON.stringify(inputs)) };
  }
  return Object.keys(out).length ? out : null;
}

// #790: the repository's manifest of a project's folder (no folder, or none there: nothing declared)
const manifestOf = (project) => (project?.folder ? readManifest(project.folder) : null);

/**
 * #486, #790: the workflow file a project's new items use (`<name>.yaml`), always a value: the project's
 * `defaultWorkflow`, its manifest's `default`, the first build workflow of its set, `feature.yaml`
 * (DefaultWorkflow.projectDefault). Never a setting: a second argument is ignored.
 */
function projectDefaultWorkflow(project) {
  return `${projectDefault(project, manifestOf(project)?.default)}.yaml`;
}

/**
 * #791: the project's workflow of a kind of work (`feature` | `fix` | `refactor`, the last one the
 * Feature entry) → { name, inputs }: the record's `workflowKinds`, the manifest's `kinds`, the
 * wizard's picks, last `feature` / `fix` in the project's way of working (DefaultWorkflow.kindEntry).
 */
function workflowForKind(project, kind) {
  return kindEntry(project, manifestOf(project), kind);
}

/**
 * #790, #791: a project's record for the screens, which read no file: with `manifest` ({ default, kinds })
 * when its repository declares either, so DefaultWorkflow.current and kindEntry follow the engine's order.
 */
function withManifest(project) {
  const m = manifestOf(project);
  return m?.default || Object.keys(m?.kinds || {}).length ? { ...project, manifest: { default: m.default, kinds: m.kinds } } : project;
}

const AFTER_CLONE = 'The repository could not be read without credentials: its workflows manifest will be read after cloning.';

/**
 * #486: a repository's workflows manifest (.craftorio/project.yaml, packages/engine/domains/project/project-manifest.js) before the
 * project exists: from a local folder, or from a remote repository through its provider's contents
 * API (gh api / glab api), else an unauthenticated raw read for a public one. Never clones.
 * @param {{ url?: string, folder?: string }} target
 * @returns {Promise<{ workflows: object[], default: string|null, kinds: object, errors?: string[], pending?: true, message?: string }|null>}
 *   null: no manifest; errors: the manifest's own (invalid YAML, an unknown category), shown by the block;
 *   #790 / #791: `default` and `kinds` as the manifest declares them (what the wizard and the project page read)
 */
async function projectManifest(target, { exec, fetch = globalThis.fetch } = {}) {
  const { LEGACY_MANIFEST_FILE, MANIFEST_FILE, parseManifest } = require('./project-manifest');
  const entries = (text) => {
    const { workflows, default: def, kinds, errors } = parseManifest(text);
    return { workflows, default: def, kinds, ...(errors.length ? { errors } : {}) };
  };
  if (target?.folder) {
    const file = [MANIFEST_FILE, LEGACY_MANIFEST_FILE].map((f) => path.join(String(target.folder), ...f.split('/'))).find((f) => fs.existsSync(f));
    if (!file) return null;
    return entries(fs.readFileSync(file, 'utf8'));
  }
  const issues = require('../backlog/issues');
  const parsed = issues.parseRepoUrl(target?.url);
  if (!parsed) return null;
  const platform = issues.platformOfHost(parsed.host);
  const adapter = platform && issues.adapterOf(platform);
  if (adapter?.fileCommand) {
    let missing = 0;
    for (const name of [MANIFEST_FILE, LEGACY_MANIFEST_FILE]) {
      const { cli, args } = adapter.fileCommand(parsed, name);
      try {
        const out = await (exec || issues.execCli)(cli, args);
        return entries(decodeContents(out));
      } catch (e) {
        if (/\b404\b|not found/i.test(String(e?.message))) missing++;
        else break;
      }
    }
    if (missing === 2) return null;
  }
  // no CLI that can read it: a public repository's raw file
  for (const name of [MANIFEST_FILE, LEGACY_MANIFEST_FILE]) {
    const raw = require('@craftorio/shared/platforms').rawFileUrl(platform, parsed, name);
    try {
      const res = typeof fetch === 'function' ? await fetch(raw) : null;
      if (res?.ok) return entries(await res.text());
    } catch { /* offline: read after cloning */ break; }
  }
  return { workflows: [], default: null, kinds: {}, pending: true, message: AFTER_CLONE };
}

// gh api's contents JSON ({ content: base64 }) or a raw file's text
function decodeContents(out) {
  try {
    const doc = JSON.parse(out);
    if (doc && typeof doc.content === 'string') return Buffer.from(doc.content, doc.encoding || 'base64').toString('utf8');
  } catch { /* the raw text */ }
  return String(out ?? '');
}

/**
 * Removes only the project entry; the project folder is not deleted (#742: the service area
 * project-remove.js deletes it on request, with ownedFolder and folderChanges below).
 */
function removeProject(dir, id) {
  fs.rmSync(metaFile(dir, id), { force: true });
  return true;
}

/**
 * #742: whether `folder` is one the app made: a folder strictly inside one of `roots` (<workspace>/repos/, the
 * clones; <workspace>/projects/, the new projects' folders), never a root itself nor a path escaping it.
 */
function ownedFolder(folder, roots) {
  if (!folder) return false;
  return roots.filter(Boolean).some((root) => insideFolder(folder, root, { strict: true }));
}

/**
 * #742: what deleting a git folder would lose: dirty (`git status --porcelain`, the paths) and unpushed (the
 * local commits on no remote branch, `<hash> <subject>`, at most 50; none without a remote). A folder that is not a repository of
 * its own (no .git) loses nothing git knows: both empty.
 */
async function folderChanges(folder, { git = execGit } = {}) {
  if (!folder || !fs.existsSync(path.join(String(folder), '.git'))) return { dirty: [], unpushed: [] };
  const lines = (out) => String(out || '').split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const dirty = lines(await git(['status', '--porcelain'], folder).catch(() => '')).map((l) => l.slice(3) || l);
  // the issue's rule: commits ahead of a remote; a repository with no remote at all has no upstream to be ahead of
  const remotes = lines(await git(['remote'], folder).catch(() => ''));
  const unpushed = remotes.length ? lines(await git(['log', '--branches', '--not', '--remotes', '--format=%h %s', '-n', '50'], folder).catch(() => '')) : [];
  return { dirty, unpushed };
}


module.exports = {
  checkAccess,
  cloneJob,
  createProject,
  folderChanges,
  listProjects,
  ownedFolder,
  projectDefaultWorkflow,
  projectManifest,
  readProject,
  removeProject,
  retryClone,
  slugify,
  updateProject,
  withManifest,
  workflowForKind,
};
