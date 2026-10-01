// Service area: files produced by runs (documents, proposals, reviews, reports, screenshots…),
// newest run first. Only a file some run lists as an artifact can be read, opened or copied, and
// only inside the workspace or the folder of the run's project.

const fs = require('fs');
const path = require('path');
const projects = require('../../projects');
const runs = require('../../runs');
const evidence = require('../../evidence');
const { folderMatcher } = require('../common');

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const norm = (x) => (process.platform === 'win32' ? path.resolve(x).toLowerCase() : path.resolve(x));

module.exports = (ctx) => {
  function artifactRuns({ projectId, runId } = {}) {
    const all = runs.listRuns(ctx.ws.runs);
    const projectList = projects.listProjects(ctx.ws.projects);
    const project = projectId ? projectList.find((x) => x.id === projectId) : null;
    const list = runId ? all.filter((r) => r.runId === runId) : project ? runs.runsForProject(all, project) : all;
    return list.map((r) => {
      const owner = runs.projectOf(r, projectList);
      const current = ctx.active.get(r.runId)?.status === 'running';
      return {
        runId: r.runId, workflow: r.workflow, version: r.version, status: current ? 'running' : r.status,
        mock: r.mock, startedAt: r.startedAt, task: r.task, runDir: r.runDir,
        project: owner ? { id: owner.id, name: owner.name } : null,
        artifacts: runs.runArtifacts(r.runDir),
      };
    }).filter((r) => r.artifacts.length);
  }

  // Only files that some run lists as an artifact can be read or opened.
  function findArtifact(file) {
    return artifactRuns().flatMap((r) => r.artifacts).find((a) => norm(a.path) === norm(file)) || null;
  }

  // An artifact that still exists (a run folder's file or its recorded project copy), else an error:
  // what reading it or copying it to the clipboard (#114) accepts. A recorded path is not trusted
  // as is: it must be inside the workspace or the folder of the run's project (compared canonically,
  // so a symlink or an 8.3 name cannot lead outside).
  function existingArtifact(file) {
    const projectList = projects.listProjects(ctx.ws.projects);
    let found = null, run = null;
    for (const r of file ? artifactRuns() : []) {
      found = r.artifacts.find((a) => norm(a.path) === norm(String(file))) || null;
      if (found) { run = r; break; }
    }
    if (!found) throw new Error('Not an artifact of any run.');
    if (!found.exists) throw new Error(`The file no longer exists: ${found.path}`);
    const folder = run.project ? projectList.find((x) => x.id === run.project.id)?.folder : null;
    const inside = folderMatcher();
    if (![ctx.ws.root, folder].some((root) => inside(found.path, root))) throw new Error(`Outside the workspace and the project's folder: ${found.path}`);
    return found;
  }

  function readArtifact({ path: file }) {
    const found = existingArtifact(file);
    const buf = fs.readFileSync(found.path);
    const truncated = buf.length > MAX_ARTIFACT_BYTES;
    const binary = buf.subarray(0, 8000).includes(0);
    // images (e.g. the test step's UI screenshots) come whole as a data URL, for an <img>
    const image = found.kind === 'image' && !truncated ? `data:${IMAGE_TYPES[path.extname(found.path).toLowerCase()]};base64,${buf.toString('base64')}` : null;
    return { ...found, truncated, binary, image, text: binary ? null : buf.subarray(0, MAX_ARTIFACT_BYTES).toString('utf8') };
  }

  // A run's screenshots (#146): its evidence manifest (rebuilt from the evidence folder, or the
  // legacy screenshots/ set), each image with `file`, its absolute path for artifacts:read. null: none.
  function runEvidence({ runId } = {}) {
    const r = runId ? runs.listRuns(ctx.ws.runs).find((x) => x.runId === runId) : null;
    const m = r ? evidence.readEvidence(r.runDir) : null;
    if (!m) return null;
    const file = (rel) => (rel ? path.join(r.runDir, ...rel.split('/')) : null);
    return { ...m, runId, images: m.images.map((x) => ({ ...x, file: file(x.path), pair_file: file(x.pair) })) };
  }

  return {
    artifactRuns,
    existingArtifact,
    findArtifact,
    readArtifact,
    runEvidence,
  };
};
