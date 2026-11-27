// Steps of features/105-local-import-remote-and-backlog.feature (#105): a repository imported from a folder on
// this computer keeps the folder's real remote (or, with none, a local backlog), never its file:// URL.
// Reuses onboarding.steps.js (the wizard, "a local git repository is ready to import", "I enter the local
// repository and the project name", Define manually, the way of working and the picked tiles, the review's
// findings), app.steps.js (the sidebar, the header's project), fronts/build's projects.steps.js (the project page),
// local-backlog.steps.js and project-without-remote.steps.js (the local Backlog).
//
// What the screens expose (existing test ids):
// - data-testid="projects-screen" / "project-card": the Projects screen's cards, each with its "Repository" line
//   (the project's repo, "—" when none);
// - the review's findings: wizard-review-findings / wizard-review-finding, each with wizard-review-create-issue,
//   replaced once filed by the link wizard-review-finding-issue ("#<n>").
//
// The folder with a remote is a real git repository under the scenario's scratch folder (as onboarding.steps.js
// makes it), with `git remote add origin <url>`; it is imported by its file:// URL, as step 1's folder card does.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const ANALYSIS_TIMEOUT = 120000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wizard = (page) => page.getByTestId('project-wizard');
const review = (page) => wizard(page).getByTestId('wizard-review');
const firstFinding = (page) => review(page).getByTestId('wizard-review-findings').getByTestId('wizard-review-finding').first();
const projectsScreen = (page) => page.getByTestId('projects-screen').filter({ visible: true }).first();
const projectCard = (page, name) => projectsScreen(page).getByTestId('project-card').filter({ hasText: name }).first();

// a git repository with one commit (fixed identity, no machine config) and the remote `origin` at `remote`
function repositoryWithRemote(scratch, name, remote) {
  const folder = path.join(scratch, 'folders', name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), `# ${name}\n`);
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, private: true, scripts: { test: 'node -e ""' } }, null, 2));
  const config = path.join(scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  const git = (args) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: folder, env, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'First commit']);
  git(['remote', 'add', 'origin', remote]);
  return pathToFileURL(folder).href;
}

Given('a local git repository whose remote is {string} is ready to import', async ({ e2e }, remote) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const name = remote.replace(/\.git$/, '').split('/').pop() || 'remote-repo';
  e2e.localRepo = repositoryWithRemote(e2e.scratch, name, remote);
});

Then('the Projects screen shows the repository {string} for the project {string}, not the folder\'s file URL', async ({ e2e }, repo, name) => {
  const card = projectCard(e2e.window, name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).toContainText(new RegExp(escapeRe(repo)));
  await expect(card).not.toContainText('file://');
});

When("I create an issue from the review's first finding", async ({ e2e }) => {
  const row = firstFinding(e2e.window);
  await expect(row).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  const button = row.getByTestId('wizard-review-create-issue');
  await expect(button).toBeEnabled();
  await button.click();
});

// filed: the row's buttons give way to the issue's link ("#<n>"); a failure would leave the buttons and a toast
Then("the review's first finding links to its issue", async ({ e2e }) => {
  const row = firstFinding(e2e.window);
  const link = row.getByTestId('wizard-review-finding-issue');
  await expect(link).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(link).toHaveText(/#\d+/);
  await expect(row.getByTestId('wizard-review-create-issue')).toHaveCount(0);
});
