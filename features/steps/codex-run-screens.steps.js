// Steps of features/codex-run-screens.feature (#117): the Run screen and the run chat of a run on Codex,
// in English or Português (Brasil). Reuses fronts/build/features/steps/turn-costs.steps.js (the seeded
// runs, "its ... turn ran on Codex ...", the session and total costs), run-chat-orchestrator.steps.js
// (the orchestrator's message of a step with no agent), run.steps.js ("I select the run's {string}
// session", "I open the run's Chat tab"), interface-language.steps.js ("the open screen shows none of
// these English texts:"). Locators are roles and data-testid only (skills/ui-conventions).
//
// The renderer's contract (NEW in #117):
// - data-testid="run-chat-turn": an agent's turn in the run chat (the message bubble), data-agent="<agent
//   id>"; its header holds the provider tag (data-testid="run-chat-turn-model", which exists): the CLI and
//   the model that answered ("Codex · gpt-6-luna"), never the robot's brand ("ChatGPT", drawn "CHATGPT").
// - data-testid="session-reasoning-note": in the selected session's details on the Run screen, the one
//   line saying that the CLI (Codex) does not show its reasoning; once per session, not once per turn.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');
const { runTabs, escapeRe } = require('../support/run-screen');

const LOAD_TIMEOUT = 30000;
const I18N_DIR = path.join(__dirname, '..', '..', 'packages', 'shared', 'i18n');
const catalog = (code) => JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${code}.json`), 'utf8'));

// the Run screen's Details tab, whatever the interface language (runchat.details / run.details)
When('I switch the run to its details', async ({ e2e }) => {
  const names = [...new Set(['en', 'pt-BR'].flatMap((code) => [catalog(code)['runchat.details'], catalog(code)['run.details']]).filter(Boolean))];
  const tabs = e2e.window.getByTestId('run-tab-row').filter({ visible: true }).first().getByRole('tablist');
  const tab = tabs.getByRole('tab', { name: new RegExp(`^(${names.map(escapeRe).join('|')})$`) }).first();
  await expect(tab).toBeVisible({ timeout: LOAD_TIMEOUT });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: LOAD_TIMEOUT });
});

const turnsOf = (page, agent) => page.locator(`[data-testid="run-chat-turn"][data-agent="${agent}"]`).filter({ visible: true });

Then('the run chat tags the {string} agent\'s turn {string}, not {string}', async ({ e2e }, agent, tag, brand) => {
  await expect(runTabs(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const turn = turnsOf(e2e.window, agent).first();
  await expect(turn).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(turn.getByTestId('run-chat-turn-model')).toHaveText(tag, { timeout: LOAD_TIMEOUT });
  // what the owner reads on the turn: its text (CSS may draw it in capitals) and its labels
  const said = await turn.evaluate((el) => [el.innerText, ...[...el.querySelectorAll('[aria-label],[title]')]
    .map((n) => `${n.getAttribute('aria-label') || ''} ${n.getAttribute('title') || ''}`)].join(' '));
  expect(said, `the ${agent} turn names the CLI, not "${brand}"`).not.toMatch(new RegExp(escapeRe(brand), 'i'));
});

Then('the selected session says once that the CLI does not show its reasoning', async ({ e2e }) => {
  const notes = e2e.window.getByTestId('session-reasoning-note').filter({ visible: true });
  await expect(notes.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(notes).toHaveCount(1);
  await expect(notes.first()).toContainText(/reasoning|raciocínio/i);
});
