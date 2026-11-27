// Steps of features/97-orchestrator-ai-choice.feature (#97): the Setup's AIs step asks which AI runs as the
// orchestrator (Claude Code or Codex CLI, a radio group; Grok Build has no choice; a CLI that is not ready
// cannot be chosen), Settings › Agents & CLIs shows and changes the same choice, and a run of a default
// workflow then shows its sessions on the chosen provider's models. The Setup's other steps are
// setup.steps.js's; Settings' tabs app.steps.js's; the Start panel fronts/build/features/steps/run.steps.js's.
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (NEW, the developer adds them):
//   setup-orchestrator-claude      in the Setup's Claude Code card (setup-cli-claude), its "Use as
//   setup-orchestrator-codex       orchestrator" radio (an <input type="radio">, one name for both, so
//                                  one radio group: exactly one checked, the arrow keys move it), its
//                                  accessible name mentions "orchestrator"; disabled while that CLI is
//                                  not ready (Not installed / Not signed in). Grok Build's card
//                                  (setup-cli-grok) holds no radio.
//   settings-orchestrator-claude   the same two radios in Settings › Agents & CLIs (settings-clis), saved
//   settings-orchestrator-codex    when they change (the next run uses it)
//   the AIs step's title           a heading of the Setup reading the question
// Existing: run-session-card on the Run screen's Details (fronts/build/views/run/run.js renderSessions):
// data-id="orchestrator" for the orchestrator, data-agent="<agent id>" for an agent; its badges read the
// provider id ("codex") and the model.
// What they expect of the engine (simulation only), like CRAFTORIO_E2E_CLI_MISSING
// (packages/engine/domains/machine/simulated-clis.js): CRAFTORIO_E2E_CLI_READY=<id>[,<id>] makes the probes
// find that CLI installed and signed in (a simulated version and account), CRAFTORIO_E2E_CLI_SIGNED_OUT=
// <id>[,<id>] installed but not signed in, whatever the machine running the scenario has.

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');
const { runTab } = require('../support/run-screen');

const LOAD_TIMEOUT = 30000;
// the CLI checks (each CLI's --version and auth status)
const CHECK_TIMEOUT = 45000;
// a simulated fix run opens its developer session well within two minutes
const RUN_TIMEOUT = 120000;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const AI_CLIS = { 'Claude Code': 'claude', 'Codex CLI': 'codex', 'Grok Build': 'grok' };
// the two CLIs that can run the orchestrator
const ORCHESTRATORS = ['Claude Code', 'Codex CLI'];
const aiId = (name) => {
  const id = AI_CLIS[name];
  if (!id) throw new Error(`unknown AI CLI "${name}" (one of ${Object.keys(AI_CLIS).join(', ')})`);
  return id;
};
const orchestratorId = (name) => {
  if (!ORCHESTRATORS.includes(name)) throw new Error(`"${name}" cannot run the orchestrator (one of ${ORCHESTRATORS.join(', ')})`);
  return aiId(name);
};

const setup = (page) => page.getByTestId('setup');
const setupCard = (page, name) => setup(page).getByTestId(`setup-cli-${aiId(name)}`);
const setupRadio = (page, name) => setup(page).getByTestId(`setup-orchestrator-${orchestratorId(name)}`);
const settingsSection = (page) => page.getByTestId('settings-clis').filter({ visible: true });
const settingsRadio = (page, name) => settingsSection(page).getByTestId(`settings-orchestrator-${orchestratorId(name)}`);

// ---- a simulated machine with its AI CLIs ready or not signed in --------------------------------------

Given('the app is open on a machine where {string} and {string} are ready', async ({ e2e }, first, second) => {
  await e2e.open({ env: { CRAFTORIO_E2E_CLI_READY: `${aiId(first)},${aiId(second)}` } });
});

Given('the app is open on a machine where {string} is ready and {string} is not signed in', async ({ e2e }, ready, signedOut) => {
  await e2e.open({ env: { CRAFTORIO_E2E_CLI_READY: aiId(ready), CRAFTORIO_E2E_CLI_SIGNED_OUT: aiId(signedOut) } });
});

// ---- the Setup's AIs step -----------------------------------------------------------------------------

Then("the Setup's AIs step asks {string}", async ({ e2e }, question) => {
  await expect(setup(e2e.window).getByRole('heading', { name: question, exact: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// the two radios are radios, in one group (checking one unchecks the other), each in its own card
async function expectOneChecked(radios, chosen) {
  for (const [name, radio] of radios) {
    await expect(radio, `the orchestrator radio of ${name}`).toBeVisible({ timeout: LOAD_TIMEOUT });
    await expect(radio).toBeChecked({ checked: name === chosen, timeout: CHECK_TIMEOUT });
  }
}

Then("the Setup's orchestrator choice is one radio group of Claude Code and Codex CLI", async ({ e2e }) => {
  const page = e2e.window;
  await expect(setup(page).getByTestId('setup-check-again'), 'the CLIs are checked').toBeEnabled({ timeout: CHECK_TIMEOUT });
  const names = [];
  for (const name of ORCHESTRATORS) {
    const radio = setupRadio(page, name);
    await expect(radio).toBeVisible({ timeout: LOAD_TIMEOUT });
    // a radio (native or role="radio"), named for what it does, inside its CLI's card
    await expect(setupCard(page, name).getByRole('radio', { name: /orchestrator/i })).toHaveCount(1);
    await expect(radio).toHaveAccessibleName(/orchestrator/i);
    expect(await radio.evaluate((el) => el.type === 'radio' || el.getAttribute('role') === 'radio'), `${name}'s choice is a radio`).toBe(true);
    names.push(await radio.evaluate((el) => el.name || el.closest('[role="radiogroup"]')?.id || ''));
  }
  expect(names[0], 'the two radios share a group').toBeTruthy();
  expect(names[1], 'the two radios share a group').toBe(names[0]);
  // exactly one of them checked
  const checked = await Promise.all(ORCHESTRATORS.map((n) => setupRadio(page, n).isChecked()));
  expect(checked.filter(Boolean), 'exactly one orchestrator chosen').toHaveLength(1);
});

Then("the Setup's orchestrator is {string}", async ({ e2e }, chosen) => {
  orchestratorId(chosen);
  await expectOneChecked(ORCHESTRATORS.map((n) => [n, setupRadio(e2e.window, n)]), chosen);
});

// the arrow keys from the checked radio, as in any radio group: the focus and the choice move together
When("I move the Setup's orchestrator choice to {string} with the keyboard", async ({ e2e }, target) => {
  const page = e2e.window;
  const radio = setupRadio(page, target);
  await expect(radio).toBeEnabled({ timeout: CHECK_TIMEOUT });
  const current = ORCHESTRATORS.filter((n) => n !== target).map((n) => setupRadio(page, n));
  await current[0].focus();
  for (let i = 0; i < ORCHESTRATORS.length && !(await radio.isChecked()); i++) await page.keyboard.press('ArrowDown');
  await expect(radio).toBeChecked();
  await expect(radio).toBeFocused();
});

Then("the Setup's {string} cannot be chosen as the orchestrator", async ({ e2e }, name) => {
  const radio = setupRadio(e2e.window, name);
  await expect(radio).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(radio).toBeDisabled({ timeout: CHECK_TIMEOUT });
  await expect(radio).not.toBeChecked();
});

Then("the Setup's {string} card offers no orchestrator choice", async ({ e2e }, name) => {
  const card = setupCard(e2e.window, name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card.getByRole('radio')).toHaveCount(0);
  await expect(card.locator('[data-testid^="setup-orchestrator-"]')).toHaveCount(0);
  await expect(card).not.toContainText(/orchestrator/i);
});

// ---- Settings › Agents & CLIs ---------------------------------------------------------------------------

Then('the orchestrator in Agents & CLIs is {string}', async ({ e2e }, chosen) => {
  orchestratorId(chosen);
  const page = e2e.window;
  await expect(settingsSection(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expectOneChecked(ORCHESTRATORS.map((n) => [n, settingsRadio(page, n)]), chosen);
});

When('I choose {string} as the orchestrator in Agents & CLIs', async ({ e2e }, name) => {
  const radio = settingsRadio(e2e.window, name);
  await expect(radio).toBeEnabled({ timeout: CHECK_TIMEOUT });
  await radio.check();
});

// ---- #111: a Codex account without Codex's mapped models ------------------------------------------------
// Steps of features/111-codex-model-fallback.feature. The Codex account's model list is the CLI's own
// cache, <CODEX_HOME>/models_cache.json ({"models":[{slug, display_name, visibility: "list", priority}]},
// packages/shared/providers/codex.js modelsCache); the app launches with CODEX_HOME at a folder of this
// scenario's output holding that file (appEnv's extra, features/support/app.js: no fixture change). Without
// the variable the scratch home has no ~/.codex/models_cache.json: no list, no warning (#97's scenarios).
// What the screens expose (NEW, the developer adds them): the engine's envDetails entry for codex gets
// `models: string[]` (the cache's slugs; absent without a cache), and
//   setup-codex-models-warning     in the Setup's Codex card (setup-cli-codex): the account lacks the mapped
//                                  models (gpt-6.2-astra, gpt-6.2-sol, gpt-6.1-terra, gpt-6-luna) and which
//                                  offered one it uses instead; with none usable, that Codex cannot run the
//                                  orchestrator (its radio disabled, like a CLI not ready)
//   settings-codex-models-warning  the same warning in Settings › Agents & CLIs (settings-clis)
// Both in the interface language.

const fs = require('fs');
const path = require('path');

// the account's offered models, "a, b, c" → the CLI's cache file in a fresh CODEX_HOME
function codexHomeOffering(testInfo, list) {
  const slugs = list.split(',').map((s) => s.trim()).filter(Boolean);
  const dir = testInfo.outputPath('codex-home');
  fs.mkdirSync(dir, { recursive: true });
  const models = slugs.map((slug, i) => ({ slug, display_name: slug, visibility: 'list', priority: i + 1 }));
  fs.writeFileSync(path.join(dir, 'models_cache.json'), JSON.stringify({ models }, null, 2));
  return dir;
}

Given('the app is open on a machine where {string} and {string} are ready and the Codex account offers only {string}',
  async ({ e2e, $testInfo }, first, second, list) => {
    if (![first, second].includes('Codex CLI')) throw new Error('this step makes the Codex CLI one of the ready CLIs');
    await e2e.open({ env: { CRAFTORIO_E2E_CLI_READY: `${aiId(first)},${aiId(second)}`, CODEX_HOME: codexHomeOffering($testInfo, list) } });
  });

const setupCodexWarning = (page) => setupCard(page, 'Codex CLI').getByTestId('setup-codex-models-warning');
const settingsCodexWarning = (page) => settingsSection(page).getByTestId('settings-codex-models-warning');

// English words a Portuguese warning would not hold (word boundaries: "modelos" is not "models")
const ENGLISH_WORDS = /\b(the|this|account|instead|will|offers?|models|available|doesn't|cannot|can't)\b/i;
const LANGUAGES = ['English', 'Português (Brasil)'];

async function expectFallbackWarning(warning, model, language) {
  if (!LANGUAGES.includes(language)) throw new Error(`unknown language "${language}" (one of ${LANGUAGES.join(', ')})`);
  await expect(warning, 'the Codex models warning').toBeVisible({ timeout: CHECK_TIMEOUT });
  await expect(warning).toContainText(model);
  if (language !== 'English') {
    const text = (await warning.innerText()).replace(/\bgpt-[\w.-]+/g, '');
    expect(text, `the Codex models warning reads in ${language}`).not.toMatch(ENGLISH_WORDS);
  }
}

Then("the Setup's Codex card warns that the account lacks Codex's models and will use {string} instead", async ({ e2e }, model) => {
  await expectFallbackWarning(setupCodexWarning(e2e.window), model, 'English');
});

// no model of the account can run the orchestrator: the warning says Codex cannot be the orchestrator
Then("the Setup's Codex card warns that the account offers no model the orchestrator can run on", async ({ e2e }) => {
  const warning = setupCodexWarning(e2e.window);
  await expect(warning, 'the Codex models warning').toBeVisible({ timeout: CHECK_TIMEOUT });
  await expect(warning).toContainText(/orchestrator/i);
});

Then("Agents & CLIs warns that the Codex account lacks Codex's models and will use {string} instead, in {string}", async ({ e2e }, model, language) => {
  await expect(settingsSection(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expectFallbackWarning(settingsCodexWarning(e2e.window), model, language);
});

// ---- the Run screen's sessions ---------------------------------------------------------------------------

// "Orchestrator" is the orchestrator's card (data-id="orchestrator"); any other name an agent's
// (data-agent="<id>", "Developer" → developer). Its badges read the provider and the model.
Then("the Run screen's {string} session runs on {string} with the model {string}", async ({ e2e }, name, provider, model) => {
  const page = e2e.window;
  const details = runTab(page, 'Details');
  await expect(details).toBeVisible({ timeout: LOAD_TIMEOUT });
  if ((await details.getAttribute('aria-selected')) !== 'true') await details.click();
  const selector = name === 'Orchestrator'
    ? '[data-testid="run-session-card"][data-id="orchestrator"]'
    : `[data-testid="run-session-card"][data-agent="${name.trim().toLowerCase().replace(/\s+/g, '_')}"]`;
  const card = page.locator(selector).filter({ visible: true }).first();
  await expect(card).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(card).toContainText(new RegExp(`${escRe(provider)}[\\s\\S]*${escRe(model)}`, 'i'), { timeout: LOAD_TIMEOUT });
  // none of Claude's models left on it
  await expect(card).not.toContainText(/claude-(opus|sonnet|haiku|fable)-/);
});
