// Steps of the #46 scenarios of fronts/build/features/releases.feature: a repository that declares two
// products in .craftorio/project.yaml, and a simulated release run of one of them. Opening the Start
// panel, the gate card, its choices and the run's end are the existing steps (releases.steps.js,
// run.steps.js, roadmap.steps.js, pr-monitor.steps.js). Locators are roles and data-testid only.
//
// What the screens expose (no new data-testid): the release workflow's inputs `product` and `version`
// (workflow-inputs.js: data-testid="input-<key>"), in the Start panel's "Advanced parameters"; the Ship
// gate's card (run-gate), whose message may sit in its collapsed Details (read as text, hidden or not).
//
// Assumption (the developer reads it this way): a product is { id, version_command, tag_prefix, folder }
// in the manifest's `products`; changesets are in the repository's `.changeset` folder. The repository
// has the app and the engine at 1.0.0, tagged v1.0.0 and engine-v1.0.0.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');
const { openStartPanel, runScreenStatus } = require('../../../../features/support/run-screen');

const LOAD_TIMEOUT = 30000;
const GATE_TIMEOUT = 120000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const gateCard = (page) => page.getByTestId('run-gate').filter({ visible: true }).first();

const MANIFEST = [
  'version: 1',
  'products:',
  '  - id: app',
  '    folder: app',
  '    version_command: node bump.js app',
  '    tag_prefix: v',
  '  - id: engine',
  '    folder: engine',
  '    version_command: node bump.js engine',
  '    tag_prefix: engine-v',
  '',
].join('\n');

// git in the project's folder with a fixed identity, never the machine's config
function git(e2e, args) {
  const config = path.join(e2e.scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config };
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: e2e.project.folder, env, encoding: 'utf8' }).trim();
}

function commit(e2e, files, message) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(e2e.project.folder, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  git(e2e, ['add', '-A']);
  git(e2e, ['commit', '-q', '-m', message]);
}

const pkg = (name) => `${JSON.stringify({ name, version: '1.0.0', private: true }, null, 2)}\n`;

Given('the project\'s repository has the products {string} and {string}, both released at {string}', async ({ e2e }, app, engine, version) => {
  expect([app, engine, version], 'the products this step seeds').toEqual(['app', 'engine', '1.0.0']);
  fs.mkdirSync(e2e.project.folder, { recursive: true });
  git(e2e, ['init', '-q', '-b', 'main']);
  commit(e2e, {
    '.craftorio/project.yaml': MANIFEST,
    'bump.js': '// writes the product\'s next version; a simulation never runs it\n',
    'app/package.json': pkg('demo-app-desktop'),
    'engine/package.json': pkg('demo-engine'),
  }, 'Declare the products');
  git(e2e, ['tag', 'v1.0.0']);
  git(e2e, ['tag', 'engine-v1.0.0']);
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

// merged after the engine's last tag, in the engine's folder; only the second one has a changeset
Given('the issue {string} was merged into the engine with no changeset and the issue {string} with one', async ({ e2e }, without, withOne) => {
  commit(e2e, { 'engine/retry.js': 'module.exports = 1;\n' }, `Retry a run after a crash (${without})\n\nCloses ${without}`);
  const number = withOne.replace('#', '');
  commit(e2e, {
    'engine/export.js': 'module.exports = 2;\n',
    [`.changeset/export-${number}.md`]: '---\n"demo-engine": minor\n---\n\nExport a run report.\n',
  }, `Export a run report (${withOne})\n\nCloses ${withOne}`);
});

// Start panel: the Release workflow, its Product and Version typed (or picked) in Advanced parameters
When('I start a simulated release of the product {string} as {string} from the Start panel', async ({ e2e }, product, version) => {
  const page = e2e.window;
  await openStartPanel(e2e);
  await page.getByRole('combobox', { name: 'Workflow', exact: true }).selectOption('release.yaml');
  const field = (key) => page.getByTestId(`input-${key}`);
  if (!(await field('version').isVisible())) await page.getByText('Advanced parameters', { exact: true }).filter({ visible: true }).first().click();
  const main = page.getByTestId('start-main-input');
  if (await main.isVisible()) await main.fill(`Release ${version}`);
  await expect(field('product'), 'the release workflow has a Product input').toBeVisible();
  if (await field('product').evaluate((el) => el.tagName === 'SELECT')) await field('product').selectOption(product);
  else await field('product').fill(product);
  await field('version').fill(version);
  await page.getByRole('checkbox', { name: /Simulation mode/ }).check();
  await page.getByTestId('start-workflow').click();
});

// as releases.steps.js' "a simulated release run ... is open": the Start panel's own call, then the Run screen
Given('a simulated release run of the product {string} as {string} is open', async ({ e2e }, product, version) => {
  const page = e2e.window;
  const res = await page.evaluate(async ({ product, version, projectId, folder }) => {
    try {
      const out = await window.api.startRun({
        file: 'release.yaml', mock: true, projectId,
        inputs: { task: `Release ${version}`, product, version, repo_path: folder },
      });
      return { runId: out?.runId || null, answer: out };
    } catch (e) { return { thrown: String(e?.message || e) }; }
  }, { product, version, projectId: e2e.project.id, folder: e2e.project.folder });
  expect(res.thrown, 'window.api.startRun rejected').toBeFalsy();
  expect(res.runId, `the release run started (${JSON.stringify(res.answer)})`).toBeTruthy();
  await page.evaluate((runId) => window.showRun(runId, { running: true }), res.runId);
});

Then('the gate card says the release is tagged {string} and not {string}', async ({ e2e }, tag, other) => {
  const card = gateCard(e2e.window);
  await expect(card).toContainText(new RegExp(`tag it\\s+\`?${escapeRe(tag)}\\b`), { timeout: GATE_TIMEOUT });
  await expect(card).not.toContainText(new RegExp(`(?<![\\w-])${escapeRe(other)}\\b`));
});

// the issue comes after the words that say it has no changeset, in the card's message
Then('the gate card lists the issue {string} as having no changeset', async ({ e2e }, issue) => {
  await expect(gateCard(e2e.window)).toContainText(new RegExp(`changeset[\\s\\S]{0,300}${escapeRe(issue)}\\b`, 'i'), { timeout: GATE_TIMEOUT });
});

// stopped before the suites: no gate ever, the reason names what was asked and what the repository declares
Then('the run ends as failed, naming the product {string} and the declared products {string} and {string}', async ({ e2e }, asked, a, b) => {
  const page = e2e.window;
  await expect(runScreenStatus(page)).toHaveAttribute('data-status', 'failed', { timeout: LOAD_TIMEOUT });
  const reason = new RegExp([asked, a, b].map((name) => `(?=[\\s\\S]*\\b${escapeRe(name)}\\b)`).join(''));
  await expect(page.getByText(reason).filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('run-gate').filter({ visible: true })).toHaveCount(0);
});
