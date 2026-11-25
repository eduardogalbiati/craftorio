// Earlier versions of a project's roadmap (#281): the safety net for an edit noticed after its Undo
// toast is gone. Before each owner edit the roadmap channels (packages/engine/service/channels/roadmap.js) save
// the stages as they were, with what the edit did ("Removed #279 from the roadmap"), under the
// workspace: backlog/<project>.roadmap.history/<time>-<n>.json ({ at, label, stages }), the last 20
// per project. The Roadmap's ⋮ menu lists them ("Restore an earlier version…"); Restore follows
// Undo's rule (packages/engine/domains/roadmap/roadmap-undo.js undoEdit): items that started since keep their run, items added
// since stay, and it refuses when an issue it brings back is planned in another unfinished item.
// Nothing here writes the roadmap file: the channel saves what restoreVersion returns.

const fs = require('fs');
const path = require('path');
const { undoEdit } = require('./roadmap-undo');
const { writeJsonSafe } = require('../workspace/state-file');

const KEEP = 20;
const NAME = /^\d{13}-\d{4}\.json$/;

const historyDir = (workspace, projectId) => path.join(workspace, 'backlog', `${path.basename(String(projectId))}.roadmap.history`);
// oldest first: the names sort by time, then by the order of the saves of one millisecond
function names(dir) {
  try { return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort(); } catch { return []; }
}
function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Keeps `stages` (the roadmap before an edit) with the edit's label; the oldest beyond 20 go. */
function saveVersion(workspace, projectId, stages, label) {
  const dir = historyDir(workspace, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const at = new Date();
  const stamp = String(at.getTime()).padStart(13, '0');
  const last = names(dir).at(-1) || '';
  const n = last.startsWith(`${stamp}-`) ? Number(last.slice(14, 18)) + 1 : 0;
  const id = `${stamp}-${String(n).padStart(4, '0')}`;
  writeJsonSafe(path.join(dir, `${id}.json`), { at: at.toISOString(), label: String(label || 'Edited the roadmap'), stages: Array.isArray(stages) ? stages : [] });
  for (const old of names(dir).slice(0, -KEEP)) fs.rmSync(path.join(dir, old), { force: true });
  return id;
}

/**
 * The kept versions, newest first: [{ id, at, label }].
 * @returns {{ id: string, at: any, label: string }[]}
 */
function listVersions(workspace, projectId) {
  const dir = historyDir(workspace, projectId);
  return names(dir).reverse().map((f) => {
    const v = read(path.join(dir, f));
    return v && Array.isArray(v.stages) ? { id: f.replace(/\.json$/, ''), at: v.at, label: String(v.label || '') } : null;
  }).filter(Boolean);
}

/** The roadmap's stages with a version put back: { ok: true, stages } or { ok: false, reason }. */
function restoreVersion(workspace, projectId, id, currentStages) {
  const file = `${String(id)}.json`;
  const version = NAME.test(file) ? read(path.join(historyDir(workspace, projectId), file)) : null;
  if (!version || !Array.isArray(version.stages)) return { ok: false, reason: 'This version is no longer kept.' };
  return undoEdit(currentStages, { before: version.stages, after: null, label: version.label });
}

module.exports = {
  listVersions,
  restoreVersion,
  saveVersion,
};
