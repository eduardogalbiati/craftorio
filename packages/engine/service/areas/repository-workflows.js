// Service area (#485): a project's repository workflows, the ones its .multiagent/project.yaml
// declares with a `file` (packages/engine/domains/project/project-manifest.js). They are read from the checkout's HEAD (the
// committed text, never an uncommitted edit), written to <workspace>/repository-workflows/<project>/<sha>/
// for the engine and the builder, and accepted by the owner per commit: projects/<id>.json keeps
// { <file>: { commit, blob } }, and a later commit that changes the file asks again (#468's answer
// for a checkout's settings). The Workflows screen lists them (areas/workflows.js), a run loads them
// capped (packages/engine/engine/run/load.js loadRepositoryWorkflow).

const fs = require('fs');
const path = require('path');
const projects = require('../../domains/project/projects');
const { MANIFEST_FILE, parseManifest } = require('../../domains/project/project-manifest');
const { editedWorkspaceCopy, repositoryEntry } = require('../../domains/workflow/workflows');
const { gitOut } = require('../common');

const MULTIAGENT_DIR = path.posix.dirname(MANIFEST_FILE);
// a commit's hash, short or full: 40 characters for SHA-1, 64 for a SHA-256 repository
const SHA = /^[0-9a-f]{7,64}$/i;
// the diff since the last accepted commit the screen shows, cut past this
const MAX_DIFF = 20000;

module.exports = (ctx) => {
  const projectOf = (projectId) => {
    try { return projects.readProject(ctx.ws.projects, projectId); } catch { return null; }
  };

  // the manifest at HEAD of a project's folder: { head, manifest } or null (no folder, not git, no manifest)
  function headManifest(project) {
    if (!project?.folder || !project.exists) return null;
    const head = gitOut(project.folder, ['rev-parse', 'HEAD']);
    if (!head) return null;
    const text = gitOut(project.folder, ['show', `${head}:${MANIFEST_FILE}`]);
    if (text == null) return null;
    return { head, manifest: parseManifest(text, { appVersion: ctx.host?.appVersion }) };
  }

  const copiesDir = () => path.join(ctx.ws.root, 'repository-workflows');
  // whether a path is one of those copies (a resumed run records the file it ran)
  const isRepositoryCopy = (file) => path.resolve(String(file)).startsWith(copiesDir() + path.sep);

  // the committed text of a repository workflow, as a file of the workspace the engine can load
  function materialize(project, commit, rel) {
    const text = gitOut(project.folder, ['show', `${commit}:${rel}`]);
    if (text == null) return null;
    const dest = path.join(copiesDir(), path.basename(project.id), commit, path.posix.basename(rel));
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, `${text}\n`);
    }
    return dest;
  }

  /**
   * The repository workflows of a project at its HEAD.
   * @returns {{ errors: string[], items: Array<{ file, entry, commit, accepted, acceptedCommit, path, diff }>, categories: object }}
   *   file: the workflow file's basename (what workflows:accept and run:start take); categories: the
   *   category the manifest gives a workflow it names without a file ({ <name>: category })
   */
  function repositoryWorkflows(projectId) {
    const project = projectId ? projectOf(projectId) : null;
    const found = headManifest(project);
    if (!found) return { errors: [], items: [], categories: {} };
    const { head, manifest } = found;
    if (manifest.errors.length) return { errors: manifest.errors, items: [], categories: {} };
    const categories = Object.fromEntries(manifest.workflows.filter((e) => !e.file && e.category).map((e) => [e.name, e.category]));
    const accepted = project.acceptedWorkflows || {};
    const items = [];
    for (const entry of manifest.workflows.filter((e) => e.file)) {
      const rel = `${MULTIAGENT_DIR}/${entry.file}`;
      const blob = gitOut(project.folder, ['rev-parse', `${head}:${rel}`]);
      if (!blob) continue; // declared but never committed: nothing to accept yet
      const file = path.posix.basename(entry.file);
      const prev = accepted[file] || null;
      const ok = !!prev && prev.blob === blob;
      // what changed since the commit the owner accepted last
      const diff = prev && !ok ? (gitOut(project.folder, ['diff', prev.commit, head, '--', rel]) || '').slice(0, MAX_DIFF) : '';
      items.push({ file, entry, commit: head, accepted: ok, acceptedCommit: prev?.commit || null, path: materialize(project, head, rel), diff });
    }
    return { errors: [], items, categories };
  }

  // The owner accepts a repository workflow for one commit of the project's repository.
  function acceptWorkflow({ projectId, file, commit }) {
    const project = projectOf(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const sha = String(commit || '');
    if (!SHA.test(sha) || gitOut(project.folder, ['cat-file', '-e', `${sha}^{commit}`]) == null) throw new Error(`Commit ${sha} is not in the repository of ${project.name || projectId}.`);
    const text = gitOut(project.folder, ['show', `${sha}:${MANIFEST_FILE}`]);
    const entry = text == null ? null : repositoryEntry(parseManifest(text).workflows, path.basename(String(file || '')));
    const blob = entry && gitOut(project.folder, ['rev-parse', `${sha}:${MULTIAGENT_DIR}/${entry.file}`]);
    if (!blob) throw new Error(`Workflow ${file} is not declared in ${MANIFEST_FILE} at commit ${sha.slice(0, 7)}.`);
    const full = gitOut(project.folder, ['rev-parse', `${sha}^{commit}`]);
    projects.updateProject(ctx.ws.projects, project.id, { acceptedWorkflows: { ...(project.acceptedWorkflows || {}), [entry.file.split('/').pop()]: { commit: full, blob } } });
    return true;
  }

  // The repository workflow a run of `file` in this project means, or null (the workspace's)
  function repositoryWorkflow(projectId, file) {
    const { items } = repositoryWorkflows(projectId);
    const entry = repositoryEntry(items.map((w) => w.entry), path.basename(String(file || '')));
    return items.find((w) => w.entry === entry) || null;
  }

  // The file to read `file`'s inputs and metadata from for a project, as a run of it finds it
  // (runs.js runWorkflowFile, without its acceptance check: the run refuses that when it starts): a
  // workflow only the repository declares has no workspace copy, so ctx.workflowPath cannot find it
  function projectWorkflowFile(projectId, file) {
    const repo = projectId ? repositoryWorkflow(projectId, file) : null;
    if (!repo) return ctx.workflowPath(file).file;
    const edited = editedWorkspaceCopy([file, repo.file], ctx.workflowDirs());
    return edited && !projectOf(projectId)?.preferRepositoryWorkflows ? path.join(ctx.ws.workflows, edited) : repo.path;
  }

  return {
    acceptWorkflow,
    isRepositoryCopy,
    projectWorkflowFile,
    repositoryWorkflow,
    repositoryWorkflows,
  };
};
