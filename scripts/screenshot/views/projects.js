// Screenshot seed of the Projects screen (--view projects, #354: Code & Build in the menu, before
// Backlog), opened from its menu entry: the demo project's card; --mode empty: no project (the empty
// state with New project); --mode two: a second project beside the demo one; --mode unfinished (#741):
// a second project whose onboarding stopped at its analysis step (its card shows "Onboarding not finished" · Continue).

const fs = require('fs');
const path = require('path');

async function seed({ args, ws, project, projects, workspace }) {
  if (args.mode === 'empty') {
    projects.removeProject(ws.projects, project.id);
    fs.rmSync(path.join(ws.backlog, `${project.id}.json`), { force: true });
    workspace.writeSettings(ws, { lastProject: null });
  }
  if (args.mode === 'two' || args.mode === 'unfinished') {
    // the repository is set afterwards: createProject would clone it
    const second = await projects.createProject(ws.projects, { name: 'billing-api', description: 'Invoices and payments service (simulated data)' });
    const onboarding = args.mode === 'unfinished'
      ? { step: 'analysis', finished: false, picks: { repo: 'https://github.com/example/billing-api', name: 'billing-api' } }
      : undefined;
    projects.updateProject(ws.projects, second.id, { repo: 'https://github.com/example/billing-api', onboarding });
  }
}

module.exports = {
  modes: ['empty', 'two', 'unfinished'],
  seed,
};
