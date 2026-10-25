// Service area: files produced by runs (documents, proposals, reviews, reports, screenshots…),
// newest run first. Only a file some run lists as an artifact can be read, opened or copied, and
// only inside the workspace or the folder of the run's project.
//
// The lists come from the cached artifact index (src/domains/run/run-artifacts.js, #200), asynchronously: the
// Artifacts screen lists the runs with their counts first and loads one run's files when it opens
// (artifacts:list { runId }, filtered and paged here); finding one file asks the index which runs it
// can belong to (its run folder, or the runs that saved it as a project copy) and checks only those.

const fs = require('fs');
const path = require('path');
const projects = require('../../domains/project/projects');
const runs = require('../../domains/run/runs');
const evidence = require('../../domains/evidence/evidence');
const { artifactIndex, runsOfArtifact } = require('../../domains/run/run-artifacts');
const { folderMatcher } = require('../common');
const { pathKey } = require('../../domains/machine/platform-paths');

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
// with a search, the files of each matching run sent with the list (the rest: artifacts:list { runId, q })
const SEARCH_PREVIEW = 20;
const norm = (x) => pathKey(x);

module.exports = (ctx) => {
  const liveIds = () => new Set([...ctx.active.entries()].filter(([, run]) => run.status === 'running').map(([id]) => id));

  function runFields(r, projectList) {
    const owner = runs.projectOf(r, projectList);
    const current = ctx.active.get(r.runId)?.status === 'running';
    return {
      runId: r.runId, workflow: r.workflow, version: r.version, status: current ? 'running' : r.status,
      mock: r.mock, startedAt: r.startedAt, task: r.task, runDir: r.runDir,
      stepNames: r.stepNames || null, // step id → display name (#245), for the round heads
      project: owner ? { id: owner.id, name: owner.name } : null,
    };
  }

  /**
   * With `runId`: [that run with `artifacts`] (its files filtered by `q` unless the run itself matches,
   * and by `kind`; `offset`/`limit` page them: `total`, `hasMore`). Without: the runs that produced
   * files, newest first, with `artifactCount` / `imageCount` and no list; filtered by `projectId`,
   * `showSim: false` and `q` (a run matching by its workflow, task, project or id, or by a file name: those
   * files come along, at most SEARCH_PREVIEW, with `matchCount`). `summary: true` answers
   * { runs, hiddenSim } instead of the array.
   */
  async function artifactRuns({ projectId, runId, q, kind, showSim, offset, limit, summary } = {}) {
    const projectList = projects.listProjects(ctx.ws.projects);
    const needle = String(q || '').trim().toLowerCase();
    const runHit = (base) => !needle || [base.workflow, base.task, base.project?.name, base.runId].some((x) => String(x || '').toLowerCase().includes(needle));
    const fileHit = (f) => `${f.name} ${f.rel}`.toLowerCase().includes(needle);

    if (runId) {
      const r = runs.findRun(ctx.ws.runs, runId, { live: liveIds() });
      if (!r) return [];
      const base = runFields(r, projectList);
      const files = (await artifactIndex(r.runDir)).files.filter((f) => (!kind || f.kind === kind) && (runHit(base) || fileHit(f)));
      const from = Math.max(0, Math.floor(+offset) || 0);
      const to = limit == null ? files.length : from + Math.max(1, Math.floor(+limit) || 50);
      return [{ ...base, artifacts: files.slice(from, to), total: files.length, hasMore: to < files.length }];
    }

    const all = await runs.listRunsAsync(ctx.ws.runs, { live: liveIds() });
    const project = projectId ? projectList.find((x) => x.id === projectId) : null;
    const mine = project ? runs.runsForProject(all, project) : all;
    const list = showSim === false ? mine.filter((r) => !r.mock) : mine;
    const out = [];
    let hiddenSim = 0;
    for (let i = 0; i < mine.length; i += 16) {
      const part = mine.slice(i, i + 16);
      const indexes = await Promise.all(part.map((r) => artifactIndex(r.runDir).catch(() => ({ files: [], count: 0, images: 0 }))));
      part.forEach((r, n) => {
        const idx = indexes[n];
        if (!idx.count) return;
        if (!list.includes(r)) { hiddenSim++; return; }
        const base = { ...runFields(r, projectList), artifactCount: idx.count, imageCount: idx.images };
        if (!needle) { out.push(base); return; }
        const matching = runHit(base) ? idx.files : idx.files.filter(fileHit);
        if (matching.length) out.push({ ...base, matchCount: matching.length, artifacts: matching.slice(0, SEARCH_PREVIEW) });
      });
    }
    return summary ? { runs: out, hiddenSim } : out;
  }

  // The artifact entry of `file` and its run, checking only the runs it can belong to; null: none.
  async function locate(file) {
    if (!file) return null;
    for (const id of await runsOfArtifact(ctx.ws.runs, String(file))) {
      const runDir = path.join(ctx.ws.runs, id);
      const found = (await artifactIndex(runDir)).files.find((a) => norm(a.path) === norm(String(file)));
      if (found) return { found, runId: id };
    }
    return null;
  }

  // Only files that some run lists as an artifact can be read or opened (`exists` checked now).
  async function findArtifact(file) {
    const hit = await locate(file);
    if (!hit) return null;
    const st = await fs.promises.stat(hit.found.path).catch(() => null);
    return { ...hit.found, exists: !!st };
  }

  // An artifact that still exists (a run folder's file or its recorded project copy), else an error:
  // what reading it or copying it to the clipboard (#114) accepts. A recorded path is not trusted
  // as is: it must be inside the workspace or the folder of the run's project (compared canonically,
  // so a symlink or an 8.3 name cannot lead outside).
  async function existingArtifact(file) {
    const hit = await locate(file);
    if (!hit) throw new Error('Not an artifact of any run.');
    const found = { ...hit.found, exists: !!(await fs.promises.stat(hit.found.path).catch(() => null)) };
    if (!found.exists) throw new Error(`The file no longer exists: ${found.path}`);
    const projectList = projects.listProjects(ctx.ws.projects);
    const r = runs.findRun(ctx.ws.runs, hit.runId, { live: liveIds() });
    const owner = r ? runs.projectOf(r, projectList) : null;
    const inside = folderMatcher();
    if (![ctx.ws.root, owner?.folder].some((root) => inside(found.path, root))) throw new Error(`Outside the workspace and the project's folder: ${found.path}`);
    return found;
  }

  async function readArtifact({ path: file }) {
    const found = await existingArtifact(file);
    const buf = await fs.promises.readFile(found.path);
    const truncated = buf.length > MAX_ARTIFACT_BYTES;
    const binary = buf.subarray(0, 8000).includes(0);
    // images (e.g. the test step's UI screenshots) come whole as a data URL, for an <img>
    const image = found.kind === 'image' && !truncated ? `data:${IMAGE_TYPES[path.extname(found.path).toLowerCase()]};base64,${buf.toString('base64')}` : null;
    return { ...found, truncated, binary, image, text: binary ? null : buf.subarray(0, MAX_ARTIFACT_BYTES).toString('utf8') };
  }

  // A run's screenshots (#146): its evidence manifest (rebuilt from the evidence folder, or the
  // legacy screenshots/ set), each image with `file`, its absolute path for artifacts:read. null: none.
  function runEvidence({ runId } = {}) {
    const r = runId ? runs.findRun(ctx.ws.runs, runId, { live: liveIds() }) : null;
    const m = r ? evidence.readEvidence(r.runDir) : null;
    if (!m) return null;
    const file = (rel) => (rel ? path.join(r.runDir, ...rel.split('/')) : null);
    return { ...m, runId: r.runId, images: m.images.map((x) => ({ ...x, file: file(x.path), pair_file: file(x.pair) })) };
  }

  return {
    artifactRuns,
    existingArtifact,
    findArtifact,
    readArtifact,
    runEvidence,
  };
};
