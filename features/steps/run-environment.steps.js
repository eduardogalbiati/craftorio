// Steps of features/30-dependencies-not-installed.feature (#30): a run on a project whose dependencies
// were never installed. The rule checks (rule_check, `npm run check`) cannot run without them: the run
// stops once at a gate that says so in one line, in the interface language, with "Try again" ("Tentar
// de novo"), instead of sending the developer back twice and stopping at check_failed with a stack trace.
// The Start panel, "a gate card waits for my approval" and the Validated pick are run.steps.js's; the
// language switch is settings-language.steps.js's; "I switch the run to its chat" is display-names.steps.js's;
// "I choose {string} on the gate card" is fronts/build/features/steps/roadmap.steps.js's.
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="run-gate": the gate card (existing), data-run its run; its summary reads "step: <id>";
//   data-testid="run-gate-choice": its choice buttons (existing), named by their label;
// - data-testid="check-environment-message" (NEW): inside the gate card, the one-line cause, e.g.
//   en "the project's dependencies are not installed: run npm ci in <folder>",
//   pt-BR "as dependências do projeto não estão instaladas: rode npm ci em <pasta>";
//   the gate card offers the choice "Try again" / "Tentar de novo", which reruns the rule checks;
// - data-testid="run-chat-step": the run chat's step tags (existing), "<Step> · visit <n>" from the
//   second visit on;
// - data-testid="sidebar-footer": the sidebar's runs in progress (existing), one button per run with
//   data-gate="1" when it waits at a gate.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// a simulated run of feature reaches a gate in well under a minute (run.steps.js GATE_TIMEOUT)
const GATE_TIMEOUT = 120000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stepIdOf = (name) => name.trim().toLowerCase().replace(/\s+/g, '_');
const visibleGates = (page) => page.getByTestId('run-gate').filter({ visible: true });
const gateCard = (page) => visibleGates(page).first();
const environmentMessage = (page) => gateCard(page).getByTestId('check-environment-message');
const gateChoice = (page, name) => gateCard(page).getByTestId('run-gate-choice').filter({ hasText: new RegExp(`^\\s*${escapeRe(name)}\\s*$`) });

// the one dependency the demo project's check needs: `npm run check` fails with MODULE_NOT_FOUND until
// node_modules holds it, and passes once it does
const DEPENDENCY = 'left-pad';
const lockfile = (name) => ({
  name,
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name, dependencies: { [DEPENDENCY]: '1.3.0' } },
    [`node_modules/${DEPENDENCY}`]: { version: '1.3.0', resolved: `https://registry.npmjs.org/${DEPENDENCY}/-/${DEPENDENCY}-1.3.0.tgz`, license: 'WTFPL' },
  },
});

// The demo project's folder (features/support/app.js seeds its package.json): a `check` script that
// requires the dependency, the dependency in package.json and in package-lock.json, and no node_modules
// (the state of a repository freshly imported, never installed). The lockfile matches no entry of the
// seeded dependency cache, so nothing links a node_modules for the run either.
Given('the demo project has a check script and a lockfile, but its dependencies were never installed', async ({ e2e }) => {
  const folder = e2e.project?.folder;
  if (!folder) throw new Error('the demo project has no folder: open the app on the demo workspace first');
  fs.mkdirSync(folder, { recursive: true });
  const pkg = {
    name: 'demo-app',
    private: true,
    scripts: { start: 'node server.js', check: `node -e "require('${DEPENDENCY}')"` },
    dependencies: { [DEPENDENCY]: '1.3.0' },
  };
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify(pkg, null, 2));
  fs.writeFileSync(path.join(folder, 'package-lock.json'), JSON.stringify(lockfile('demo-app'), null, 2));
  fs.rmSync(path.join(folder, 'node_modules'), { recursive: true, force: true });
});

Then('the gate card says the project\'s dependencies are not installed', async ({ e2e }) => {
  const message = environmentMessage(e2e.window);
  await expect(message).toBeVisible({ timeout: GATE_TIMEOUT });
  await expect(message).toContainText(/dependencies are not installed/i);
  await expect(message).toContainText('npm ci');
});

// the message is the given words, then the folder to run npm ci in, on one line
Then('the gate card says in one line {string} and the project\'s folder', async ({ e2e }, words) => {
  const message = environmentMessage(e2e.window);
  await expect(message).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(message).toHaveText(new RegExp(`^\\s*${escapeRe(words)}\\s+\\S.*$`), { timeout: LOAD_TIMEOUT });
  const text = (await message.innerText()).trim();
  expect(text.includes('\n'), `the cause fits in one line: "${text}"`).toBe(false);
});

// no line of a Node stack trace anywhere in the gate card (its text as the screen shows it)
Then('the gate card shows no stack trace', async ({ e2e }) => {
  const card = gateCard(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  const text = await card.innerText();
  expect(text, 'no "Error: Cannot find module" line').not.toMatch(/Error: Cannot find module/);
  expect(text, 'no MODULE_NOT_FOUND code').not.toMatch(/MODULE_NOT_FOUND/);
  expect(text, 'no "at <frame>" line of a stack trace').not.toMatch(/^\s*at\s+\S+.*(\(|:\d+:\d+)/m);
});

Then('the gate card offers {string}', async ({ e2e }, name) => {
  const choice = gateChoice(e2e.window, name);
  await expect(choice).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(choice).toBeEnabled();
});

Then('the gate card does not offer {string}', async ({ e2e }, name) => {
  await expect(gateCard(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(gateChoice(e2e.window, name)).toHaveCount(0);
});

// the run chat (open) shows Develop once and the rule checks once: no "Develop · visit 2", no second
// "Rule checks" visit before the gate
Then('the developer was not sent back to fix the rule checks', async ({ e2e }) => {
  const tags = e2e.window.getByTestId('run-chat-step').filter({ visible: true });
  await expect(tags.filter({ hasText: /^Develop\b/ }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(tags.filter({ hasText: /^Develop\b.*·\s*visit\s+\d+/ })).toHaveCount(0);
  await expect(tags.filter({ hasText: /^Rule checks\b.*·\s*visit\s+\d+/ })).toHaveCount(0);
});

// back to the run from the sidebar's runs in progress, whatever the interface language
When('I go back to the run waiting at a gate from the sidebar', async ({ e2e }) => {
  const footer = e2e.window.getByTestId('sidebar-footer');
  const run = footer.getByRole('button').and(footer.locator('[data-gate="1"]')).first();
  await expect(run).toBeVisible({ timeout: LOAD_TIMEOUT });
  await run.click();
  await expect(gateCard(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// What the developer does after reading the gate: npm ci in the folder the message names. The step
// writes what npm ci would (node_modules with the dependency and npm's own record of it), only inside
// the scenario's scratch folder.
When('I install the dependencies in the folder the gate card names', async ({ e2e }) => {
  const message = environmentMessage(e2e.window);
  await expect(message).toBeVisible({ timeout: LOAD_TIMEOUT });
  const text = (await message.innerText()).trim();
  const named = text.match(/npm ci (?:in|em)\s+(.+?)[\s.`'"]*$/)?.[1]?.replace(/^[`'"]/, '');
  expect(named, `the gate names a folder: "${text}"`).toBeTruthy();
  const folder = path.resolve(named);
  const scratch = path.resolve(e2e.scratch);
  expect(folder.startsWith(scratch + path.sep), `the folder ${folder} is inside the scenario's scratch folder`).toBe(true);
  expect(fs.existsSync(path.join(folder, 'package-lock.json')), `${folder} holds the lockfile`).toBe(true);
  const dep = path.join(folder, 'node_modules', DEPENDENCY);
  fs.mkdirSync(dep, { recursive: true });
  fs.writeFileSync(path.join(dep, 'package.json'), JSON.stringify({ name: DEPENDENCY, version: '1.3.0', main: 'index.js' }, null, 2));
  fs.writeFileSync(path.join(dep, 'index.js'), 'module.exports = (s, n, c = " ") => String(s).padStart(n, c);\n');
  fs.writeFileSync(path.join(folder, 'node_modules', '.package-lock.json'), JSON.stringify(lockfile(path.basename(folder)), null, 2));
});

// the run went on past the rule checks to the gate of the given step (its card reads "step: <id>")
Then('the gate card of the step {string} waits for my approval', async ({ e2e }, step) => {
  const card = visibleGates(e2e.window).filter({ hasText: new RegExp(`step:\\s*${escapeRe(stepIdOf(step))}\\b`) }).first();
  await expect(card).toBeVisible({ timeout: GATE_TIMEOUT });
});

Then('no gate card says the project\'s dependencies are not installed', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('check-environment-message').filter({ visible: true })).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});
