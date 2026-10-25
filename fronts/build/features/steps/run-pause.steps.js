// Steps of #368 (fronts/build/features/run.feature, fronts/build/features/roadmap.feature): pause a run or a stage after the
// current agent turn, and resume from there. Locators are roles and data-testid only
// (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps):
// - Run screen: data-testid="run-pause", a button "Pause after current step" (#391) next to Stop, on
//   the Run screen's tab row since #410/#412 (no longer in the header).
// - data-testid="run-pause-state": the run's pause line, data-state = pausing | paused. Pausing reads
//   "Pausing: waiting for <agent> to finish its turn (<step>)" and holds data-testid="run-cancel-pause"
//   (a button "Cancel pause"); paused reads "Paused at <step>, next: <agent>'s turn" and when.
// - data-testid="run-screen-status" (the Run screen's tab row, #412: the header's run-status is gone)
//   has data-status="paused" and reads "Paused" once paused; data-testid="run-screen-id" is the run's
//   id there. The run list's status label (data-testid="status-label", #266) reads "Paused",
//   data-status="paused".
// - data-testid="run-resume": a button "Resume" on a paused run (continues from where it stopped; not
//   the "Resume from step…" of a finished run).
// - Roadmap: the stage actions menu (#282) has a menuitem "Pause after current step" (#391),
//   data-testid="roadmap-stage-pause"; a pausing or paused stage shows data-testid=
//   "roadmap-stage-pause-state" with data-state = pausing | paused ("Pausing: …" / "Paused at …").
// Simulated turns run slower here (Given the app is open with slow simulated turns: the mock delay
// scale 10, a turn of about 15 to 30 s) so the pause lands during an agent's turn.

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');
const { runScreenStatus, runScreenId } = require('../../../../features/support/run-screen');

const SLOW_TURNS = 10;
// a slow simulated turn ends in at most ~35 s; the next step starts right after it
const TURN_TIMEOUT = 120000;
const LOAD_TIMEOUT = 30000;

const visible = (page, id) => page.getByTestId(id).filter({ visible: true }).first();
const pauseState = (page) => visible(page, 'run-pause-state');
// a session card of an agent in the middle of a turn: its status is "active" (or "retrying"), not "running"
const workingCard = (page) => page.locator('[data-testid="run-session-card"]:not([data-id="orchestrator"])').filter({ visible: true })
  .filter({ has: page.locator('[data-status="active"], [data-status="retrying"]') });
const firstLine = (text) => String(text).trim().split('\n')[0].trim();
const stepItems = (page) => visible(page, 'run-steps').getByRole('listitem');
const stage = (page, n) => page.getByTestId('roadmap-stage').filter({ hasText: new RegExp(`\\bStage ${n}\\b`) }).first();
const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).first();

Given('the app is open with slow simulated turns', async ({ e2e }) => {
  await e2e.open({ mockDelayScale: SLOW_TURNS });
});

// an agent (not the orchestrator) is in the middle of its turn; remembers it and the running step
When("an agent's turn of the run is under way", async ({ e2e }) => {
  const page = e2e.window;
  await expect(runScreenStatus(page)).toHaveAttribute('data-status', 'running', { timeout: LOAD_TIMEOUT });
  const card = workingCard(page).first();
  await expect(card).toBeVisible({ timeout: TURN_TIMEOUT });
  e2e.workingAgent = await card.getAttribute('data-agent');
  const running = await stepItems(page).evaluateAll((els) => els.filter((el) => el.classList.contains('running')).map((el) => el.innerText));
  e2e.workingStep = firstLine(running[0] || '');
  e2e.runId = (await runScreenId(page).innerText()).trim();
});

When('I click "Pause after current step" on the run', async ({ e2e }) => {
  const button = visible(e2e.window, 'run-pause');
  await expect(button).toHaveAccessibleName('Pause after current step');
  await button.click();
});

Then('the run says it is pausing, waiting for the working agent to finish its turn, with a "Cancel pause" button', async ({ e2e }) => {
  const line = pauseState(e2e.window);
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toHaveAttribute('data-state', 'pausing');
  await expect(line).toContainText(/Pausing: waiting for .+ to finish its turn \(.+\)/);
  if (e2e.workingAgent) await expect(line).toContainText(new RegExp(e2e.workingAgent.replace(/[-_]/g, '.'), 'i'));
  await expect(line.getByTestId('run-cancel-pause')).toHaveAccessibleName('Cancel pause');
  await expect(line.getByTestId('run-cancel-pause')).toBeEnabled();
  // still running: the agent's turn is not cut
  await expect(runScreenStatus(e2e.window)).not.toHaveAttribute('data-status', 'paused');
});

Then("the run shows where it paused and the next agent's turn", async ({ e2e }) => {
  const line = pauseState(e2e.window);
  await expect(line).toHaveAttribute('data-state', 'paused', { timeout: TURN_TIMEOUT });
  await expect(line).toContainText(/Paused at .+, next: .+'s turn/);
  await expect(line.getByTestId('run-cancel-pause')).toHaveCount(0);
});

Then('the run\'s status is {string} with the id {string}', async ({ e2e }, label, id) => {
  const status = runScreenStatus(e2e.window);
  await expect(status).toHaveAttribute('data-status', id, { timeout: TURN_TIMEOUT });
  await expect(status).toHaveText(label);
});

Then('the run offers Resume', async ({ e2e }) => {
  const button = visible(e2e.window, 'run-resume');
  await expect(button).toHaveAccessibleName('Resume');
  await expect(button).toBeEnabled();
});

// Workflows › Runs: the run just started (its id from the Run screen), simulated runs shown
When('I search the runs for this run', async ({ e2e }) => {
  const page = e2e.window;
  expect(e2e.runId, 'the run id, noted on the Run screen').toBeTruthy();
  await page.getByRole('checkbox', { name: 'Show simulated', exact: true }).filter({ visible: true }).first().check();
  await page.getByRole('textbox', { name: 'Search runs', exact: true }).filter({ visible: true }).first().fill(e2e.runId);
  await expect(page.locator(`[data-testid="run-list-row"][data-run="${e2e.runId}"]`).filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('this run\'s row shows the status {string} with the id {string}', async ({ e2e }, label, id) => {
  const row = e2e.window.locator(`[data-testid="run-list-row"][data-run="${e2e.runId}"]`).filter({ visible: true }).first();
  const status = row.getByTestId('status-label').first();
  await expect(status).toHaveText(label, { timeout: LOAD_TIMEOUT });
  await expect(status).toHaveAttribute('data-status', id);
});

When('I click "Cancel pause" on the run', async ({ e2e }) => {
  await pauseState(e2e.window).getByTestId('run-cancel-pause').click();
});

Then('the run no longer says it is pausing', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('run-pause-state').filter({ visible: true })).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('the run offers "Pause after current step" again', async ({ e2e }) => {
  const button = visible(e2e.window, 'run-pause');
  await expect(button).toHaveAccessibleName('Pause after current step');
  await expect(button).toBeEnabled();
});

// the step that was running when the pause was asked ends and another one starts: the run went on
Then('the run goes on past the current turn without pausing', async ({ e2e }) => {
  const page = e2e.window;
  await expect.poll(async () => {
    const steps = (await stepItems(page).evaluateAll((els) => els.map((el) => ({ text: el.innerText, cls: el.className }))))
      .map((s) => ({ name: firstLine(s.text), cls: s.cls }));
    return steps.some((s) => /\b(running|waiting)\b/.test(s.cls) && s.name !== e2e.workingStep) ? 'went on' : steps.map((s) => `${s.name}:${s.cls}`).join(' | ');
  }, { timeout: TURN_TIMEOUT }).toBe('went on');
  await expect(runScreenStatus(page)).not.toHaveAttribute('data-status', 'paused');
  await expect(page.getByTestId('run-pause-state').filter({ visible: true })).toHaveCount(0);
});

// ---- the roadmap's stage menu ---------------------------------------------------------------------

Then('the stage actions menu entry {string} pauses the stage', async ({ e2e }, name) => {
  const entry = e2e.window.getByRole('menu').filter({ visible: true }).first().getByRole('menuitem', { name, exact: true });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('data-testid', 'roadmap-stage-pause');
});

// the demo stage's runs are seeded (no live turn to wait for): the stage ends paused
Then('stage {int} is shown as paused, not failed', async ({ e2e }, n) => {
  const s = stage(e2e.window, n);
  const line = s.getByTestId('roadmap-stage-pause-state');
  await expect(line).toHaveAttribute('data-state', 'paused', { timeout: TURN_TIMEOUT });
  await expect(line).toContainText(/^Paused/);
  await expect(line).not.toContainText(/fail/i);
});

Then('the roadmap item {string} offers neither Retry nor Skip', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(item.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(item.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
});

Then('the roadmap item {string} is not shown as failed', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).not.toHaveAttribute('data-status', 'failed');
  await expect(item.getByTestId('status-label').first()).not.toHaveAttribute('data-status', 'failed');
});
