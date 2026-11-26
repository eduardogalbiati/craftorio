// Steps of the "main stays green" scenarios (#405) in fronts/build/features/roadmap.feature and
// features/settings.feature: the Roadmap's one line of the base's known failures, the red-base choice
// in Settings › Execution, and the fix item a red base check puts at the front of the roadmap.
// State is seeded through packages/engine/domains/project/base-health.js (required inside the steps, never at the top: bddgen
// loads this file before the module exists). Locators are roles and data-testid only.
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="base-failures": one line on the Roadmap ("1 known failure on the base"), absent when
//   the base has none; data-testid="base-failures-link" inside it opens the details (they name each test).
// - data-testid="base-check-on-red": Settings › Execution's red-base choice, a <select> whose options
//   read "Off", "Issue only" and "Issue + fix item" (values off | issue | fix); the test id is on the
//   native <select> under the design-system control, like the time zone list (#383).
// - data-testid="base-check-card" (#465): the Roadmap's base check line, its state in data-status; new
//   for #527: data-status="waiting" and a text reading "waiting for the suite slot" while another run
//   holds the machine's `suite` slot (packages/engine/engine/machine-slot.js).
//
// #527 (fronts/analyser/features/base-health.feature): the app is launched with its temp folder (TMP/TEMP/TMPDIR, so
// machineSlotDir()) and CRAFTORIO_LOCKS_DIR in a folder of the scenario, never the machine's; the
// "other run" is a suite.slot file there held by this test process (alive, this host), as
// machine-slot.js writes it. The base check is started inside the app's main process through the
// service's own base-health area (afterBaseMerge, kept by features/support/electron-main.js), as a
// real run's local merge starts it, on the demo project's folder made a git repository.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
const root = path.join(__dirname, '..', '..', '..', '..');
const baseHealth = () => require(path.join(root, 'packages', 'engine', 'domains', 'project', 'base-health'));
const wsRoot = (e2e) => path.join(e2e.scratch, 'workspace');

const failuresLine = (page) => page.getByTestId('base-failures');
const onRedChoice = (page) => page.getByTestId('base-check-on-red');
const stage = (page, n) => page.getByTestId('roadmap-stage').filter({ hasText: new RegExp(`\\bStage ${n}\\b`) }).first();

// git with a fixed identity, never the machine's config (an empty global config: next to cwd by default)
function git(cwd, args, globalConfig = path.join(cwd, '..', 'empty.gitconfig')) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig };
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

// #85: the help under "When the base goes red" (data-testid="base-check-help", new): says the check is
// off by default and what turning it on does (files issues; with a fix item, a Fix-the-base stage)
Then('the base check help mentions {string}', async ({ e2e }, text) => {
  const help = e2e.window.getByTestId('base-check-help');
  await expect(help).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(help).toContainText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

// #85: the base check is off by default; a scenario that needs it on saves the choice the owner would
// make in Settings › Execution (settings.json baseCheck.onRed, read by the service on every check)
const ON_RED = { Off: 'off', 'Issue only': 'issue', 'Issue + fix item': 'fix' };
Given('the base check is set to {string}', async ({ e2e }, label) => {
  const onRed = ON_RED[label];
  if (!onRed) throw new Error(`the red-base choice reads ${Object.keys(ON_RED).join(', ')}, not "${label}"`);
  const file = path.join(wsRoot(e2e), 'settings.json');
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...settings, baseCheck: { ...(settings.baseCheck || {}), onRed } }, null, 2));
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

// ---- #527: the base check waits for the machine's suite slot ------------------------------------------

const baseCheckCard = (page) => page.getByTestId('base-check-card').filter({ visible: true }).first();
const OTHER_RUN = '20261023-120000-cccc3333';

// The app's temp folder (machineSlotDir) and CRAFTORIO_LOCKS_DIR in a folder of this scenario, its
// suite slot held by "another run": this test process, alive on this host (machine-slot.js's holder)
Given("the app is open while another run holds the machine's suite slot", async ({ e2e }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-e2e-slots-'));
  const locks = path.join(tmp, 'craftorio', 'locks');
  fs.mkdirSync(locks, { recursive: true });
  const slot = path.join(locks, 'suite.slot');
  fs.writeFileSync(slot, JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'e2e-other-run', started: Date.now(), holder: OTHER_RUN }), { flag: 'wx' });
  e2e.suiteSlot = slot;
  await e2e.open({ env: { TMP: tmp, TEMP: tmp, TMPDIR: tmp, CRAFTORIO_LOCKS_DIR: locks } });
  const close = e2e.close;
  e2e.close = async () => {
    await close();
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* the OS temp folder cleans it */ }
  };
});

// the demo project's folder as a git repository whose base has one commit, with a quick test script
Given('the demo project is a git repository on the base {string}', async ({ e2e }, base) => {
  const folder = e2e.project.folder;
  const pkg = path.join(folder, 'package.json');
  const data = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  data.scripts = { ...data.scripts, test: 'node -e "process.exit(0)"' };
  fs.writeFileSync(pkg, JSON.stringify(data, null, 2));
  const config = path.join(e2e.scratch, 'empty.gitconfig');
  fs.writeFileSync(config, '');
  git(folder, ['init', '-q', '-b', base], config);
  git(folder, ['add', '-A'], config);
  git(folder, ['commit', '-q', '-m', 'Initial commit'], config);
});

// what the service does on a real run's `worktree.merged` (packages/engine/service/areas/runs.js): not awaited,
// the check waits for the slot in the background
When('a merge into the base {string} starts the base check', async ({ e2e }, base) => {
  const res = await e2e.app.evaluate((_electron, a) => {
    const area = global.craftorioE2E?.baseHealth;
    if (!area) return { missing: true };
    try {
      const check = area.afterBaseMerge({ projectId: a.projectId, runId: a.runId, mock: false }, { base: a.base, tested: 'green' });
      check?.catch?.(() => {});
      return { started: !!check };
    } catch (e) { return { thrown: String(e?.message || e) }; }
  }, { projectId: e2e.project.id, runId: '20261023-121500-dddd4444', base });
  expect(res.missing, "the app's main process keeps the service's base-health area").toBeFalsy();
  expect(res.thrown, 'starting the base check').toBeFalsy();
  expect(res.started, 'the merge started a base check').toBe(true);
});

Then("the roadmap's base check reads {string}", async ({ e2e }, text) => {
  const card = baseCheckCard(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).toHaveAttribute('data-status', 'waiting');
  await expect(card).toContainText(text, { ignoreCase: true });
});

// ---- #750: the Roadmap header's activity band while the base check runs ------------------------------
// (fronts/build/features/roadmap.feature). The app gets a suite slot of the scenario's own (its temp
// folder and CRAFTORIO_LOCKS_DIR, as #527), free, so no other suite on the machine makes the check wait.
Given("the app is open with the machine's suite slot free", async ({ e2e }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-e2e-slots-'));
  const locks = path.join(tmp, 'craftorio', 'locks');
  fs.mkdirSync(locks, { recursive: true });
  await e2e.open({ env: { TMP: tmp, TEMP: tmp, TMPDIR: tmp, CRAFTORIO_LOCKS_DIR: locks } });
  const close = e2e.close;
  e2e.close = async () => {
    await close();
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* the OS temp folder cleans it */ }
  };
});

// as "the demo project is a git repository on the base …", its test script lasting about 90 s (the check
// stays "running" while the scenario looks at it); the base's commit noted in e2e.baseCommit
Given('the demo project is a git repository on the base {string} whose suite runs for a while', async ({ e2e }, base) => {
  const folder = e2e.project.folder;
  const pkg = path.join(folder, 'package.json');
  const data = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  data.scripts = { ...data.scripts, test: 'node -e "setTimeout(function () {}, 90000)"' };
  fs.writeFileSync(pkg, JSON.stringify(data, null, 2));
  const config = path.join(e2e.scratch, 'empty.gitconfig');
  fs.writeFileSync(config, '');
  git(folder, ['init', '-q', '-b', base], config);
  git(folder, ['add', '-A'], config);
  git(folder, ['commit', '-q', '-m', 'Initial commit'], config);
  e2e.baseCommit = git(folder, ['rev-parse', 'HEAD'], config);
});

When('the other run frees the suite slot', async ({ e2e }) => {
  fs.rmSync(e2e.suiteSlot, { force: true });
});

Then("the roadmap's base check is no longer waiting", async ({ e2e }) => {
  const card = baseCheckCard(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).not.toHaveAttribute('data-status', 'waiting', { timeout: LOAD_TIMEOUT });
  await expect(card).not.toContainText('waiting for the suite slot', { ignoreCase: true });
});
