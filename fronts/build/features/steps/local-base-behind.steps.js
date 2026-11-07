// Steps of fronts/build/features/local-base-behind-805.feature: a local run says when its base is
// behind origin before it starts, on the Start panel and on the Roadmap. Locators are roles and
// data-testid only (skills/ui-conventions).
//
// Contract (what the screens expose for these steps):
// - Start panel: when the start answers with a question the panel stays open and nothing is reported as
//   started; data-testid="start-base-notice" holds the count, the base and origin ("2 commits behind
//   origin/main"), with the buttons data-testid="start-base-update" and "start-base-continue".
// - diverged: the same notice, its text says the base was not moved and names the Backlog; no
//   "start-base-update", "start-base-continue" stays.
// - Roadmap: data-testid="roadmap-base-notice" with the count and "origin/main", the buttons
//   data-testid="roadmap-base-update" and "roadmap-base-continue"; a click on one takes the notice away.
//
// The repositories are made under the scenario's scratch folder (e2e.scratch), with a fixed identity
// and no machine config: `origin` is a bare repository and origin's extra commits are pushed from a
// second clone. The demo folder never fetches them, so it stays behind until the app looks.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');
const { LOAD_TIMEOUT, visibleTestId } = require('../../../../features/support/run-screen');

const commits = (n) => `${n} commit${n === 1 ? '' : 's'}`;

// the scenario's scratch folder (the workspace is <scratch>/workspace)
function scratchOf(e2e) {
  const scratch = e2e.scratch || (process.env.MULTIAGENT_WORKSPACE && path.dirname(process.env.MULTIAGENT_WORKSPACE));
  if (!scratch) throw new Error('no scratch folder: open the app first');
  return scratch;
}

function git(e2e, cwd, args) {
  const config = path.join(scratchOf(e2e), 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

const demoFolder = (e2e) => {
  const folder = e2e.project && e2e.project.folder;
  if (!folder) throw new Error('the demo project has no folder');
  return folder;
};

function commitFile(e2e, cwd, name) {
  fs.writeFileSync(path.join(cwd, name), `${name} (simulated data)\n`);
  git(e2e, cwd, ['add', '-A']);
  git(e2e, cwd, ['commit', '-q', '-m', name]);
}

// the demo folder's main pushed to a bare origin, `behind` commits added to origin from a second clone
// and `ahead` commits added to the demo folder only; then the app reloads
async function setUpBase(e2e, { behind, ahead = 0 }) {
  const folder = demoFolder(e2e);
  const origin = path.join(scratchOf(e2e), 'origin-805.git');
  const clone = path.join(scratchOf(e2e), 'second-clone-805');
  if (!fs.existsSync(path.join(folder, '.git'))) git(e2e, folder, ['init', '-q', '-b', 'main']);
  git(e2e, folder, ['add', '-A']);
  git(e2e, folder, ['commit', '-q', '--allow-empty', '-m', 'The demo project']);
  fs.mkdirSync(origin, { recursive: true });
  git(e2e, origin, ['init', '-q', '--bare', '-b', 'main']);
  git(e2e, folder, ['remote', 'add', 'origin', origin]);
  git(e2e, folder, ['push', '-q', '-u', 'origin', 'main']);
  git(e2e, scratchOf(e2e), ['clone', '-q', origin, clone]);
  for (let i = 1; i <= behind; i++) commitFile(e2e, clone, `ORIGIN-${i}.md`);
  git(e2e, clone, ['push', '-q', 'origin', 'main']);
  for (let i = 1; i <= ahead; i++) commitFile(e2e, folder, `LOCAL-${i}.md`);
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
}

Given('the demo project\'s local main is {int} commit(s) behind origin', async ({ e2e }, behind) => {
  await setUpBase(e2e, { behind });
});

Given('the demo project\'s local main is {int} commit(s) ahead of and {int} commit(s) behind origin', async ({ e2e }, ahead, behind) => {
  await setUpBase(e2e, { behind, ahead });
});

// ---- the Start panel ----------------------------------------------------------------------------

const startNotice = (page) => visibleTestId(page, 'start-base-notice');

Then('the Start panel says the base is {int} commit(s) behind origin\\/main', async ({ e2e }, n) => {
  const notice = startNotice(e2e.window);
  await expect(notice).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(notice).toContainText(`${commits(n)} behind origin/main`);
});

Then('the Start panel offers to update the base or go on', async ({ e2e }) => {
  const page = e2e.window;
  await expect(visibleTestId(page, 'start-base-update')).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await expect(visibleTestId(page, 'start-base-continue')).toBeEnabled();
});

// the panel is still open, no Run screen came up and no run folder holds the task
Then('no run of the task {string} has started', async ({ e2e }, task) => {
  const page = e2e.window;
  await expect(page.getByTestId('start-workflow')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('run-screen-status').filter({ visible: true })).toHaveCount(0);
  const runs = path.join(scratchOf(e2e), 'workspace', 'runs');
  const started = (fs.existsSync(runs) ? fs.readdirSync(runs) : []).filter((id) => {
    try { return fs.readFileSync(path.join(runs, id, 'events.jsonl'), 'utf8').includes(task); } catch { return false; }
  });
  expect(started, `runs of the task "${task}"`).toEqual([]);
});

When('I choose to go on from the local base in the Start panel', async ({ e2e }) => {
  await visibleTestId(e2e.window, 'start-base-continue').click();
});

Then('the Start panel says the base was not moved and points to the Backlog', async ({ e2e }) => {
  const notice = startNotice(e2e.window);
  await expect(notice).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(notice).toContainText(/(not|n't)( been)? moved/i);
  await expect(notice).toContainText('Backlog');
});

// checked once the notice is on screen, so the absence means something
Then('the Start panel offers no update of the base', async ({ e2e }) => {
  const page = e2e.window;
  await expect(startNotice(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('start-base-update')).toHaveCount(0);
});

// ---- the Roadmap --------------------------------------------------------------------------------

Then('the Roadmap says the base is {int} commit(s) behind origin\\/main', async ({ e2e }, n) => {
  const notice = visibleTestId(e2e.window, 'roadmap-base-notice');
  await expect(notice).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(notice).toContainText(`${commits(n)} behind origin/main`);
});

Then('the Roadmap offers to update the base or go on', async ({ e2e }) => {
  const page = e2e.window;
  await expect(visibleTestId(page, 'roadmap-base-update')).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await expect(visibleTestId(page, 'roadmap-base-continue')).toBeEnabled();
});

When('I choose to update the base in the Roadmap', async ({ e2e }) => {
  await visibleTestId(e2e.window, 'roadmap-base-update').click();
});

Then('the Roadmap no longer says the base is behind', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('roadmap-base-notice')).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});
