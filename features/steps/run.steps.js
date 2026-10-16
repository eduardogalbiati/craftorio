// Steps of features/run.feature (#222): the Start panel, a simulated run of the demo project, its
// gate card; the "Developer effort" field next to "Developer model" (#286); the chat of a run
// interrupted at a gate (#288: the note "Interrupted at <step>" and its Resume button); AI
// Development's Warm Up step (#301), its affected suite's card and run report (#304), and the "Not
// tested green" pill of a run built without a green suite (#396). Locators are
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

// #340: a field offers an option, whatever control draws it (a row of pills, a select, a list of
// checkboxes for an input that takes several values); in the Start panel the field may sit in
// "Advanced parameters", opened first when it is hidden there
Then('the field {string} offers {string}', async ({ e2e }, field, option) => {
  const page = e2e.window;
  const control = page.getByRole('radiogroup', { name: field, exact: true })
    .or(page.getByRole('combobox', { name: field, exact: true }))
    .or(page.getByRole('group', { name: field, exact: true }))
    .or(page.getByRole('listbox', { name: field, exact: true }))
    .filter({ visible: true }).first();
  if (!(await control.isVisible())) {
    const advanced = page.getByText('Advanced parameters', { exact: true }).filter({ visible: true });
    if (await advanced.count()) await advanced.first().click();
  }
  await expect(control).toBeVisible();
  const choice = control.getByRole('radio', { name: option, exact: true })
    .or(control.getByRole('option', { name: option, exact: true }))
    .or(control.getByRole('checkbox', { name: option, exact: true }));
  await expect(choice.first()).toBeAttached();
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

// Workflows › Runs, after `I search the runs for`: expands the run's row, clicks its "Open run"
// (the card's only way to the run since #409: it opens the Details) and switches to the Chat
When('I open the chat of the run {string} from the list', async ({ e2e }, fragment) => {
  const page = e2e.window;
  await rowButton(page, fragment, 'Open run');
  // a past run is rebuilt from its events: its workflow (which picks the AI Arena / Write & Review chat
  // screens) is known only once it has loaded
  await expect.poll(() => page.evaluate((f) => (typeof state === 'object' && state.view === 'run' && String(state.run?.id || '').endsWith(f) && state.run?.workflow) || null, fragment), { timeout: LOAD_TIMEOUT }).toBeTruthy();
  await page.getByRole('group', { name: 'Run view', exact: true }).filter({ visible: true }).first()
    .getByRole('button', { name: 'Chat', exact: true }).click({ timeout: LOAD_TIMEOUT });
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

// ---- #301 / #304: AI Development (local hero), its Warm Up step and its affected suite -------------
// #301: a read-only agent step "Warm Up" (warm_up, agent mapper) before Develop, shown like any agent
// step: the Run screen's steps list (data-testid run-steps, NEW: the #steps box; one listitem per step,
// its first line the step's readable name, its second the agent's), the run chat's step tags. A failed
// Warm Up is a "Warm Up failed: ..." line of the chat (run-chat-fail, NEW), and Develop runs after it.
// #304: the suite step (scope affected) on the Run screen has a card (data-testid run-suite-card, NEW)
// with its scope (run-suite-scope, NEW: says the affected tests ran), why each file ran
// (run-suite-selection, NEW: output.selection, e.g. "imports src/roadmap.js") and, when the whole
// suite ran after them, a link to that run's log (run-suite-full-log, NEW). Analytics › Run, the run
// report, gives each suite round a row (an-suite-round, NEW) with the same scope and selection.
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AI_DEV = 'ai-development-local-hero';

// A finished simulated ai-development-local-hero run of the demo project (events.jsonl, summary.json
// and the given files), days back, written like scripts/screenshot.js demoRoadmapRuns. `steps`:
// (at) => the events between workflow.started and workflow.finished. The run list reads the runs
// folder when the screen opens, so no reload is needed.
// `summary`: extra fields of summary.json (#396: `tested`)
function seedAiDevRun(e2e, suffix, task, steps, files = {}, summary = {}) {
  const min = 6e4;
  const start = Date.now() - 2 * 864e5;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-101500-${suffix}`;
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const at = (m) => new Date(start + m * min).toISOString();
  const projectId = e2e.project.id;
  const inner = steps(at);
  const end = Math.max(...inner.map((e) => (Date.parse(e.ts) - start) / min)) + 1;
  // the steps the run went through, as workflow.started lists them (the Run screen builds its steps from it)
  const started = inner.filter((e) => e.type === 'step.started');
  const stepList = [...new Map(started.map((e) => [e.step_id, { id: e.step_id, type: e.step_type || 'agent', agent: e.agent }])).values()];
  // the engine's workflow.finished carries the run's summary (the Run screen reads `tested` from it, #396)
  const finishedSummary = summary.tested ? { summary: { tested: summary.tested, tested_failures: summary.tested_failures } } : {};
  const events = [
    { ts: at(0), type: 'workflow.started', run_id: runId, workflow: AI_DEV, file: `${AI_DEV}.yaml`, project_id: projectId, mock: true, inputs: { task }, steps: stepList },
    ...inner,
    { ts: at(end), type: 'workflow.finished', run_id: runId, status: 'success', ...finishedSummary },
  ].map((e, i) => ({ seq: i + 1, run_id: runId, ...e }));
  const all = {
    'events.jsonl': `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'summary.json': JSON.stringify({
      run_id: runId, workflow: AI_DEV, project_id: projectId, mock: true, inputs: { task }, status: 'success', started_at: at(0), finished_at: at(end), duration_ms: end * min, sessions: [], ...summary,
    }, null, 2),
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

const agentTurn = (at, from, to, step, agent, text) => {
  const session = { agent, provider: 'claude', model: 'claude-opus-5-5' };
  return [
    { ts: at(from), type: 'step.started', step_id: step, step_type: 'agent', agent, visit: 1 },
    { ts: at(from), type: 'session.opened', session_id: `s-${step}`, session },
    { ts: at(to), type: 'session.message_received', session_id: `s-${step}`, step_id: step, text, cost_usd: 0.1, duration_ms: (to - from) * 6e4, session },
  ];
};

// #301: the mapper crashed: warm_up finished with an error, develop ran after it, the run succeeded
Given('the demo project has a finished AI Development run {string} whose Warm Up failed', async ({ e2e }, suffix) => {
  seedAiDevRun(e2e, suffix, `A run whose Warm Up failed (${suffix})`, (at) => [
    { ts: at(1), type: 'step.started', step_id: 'warm_up', step_type: 'agent', agent: 'mapper', visit: 1 },
    { ts: at(1), type: 'session.opened', session_id: 's-warm_up', session: { agent: 'mapper', provider: 'claude', model: 'claude-opus-5-5' } },
    { ts: at(2), type: 'step.finished', step_id: 'warm_up', error: true, duration_ms: 6e4, output: { error: 'mapper crashed (simulated)' } },
    { ts: at(2), type: 'step.transition', from: 'warm_up', to: 'develop', when: '(sequential)' },
    ...agentTurn(at, 2, 20, 'develop', 'developer', 'Implemented the task without a map.'),
    { ts: at(20), type: 'step.finished', step_id: 'develop', duration_ms: 18 * 6e4, output: { summary: 'Implemented the task without a map.' } },
  ]);
});

// #304: the suite step's one visit, as the engine records it (src/engine/workflow.js, scope affected):
// test/roadmap.test.js ran first (logs/suite-1.log), passed, then the whole suite ran
// (logs/suite-1-full.log); the output keeps the selection and the affected round
Given('the demo project has a finished AI Development run {string} whose suite ran the affected tests, then the whole suite', async ({ e2e }, suffix) => {
  const files = ['test/roadmap.test.js'];
  const selection = {
    mode: 'affected', files, reasons: { 'test/roadmap.test.js': 'imports src/roadmap.js' }, changed: ['src/roadmap.js'], slow: [],
    why: 'the 1 affected test file(s) passed; the whole suite runs once before the merge',
  };
  seedAiDevRun(e2e, suffix, `A run with an affected suite (${suffix})`, (at) => [
    ...agentTurn(at, 1, 20, 'develop', 'developer', 'Done.'),
    { ts: at(20), type: 'step.finished', step_id: 'develop', duration_ms: 19 * 6e4, output: { summary: 'Implemented the task.' } },
    { ts: at(21), type: 'step.started', step_id: 'suite', step_type: 'suite', visit: 1 },
    { ts: at(21), type: 'log', level: 'info', kind: 'suite', step_id: 'suite', message: 'suite: 1 test file(s) reach the 1 changed file(s)\n- test/roadmap.test.js: imports src/roadmap.js' },
    {
      ts: at(25),
      type: 'step.finished',
      step_id: 'suite',
      duration_ms: 4 * 6e4,
      output: {
        kind: 'suite', status: 'pass', round: 1, scope: 'full', command: 'npm test', log: 'logs/suite-1-full.log', exit_code: 0, duration_ms: 3 * 6e4, passed: 412, failed: 0, failures: [], preexisting: [], selection,
        affected: { command: 'node --test test/roadmap.test.js', log: 'logs/suite-1.log', passed: 9, failed: 0, duration_ms: 6e4, files },
        message: 'The suite passed in round 1 (`npm test`).',
      },
    },
  ], {
    'logs/suite-1.log': '$ node --test test/roadmap.test.js   (simulated: nothing was run)\n',
    'logs/suite-1-full.log': '$ npm test   (simulated: nothing was run)\n',
  });
});

// Workflows › Runs, after `I search the runs for`: expands the run's row and clicks a button of it
async function rowButton(page, fragment, name) {
  const row = page.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true }).first();
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  const button = row.getByRole('button', { name, exact: true });
  if (!(await button.isVisible())) await row.locator('.pr-row').first().click();
  await button.click();
}

When('I view the run {string} from the list', async ({ e2e }, fragment) => {
  await rowButton(e2e.window, fragment, 'Open run');
});

// #409: the card has no "Open in Analytics" any more: Open run, then the Run screen's own button
When('I open the run {string} in Analytics from the list', async ({ e2e }, fragment) => {
  await rowButton(e2e.window, fragment, 'Open run');
  await e2e.window.getByRole('button', { name: 'Open in Analytics', exact: true }).filter({ visible: true }).first().click({ timeout: LOAD_TIMEOUT });
  await expect(e2e.window.getByTestId('an-run-header')).toContainText(fragment, { timeout: LOAD_TIMEOUT });
});

// the Run screen's steps list: each step's lines (its readable name, then its agent or kind)
const stepLines = async (page) => {
  const box = visibleTestId(page, 'run-steps');
  await expect(box.getByRole('listitem').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  return box.getByRole('listitem').filter({ visible: true }).evaluateAll((els) => els.map((el) => el.innerText.split('\n').map((l) => l.trim()).filter(Boolean)));
};

Then('the run\'s steps show {string} right before {string}', async ({ e2e }, first, then) => {
  await expect.poll(async () => {
    const names = (await stepLines(e2e.window)).map((l) => l[0]);
    const i = names.indexOf(first);
    return i >= 0 && names[i + 1] === then ? 'in order' : names.join(' | ');
  }, { timeout: LOAD_TIMEOUT }).toBe('in order');
});

Then('the run\'s step {string} is run by the agent {string}', async ({ e2e }, step, agent) => {
  await expect.poll(async () => (await stepLines(e2e.window)).find((l) => l[0] === step)?.[1] || '', { timeout: LOAD_TIMEOUT }).toBe(agent);
});

// the chat's "<step> failed: <error>" line (data-testid run-chat-fail, NEW: runchat.js's `fail` item)
const failLine = (page, step) => page.getByTestId('run-chat-fail').filter({ visible: true }).filter({ hasText: new RegExp(`^${escRe(step)} failed:`) }).first();

Then('the run chat says that {string} failed', async ({ e2e }, step) => {
  await expect(failLine(e2e.window, step)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the run chat shows the step {string} after the failure of {string}', async ({ e2e }, step, failed) => {
  const page = e2e.window;
  const fail = failLine(page, failed);
  await expect(fail).toBeVisible({ timeout: LOAD_TIMEOUT });
  const tag = page.getByTestId('run-chat-step').filter({ visible: true }).filter({ hasText: new RegExp(`^${escRe(step)}\\b`) }).last();
  await expect(tag).toBeVisible({ timeout: LOAD_TIMEOUT });
  const after = await fail.evaluate((a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING), await tag.elementHandle());
  expect(after, `the "${step}" step shows after "${failed} failed"`).toBe(true);
});

// the suite step's card on the Run screen, by the step's readable name
const suiteCard = (page, step) => page.getByTestId('run-suite-card').filter({ visible: true }).filter({ hasText: step }).first();

Then('the {string} step card shows that the affected tests ran', async ({ e2e }, step) => {
  const card = suiteCard(e2e.window, step);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card.getByTestId('run-suite-scope')).toContainText(/affected/i);
});

Then('the {string} step card explains the selection with {string}', async ({ e2e }, step, why) => {
  const card = suiteCard(e2e.window, step);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card.getByTestId('run-suite-selection')).toContainText(why);
});

// the link names the whole suite's log (logs/suite-<visit>-full.log) in its text or its tooltip
Then('the {string} step card links the log of the whole suite\'s run', async ({ e2e }, step) => {
  const link = suiteCard(e2e.window, step).getByTestId('run-suite-full-log');
  await expect(link).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(link).toBeEnabled();
  const named = `${await link.textContent()} ${(await link.getAttribute('title')) || ''}`;
  expect(named, 'the link names the whole suite\'s log').toMatch(/suite-1-full\.log/);
});

const suiteRound = (page) => page.getByTestId('an-suite-round').filter({ visible: true }).first();

Then('the run report\'s suite round shows that the affected tests ran', async ({ e2e }) => {
  await expect(suiteRound(e2e.window)).toContainText(/affected/i, { timeout: LOAD_TIMEOUT });
});

Then('the run report\'s suite round explains the selection with {string}', async ({ e2e }, why) => {
  await expect(suiteRound(e2e.window)).toContainText(why, { timeout: LOAD_TIMEOUT });
});

// ---- #396: a run that reached the build without a green suite ------------------------------------
// The policy input suite_red_outside_change (ask | continue, default ask; label "Suite red outside
// the change", pills "Ask" and "Continue") is drawn like any enum input (a radiogroup): the Start
// panel's steps above check it. A run that reached the build without a green suite (the policy, or
// the owner's Continue at test_failed) records summary.json `tested: "not green"` with its failures
// and their class; the Run screen shows a pill "Not tested green" (data-testid run-tested-pill, NEW)
// and the run chat's summary says it too (data-testid runchat-tested, NEW).
// The run "-red00396" is seeded finished: its suite was red on a test outside the change (round 1),
// the policy was continue, the build ran and passed, the run succeeded.
Given('the demo project has a finished AI Development run {string} that reached the build with the suite red outside the change', async ({ e2e }, suffix) => {
  const task = `A run built with a red suite (${suffix})`;
  const failures = [{ test: 'roadmap sorts items by priority', file: 'test/legacy-sort.test.js', class: 'outside the change' }];
  seedAiDevRun(e2e, suffix, task, (at) => [
    ...agentTurn(at, 1, 20, 'develop', 'developer', 'Done.'),
    { ts: at(20), type: 'step.finished', step_id: 'develop', duration_ms: 19 * 6e4, output: { summary: 'Implemented the task.' } },
    { ts: at(21), type: 'step.started', step_id: 'suite', step_type: 'suite', visit: 1 },
    {
      ts: at(25),
      type: 'step.finished',
      step_id: 'suite',
      duration_ms: 4 * 6e4,
      output: {
        kind: 'suite', status: 'fail', round: 1, scope: 'full', command: 'npm test', log: 'logs/suite-1-full.log', exit_code: 1, duration_ms: 3 * 6e4, passed: 411, failed: 1, failures, preexisting: [],
        message: 'The suite failed in round 1 (`npm test`): 1 failure, outside the change.',
      },
    },
    { ts: at(25), type: 'step.transition', from: 'suite', to: 'build', when: "inputs.suite_red_outside_change == 'continue'" },
    { ts: at(26), type: 'step.started', step_id: 'build', step_type: 'build', visit: 1 },
    { ts: at(30), type: 'step.finished', step_id: 'build', duration_ms: 4 * 6e4, output: { status: 'pass', message: 'The build passed.' } },
  ], { 'logs/suite-1-full.log': '$ npm test   (simulated: nothing was run)\n' }, {
    inputs: { task, suite_red_outside_change: 'continue' },
    tested: 'not green',
    tested_failures: failures,
  });
});

Then('the run shows a {string} pill', async ({ e2e }, text) => {
  const pill = visibleTestId(e2e.window, 'run-tested-pill');
  await expect(pill).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(pill).toContainText(text);
});

// checked once the Run screen has drawn the run's suite card (the run is loaded)
Then('the run shows no {string} pill', async ({ e2e }, text) => {
  const page = e2e.window;
  await expect(page.getByTestId('run-suite-card').filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('run-tested-pill').filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText(text, { exact: true }).filter({ visible: true })).toHaveCount(0);
});

Then('the run chat\'s summary says {string}', async ({ e2e }, text) => {
  const line = visibleTestId(e2e.window, 'runchat-tested');
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(text);
});
