// Screenshot seed of the new-project wizard (--view onboarding, #644, onboarding step 7 of
// docs/work/first-project-onboarding/plan.md): Home in a new workspace with the wizard open
// (fronts/build/views/projects/project-wizard.js), driven through its own controls to the state of --mode:
//   start         step 1, the two sources
//   repository    step 2 with a URL and a name typed, before Next (#848: the demo account's repositories
//                 under the field, filtered by --fill "#wizard-repo=<text>")
//   cloning       the Repository step cloning in place (#743: Next's spinner and "Cloning <name>…", no
//                 status card; #724: the tray stays hidden behind the open wizard) (the real onboarding:changed
//                 channel says cloning for the project an import just made: a clone of a local repository
//                 ends too fast to capture)
//   access-error  a repository the app cannot reach: wizard-error data-error="no-access", its Retry and Edit
//   analysis      a local git repository imported (file://, no network): the jobs and the cost, before the click
//   review        that repository analysed (simulated) and the review step
// --review issues-off (with --mode review, #845): a repository with Issues turned off, its Backlog card says so,
// no Retry (the simulation-only hook MULTIAGENT_E2E_ISSUES_FAIL answers the issue read as gh does)
// --review running (with --mode review, #852): the project map still running, City and Findings with the same
// running indicator, the languages bar's loading placeholder
// Nothing reaches the network nor a model (MULTIAGENT_SIMULATION_ONLY).

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');

const MODES = ['start', 'repository', 'cloning', 'access-error', 'analysis', 'review'];
// the access check (git ls-remote, up to 30 s in the engine) and a local clone; the simulated analyses
const IMPORT_WAIT_MS = 45000;
const ANALYSIS_WAIT_MS = 90000;

// the file:// URL of the seeded repository (seed and open run in the same process)
let reachableRepo = null;

// #790, #791: the sample repository names its default and its Fix, so the workflows column shows the
// Default row (analysis with --click "[data-testid=wizard-workflows-choice-manual]")
const SAMPLE_MANIFEST = `version: 1
requires: ">=1.1"
default: feature
kinds:
  fix: { name: fix, mode: remote }
workflows:
  - name: feature
    category: solo
  - name: fix
    category: fix
  - name: release
    category: release
`;

// a git repository with a few source files and some history on one of them (the analyses score it)
function sampleRepository(folder) {
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  const config = path.join(path.dirname(folder), 'empty.gitconfig');
  fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  const git = (a) => execFileSync('git', ['-C', folder, '-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'core.autocrlf=false', ...a], { stdio: 'pipe', env });
  const router = (n) => `function route(kind, value) {\n  if (kind === 'a') return value + ${n};\n  switch (kind) { case 'b': return -value; default: return ${n}; }\n}\nmodule.exports = { route };\n`;
  fs.writeFileSync(path.join(folder, 'README.md'), '# billing-api\n');
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'billing-api', private: true }, null, 2));
  fs.writeFileSync(path.join(folder, 'src', 'router.js'), router(0));
  fs.writeFileSync(path.join(folder, 'src', 'util.js'), 'const add = (a, b) => a + b;\nmodule.exports = { add };\n');
  fs.mkdirSync(path.join(folder, '.multiagent'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.multiagent', 'project.yaml'), SAMPLE_MANIFEST);
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'First commit']);
  for (let n = 1; n <= 3; n++) {
    fs.writeFileSync(path.join(folder, 'src', 'router.js'), router(n));
    git(['commit', '-q', '-am', `Change the router (${n})`]);
  }
  return pathToFileURL(folder).href;
}

// a new workspace (Home's empty state behind the wizard); the modes that import a reachable repository get one
function seed({ args, ws, project, projects, workspace }) {
  projects.removeProject(ws.projects, project.id);
  fs.rmSync(path.join(ws.backlog, `${project.id}.json`), { force: true });
  workspace.writeSettings(ws, { lastProject: null });
  reachableRepo = null;
  if (args.review === 'issues-off') process.env.MULTIAGENT_E2E_ISSUES_FAIL = 'disabled';
  if (['analysis', 'review'].includes(args.mode)) {
    const folder = path.join(ws.root, 'onboarding-demo', 'billing-api');
    fs.rmSync(folder, { recursive: true, force: true });
    reachableRepo = sampleRepository(folder);
  }
}

// waits in the page for a selector (up to ms), then fails with what is missing
const waitFor = (js, sel, ms) => js(`
  const sel = ${JSON.stringify(sel)};
  for (let i = 0; i < ${Math.ceil(ms / 100)} && !document.querySelector(sel); i++) await new Promise((r) => setTimeout(r, 100));
  if (!document.querySelector(sel)) throw new Error('nothing matches ' + sel);`);

// types into the wizard's fields the way a person does (its input listener updates the model)
const typeIn = (js, sel, value) => js(`
  const el = document.querySelector(${JSON.stringify(sel)});
  el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('input', { bubbles: true }));`);

// #632 (mock-3): gh signed in as a demo account and glab missing, so Create new project's private remote
// can be ticked from the start mode (--click); the repository mode too (#848), the other import modes keep
// the machine's own answer (its repo list)
const DEMO_ACCOUNTS = [
  { provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'octo-demo' },
  { provider: 'gitlab', cli: 'glab', installed: false, signedIn: false },
];

function stubAccounts() {
  const { ipcMain } = require('electron');
  ipcMain.removeHandler('onboarding:accounts');
  ipcMain.handle('onboarding:accounts', () => DEMO_ACCOUNTS);
}

// #848: the demo account's repositories, newest first (the API's order), FreeMyTvWebOS outside the 5 newest,
// so the repository mode shows the list filtering: --fill "#wizard-repo=" (the 5 newest) or
// --fill "#wizard-repo=freemy" (only FreeMyTvWebOS)
const DEMO_REPOS = [
  ['octo-demo/billing-api', true], ['octo-demo/multiagent-orchestrator', false], ['octo-demo/video-skills', false],
  ['vercel/next.js', false], ['octo-demo/ai-memory', true], ['octo-demo/edugalbs', false], ['octo-demo/FreeMyTvWebOS', false],
].map(([name, isPrivate], i) => ({ name, private: isPrivate, updatedAt: new Date(Date.now() - (i + 1) * 2 * 86400000).toISOString() }));

function stubRepos() {
  const { ipcMain } = require('electron');
  ipcMain.removeHandler('onboarding:repos');
  ipcMain.handle('onboarding:repos', () => DEMO_REPOS);
}

async function open({ args, click, js, pause, win }) {
  const mode = args.mode || 'start';
  if (mode === 'start' || mode === 'repository') stubAccounts();
  if (mode === 'repository') stubRepos();
  await click('.nav-item[data-view="dashboard"]');
  await click('[data-testid="home-empty-create-project"]');
  await waitFor(js, '[data-testid="project-wizard"] [data-step="start"][aria-current="step"]', 10000);
  if (mode === 'start') return;
  await click('[data-testid="wizard-source-import"]');
  await click('[data-testid="wizard-next"]');
  await waitFor(js, '#wizard-repo', 5000);
  const unreachable = ['cloning', 'access-error'].includes(mode);
  await typeIn(js, '#wizard-repo', unreachable ? 'https://github.com/example/private-billing' : reachableRepo || 'https://github.com/example/billing-api');
  await typeIn(js, '#wizard-name', 'billing-api');
  if (mode === 'repository') return;
  await click('[data-testid="wizard-next"]');
  if (unreachable) {
    await waitFor(js, '[data-testid="wizard-error"][data-error="no-access"]', IMPORT_WAIT_MS);
    if (mode === 'access-error') return;
    // the project the failed import made, said cloning again (what Retry shows while the clone runs)
    const projectId = await js('return document.querySelector(\'[data-testid="tray-item"]\')?.dataset.project || null;');
    if (!projectId) throw new Error('the failed import left no project in the tray');
    win.webContents.send('onboarding:changed', { projectId, status: 'cloning', cli: null, jobs: { clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' }, projectMap: { status: 'waiting' }, ranking: { status: 'waiting' } } });
    await waitFor(js, '[data-testid="tray-item"][data-status="cloning"]', 5000);
    return;
  }
  await waitFor(js, '[data-testid="wizard-cost"] [data-testid="wizard-cost-total"]', IMPORT_WAIT_MS);
  await pause(1000); // the project map's estimate
  if (mode === 'analysis') return;
  // #725: the workflows column's Analyze the repository starts the analysis; Continue is always there,
  // the review is captured when every analysis ended
  await click('[data-testid="wizard-workflows-choice-analyze"]');
  await waitFor(js, '[data-testid="tray-item"][data-status="analyzed"], [data-testid="tray-item"][data-status="failed"]', ANALYSIS_WAIT_MS);
  await click('[data-testid="wizard-next"]');
  await waitFor(js, '[data-testid="wizard-review"]', 5000);
  await pause(1500); // the review's reads (the backlog, the city, the facts, the proposals)
  if (args.review === 'running') {
    // #852: the project map still running (the real onboarding:changed channel, as the cloning mode does): the
    // City and Findings cards show the same running indicator, the languages bar its loading placeholder
    const projectId = await js('return document.querySelector(\'[data-testid="tray-item"]\')?.dataset.project || null;');
    if (!projectId) throw new Error('the review left no project in the tray');
    win.webContents.send('onboarding:changed', { projectId, status: 'analyzing', cli: null, jobs: { clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'running' }, ranking: { status: 'waiting' } } });
    await waitFor(js, '[data-testid="wizard-review-city"][data-state="pending"]', 5000);
  }
}

module.exports = {
  modes: MODES,
  open,
  // #845: the review of a repository with Issues turned off; #852: the review with the project map still running
  options: { review: ['issues-off', 'running'] },
  sampleRepository,
  seed,
  typeIn,
  waitFor,
};
