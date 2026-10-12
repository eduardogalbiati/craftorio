// Steps of features/run.feature (#222): the Start panel, a simulated run of the demo project, its
// gate card; the "Developer effort" field next to "Developer model" (#286); the chat of a run
// interrupted at a gate (#288: the note "Interrupted at <step>" and its Resume button). Locators are
// roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

// a simulated run of software-development reaches its first gate in well under a minute
const GATE_TIMEOUT = 120000;

When('I open the Start panel', async ({ e2e }) => {
  await e2e.window.getByTestId('quick-start').click();
  await expect(e2e.window.getByTestId('start-workflow')).toBeVisible();
});

When('I pick {string} for {string}', async ({ e2e }, option, field) => {
  await e2e.window.getByRole('radiogroup', { name: field }).getByRole('radio', { name: option, exact: true }).click();
});

Then('{string} offers {string}, {string} and {string}', async ({ e2e }, field, a, b, c) => {
  const group = e2e.window.getByRole('radiogroup', { name: field });
  for (const name of [a, b, c]) await expect(group.getByRole('radio', { name, exact: true })).toBeVisible();
});

Then('{string} is selected for {string}', async ({ e2e }, option, field) => {
  await expect(e2e.window.getByRole('radiogroup', { name: field }).getByRole('radio', { name: option, exact: true })).toHaveAttribute('aria-checked', 'true');
});

When('I start a simulated run with the task {string}', async ({ e2e }, task) => {
  const page = e2e.window;
  if (!(await page.getByTestId('start-workflow').isVisible())) await page.getByTestId('quick-start').click();
  await page.getByTestId('start-main-input').fill(task);
  await page.getByRole('checkbox', { name: /Simulation mode/ }).check();
  await page.getByTestId('start-workflow').click();
});

Then('the run is running', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('run-status')).not.toHaveAttribute('data-status', 'idle', { timeout: 30000 });
});

Then('a gate card waits for my approval', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('run-gate').first()).toBeVisible({ timeout: GATE_TIMEOUT });
});

Then('the gate card shows its summary and its buttons', async ({ e2e }) => {
  const card = e2e.window.getByTestId('run-gate').first();
  await expect(card).toContainText('Approval required');
  await expect(card).toContainText('step:');
  const buttons = card.getByTestId('run-gate-choice');
  await expect(buttons.first()).toBeEnabled();
  expect(await buttons.count()).toBeGreaterThanOrEqual(2);
});

Then('the run shows the pill {string}', async ({ e2e }, text) => {
  await expect(e2e.window.getByTestId('input-pill').filter({ hasText: text }).first()).toBeVisible({ timeout: 30000 });
});

// #233: Analytics › Run and the run page mark an estimated cost (a timed-out attempt) and an old
// run's stopped attempt ("cost not recorded")
When('I open the {string} Analytics tab', async ({ e2e }, name) => {
  await e2e.window.getByRole('tablist', { name: 'Analytics' }).getByRole('tab', { name, exact: true }).click();
});

// picks the run whose id contains `fragment` (searched first: the list shows the latest 80)
When('I pick the run {string} in Analytics', async ({ e2e }, fragment) => {
  const page = e2e.window;
  await page.getByTestId('an-run-search').fill(fragment);
  const option = page.getByTestId('an-run-pick').locator(`option[value*="${fragment}"]`);
  await expect(option).toHaveCount(1, { timeout: 30000 });
  await page.getByTestId('an-run-pick').selectOption(await option.getAttribute('value'));
  await expect(page.getByTestId('an-run-header')).toContainText(fragment, { timeout: 30000 });
});

Then('the run\'s total cost in Analytics is marked as estimated', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('an-run-total-cost')).toContainText(/estimated/i);
});

Then('the cost of the agent {string} in Analytics is marked as estimated', async ({ e2e }, agent) => {
  await expect(e2e.window.getByTestId('an-agent-cost').filter({ hasText: agent }).first()).toContainText(/estimated/i);
});

// #308: Analytics › Run's "Tokens per agent" counts the sub-agents' model calls in the agent's
// tokens; a bar (data-testid an-agent-tokens) shows "of which sub-agents: n calls, m tokens"
// (data-testid an-agent-subagents) only when the agent's turns started sub-agents
const agentTokens = (page, agent) => page.getByTestId('an-agent-tokens').filter({ hasText: agent }).first();

Then('the tokens of the agent {string} in Analytics show {int} sub-agent calls and their tokens', async ({ e2e }, agent, calls) => {
  const line = agentTokens(e2e.window, agent).getByTestId('an-agent-subagents');
  await expect(line).toBeVisible({ timeout: 30000 });
  await expect(line).toContainText(new RegExp(`of which sub-agents: ${calls} calls?, [\\d.,]+\\s*[kKM]? tokens`));
});

Then('the tokens of the agent {string} in Analytics show its total and its cost per million tokens', async ({ e2e }, agent) => {
  const bar = agentTokens(e2e.window, agent);
  await expect(bar).toBeVisible({ timeout: 30000 });
  await expect(bar).toContainText(/\d/);
  await expect(bar).toContainText(/\/M/);
});

Then('the tokens of the agent {string} in Analytics show no sub-agent line', async ({ e2e }, agent) => {
  const bar = agentTokens(e2e.window, agent);
  await expect(bar).toBeVisible({ timeout: 30000 });
  await expect(bar.getByTestId('an-agent-subagents')).toHaveCount(0);
  await expect(bar).not.toContainText(/sub-agents/i);
});

When('I open the run from Analytics', async ({ e2e }) => {
  await e2e.window.getByTestId('an-run-header').getByRole('button', { name: 'Open run', exact: true }).click();
});

Then('the run\'s total cost is marked as estimated', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('run-total-cost')).toContainText(/estimated/i, { timeout: 30000 });
});

Then('the run\'s {string} session shows {string}', async ({ e2e }, agent, text) => {
  const card = e2e.window.getByTestId('run-session-card').filter({ hasText: new RegExp(agent, 'i') }).first();
  await expect(card).toContainText(text, { timeout: 30000 });
});

// #183: a human gate's "Interact with Oracle" button opens the Oracle's drawer beside the gate, with
// a context chip (the run, the issue, the step, the branch) and starter questions about the gate
const gateCard = (page) => page.getByTestId('run-gate').first();
const oracleDrawer = (page) => page.getByRole('complementary', { name: 'Oracle', exact: true });
const contextChip = (page) => oracleDrawer(page).getByTestId('oracle-context-chip');

When('I click the gate\'s "Interact with Oracle" button', async ({ e2e }) => {
  const button = gateCard(e2e.window).getByTestId('gate-oracle');
  await expect(button).toHaveAccessibleName(/Interact with Oracle/);
  await button.click();
});

Then('the Oracle drawer opens', async ({ e2e }) => {
  await expect(oracleDrawer(e2e.window)).toBeVisible();
});

// the choices can still be clicked: nothing (the drawer, a backdrop) lies over them
Then('the gate card is still in view with its choices enabled', async ({ e2e }) => {
  const card = gateCard(e2e.window);
  await expect(card).toBeInViewport();
  const choices = card.getByTestId('run-gate-choice');
  expect(await choices.count()).toBeGreaterThanOrEqual(2);
  for (const choice of await choices.all()) {
    await expect(choice).toBeEnabled();
    const onTop = await choice.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });
    expect(onTop, `the choice "${await choice.textContent()}" is covered`).toBe(true);
  }
});

Then('the Oracle\'s question box shows a context chip naming the gate\'s run and step', async ({ e2e }) => {
  const card = gateCard(e2e.window);
  const runId = await card.getAttribute('data-run');
  const step = (await card.textContent()).match(/step:\s*([\w.-]+)/)?.[1];
  expect(step, 'the gate card names its step').toBeTruthy();
  const chip = contextChip(e2e.window);
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(`Run ${runId}`);
  await expect(chip).toContainText(step);
});

Then('the Oracle suggests {string}, {string}, {string} and {string}', async ({ e2e }, a, b, c, d) => {
  const drawer = oracleDrawer(e2e.window);
  for (const name of [a, b, c, d]) await expect(drawer.getByRole('button', { name, exact: true })).toBeEnabled();
});

When('I remove the Oracle\'s context chip', async ({ e2e }) => {
  await contextChip(e2e.window).getByRole('button', { name: /Remove/ }).click();
});

Then('the Oracle\'s question box has no context chip', async ({ e2e }) => {
  await expect(contextChip(e2e.window)).toHaveCount(0);
});

When('I ask the Oracle the suggested question {string}', async ({ e2e }, question) => {
  await oracleDrawer(e2e.window).getByRole('button', { name: question, exact: true }).click();
});

// the simulated Oracle (MULTIAGENT_SIMULATION_ONLY) answers without a model: "Simulated Oracle: ..."
Then('the Oracle shows a simulated answer', async ({ e2e }) => {
  await expect(oracleDrawer(e2e.window)).toContainText('Simulated Oracle', { timeout: 30000 });
});

// #286: the developer's effort (developer_effort: default | low | medium | high | xhigh), a row of
// pills next to "Developer model" wherever the workflow's inputs are drawn (WorkflowInputs.fieldHtml):
// the Start panel, the Assign dialog, a roadmap item's Edit. Found by role (a pill row is a
// radiogroup named by its label); no new data-testid.
const visibleGroup = (page, name) => page.getByRole('radiogroup', { name, exact: true }).filter({ visible: true }).first();

When('I choose the workflow {string} in the Start panel', async ({ e2e }, name) => {
  const page = e2e.window;
  if (!(await page.getByTestId('start-workflow').isVisible())) await page.getByTestId('quick-start').click();
  await page.getByRole('combobox', { name: 'Workflow', exact: true }).selectOption(`${name}.yaml`);
});

// the field right after the other one in the same form; in the Start panel both may sit in
// "Advanced parameters", opened first when the field is hidden there
Then('the field {string} comes right after {string}', async ({ e2e }, field, before) => {
  const page = e2e.window;
  if (!(await visibleGroup(page, before).isVisible())) {
    const advanced = page.getByText('Advanced parameters', { exact: true }).filter({ visible: true });
    if (await advanced.count()) await advanced.first().click();
  }
  await expect(visibleGroup(page, before)).toBeVisible();
  await expect(visibleGroup(page, field)).toBeVisible();
  const next = await visibleGroup(page, before).evaluate((el) => {
    const own = el.closest('.wi-field') || el.parentElement;
    return own?.nextElementSibling?.querySelector('label')?.textContent?.trim() || '';
  });
  expect(next.startsWith(field), `the field after "${before}" is "${next}"`).toBe(true);
});

// each value matches a pill whose label reads as it ("High" → high, "Extra high" or "XHigh" →
// xhigh), in that order and no other pill
Then('{string} offers the choices {string}, {string}, {string}, {string} and {string}', async ({ e2e }, field, a, b, c, d, e) => {
  const radios = visibleGroup(e2e.window, field).getByRole('radio');
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '').replace(/^extra/, 'x');
  await expect(radios).toHaveCount(5);
  expect((await radios.allTextContents()).map(norm)).toEqual([a, b, c, d, e].map(norm));
});

// #288: the chat of a run interrupted at a human gate (the app closed while the gate waited) shows a
// note "Interrupted at <step>" (data-testid runchat-interrupted-note) instead of "Waiting for an
// answer.", and a Resume button (data-testid runchat-resume) that opens the Resume from step dialog
// (index.html #resume-modal: a dialog named "Resume from step", its step select labelled the same)
// with the stopped step preselected.
const LOAD_TIMEOUT = 30000;
const stepIdOf = (name) => name.trim().toLowerCase().replace(/\s+/g, '_');
const visibleTestId = (page, id) => page.getByTestId(id).filter({ visible: true }).first();
const resumeDialog = (page) => page.getByRole('dialog', { name: 'Resume from step', exact: true });

// A simulated software-development-local-hero run of the demo project, written like scripts/screenshot.js
// demoRoadmapRuns: develop and its screenshots done, then the gate `gate` (its readable name:
// "Developer check" → developer_check) asked for an answer. No summary.json and no owner.json: the
// app reads it as interrupted (src/runs.js liveStatus). The run list reads the runs folder when the
// screen opens, so no reload is needed.
Given('the demo project has a run {string} interrupted at the gate {string}', async ({ e2e }, suffix, gate) => {
  const min = 6e4;
  const workflow = 'software-development-local-hero';
  const start = Date.now() - 3 * 3600e3;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-201500-${suffix}`;
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const at = (m) => new Date(start + m * min).toISOString();
  const task = `A run interrupted at a gate (${suffix})`;
  const session = { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' };
  const events = [
    { ts: at(0), type: 'workflow.started', run_id: runId, workflow, file: `${workflow}.yaml`, project_id: e2e.project.id, mock: true, inputs: { task } },
    { ts: at(0), type: 'step.started', step_id: 'develop', step_type: 'agent', agent: 'developer' },
    { ts: at(0), type: 'session.opened', session_id: 's-develop', session },
    { ts: at(30), type: 'session.message_received', session_id: 's-develop', step_id: 'develop', text: 'Done.', cost_usd: 0.4, duration_ms: 30 * min, session },
    { ts: at(30), type: 'step.finished', step_id: 'develop', duration_ms: 30 * min, output: { summary: 'Implemented the task.' } },
    { ts: at(30), type: 'step.started', step_id: 'developer_screenshots', step_type: 'screenshots' },
    { ts: at(32), type: 'step.finished', step_id: 'developer_screenshots', duration_ms: 2 * min },
    { ts: at(32), type: 'step.started', step_id: stepIdOf(gate), step_type: 'human_approval' },
    { ts: at(32), type: 'approval.requested', step_id: stepIdOf(gate), approval_id: 'gate-288', message: 'The developer finished the implementation. Try it before the review and the tests run.' },
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
});

// Workflows › Runs, after `I search the runs for`: expands the run's row and clicks its "Open chat"
When('I open the chat of the run {string} from the list', async ({ e2e }, fragment) => {
  const page = e2e.window;
  const row = page.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true }).first();
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  const open = row.getByRole('button', { name: 'Open chat', exact: true });
  if (!(await open.isVisible())) await row.locator('.pr-row').first().click();
  await open.click();
});

Then('the run chat notes {string}', async ({ e2e }, text) => {
  const note = visibleTestId(e2e.window, 'runchat-interrupted-note');
  await expect(note).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(note).toContainText(text);
});

// checked once the chat has drawn its interrupted note
Then('the run chat does not say {string}', async ({ e2e }, text) => {
  const page = e2e.window;
  await expect(visibleTestId(page, 'runchat-interrupted-note')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByText(text, { exact: true }).filter({ visible: true })).toHaveCount(0);
});

Then('the run chat offers a Resume button', async ({ e2e }) => {
  const button = visibleTestId(e2e.window, 'runchat-resume');
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toBeEnabled();
  await expect(button).toHaveAccessibleName(/Resume/);
});

When('I click Resume in the run chat', async ({ e2e }) => {
  await visibleTestId(e2e.window, 'runchat-resume').click();
});

// the step select holds the step's id as its value, its option reads the readable name first
Then('the resume dialog opens with the step {string} preselected', async ({ e2e }, name) => {
  const dialog = resumeDialog(e2e.window);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  const select = dialog.getByRole('combobox', { name: 'Resume from step', exact: true });
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(select).toHaveValue(stepIdOf(name));
  await expect.poll(() => select.evaluate((el) => el.selectedOptions[0]?.textContent.trim() || '')).toMatch(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
});
