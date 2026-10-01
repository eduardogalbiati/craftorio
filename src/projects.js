// Projects: each project is a JSON file in <workspace>/projects/<id>.json pointing to
// a local folder (required) and, optionally, to a git repository.
// With no folder given, a project with a repository is cloned into <workspace>/repos/<owner>-<repo>
// (the same place git URLs given as repo_path go); one without a repository gets an empty
// <workspace>/projects/<id>/.

const fs = require('fs');
const path = require('path');
const { execGit, repoNameFromUrl } = require('./workspace');
const { cleanConfig } = require('./local-preview');

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

  if (repo && !isDir(path.join(folder, '.git'))) {
    if (isDir(folder) && fs.readdirSync(folder).length) throw new Error(`The folder ${folder} is not empty and is not a git repository; cannot clone into it.`);
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    await git(['clone', repo, folder], path.dirname(folder));
  } else {
    fs.mkdirSync(folder, { recursive: true });
    if (!repo && isDir(path.join(folder, '.git'))) repo = await git(['remote', 'get-url', 'origin'], folder).then((s) => s.trim() || null, () => null);
  }

  const localPreview = cleanLocalPreview(data.localPreview);
  const project = { name, description: data.description?.trim() || '', folder, repo, ...(localPreview ? { localPreview } : {}), createdAt: new Date().toISOString() };
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
  // how to run a run's worktree from a gate (Run locally); overrides the workflow's orchestrator.local_preview
  if (patch.localPreview !== undefined) next.localPreview = cleanLocalPreview(patch.localPreview);
  // the fingerprint of the declared run command the owner confirmed (#115): a changed one asks again
  if (patch.localPreviewConfirmed !== undefined) next.localPreviewConfirmed = patch.localPreviewConfirmed ? String(patch.localPreviewConfirmed) : null;
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

/** Removes only the project entry; the project folder is not deleted. */
function removeProject(dir, id) {
  fs.rmSync(metaFile(dir, id), { force: true });
  return true;
}


module.exports = {
  createProject,
  listProjects,
  readProject,
  removeProject,
  slugify,
  updateProject,
};
