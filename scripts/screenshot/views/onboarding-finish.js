// Screenshot seed of the onboarding's end (--view onboarding-finish, #846): the first-run Setup's First
// project opens the new-project wizard (views/onboarding.js drives it the same way) on a local git
// repository (file://, no network), its analysis is started, then Continue, Finish and the Setup's Concluir
// (setup-next on its last step), to the state of --mode:
//   finished   the project's page with no Start drawer, the Imports tray saying analyzing (pinned by
//              onboarding:changed: a simulated analysis may end before the capture)
//   duplicate  that page, then the Start drawer on analyze-project for that project and Start: the refusal
//              in #start-error (packages/ui-kit/start-drawer.js startRun), nothing started
// Nothing reaches the network nor a model (MULTIAGENT_SIMULATION_ONLY).

const fs = require('fs');
const path = require('path');
const onboarding = require('./onboarding');

const IMPORT_WAIT_MS = 45000;

let reachableRepo = null;

// a first run in a new workspace, with a reachable sample repository
function seed({ ws, project, projects, workspace }) {
  projects.removeProject(ws.projects, project.id);
  fs.rmSync(path.join(ws.backlog, `${project.id}.json`), { force: true });
  workspace.writeSettings(ws, { lastProject: null, setupDone: false });
  const folder = path.join(ws.root, 'onboarding-demo', 'billing-api');
  fs.rmSync(folder, { recursive: true, force: true });
  reachableRepo = onboarding.sampleRepository(folder);
}

const ANALYZING = { clone: { status: 'done' }, facts: { status: 'running' }, profile: { status: 'running' }, projectMap: { status: 'waiting' }, ranking: { status: 'waiting' } };

async function open({ args, click, js, pause, win }) {
  const { waitFor, typeIn } = onboarding;
  await js('await window.Setup.open(\'first-project\')');
  await waitFor(js, '[data-testid="setup-new-project"]', 10000);
  await click('[data-testid="setup-new-project"]');
  await waitFor(js, '[data-testid="project-wizard"] [data-step="start"][aria-current="step"]', 10000);
  await click('[data-testid="wizard-source-import"]');
  await click('[data-testid="wizard-next"]');
  await waitFor(js, '#wizard-repo', 5000);
  await typeIn(js, '#wizard-repo', reachableRepo);
  await typeIn(js, '#wizard-name', 'billing-api');
  await click('[data-testid="wizard-next"]');
  await waitFor(js, '[data-testid="wizard-cost"] [data-testid="wizard-cost-total"]', IMPORT_WAIT_MS);
  await click('[data-testid="wizard-workflows-choice-analyze"]');
  // Continue and Finish while the analysis runs, then the Setup's Concluir
  await click('[data-testid="wizard-next"]');
  await waitFor(js, '[data-testid="wizard-finish"]', 10000);
  await click('[data-testid="wizard-finish"]');
  await waitFor(js, '[data-testid="setup-next"]', 10000);
  await click('[data-testid="setup-next"]');
  const projectId = await js('return state.view === \'project\' ? state.pv?.project?.id || null : null;');
  if (!projectId) throw new Error('Concluir did not leave the project\'s page open');
  win.webContents.send('onboarding:changed', { projectId, status: 'analyzing', cli: null, jobs: ANALYZING });
  await waitFor(js, '[data-testid="tray-item"][data-status="analyzing"]', 5000);
  if ((args.mode || 'finished') === 'finished') return;
  await js(`await openDrawer({ workflow: 'analyze-project.yaml', project: ${JSON.stringify(projectId)} })`);
  await pause(1000); // the drawer's estimate
  await click('[data-testid="start-workflow"]');
  await js(`
    for (let i = 0; i < 50 && !document.getElementById('start-error').textContent; i++) await new Promise((r) => setTimeout(r, 100));
    if (!document.getElementById('start-error').textContent) throw new Error('the Start drawer did not refuse the second analysis');`);
}

module.exports = {
  modes: ['duplicate', 'finished'],
  open,
  seed,
};
