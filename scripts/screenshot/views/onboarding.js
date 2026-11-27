// Screenshot seed of the new-project wizard (--view onboarding, #644, onboarding step 7 of
// docs/work/first-project-onboarding/plan.md): Home in a new workspace with the wizard open
// (fronts/build/views/projects/project-wizard.js), driven through its own controls to the state of --mode:
//   start         step 1, the two sources
//   repository    step 2 with a URL and a name typed, before Next (#848: the demo account's repositories
//                 under the field, filtered by --fill "#wizard-repo=<text>")
//   cloning       the Repository step cloning in place (#743: Next's spinner and "Cloning <name>…", no
//                 status card; #724: the tray stays hidden behind the open wizard) (onboarding:start answers
//                 cloning for a demo project: a clone of a local repository ends too fast to capture, and #107: a
//                 failed import no longer leaves a project to say cloning again)
//   access-error  a repository the app cannot reach (#107: refused before anything is made): wizard-error
//                 data-error="repo-no-access" (--cause no-access, the default) | "repo-not-found" (--cause
//                 not-found), its Retry and Edit; the simulation-only hook CRAFTORIO_E2E_REPO_ACCESS gives git's answer
// --source new (with --mode repository, #108): Create new project's step 2 with "garden-log" typed while a
// project holds that folder (projects:list answers it), so the folder line shows garden-log-2; --fill
// "#wizard-new-name=" shows the required line, --fill "#wizard-new-name=Lista de Tarefas" the slug folder
//   analysis      a local git repository imported (file://, no network): the jobs and the cost, before the click
//                 (#74: the simulation-only hook CRAFTORIO_E2E_ONBOARDING_COSTS gives the analyses their amounts)
//   review        that repository analysed (simulated) and the review step
//   new-workflows Create new project named "garden-log" (no answer changed), its step 3 (#21: its own heading,
//                 the suggestions from the answers, no row left waiting without its reason)
// --review manual (with --mode review, #20): Define manually then Continue, no Analyze click: the city starts
// on Continue, the review shows it running, without the "skipped" banner
// --review awaiting (with --mode analysis or review, #40): the repository's own default workflow
// (.multiagent/workflows/team-feature.yaml) is not accepted: step 3 and the review show wizard-default-awaiting-acceptance
// --review issues-off (with --mode review, #845): a repository with Issues turned off, its Backlog card says so,
// no Retry (the simulation-only hook CRAFTORIO_E2E_ISSUES_FAIL answers the issue read as gh does)
// --review running (with --mode review, #852): the project map still running, City and Findings with the same
// running indicator, the languages bar's loading placeholder
// --review no-push (with --mode review, #79): the clone's push check fails (the simulation-only hook
// CRAFTORIO_E2E_GIT_PUSH=0), the review shows wizard-push-notice with its "Run gh auth setup-git" button
// Nothing reaches the network nor a model (CRAFTORIO_SIMULATION_ONLY).

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');

const MODES = ['start', 'repository', 'cloning', 'access-error', 'analysis', 'review', 'new-workflows'];
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

// #40 (--review awaiting): the repository ships its own workflow (a copy of the bundled feature.yaml) and
// declares it its default: not accepted at HEAD, so the wizard says it awaits acceptance
const AWAITING_MANIFEST = SAMPLE_MANIFEST.replace('default: feature', 'default: team-feature')
  .replace('workflows:\n', 'workflows:\n  - name: team-feature\n    file: workflows/team-feature.yaml\n    category: solo\n');

// a git repository with a few source files and some history on one of them (the analyses score it)
function sampleRepository(folder, { awaiting = false } = {}) {
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
  fs.writeFileSync(path.join(folder, '.multiagent', 'project.yaml'), awaiting ? AWAITING_MANIFEST : SAMPLE_MANIFEST);
  if (awaiting) {
    fs.mkdirSync(path.join(folder, '.multiagent', 'workflows'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml'), path.join(folder, '.multiagent', 'workflows', 'team-feature.yaml'));
  }
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
  if (args.review === 'issues-off') process.env.CRAFTORIO_E2E_ISSUES_FAIL = 'disabled';
  // #79: the clone's push check fails as git does without credentials: the review shows wizard-push-notice
  if (args.review === 'no-push') process.env.CRAFTORIO_E2E_GIT_PUSH = '0';
  // #107: git's answer to the access check of the unreachable demo URL (no network reached)
  if (args.mode === 'access-error') process.env.CRAFTORIO_E2E_REPO_ACCESS = args.cause || 'no-access';
  if (['analysis', 'review'].includes(args.mode)) {
    const folder = path.join(ws.root, 'onboarding-demo', 'billing-api');
    fs.rmSync(folder, { recursive: true, force: true });
    reachableRepo = sampleRepository(folder, { awaiting: args.review === 'awaiting' });
    process.env.CRAFTORIO_E2E_ONBOARDING_COSTS = JSON.stringify({ profile: 0.42, projectMap: 0.74 }); // #74
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

// #108 (--source new): a project already holds garden-log, so the wizard (projects:list at open) shows garden-log-2;
// stubbed once Home shows its empty state, which it keeps
function stubTakenProject() {
  const { ipcMain } = require('electron');
  ipcMain.removeHandler('projects:list');
  ipcMain.handle('projects:list', () => [{ id: 'garden-log', name: 'garden-log' }]);
}

// #743 (cloning): onboarding:start answers the clone running for a demo project, as a slow clone does
function stubCloning() {
  const { ipcMain } = require('electron');
  const waiting = { status: 'waiting' };
  ipcMain.removeHandler('onboarding:start');
  ipcMain.handle('onboarding:start', () => ({ projectId: 'billing-api', status: 'cloning', cli: null, jobs: { clone: { status: 'running' }, facts: waiting, profile: waiting, projectMap: waiting, ranking: waiting } }));
}

async function open({ args, click, js, pause, win }) {
  const mode = args.mode || 'start';
  if (mode === 'start' || mode === 'repository') stubAccounts();
  if (mode === 'repository') stubRepos();
  if (mode === 'cloning') stubCloning();
  await click('.nav-item[data-view="dashboard"]');
  if (args.source === 'new') stubTakenProject();
  await click('[data-testid="home-empty-create-project"]');
  await waitFor(js, '[data-testid="project-wizard"] [data-step="start"][aria-current="step"]', 10000);
  if (mode === 'start') return;
  if (mode === 'repository' && args.source === 'new') {
    await click('[data-testid="wizard-source-new"]');
    await click('[data-testid="wizard-next"]');
    await waitFor(js, '#wizard-new-name', 5000);
    await typeIn(js, '#wizard-new-name', 'garden-log');
    await waitFor(js, '[data-testid="wizard-new-folder"][title$="garden-log-2"]', 5000);
    return;
  }
  if (mode === 'new-workflows') {
    await click('[data-testid="wizard-source-new"]');
    await click('[data-testid="wizard-next"]');
    await waitFor(js, '#wizard-new-name', 5000);
    await typeIn(js, '#wizard-new-name', 'garden-log');
    await click('[data-testid="wizard-next"]');
    await waitFor(js, '[data-testid="project-wizard"] [data-step="analysis"][aria-current="step"]', IMPORT_WAIT_MS);
    await pause(1000); // the profile's suggestions
    return;
  }
  await click('[data-testid="wizard-source-import"]');
  await click('[data-testid="wizard-next"]');
  await waitFor(js, '#wizard-repo', 5000);
  const unreachable = ['cloning', 'access-error'].includes(mode);
  await typeIn(js, '#wizard-repo', unreachable ? 'https://github.com/example/private-billing' : reachableRepo || 'https://github.com/example/billing-api');
  await typeIn(js, '#wizard-name', 'billing-api');
  if (mode === 'repository') return;
  await click('[data-testid="wizard-next"]');
  if (mode === 'access-error') {
    const code = args.cause === 'not-found' ? 'repo-not-found' : 'repo-no-access';
    await waitFor(js, `[data-testid="wizard-error"][data-error="${code}"]`, IMPORT_WAIT_MS);
    return;
  }
  if (mode === 'cloning') {
    await waitFor(js, '#wizard-next[aria-busy="true"]', IMPORT_WAIT_MS);
    return;
  }
  await waitFor(js, '[data-testid="wizard-cost"] [data-testid="wizard-cost-total"]', IMPORT_WAIT_MS);
  await pause(1000); // the project map's estimate
  if (mode === 'analysis') return;
  // #725: the workflows column's Analyze the repository starts the analysis; Continue is always there,
  // the review is captured when every analysis ended
  if (args.review === 'manual') {
    // #20: Define manually, then Continue with the city still ticked: the review while the analyses run
    await click('[data-testid="wizard-workflows-choice-manual"]');
    await click('[data-testid="wizard-next"]');
    await waitFor(js, '[data-testid="wizard-review"]', 5000);
    await pause(1500); // the review's reads
    return;
  }
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
  // #845: the review of a repository with Issues turned off; #852: the review with the project map still running;
  // #79: the review of a clone that cannot push (its push notice and setup-git button)
  // #40: a repository whose own default workflow awaits acceptance (with --mode analysis or review)
  // #107: the cause of a refused import (with --mode access-error); #108: Create new project's step 2 (with --mode repository)
  options: {
    cause: ['no-access', 'not-found'],
    review: ['awaiting', 'issues-off', 'manual', 'no-push', 'running'],
    source: ['new'],
  },
  sampleRepository,
  seed,
  typeIn,
  waitFor,
};
