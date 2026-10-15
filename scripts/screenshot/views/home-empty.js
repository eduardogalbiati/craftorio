// Screenshot seed of Home in a new workspace (--view home-empty, #255): no project and no run, how to
// start.

const fs = require('fs');
const path = require('path');

function seed({ ws, project, projects, workspace }) {
  projects.removeProject(ws.projects, project.id);
  fs.rmSync(path.join(ws.backlog, `${project.id}.json`), { force: true });
  workspace.writeSettings(ws, { lastProject: null });
}

const open = ({ click }) => click('.nav-item[data-view="dashboard"]');

module.exports = {
  open,
  seed,
};
