// Steps of features/settings.feature's time zone scenarios (#273): Settings › General's Time zone
// select (data-testid="settings-time-zone": IANA zones, the computer's zone by default, saved as
// `timeZone` in the workspace's settings.json) and a time shown in the chosen zone (the run list's
// "started" time: data-testid="run-list-started" in a run-list-row, its tooltip naming the zone).
// Opening Settings, its tabs, Runs and the run search reuse app.steps.js and display-names.steps.js.
// Locators are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const timeZoneSelect = (page) => page.getByTestId('settings-time-zone');
const runRow = (page, fragment) => page.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true }).first();
const startedOf = (page, fragment) => runRow(page, fragment).getByTestId('run-list-started');

// 'HH:MM' (24h) shown either as is or as its 12h form ('10:14 PM'); never the other half of the day
function clockPattern(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const mm = String(m).padStart(2, '0');
  const h12 = h % 12 || 12;
  const half = h < 12 ? 'AM' : 'PM';
  return new RegExp(`(\\b${String(h).padStart(2, '0')}:${mm}\\b(?!\\s*[AP]M)|\\b${h}:${mm}\\b(?!\\s*[AP]M)|\\b${h12}:${mm}\\s*${half}\\b)`, 'i');
}

// ---- Settings › General › Time zone ---------------------------------------------------------------------

// the window's own zone: the computer's (the app runs on this machine)
Then('the time zone is the computer\'s time zone', async ({ e2e }) => {
  const page = e2e.window;
  const system = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await expect(timeZoneSelect(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(timeZoneSelect(page)).toHaveValue(system);
});

Then('the time zone list offers {string}', async ({ e2e }, zone) => {
  await expect(timeZoneSelect(e2e.window).locator(`option[value="${zone}"]`)).toHaveCount(1);
});

When('I choose the time zone {string}', async ({ e2e }, zone) => {
  // fails when the zone is not offered
  await timeZoneSelect(e2e.window).selectOption(zone);
});

Then('the time zone is {string}', async ({ e2e }, zone) => {
  await expect(timeZoneSelect(e2e.window)).toHaveValue(zone, { timeout: LOAD_TIMEOUT });
});

Then('the workspace settings keep the time zone {string}', async ({ e2e }, zone) => {
  const file = path.join(e2e.scratch, 'workspace', 'settings.json');
  await expect.poll(() => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).timeZone; } catch { return null; }
  }).toBe(zone);
});

// ---- a time shown in the chosen zone ----------------------------------------------------------------------

// A finished run of the demo project started three days ago at 01:14 UTC (Asia/Tokyo 10:14, UTC+9;
// America/Sao_Paulo 22:14 the day before, UTC-3: neither has daylight saving time). Written like
// run-card.steps.js' run; the run list reads the runs folder when the screen opens.
Given('the demo workspace gains a finished run {string} started at {string} UTC three days ago', async ({ e2e }, suffix, hhmm) => {
  const min = 6e4;
  const [h, m] = hhmm.split(':').map(Number);
  const day = new Date(Date.now() - 3 * 864e5);
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m);
  const workflow = 'software-development-local-hero';
  const stamp = new Date(start).toISOString();
  const runId = `${stamp.slice(0, 10).replace(/-/g, '')}-${stamp.slice(11, 19).replace(/:/g, '')}-${suffix}`;
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const at = (mins) => new Date(start + mins * min).toISOString();
  const task = `A run started at ${hhmm} UTC (${suffix})`;
  const projectId = e2e.project.id;
  const events = [
    { seq: 1, ts: at(0), type: 'workflow.started', run_id: runId, workflow, file: `${workflow}.yaml`, project_id: projectId, mock: false, inputs: { task } },
    { seq: 2, ts: at(12), type: 'workflow.finished', run_id: runId, status: 'success' },
  ];
  const files = {
    'events.jsonl': `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'summary.json': JSON.stringify({
      run_id: runId, workflow, project_id: projectId, mock: false, inputs: { task }, status: 'success', started_at: at(0), finished_at: at(12), duration_ms: 12 * min, sessions: [],
    }, null, 2),
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
});

Then('the run {string} shows it started at {string}', async ({ e2e }, fragment, hhmm) => {
  const started = startedOf(e2e.window, fragment);
  await expect(started).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(started).toHaveText(clockPattern(hhmm), { timeout: LOAD_TIMEOUT });
});

Then('the run {string}\'s start time names the time zone {string} in its tooltip', async ({ e2e }, fragment, zone) => {
  const started = startedOf(e2e.window, fragment);
  await expect(started).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(started).toHaveAttribute('title', new RegExp(zone.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
});
