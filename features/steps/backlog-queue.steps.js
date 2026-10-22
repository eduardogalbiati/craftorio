// Steps of features/backlog.feature for the Backlog's "Queue" error alert (#422): shown when a queued
// run failed and paused the issue queue, it offers Resume (which resumes the queue and takes the
// alert away) and never a dismiss ×; an empty, not paused queue shows no queue bar and a failed
// roadmap run does not pause it (#445). Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screen exposes (the renderer's contract for these steps):
// - #270's data-testid="page-alerts" / "page-alert" (data-level), one alert at a time, the queue's
//   error titled "Queue"; new for #422: a "Resume" button in that alert (the backlog:pause channel,
//   paused false, as the queue's own Resume), and no "Dismiss" (×) button.
//
// The demo workspace has no issue queue. The queue lives in the service's index (src/store.js), not
// in a file the app follows, and no channel pauses it with an error, so the Given makes, inside the
// app's main process, the call the service makes when a queued run fails (src/service/areas/runs.js:
// backlog.setPaused(dir, projectId, true, "#n failed: resume to start the next issues.")).

const path = require('path');
const { expect } = require('@playwright/test');
const { Given, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const QUEUE_ERROR = '#13 failed: resume to start the next issues.';

const alerts = (page) => page.getByTestId('page-alerts').filter({ visible: true }).first();
const shownAlert = (page) => alerts(page).getByTestId('page-alert').filter({ visible: true }).first();

Given('a queued run failed and paused the issue queue', async ({ e2e }) => {
  const args = {
    module: path.resolve(__dirname, '..', '..', 'src', 'backlog.js'),
    dir: path.join(e2e.scratch, 'workspace', 'backlog'),
    projectId: e2e.project.id,
    error: QUEUE_ERROR,
  };
  const res = await e2e.app.evaluate((_electron, a) => {
    const load = process.mainModule?.require;
    if (!load) return { missing: true };
    try {
      load(a.module).setPaused(a.dir, a.projectId, true, a.error);
      return { queue: load(a.module).readQueue(a.dir, a.projectId) };
    } catch (e) { return { thrown: String(e?.message || e) }; }
  }, args);
  expect(res.missing, "the app's main process loads its modules").toBeFalsy();
  expect(res.thrown, 'pausing the queue with an error').toBeFalsy();
  expect(res.queue).toMatchObject({ paused: true, error: QUEUE_ERROR });
});

Then('the shown alert offers {string}', async ({ e2e }, name) => {
  await expect(shownAlert(e2e.window).getByRole('button', { name, exact: true })).toBeEnabled({ timeout: LOAD_TIMEOUT });
});

// the × of an info or a warning (#270: accessible name "Dismiss")
Then('the shown alert has no {string} button', async ({ e2e }, name) => {
  const alert = shownAlert(e2e.window);
  await expect(alert).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(alert.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(alert.getByRole('button', { name: '×', exact: true })).toHaveCount(0);
});

// #445: the plain queue's bar (data-testid="queue-bar", today's #bl-queue) is drawn only when the queue
// has runs waiting, is paused, or has skipped issues to show; an empty queue that is not paused has none
Then('the Backlog shows no queue bar', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByTestId('roadmap-item').or(page.getByTestId('backlog-list')).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('queue-bar').filter({ visible: true })).toHaveCount(0);
});

Then('the alerts no longer show {string}', async ({ e2e }, text) => {
  const page = e2e.window;
  await expect(page.getByTestId('page-alert').filter({ hasText: text }).filter({ visible: true })).toHaveCount(0, { timeout: LOAD_TIMEOUT });
  // nor behind the arrows: every alert is walked through once
  const counter = alerts(page).getByTestId('alerts-counter');
  if (await counter.count()) {
    const total = Number((await counter.innerText()).trim().split('/')[1]) || 1;
    for (let k = 0; k < total; k += 1) {
      await expect(shownAlert(page)).not.toContainText(text);
      await alerts(page).getByRole('button', { name: 'Next alert', exact: true }).click();
    }
  }
});
