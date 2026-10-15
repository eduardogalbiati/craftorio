// Steps of the "main stays green" scenarios (#405) in features/roadmap.feature and
// features/settings.feature: the Roadmap's one line of the base's known failures, the red-base choice
// in Settings › Execution, and the fix item a red base check puts at the front of the roadmap.
// State is seeded through src/base-health.js (required inside the steps, never at the top: bddgen
// loads this file before the module exists). Locators are roles and data-testid only.
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="base-failures": one line on the Roadmap ("1 known failure on the base"), absent when
//   the base has none; data-testid="base-failures-link" inside it opens the details (they name each test).
// - data-testid="base-check-on-red": Settings › Execution's red-base choice, a <select> whose options
//   read "Off", "Issue only" and "Issue + fix item" (values off | issue | fix); the test id is on the
//   native <select> under the design-system control, like the time zone list (#383).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const root = path.join(__dirname, '..', '..');
const baseHealth = () => require(path.join(root, 'src', 'base-health'));
const wsRoot = (e2e) => path.join(e2e.scratch, 'workspace');

const failuresLine = (page) => page.getByTestId('base-failures');
const onRedChoice = (page) => page.getByTestId('base-check-on-red');
const stage = (page, n) => page.getByTestId('roadmap-stage').filter({ hasText: new RegExp(`\\bStage ${n}\\b`) }).first();

// git with a fixed identity, never the machine's config
function git(cwd, args) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, '..', 'empty.gitconfig') };
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

// ---- the base's known failures on the Roadmap ---------------------------------------------------------

// the same test failed on the demo project's base in two runs' preexisting checks (no issue CLI: no issue)
Given('the test {string} in {string} fails on the base of the demo project', async ({ e2e }, test, file) => {
  const { recordPreexisting } = baseHealth();
  const commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  for (const runId of ['20261014-101500-aaaa1111', '20261015-091500-bbbb2222']) {
    await recordPreexisting(wsRoot(e2e), { projectId: e2e.project.id, runId, commit, failures: [{ test, file, reason: 'AssertionError: expected 200, got 500' }] });
  }
  expect(baseHealth().knownFailures(wsRoot(e2e), e2e.project.id).map((f) => f.test)).toContain(test);
});

Then('the roadmap shows one line reading {string}', async ({ e2e }, text) => {
  const line = failuresLine(e2e.window);
  await expect(line).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(line).toBeVisible();
  await expect(line).toContainText(text);
  await expect(line.getByTestId('base-failures-link')).toBeVisible();
});

When("I open the base's known failures from that line", async ({ e2e }) => {
  await failuresLine(e2e.window).getByTestId('base-failures-link').click();
});

Then('the details name the test {string} in {string}', async ({ e2e }, test, file) => {
  const page = e2e.window;
  await expect(page.getByText(test, { exact: false }).filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByText(file, { exact: false }).filter({ visible: true }).first()).toBeVisible();
});

// ---- Settings › Execution: when the base goes red -----------------------------------------------------

Then('the red-base choice offers {string}, {string} and {string}, with {string} selected', async ({ e2e }, a, b, c, selected) => {
  const select = onRedChoice(e2e.window);
  await expect(select).toBeAttached({ timeout: LOAD_TIMEOUT });
  const labels = await select.locator('option').evaluateAll((els) => els.map((el) => el.textContent.trim()));
  expect(labels).toEqual([a, b, c]);
  await expect.poll(() => select.evaluate((el) => el.selectedOptions[0]?.textContent.trim())).toBe(selected);
});

// ---- a red base check puts a fix item at the front of the roadmap -------------------------------------

// A base check of the demo project after a merge, on a scratch repository's main, its suite red on one
// test; Settings' default (fix). The issue CLI is a fake: a create returns the new issue's URL.
Given('a base check after a merge finds the test {string} in {string} red', async ({ e2e }, test, file) => {
  const { runBaseCheck } = baseHealth();
  const repo = path.join(e2e.scratch, 'base-repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(e2e.scratch, 'empty.gitconfig'), '');
  git(repo, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# demo-app\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'Initial commit']);
  const exec = async (cli, args) => (args.includes('issue') && args.includes('create') ? 'https://github.com/example/demo-app/issues/4051\n' : '[]');
  const result = await runBaseCheck(wsRoot(e2e), {
    projectId: e2e.project.id, repo, base: 'main', platform: 'github', ghRepo: 'example/demo-app', trigger: 'merge', onRed: 'fix',
    releaseHoldsBase: () => false,
    runSuite: async () => ({ failures: [{ test, file, error: 'AssertionError: expected 200, got 500' }], log: `not ok 1 - ${test}` }),
    exec,
  });
  expect(result.status).toBe('red');
  expect(result.fixItem, 'the red check inserted a fix item').toBeTruthy();
});

Then('stage {int} holds only the fix item for {string}', async ({ e2e }, n, test) => {
  const items = stage(e2e.window, n).getByTestId('roadmap-item');
  await expect(items).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(items.first()).toContainText(test);
});

Then('stage {int} shows the item {string}', async ({ e2e }, n, title) => {
  await expect(stage(e2e.window, n).getByTestId('roadmap-item').filter({ hasText: title })).toHaveCount(1, { timeout: LOAD_TIMEOUT });
});
