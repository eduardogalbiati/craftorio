// Steps of features/39-73-local-backlog-states.feature: the Backlog and the Roadmap of a project with no repository
// (#39: no sync line, no platform, a local description; the issue run names no platform) and its state after a local
// merge (#73: no push status, a closed local issue listed as closed). Opening the screens, the language and the
// project are app.steps.js's and settings-language.steps.js's; "the open screen does not say" is
// project-without-remote.steps.js's; the Start panel and the run are fronts/build's run.steps.js's.
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="backlog-description" (NEW): the text under the page's title, on the Backlog and the Roadmap;
// - data-testid="backlog-platform" / "backlog-platform-select" (exist): hidden for a project with no repository;
// - data-testid="backlog-issue", "backlog-state-open" / "backlog-state-closed" (exist): the list and its state chips;
// - data-testid="input-pill" (exists): the run's choices.
//
// The project is written in the scratch workspace with the engine's own domain functions, then the app reloads to read
// the project list again (as app.steps.js addProject). Its folder is no git repository, so the app never refreshes the
// cached push status (<id>.local.json) this scenario seeds.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');
const workflows = require('../support/workflows');

const LOAD_TIMEOUT = 30000;
const root = path.join(__dirname, '..', '..');
const engine = (...parts) => require(path.join(root, 'packages', 'engine', ...parts));

const openScreen = (page) => page.getByRole('main').filter({ visible: true }).first();
const listed = (page, title) => page.getByTestId('backlog-issue').filter({ visible: true, hasText: title });

// ---- the workspace -----------------------------------------------------------------------------------

async function addLocalProject(e2e, name, seed) {
  const projects = engine('domains', 'project', 'projects');
  const ws = engine('domains', 'workspace', 'workspace').setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  const project = await projects.createProject(ws.projects, { name, description: 'A project with no repository (simulated data)' });
  expect(project.repo || null, 'the project has no repository').toBe(null);
  fs.mkdirSync(ws.backlog, { recursive: true });
  seed({ ws, project, local: engine('domains', 'backlog', 'local-backlog') });
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
}

Given('the workspace has a project {string} with no repository and the open local issue {string}', async ({ e2e }, name, title) => {
  await addLocalProject(e2e, name, ({ ws, project, local }) => local.createLocalIssue(ws.backlog, project.id, { title }));
});

Given('the workspace has a project {string} with no repository, the closed local issue {string} and the open local issue {string} whose run merged locally', async ({ e2e }, name, closedTitle, openTitle) => {
  await addLocalProject(e2e, name, ({ ws, project, local }) => {
    const closed = local.createLocalIssue(ws.backlog, project.id, { title: closedTitle });
    local.closeLocalIssue(ws.backlog, project.id, closed.number);
    const open = local.createLocalIssue(ws.backlog, project.id, { title: openTitle });
    const merges = [[closed, 'abfcdf6000000000000000000000000000000001'], [open, 'abfcdf6000000000000000000000000000000002']];
    merges.forEach(([issue, commit], i) => {
      const runId = `20261125-07310${i}-local073${i}`;
      const dir = path.join(ws.runs, runId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
        run_id: runId, workflow: workflows.FEATURE.name, project_id: project.id, status: 'success', mock: false,
        started_at: `2026-11-25T07:3${i}:01.000Z`, finished_at: `2026-11-25T07:4${i}:01.000Z`, duration_ms: 600000,
        issues: [{ number: issue.number, url: '', title: issue.title }], inputs: {}, sessions: [],
        local_merge: { branch: `feat/local-${i}`, base: 'main', commit },
      }, null, 2));
    });
    fs.writeFileSync(path.join(ws.backlog, `${project.id}.local.json`), JSON.stringify({
      base: 'main', ahead: 0, behind: 0, commits: [], issues: [], fetchError: null,
      error: 'origin/main not found: nothing to compare the local main with.', checkedAt: new Date().toISOString(),
    }, null, 2));
  });
});

// ---- the Backlog and the Roadmap ---------------------------------------------------------------------

Then('the local backlog lists the issue {string}', async ({ e2e }, title) => {
  await expect(listed(e2e.window, title).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the local backlog counts {int} open issue(s) and {int} closed issue(s)', async ({ e2e }, open, closed) => {
  await expect(e2e.window.getByTestId('backlog-state-open')).toHaveText(new RegExp(`\\D${open}$`), { timeout: LOAD_TIMEOUT });
  await expect(e2e.window.getByTestId('backlog-state-closed')).toHaveText(new RegExp(`\\D${closed}$`));
});

When('I show the closed issues of the local backlog', async ({ e2e }) => {
  await e2e.window.getByTestId('backlog-state-closed').click();
});

Then('the open screen says {string}', async ({ e2e }, text) => {
  await expect(openScreen(e2e.window)).toContainText(text, { timeout: LOAD_TIMEOUT });
});

// the description says where the issues are, and nothing about a sync or a git platform
Then('the page is described as kept in the workspace', async ({ e2e }) => {
  const description = e2e.window.getByTestId('backlog-description').filter({ visible: true });
  await expect(description).toContainText(/workspace/i, { timeout: LOAD_TIMEOUT });
  await expect(description).not.toContainText(/sync|sincroniz|git platform|plataforma git/i);
});

// 1969 in the time zones behind UTC, 1970 in the others
Then('the page shows no sync date and no unfilled placeholder', async ({ e2e }) => {
  const screen = openScreen(e2e.window);
  await expect(screen).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(screen).not.toContainText(/\b(1969|1970)\b|\{\w+\}/);
  await expect(screen).not.toContainText(/Synced |Sincronizado /);
});

Then('the page offers no git platform', async ({ e2e }) => {
  const page = e2e.window;
  await expect(openScreen(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('backlog-platform-select').filter({ visible: true })).toHaveCount(0);
  await expect(page.getByTestId('backlog-platform').filter({ visible: true })).toHaveCount(0);
});

// ---- the issue run -----------------------------------------------------------------------------------

When('I start the issue run in simulation with the request {string}', async ({ e2e }, request) => {
  const page = e2e.window;
  await page.getByTestId('start-main-input').fill(request);
  await page.getByRole('checkbox', { name: /Simulation mode/ }).check();
  await page.getByTestId('start-workflow').click();
});

// checked once the run's other choices are drawn ("the run shows the pill …" before it)
Then('the run shows no input pill {string}', async ({ e2e }, label) => {
  const pills = e2e.window.getByTestId('input-pill').filter({ visible: true });
  await expect(pills.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(pills.filter({ hasText: `${label}:` })).toHaveCount(0);
});
