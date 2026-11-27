// Steps of fronts/build/features/run-chat-orchestrator-795.feature (#795): the run's Chat shows the
// deterministic orchestrator working on a step with no agent (suite, e2e, red_check...): a message
// naming the step and what it runs, its elapsed time and timeout while it runs, the tail of its log
// (expandable) with a link to the whole log, then its outcome. Locators are roles and data-testid only
// (skills/ui-conventions).
//
// The renderer's contract (NEW in #795):
// - data-testid="runchat-orchestrator-message": one per visit of a step with no agent, with
//   data-step="<step id>" (e.g. suite) and data-state="running" | "waiting" | "passed" | "failed". The
//   same element becomes the outcome when the step ends (no second message for the same visit). Its
//   text names the step (its display name, "Run suite (Unit)") and the command it runs; while it runs,
//   the elapsed time (e.g. "0:07" or "7s", ticking) and the step's timeout (the word "timeout"); once
//   failed, the number of failing tests (e.g. "1 failed").
// - data-testid="runchat-orchestrator-log-toggle": expands / collapses the log tail;
//   data-testid="runchat-orchestrator-log-tail": the last lines of the step's log;
//   data-testid="runchat-orchestrator-log-link": the link to the whole log (its text, title or href
//   names the log file, logs/<step>-<visit>[-full].log).
// The E2E hook of the simulation (NEW in #795, read only when CRAFTORIO_SIMULATION_ONLY=1, like the
// onboarding's CRAFTORIO_E2E_ONBOARDING_* hooks): CRAFTORIO_E2E_SUITE_DELAY_MS=<ms> with
// CRAFTORIO_E2E_SUITE_DELAY_STEP=<step id> keeps each simulated round of that suite step running
// that long (its log header "$ npm test   (simulated: nothing was run)" already written) before its
// simulated result (packages/engine/engine/suite-step.js mockSuite: pass "ℹ pass 42", fail "1").

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');
const { FEATURE } = require('../../../../features/support/workflows');

const LOAD_TIMEOUT = 30000;
// a simulated Feature run (Validation Automatic) reaches its suite after Develop, the review and the
// test step: well within two minutes at the default mock speed
const REACH_TIMEOUT = 150000;
// the scenario's budget on top of the config's 180 s: the run up to the suite plus the held suite
const EXTRA_BUDGET = 180000;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// the steps with no agent of feature.yaml, by their display name
const STEPS = {
  'Run suite (Unit)': 'suite',
  'Run suite (E2E)': 'e2e',
  'Red check (TDD)': 'red_check',
  'Rule checks': 'rule_check',
};
const stepId = (name) => {
  const id = STEPS[name];
  if (!id) throw new Error(`unknown step "${name}": one of ${Object.keys(STEPS).join(', ')}`);
  return id;
};

// the step's first orchestrator message (its first visit) in the visible run chat
const message = (page, name) => page.locator(`[data-testid="runchat-orchestrator-message"][data-step="${stepId(name)}"]`).filter({ visible: true }).first();
const allMessages = (page, name) => page.locator(`[data-testid="runchat-orchestrator-message"][data-step="${stepId(name)}"]`).filter({ visible: true });
const logTail = (page, name) => message(page, name).getByTestId('runchat-orchestrator-log-tail');
// an elapsed time as the message may write it: 0:07, 1:02:03, 7s, 7 s, 1m 05s
const TIME = /\b\d+:\d{2}(?::\d{2})?\b|\b\d+\s?(?:s|sec|min|m)\b/g;

Given('the app is open where the simulated {string} step takes {int} seconds', async ({ e2e, $testInfo }, name, seconds) => {
  $testInfo.setTimeout($testInfo.timeout + EXTRA_BUDGET);
  await e2e.open({ env: { CRAFTORIO_E2E_SUITE_DELAY_MS: String(seconds * 1000), CRAFTORIO_E2E_SUITE_DELAY_STEP: stepId(name) } });
});

// Started the way the Start panel starts one (window.api.startRun, channel run:start) with the
// simulation's mockSequences.suite: the step's first round fails (1 failing test), the next ones pass;
// then shown on the Run screen (window.showRun), as agent-providers.steps.js does
When('I start a simulated Feature run with the task {string} whose {string} fails once', async ({ e2e, $testInfo }, task, name) => {
  $testInfo.setTimeout($testInfo.timeout + EXTRA_BUDGET);
  const page = e2e.window;
  const project = e2e.project;
  const res = await page.evaluate(async ({ file, task, step, projectId, folder }) => {
    try {
      const out = await window.api.startRun({
        file, mock: true, projectId,
        inputs: { task, repo_path: folder },
        mockSequences: { suite: { [step]: ['fail', 'pass'] } },
      });
      return { runId: out?.runId || null, answer: out };
    } catch (e) { return { thrown: String(e?.message || e) }; }
  }, { file: FEATURE.file, task, step: stepId(name), projectId: project.id, folder: project.folder || project.repo });
  expect(res.thrown, 'window.api.startRun rejected').toBeFalsy();
  expect(res.runId, `the run started (${JSON.stringify(res.answer)})`).toBeTruthy();
  e2e.startedRunId = res.runId;
  await page.evaluate((runId) => window.showRun(runId, { running: true }), res.runId);
});

Then('the run chat shows the orchestrator\'s message for {string} while it runs', async ({ e2e }, name) => {
  const msg = message(e2e.window, name);
  await expect(msg).toBeVisible({ timeout: REACH_TIMEOUT });
  await expect(msg).toHaveAttribute('data-state', 'running', { timeout: LOAD_TIMEOUT });
  await expect(msg).toContainText(name);
});

Then('the orchestrator\'s message for {string} names what it runs, {string}', async ({ e2e }, name, command) => {
  await expect(message(e2e.window, name)).toContainText(command, { timeout: LOAD_TIMEOUT });
});

// the elapsed time ticks while the step runs (read twice, it changed), and the timeout is shown
Then('the orchestrator\'s message for {string} shows its elapsed time going up and its timeout', async ({ e2e }, name) => {
  const msg = message(e2e.window, name);
  await expect(msg).toHaveAttribute('data-state', 'running');
  await expect(msg).toContainText(/timeout/i);
  const times = async () => ((await msg.innerText()).match(TIME) || []).join(' ');
  await expect.poll(times, { message: 'the message shows an elapsed time', timeout: LOAD_TIMEOUT }).not.toBe('');
  const first = await times();
  await expect.poll(times, { message: `the elapsed time goes up from "${first}"`, timeout: 10000 }).not.toBe(first);
  await expect(msg, 'still running while the time went up').toHaveAttribute('data-state', 'running');
});

When('I expand the orchestrator\'s message for {string}', async ({ e2e }, name) => {
  const page = e2e.window;
  const toggle = message(page, name).getByTestId('runchat-orchestrator-log-toggle');
  await expect(toggle).toBeVisible({ timeout: LOAD_TIMEOUT });
  await toggle.click();
  await expect(logTail(page, name)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// expanded again if the message folded when its state changed
Then('the orchestrator\'s message for {string} shows the tail of its log with {string}', async ({ e2e }, name, text) => {
  const page = e2e.window;
  if (!(await logTail(page, name).isVisible())) await message(page, name).getByTestId('runchat-orchestrator-log-toggle').click();
  await expect(logTail(page, name)).toContainText(text, { timeout: LOAD_TIMEOUT });
});

Then('the orchestrator\'s message for {string} links to the step\'s whole log', async ({ e2e }, name) => {
  const link = message(e2e.window, name).getByTestId('runchat-orchestrator-log-link');
  await expect(link).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(link).toBeEnabled();
  const named = `${await link.textContent()} ${(await link.getAttribute('title')) || ''} ${(await link.getAttribute('href')) || ''}`;
  expect(named, 'the link names the step\'s log file').toMatch(new RegExp(`${escRe(stepId(name))}-\\d+(-[a-z]+)?\\.log`));
});

// the same message became the outcome: the step's one visit has one message
Then('once it ends, the orchestrator\'s message for {string} shows that it passed', async ({ e2e }, name) => {
  const page = e2e.window;
  const msg = message(page, name);
  await expect(msg).toHaveAttribute('data-state', 'passed', { timeout: REACH_TIMEOUT });
  await expect(msg).toContainText(/passed/i);
  await expect(allMessages(page, name)).toHaveCount(1);
});

// #117: a step that was skipped (the rule checks of a project with none) reads "Skipped" in the
// interface language (status_pill.status_skipped: "Pulado"), never "Passed" / "Passou"
Then('the orchestrator\'s message for {string} shows that it was skipped, not passed', async ({ e2e }, name) => {
  const msg = message(e2e.window, name);
  await expect(msg).toBeVisible({ timeout: LOAD_TIMEOUT });
  // the state pill is its own element: the message's text run together ("Rule checkSkipped") has no word boundary
  await expect(msg.locator('.pill').first()).toHaveText(/^(Skipped|Pulado)$/, { timeout: LOAD_TIMEOUT });
  await expect(msg).not.toContainText(/\b(Passed|Passou)\b/);
  await expect(msg).not.toHaveAttribute('data-state', 'passed');
});

Then('once it ends, the orchestrator\'s message for {string} shows that it failed with {int} failing test(s)', async ({ e2e }, name, count) => {
  const msg = message(e2e.window, name);
  await expect(msg).toHaveAttribute('data-state', 'failed', { timeout: REACH_TIMEOUT });
  await expect(msg).toContainText(/fail/i);
  await expect(msg).toContainText(new RegExp(`\\b${count}\\b[^\\d]{0,20}fail|fail[^\\d]{0,20}\\b${count}\\b`, 'i'));
});
