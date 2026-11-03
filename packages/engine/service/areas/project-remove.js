// Service area (#742): removing a project, and on request its folder. projects:remove (channels/projects.js)
// takes a bare id (the record only, as before #742: true) or { id, deleteFolder, confirmed, confirmName }:
// - a run of the project still running refuses the removal (a 400 naming the run), nothing removed;
// - deleteFolder for a folder the app did not make (outside <workspace>/repos/ and <workspace>/projects/, e.g.
//   the owner's own checkout) needs confirmName equal to the project's name, else { needsName: true, folder };
// - a git folder with uncommitted changes or commits on no remote answers { needsConfirm: true, dirty, unpushed }
//   until the same call comes with confirmed: true;
// - the folder goes to the system trash (the host's trashItem), else is deleted;
// - the project's data goes with it: its roadmap (<backlog>/<id>.json, .local.json, .queue.json), its architecture
//   and refactor folders, its record (with its onboarding state, #741); the runs' history stays.
// The delete runs where the engine runs, so the browser and the desktop in remote mode do the same.

const fs = require('fs');
const path = require('path');
const projects = require('../../domains/project/projects');
const { clientError, requireId } = require('../common');

// the files and folders of a project's own data in the workspace (never the runs)
function projectData(ws, id) {
  const base = path.basename(String(id));
  const arch = ws.architecture || path.join(ws.root, 'architecture');
  return [
    ...['.json', '.local.json', '.queue.json'].map((ext) => ws.backlog && path.join(ws.backlog, `${base}${ext}`)),
    path.join(arch, base),
    ws.refactor && path.join(ws.refactor, base),
    ws.refactor && path.join(ws.refactor, `${base}.json`),
  ].filter(Boolean);
}

module.exports = (ctx) => {
  // the folder to the trash, else deleted; never a folder the checks did not pass
  async function dropFolder(folder) {
    if (!fs.existsSync(folder)) return;
    try { await ctx.host?.trashItem?.(folder); } catch { /* no trash on this machine: deleted below */ }
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  async function projectRemove(arg) {
    const ws = ctx.ws;
    // the old form (a bare id): the record only, as before #742
    if (!arg || typeof arg !== 'object') return projects.removeProject(ws.projects, requireId(arg, 'project id'));
    const opts = arg;
    const id = requireId(opts.id, 'project id');
    let p;
    try { p = projects.readProject(ws.projects, id); } catch { return projects.removeProject(ws.projects, id); }
    const running = (typeof ctx.activeRuns === 'function' ? ctx.activeRuns() : []).filter((r) => r.projectId === id);
    if (running.length) throw clientError(`The project ${p.name} has a run in progress (${running.map((r) => r.runId).join(', ')}): stop it before removing the project.`);
    const folder = opts.deleteFolder === true && p.folder ? path.resolve(p.folder) : null;
    if (folder && fs.existsSync(folder)) {
      const owned = projects.ownedFolder(folder, [ws.repos, ws.projects]);
      if (!owned && opts.confirmName !== p.name) return { needsName: true, folder, name: p.name };
      if (opts.confirmed !== true) {
        const { dirty, unpushed } = await projects.folderChanges(folder);
        if (dirty.length || unpushed.length) return { needsConfirm: true, folder, dirty, unpushed };
      }
      await dropFolder(folder);
    }
    for (const f of projectData(ws, id)) fs.rmSync(f, { recursive: true, force: true });
    projects.removeProject(ws.projects, id);
    return { removed: true, folderDeleted: !!folder };
  }

  return { projectRemove };
};
