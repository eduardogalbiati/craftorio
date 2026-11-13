// Steps of features/784-backlog-refresh-baseline.feature (#784): the Backlog Refresh banner of a project with
// no refresh run counts from when the project was added. Reuses the wizard's steps (onboarding.steps.js),
// "the project page of {string} is open" (fronts/build's projects.steps.js), "I choose the project {string}
// in the header" (app.steps.js) and "the backlog of {string} has the open issue {string}"
// (project-workflow-kinds.steps.js). Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps), all existing since #270 / #161:
// - data-testid="page-alerts": the Backlog's alerts, one shown at a time, with data-testid="alerts-counter"
//   ("1/3") and the buttons "Previous alert" / "Next alert" when there are several;
// - data-testid="page-alert": the alert shown; the Backlog Refresh one has the buttons "Refresh now" and
//   "Dismiss for today".
// The merges on the base are counted by an async git call, so the banner may appear a moment after the
// Backlog opens: the positive checks wait for it.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, Then } = require('./fixtures');

const root = path.join(__dirname, '..', '..');
const engine = (...p) => require(path.join(root, 'packages', 'engine', ...p));
const LOAD_TIMEOUT = 30000;
const HOUR = 3600e3;

const openWorkspace = (e2e) => engine('domains', 'workspace', 'workspace').setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });

// git in `folder` with a fixed identity, no machine config, and the given author/committer date
function gitAt(scratch, folder, args, date) {
  const config = path.join(scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: folder, env, encoding: 'utf8' });
}

// A project as the onboarding leaves it, its record dated `days` ago (createdAt, the time it was added);
// its folder is a git repository with a first commit before that and `merges` commits on main since.
Given('the workspace has a project {string} added {int} days ago whose base branch got {int} merges since', async ({ e2e }, name, days, merges) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const projects = engine('domains', 'project', 'projects');
  const dir = openWorkspace(e2e).projects;
  const created = await projects.createProject(dir, { name, description: 'A project added days ago (simulated data)' });
  const now = Date.now();
  const addedAt = new Date(now - days * 24 * HOUR).toISOString();
  const folder = created.folder;
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), `# ${name}\n`);
  const before = new Date(now - (days + 2) * 24 * HOUR).toISOString();
  gitAt(e2e.scratch, folder, ['init', '-q', '-b', 'main'], before);
  gitAt(e2e.scratch, folder, ['add', '-A'], before);
  gitAt(e2e.scratch, folder, ['commit', '-q', '-m', 'First commit, before the project was added'], before);
  for (let i = 1; i <= merges; i += 1) {
    const at = new Date(now - (merges - i + 1) * HOUR).toISOString();
    fs.writeFileSync(path.join(folder, `change-${i}.txt`), `change ${i}\n`);
    gitAt(e2e.scratch, folder, ['add', '-A'], at);
    gitAt(e2e.scratch, folder, ['commit', '-q', '-m', `Merge change ${i}`], at);
  }
  const file = path.join(dir, `${created.id}.json`);
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...meta, repo: `https://github.com/example/${name}`, createdAt: addedAt }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

const alerts = (page) => page.getByTestId('page-alerts').filter({ visible: true }).first();
const shownAlert = (page) => alerts(page).getByTestId('page-alert').filter({ visible: true }).first();
const refreshNow = (alert) => alert.getByRole('button', { name: 'Refresh now', exact: true });

// Next alert until the Backlog Refresh banner (its "Refresh now") is the one shown; returns it
async function refreshBanner(page) {
  await expect(alerts(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(async () => {
    const counter = alerts(page).getByTestId('alerts-counter');
    const text = (await counter.count()) ? (await counter.innerText()).trim() : '1/1';
    const total = Number(text.split('/')[1]) || 1;
    for (let k = 0; k < total; k += 1) {
      if (await refreshNow(shownAlert(page)).count()) return true;
      if (total > 1) await alerts(page).getByRole('button', { name: 'Next alert', exact: true }).click();
    }
    return false;
  }, { timeout: LOAD_TIMEOUT, message: 'the Backlog shows the Backlog Refresh banner' }).toBe(true);
  return shownAlert(page);
}

Then('the Backlog shows no Backlog Refresh banner', async ({ e2e }) => {
  const page = e2e.window;
  // the Backlog has read the project (its Board tab is shown) before the banner is checked
  await expect(page.getByRole('tab', { name: 'Board', exact: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByRole('button', { name: 'Refresh now', exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText(/never refreshed/i).filter({ visible: true })).toHaveCount(0);
});

Then('the Backlog Refresh banner counts {string} the project was added, without saying {string}', async ({ e2e }, merges, never) => {
  const alert = await refreshBanner(e2e.window);
  await expect(alert).toHaveAttribute('data-level', 'warning');
  await expect(alert).toContainText(merges);
  await expect(alert).not.toContainText(never, { ignoreCase: true });
});

Then('the Backlog Refresh banner offers {string} and {string}', async ({ e2e }, a, b) => {
  const alert = await refreshBanner(e2e.window);
  for (const name of [a, b]) await expect(alert.getByRole('button', { name, exact: true })).toBeEnabled();
});
