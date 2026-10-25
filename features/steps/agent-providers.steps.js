// Steps of features/agent-providers.feature (#262, #312: several accounts per provider, at the end):
// each agent's provider, model and effort per run
// (the Start panel's "Agents" section), the engine's fallback to the next provider/model when one hits
// its usage limit (the `agent.fallback` event: from, to, reason), shown in the run chat, the run's
// agents table (the run list's expanded row) and a notification; with no fallback left the run fails
// with the provider's message. Locators are roles and data-testid only (skills/ui-conventions).
//
// What the scenarios expect of the UI (NEW: to be added by #262):
//   Start panel   a group named "Agents" (role group, e.g. a <fieldset> with the legend "Agents"),
//                 holding one group per agent of the workflow named by its readable name ("Developer"),
//                 each with the comboboxes "Provider", "Model" and "Effort" (selects, or an input with
//                 a datalist for the model); their values are the provider id, the model id and the
//                 effort id (empty for the CLI's default). It may sit under "Advanced parameters".
//   run chat      run-chat-turn-model (NEW): on each agent turn, the provider and the model that
//                 answered it, with data-step="<step id>"; run-chat-fallback (NEW): one line per
//                 agent.fallback, naming the step, the provider · model it left, the one it moved to
//                 and the reason (e.g. "usage limit"); run-chat-finished (NEW): the run's end note
//                 ("Failed · <error>"), today's `duo-note` of the `finished` item.
//   agents table  run-session-card (the run list's expanded row, one per session) keeps the provider
//                 and the model that answered; run-session-fallback (NEW) inside the agent's row: the
//                 provider · model it fell back from and the reason.
//   notifications notification-item (NEW): one notice of the notification centre (dialog
//                 "Notifications"): its title and body (e.g. "Provider fell back: <run>" / "Developer:
//                 codex · gpt-6-luna → claude · claude-opus-5-5 (usage limit)").
// What they expect of the engine (simulation only), the interface of test/agent-fallbacks-262.test.js
// and test/service/agent-overrides-262.test.js: run:start (window.api.startRun) takes
// `agentOverrides: { <agent>: { provider?, model?, effort? } }` (this run only); Settings keep
// `providers: { <provider>: { fallbacks: ['provider:model', ...] } }` (window.api.setSettings); and
// `mockSequences.usage_limits: ['<provider>' | '<provider>:<model>', ...]` makes every turn on a
// listed entry answer with that provider's usage-limit message (Codex: "You've hit your usage limit.
// Upgrade to Plus to continue using Codex").

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// a simulated AI Development run reaches its develop turn well within two minutes
const RUN_TIMEOUT = 120000;
const AI_DEV = 'ai-development-local-hero';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stepIdOf = (name) => name.trim().toLowerCase().replace(/\s+/g, '_');
// "codex · gpt-6-luna" → { provider: 'codex', model: 'gpt-6-luna' }
const providerModel = (s) => {
  const [provider, model] = String(s).split('·').map((x) => x.trim());
  return { provider, model };
};
// text that names both the provider and the model, in any separator
const namesBoth = ({ provider, model }) => new RegExp(`${escRe(provider)}[\\s\\S]*${escRe(model)}`);

// ---- the Start panel's "Agents" section -------------------------------------------------------------

const agentsSection = (page) => page.getByRole('group', { name: 'Agents', exact: true }).filter({ visible: true }).first();
const startAgent = (page, name) => agentsSection(page).getByRole('group', { name, exact: true });

// the section may sit under "Advanced parameters": opened when it is hidden there
async function showAgents(page) {
  if (await agentsSection(page).isVisible()) return;
  const advanced = page.getByText('Advanced parameters', { exact: true }).filter({ visible: true });
  if (await advanced.count()) await advanced.first().click();
  await expect(agentsSection(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
}

// sets a select by its option value, or types into an input (a model with a datalist)
async function setField(field, value) {
  if (await field.evaluate((el) => el.tagName === 'SELECT')) await field.selectOption(value);
  else await field.fill(value);
}

async function expectStartAgent(page, name, provider, model, effort) {
  await showAgents(page);
  const row = startAgent(page, name);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row.getByRole('combobox', { name: 'Provider', exact: true })).toHaveValue(provider);
  await expect(row.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue(model);
  if (effort !== undefined) await expect(row.getByRole('combobox', { name: 'Effort', exact: true })).toHaveValue(effort);
}

Then('the Start panel\'s agent {string} runs on {string} with the model {string} and the effort {string}', async ({ e2e }, name, provider, model, effort) => {
  await expectStartAgent(e2e.window, name, provider, model, effort);
});

Then('the Start panel\'s agent {string} runs on {string} with the model {string}', async ({ e2e }, name, provider, model) => {
  await expectStartAgent(e2e.window, name, provider, model);
});

When('I set the Start panel\'s agent {string} to {string} with the model {string}', async ({ e2e }, name, provider, model) => {
  const page = e2e.window;
  await showAgents(page);
  const row = startAgent(page, name);
  await setField(row.getByRole('combobox', { name: 'Provider', exact: true }), provider);
  // the provider's change may reset the model to that provider's default: set after it
  await setField(row.getByRole('combobox', { name: 'Model', exact: true }), model);
  await expect(row.getByRole('combobox', { name: 'Provider', exact: true })).toHaveValue(provider);
  await expect(row.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue(model);
});

// ---- a simulated run whose provider hits its usage limit ---------------------------------------------

// Started the way the Start panel starts one (window.api.startRun, channel run:start), with the
// agent's provider/model for this run and its fallback, and the simulation scenario
// mockSequences.usage_limits (the Start panel has no such choice); then shown on the Run screen
// (window.showRun, as the Start panel does for the run it started). Mode validated: the run stops at
// its "Developer check" gate after Develop.
Given('a simulated AI Development run is open whose {string} on {string} hits its usage limit once and falls back to {string}', async ({ e2e }, agent, from, to) => {
  const page = e2e.window;
  const project = e2e.project;
  const res = await page.evaluate(async ({ file, agent, from, to, projectId, folder }) => {
    try {
      // the fallback chain of the provider, from Settings (providers.<p>.fallbacks)
      await window.api.setSettings({ providers: { [from.provider]: { fallbacks: [`${to.provider}:${to.model}`] } } });
      const out = await window.api.startRun({
        file, mock: true, projectId,
        inputs: { task: 'Add a /health endpoint', repo_path: folder, mode: 'validated' },
        agentOverrides: { [agent]: { provider: from.provider, model: from.model } },
        mockSequences: { usage_limits: [`${from.provider}:${from.model}`] },
      });
      return { runId: out?.runId || null, answer: out };
    } catch (e) { return { thrown: String(e?.message || e) }; }
  }, { file: `${AI_DEV}.yaml`, agent, from: providerModel(from), to: providerModel(to), projectId: project.id, folder: project.folder || project.repo });
  expect(res.thrown, 'window.api.startRun rejected').toBeFalsy();
  expect(res.runId, `the run started (${JSON.stringify(res.answer)})`).toBeTruthy();
  e2e.startedRunId = res.runId;
  await page.evaluate((runId) => window.showRun(runId, { running: true }), res.runId);
});

const visibleTestId = (page, id) => page.getByTestId(id).filter({ visible: true });

Then('the run chat shows the fallback of {string} from {string} to {string} with the reason {string}', async ({ e2e }, step, from, to, reason) => {
  const line = visibleTestId(e2e.window, 'run-chat-fallback').filter({ hasText: step }).first();
  await expect(line).toBeVisible({ timeout: RUN_TIMEOUT });
  // from, then to, in that order; the reason anywhere on the line
  const { provider: fp, model: fm } = providerModel(from);
  const { provider: tp, model: tm } = providerModel(to);
  await expect(line).toContainText(new RegExp(`${escRe(fp)}[\\s\\S]*${escRe(fm)}[\\s\\S]*${escRe(tp)}[\\s\\S]*${escRe(tm)}`));
  await expect(line).toContainText(new RegExp(escRe(reason), 'i'));
});

Then('the run chat shows that {string} was answered by {string} with the model {string}', async ({ e2e }, step, provider, model) => {
  const tags = e2e.window.locator(`[data-testid="run-chat-turn-model"][data-step="${stepIdOf(step)}"]`).filter({ visible: true });
  await expect(tags.first()).toBeVisible({ timeout: RUN_TIMEOUT });
  // the step's last turn: the one that answered
  await expect(tags.last()).toContainText(namesBoth({ provider, model }), { timeout: LOAD_TIMEOUT });
});

Then('the run chat shows no fallback', async ({ e2e }) => {
  const page = e2e.window;
  await expect(visibleTestId(page, 'run-chat-finished').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visibleTestId(page, 'run-chat-fallback')).toHaveCount(0);
});

Then('the run chat ends with the failure {string}', async ({ e2e }, message) => {
  const note = visibleTestId(e2e.window, 'run-chat-finished').first();
  await expect(note).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(note).toContainText(/Failed/);
  await expect(note).toContainText(message);
});

// ---- the run's agents table (Workflows › Runs, the expanded row) --------------------------------------

const runRow = (page, runId) => page.locator(`[data-testid="run-list-row"][data-run="${runId}"]`).filter({ visible: true }).first();

// searches the run started by this scenario (its id), then expands its row
When('I expand the run I started in the list', async ({ e2e }) => {
  const page = e2e.window;
  const runId = e2e.startedRunId;
  expect(runId, 'a run was started in this scenario').toBeTruthy();
  // simulated runs are hidden until "Show simulated" is ticked
  await page.getByRole('checkbox', { name: 'Show simulated', exact: true }).filter({ visible: true }).first().check();
  await page.getByRole('textbox', { name: 'Search runs', exact: true }).filter({ visible: true }).first().fill(runId);
  const row = runRow(page, runId);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await row.locator('.pr-row').first().click();
  await expect(row.getByTestId('run-session-card').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

const agentRows = (page, agent) => page.getByTestId('run-session-card').filter({ visible: true }).filter({ hasText: new RegExp(`^\\s*${escRe(agent)}\\b`) });

Then('the run\'s agents table shows {string} on {string} with the model {string}', async ({ e2e }, agent, provider, model) => {
  await expect(agentRows(e2e.window, agent).filter({ hasText: namesBoth({ provider, model }) }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the run\'s agents table shows the fallback of {string} from {string} with the reason {string}', async ({ e2e }, agent, from, reason) => {
  const mark = agentRows(e2e.window, agent).getByTestId('run-session-fallback').first();
  await expect(mark).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(mark).toContainText(namesBoth(providerModel(from)));
  await expect(mark).toContainText(new RegExp(escRe(reason), 'i'));
});

// ---- the notification -----------------------------------------------------------------------------

Then('a notification says that {string} fell back from {string} to {string} because of the {string}', async ({ e2e }, agent, from, to, reason) => {
  const centre = e2e.window.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(centre).toBeVisible({ timeout: LOAD_TIMEOUT });
  const notice = centre.getByTestId('notification-item').filter({ hasText: /fell back/i }).filter({ hasText: agent }).first();
  await expect(notice).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(notice).toContainText(new RegExp(`${escRe(from)}[\\s\\S]*${escRe(to)}`));
  await expect(notice).toContainText(new RegExp(escRe(reason), 'i'));
});

// ---- a finished run that failed on the provider's usage limit (seeded) --------------------------------

// A finished simulated ai-development-local-hero run of the demo project, days back, written as the
// engine writes it today (packages/engine/engine/workflow.js): the developer's session opened on the given
// provider · model, its turn ended with the provider's message, no fallback was left (no
// agent.fallback event), so the step threw and workflow.finished carries status failed and the
// message. The run list reads the runs folder when the screen opens, so no reload is needed.
Given('the demo project has a finished AI Development run {string} whose developer on {string} hit {string} with no fallback left', async ({ e2e }, suffix, on, message) => {
  const min = 6e4;
  const start = Date.now() - 2 * 864e5;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-091500-${suffix}`;
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const at = (m) => new Date(start + m * min).toISOString();
  const projectId = e2e.project.id;
  const task = `A run whose provider hit its usage limit (${suffix})`;
  const { provider, model } = providerModel(on);
  const session = { id: 's-develop', agent: 'developer', provider, model, status: 'failed', turns: 1, cost_usd: 0 };
  const events = [
    { ts: at(0), type: 'workflow.started', workflow: AI_DEV, file: `${AI_DEV}.yaml`, project_id: projectId, mock: true, inputs: { task }, steps: [{ id: 'develop', type: 'agent', agent: 'developer' }] },
    { ts: at(1), type: 'step.started', step_id: 'develop', step_type: 'agent', agent: 'developer', visit: 1 },
    { ts: at(1), type: 'session.opened', session_id: 's-develop', session },
    { ts: at(1), type: 'session.message_sent', session_id: 's-develop', step_id: 'develop', text: `Implement: ${task}`, session },
    { ts: at(2), type: 'log', level: 'error', step_id: 'develop', message: `develop: ${message}` },
    { ts: at(2), type: 'session.status', session_id: 's-develop', status: 'failed', session },
    { ts: at(3), type: 'workflow.finished', status: 'failed', error: message },
  ].map((e, i) => ({ seq: i + 1, run_id: runId, ...e }));
  const files = {
    'events.jsonl': `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'summary.json': JSON.stringify({
      run_id: runId, workflow: AI_DEV, project_id: projectId, mock: true, inputs: { task }, status: 'failed', error: message, started_at: at(0), finished_at: at(3), duration_ms: 3 * min, sessions: [session],
    }, null, 2),
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
});

// ---- #312: several accounts per provider ----------------------------------------------------------------
//
// What the scenarios expect of the UI (NEW: to be added by #312):
//   Settings › Agents & CLIs  settings-accounts: the accounts section (next to settings-fallbacks),
//                 holding one settings-accounts-provider per provider (data-provider="<provider id>"),
//                 each with its settings-account-row items in order and a settings-account-add button
//                 ("Add account"). A row has the textboxes "Account name" and "Config folder" and the
//                 checkbox "Enabled"; a row being added also shows settings-account-login-command (the
//                 command that logs the folder in, e.g. `CLAUDE_CONFIG_DIR=<folder> claude`, then
//                 `/login`) and settings-account-signed-in ("Signed in" / "Not signed in", never a
//                 credential). settings-accounts-terms: the notice that the owner must follow each
//                 provider's terms for using more than one account. Saved with settings-fallbacks-save.
//   run chat      run-chat-account-switch: one line per agent.account_switch, e.g. "moved to Claude B:
//                 Claude A hit its limit until Oct 26"; run-waiting-credits: the run waits for credits
//                 (run.waiting_credits), naming the provider and the reset time when known.
// What they expect of the engine (simulation only): Settings `providers.<p>.accounts: [{ name, dir,
// enabled }]`, and `mockSequences.usage_limits` entries `"<provider>@<account name>"`: every turn on that
// account answers with the provider's usage-limit message.

const accountsOf = (page, provider) => page.getByTestId('settings-accounts').filter({ visible: true }).first()
  .locator(`[data-testid="settings-accounts-provider"][data-provider="${provider}"]`);
const accountRows = (page, provider) => accountsOf(page, provider).getByTestId('settings-account-row');
const accountName = (row) => row.getByRole('textbox', { name: 'Account name', exact: true });

// an empty config folder for an account, inside the scenario's scratch folder
function accountFolder(e2e, name) {
  const dir = path.join(e2e.scratch, 'accounts', name.toLowerCase().replace(/\W+/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

Given('the workspace has the {string} account {string}', async ({ e2e }, provider, name) => {
  const dir = accountFolder(e2e, name);
  const res = await e2e.window.evaluate(async ({ provider, name, dir }) => {
    try { await window.api.setSettings({ providers: { [provider]: { accounts: [{ name, dir, enabled: true }] } } }); return {}; } catch (e) { return { thrown: String(e?.message || e) }; }
  }, { provider, name, dir });
  expect(res.thrown, 'window.api.setSettings rejected').toBeFalsy();
});

async function expectAccounts(page, provider, names) {
  const rows = accountRows(page, provider);
  await expect(rows).toHaveCount(names.length, { timeout: LOAD_TIMEOUT });
  for (const [i, name] of names.entries()) await expect(accountName(rows.nth(i))).toHaveValue(name);
}

Then('the {string} accounts read {string}', async ({ e2e }, provider, a) => {
  await expectAccounts(e2e.window, provider, [a]);
});

Then('the {string} accounts read {string}, then {string}', async ({ e2e }, provider, a, b) => {
  await expectAccounts(e2e.window, provider, [a, b]);
});

When('I add the {string} account {string} on a new empty folder', async ({ e2e }, provider, name) => {
  const page = e2e.window;
  const before = await accountRows(page, provider).count();
  await accountsOf(page, provider).getByTestId('settings-account-add').click();
  const row = accountRows(page, provider).nth(before);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  e2e.addedAccount = { row, dir: accountFolder(e2e, name) };
  await accountName(row).fill(name);
  const folder = row.getByRole('textbox', { name: 'Config folder', exact: true });
  await folder.fill(e2e.addedAccount.dir);
  await folder.press('Tab');
});

Then('the new account shows the command that logs {string} in on its folder, then {string}', async ({ e2e }, cli, then) => {
  const { row, dir } = e2e.addedAccount;
  const command = row.getByTestId('settings-account-login-command');
  await expect(command).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(command).toContainText(`${cli.toUpperCase()}_CONFIG_DIR`);
  await expect(command).toContainText(dir);
  await expect(command).toContainText(new RegExp(`\\b${escRe(cli)}\\b`));
  await expect(command).toContainText(then);
});

Then('the new account shows {string}', async ({ e2e }, state) => {
  await expect(e2e.addedAccount.row.getByTestId('settings-account-signed-in')).toHaveText(state, { timeout: LOAD_TIMEOUT });
});

Then('the accounts say that the owner must follow each provider\'s terms for using more than one account', async ({ e2e }) => {
  const notice = visibleTestId(e2e.window, 'settings-accounts-terms').first();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/terms/i);
  await expect(notice).toContainText(/more than one account|several accounts|multiple accounts/i);
});

When('I save the Agents & CLIs settings', async ({ e2e }) => {
  await visibleTestId(e2e.window, 'settings-fallbacks-save').first().click();
});

Then('the {string} account {string} is enabled', async ({ e2e }, provider, name) => {
  const rows = accountRows(e2e.window, provider);
  const n = await rows.count();
  for (let i = 0; i < n; i += 1) {
    if ((await accountName(rows.nth(i)).inputValue()) !== name) continue;
    await expect(rows.nth(i).getByRole('checkbox', { name: 'Enabled', exact: true })).toBeChecked();
    return;
  }
  throw new Error(`no "${provider}" account named "${name}"`);
});

// A simulated run started like the Start panel starts one (window.api.startRun), with the provider's
// accounts in Settings (no fallback chain) and the simulation scenario mockSequences.usage_limits on
// the given accounts; mode validated: the run stops at its "Developer check" gate after Develop.
async function startAccountsRun(e2e, provider, names, limited) {
  const page = e2e.window;
  const accounts = names.map((name) => ({ name, dir: accountFolder(e2e, name), enabled: true }));
  const res = await page.evaluate(async ({ file, provider, accounts, limited, projectId, folder }) => {
    try {
      await window.api.setSettings({ providers: { [provider]: { accounts, fallbacks: [] } } });
      const out = await window.api.startRun({
        file, mock: true, projectId,
        inputs: { task: 'Add a /health endpoint', repo_path: folder, mode: 'validated' },
        mockSequences: { usage_limits: limited.map((name) => `${provider}@${name}`) },
      });
      return { runId: out?.runId || null, answer: out };
    } catch (e) { return { thrown: String(e?.message || e) }; }
  }, { file: `${AI_DEV}.yaml`, provider, accounts, limited, projectId: e2e.project.id, folder: e2e.project.folder || e2e.project.repo });
  expect(res.thrown, 'window.api.startRun rejected').toBeFalsy();
  expect(res.runId, `the run started (${JSON.stringify(res.answer)})`).toBeTruthy();
  e2e.startedRunId = res.runId;
  await page.evaluate((runId) => window.showRun(runId, { running: true }), res.runId);
}

Given('a simulated AI Development run is open where the {string} account {string} hits its usage limit and {string} is next', async ({ e2e }, provider, a, b) => {
  await startAccountsRun(e2e, provider, [a, b], [a]);
});

Given('a simulated AI Development run is open where both {string} accounts {string} and {string} hit their usage limit, with no fallback', async ({ e2e }, provider, a, b) => {
  await startAccountsRun(e2e, provider, [a, b], [a, b]);
});

Then('the run chat says a turn moved to {string} because {string} hit its limit', async ({ e2e }, to, from) => {
  const line = visibleTestId(e2e.window, 'run-chat-account-switch').filter({ hasText: to }).first();
  await expect(line).toBeVisible({ timeout: RUN_TIMEOUT });
  // "moved to Claude B: Claude A hit its limit (until …)"
  await expect(line).toContainText(new RegExp(`${escRe(to)}[\\s\\S]*${escRe(from)}[\\s\\S]*limit`, 'i'));
});

Then('the run shows it is waiting for {string} credits', async ({ e2e }, provider) => {
  const waiting = visibleTestId(e2e.window, 'run-waiting-credits').first();
  await expect(waiting).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(waiting).toContainText(/waiting for credits/i);
  await expect(waiting).toContainText(new RegExp(escRe(provider), 'i'));
});

Then('the run has not failed', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByTestId('run-screen-status').filter({ visible: true }).first()).not.toHaveAttribute('data-status', 'failed');
  await expect(visibleTestId(page, 'run-chat-finished').filter({ hasText: /Failed/ })).toHaveCount(0);
});

// no agent.fallback line, and every turn shown was answered on the run's provider
Then('the run did not move to another provider than {string}', async ({ e2e }, provider) => {
  const page = e2e.window;
  await expect(visibleTestId(page, 'run-chat-fallback')).toHaveCount(0);
  const tags = visibleTestId(page, 'run-chat-turn-model');
  const n = await tags.count();
  for (let i = 0; i < n; i += 1) await expect(tags.nth(i)).toContainText(new RegExp(escRe(provider), 'i'));
});
