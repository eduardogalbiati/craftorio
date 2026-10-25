// Steps of features/nightwatch.feature (#239): the Night watch screen's permissions (what the
// Oracle may do without asking), ticked, saved and found again; #278: Self-healing, its switch in
// Settings › Execution › Oracle and what the Night watch screen shows of it; #279: the "Apply merged
// fixes to this app" row under it; #335: a step whose cost or minutes regress, in Home's morning
// summary; #337: the turn-on form's "Limits tonight" group and the active limits. Locators are roles and data-testid
// only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the "What the Oracle may do without asking" card
const permissions = (page) => page.getByTestId('nw-permissions');
// a permission's checkbox: its label wraps the permission's name, what it does and its undo
const permission = (page, name) => permissions(page).getByRole('checkbox', { name: new RegExp(`^\\s*${escapeRe(name)}`) });

When('I tick the permission {string}', async ({ e2e }, name) => {
  const box = permission(e2e.window, name);
  await expect(box).not.toBeChecked();
  // the card re-renders on every change: click, then check the new state
  await box.click();
  await expect(permission(e2e.window, name)).toBeChecked();
});

When('I untick every permission', async ({ e2e }) => {
  const card = permissions(e2e.window);
  await expect(card.getByRole('checkbox').first()).toBeVisible();
  const ticked = card.getByRole('checkbox', { checked: true });
  for (let left = await ticked.count(); left > 0; left -= 1) {
    await ticked.first().click();
    await expect(ticked).toHaveCount(left - 1);
  }
});

When('I save the permissions', async ({ e2e }) => {
  const save = permissions(e2e.window).getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect(save).toBeHidden();
});

Then('the permissions show when they were saved', async ({ e2e }) => {
  await expect(permissions(e2e.window).getByText(/Saved \d/)).toBeVisible();
});

Then('the permission {string} is ticked', async ({ e2e }, name) => {
  await expect(permission(e2e.window, name)).toBeChecked();
});

Then('no permission is ticked', async ({ e2e }) => {
  const card = permissions(e2e.window);
  await expect(card.getByRole('checkbox').first()).toBeVisible();
  await expect(card.getByRole('checkbox', { checked: true })).toHaveCount(0);
});

// ---- Self-healing (#278) -------------------------------------------------------------------------------
// Settings › Execution › Oracle's first row: data-testid="oracle-self-healing" (the switch, a
// checkbox, saved on change like the rest of the tab) and data-testid="self-healing-permissions"
// ("What it may do alone (n of 10) ›", opens the Night watch's permissions checklist, nw-permissions).
// The Night watch screen: data-testid="nightwatch-switch" (the watch's switch, a checkbox) and
// data-testid="nightwatch-self-healing" ("Self-healing is on", in place of "On until hh:mm");
// data-testid="nw-never-allowed" holds the never-allowed items, locked (no checkbox that can be ticked).

const selfHealing = (page) => page.getByTestId('oracle-self-healing');
const watchSwitch = (page) => page.getByTestId('nightwatch-switch');

When('I turn Self-healing {word}', async ({ e2e }, state) => {
  const box = selfHealing(e2e.window);
  await expect(box).toBeEnabled();
  await box.setChecked(state === 'on');
  await expect(box).toBeChecked({ checked: state === 'on' });
});

Then('Self-healing is {word}', async ({ e2e }, state) => {
  await expect(selfHealing(e2e.window)).toBeChecked({ checked: state === 'on' });
});

When('I open what Self-healing may do alone', async ({ e2e }) => {
  const link = e2e.window.getByTestId('self-healing-permissions');
  await expect(link).toHaveText(/What it may do alone/);
  await link.click();
});

Then('the permissions checklist is shown', async ({ e2e }) => {
  await expect(permissions(e2e.window)).toBeVisible();
  await expect(permissions(e2e.window).getByRole('checkbox').first()).toBeVisible();
});

Then('the never-allowed item {string} is shown locked', async ({ e2e }, name) => {
  const card = permissions(e2e.window);
  await expect(card.getByTestId('nw-never-allowed').getByText(name, { exact: false })).toBeVisible();
  // locked: the checklist offers no checkbox for it that could be ticked
  await expect(card.getByRole('checkbox', { name: new RegExp(`^\s*${escapeRe(name)}`), disabled: false })).toHaveCount(0);
});

Then('the Night watch says {string}', async ({ e2e }, text) => {
  await expect(e2e.window.getByTestId('nightwatch-self-healing')).toHaveText(new RegExp(escapeRe(text)));
});

Then('the Night watch does not say {string}', async ({ e2e }, text) => {
  await expect(watchSwitch(e2e.window)).toBeAttached();
  await expect(e2e.window.getByTestId('nightwatch-self-healing').filter({ hasText: text })).toHaveCount(0);
});

Then('the Night watch shows no end time', async ({ e2e }) => {
  await expect(watchSwitch(e2e.window)).toBeChecked();
  await expect(e2e.window.getByText(/On until \d/)).toHaveCount(0);
});

Then('the Night watch is off', async ({ e2e }) => {
  await expect(watchSwitch(e2e.window)).not.toBeChecked();
});

// ---- Self-healing applies merged fixes to the app (#279) ---------------------------------------------
// Under the Self-healing row: data-testid="app-update-row" (the row), data-testid="app-update-switch"
// (its checkbox, accessible name "Apply merged fixes to this app"), data-testid="app-update-reason"
// (why it is disabled: "the packaged app updates with a new install" or "no project of this workspace
// is this app's repository"), data-testid="app-update-source" (the source line, only when it applies).

const appUpdateRow = (page) => page.getByTestId('app-update-row');

// ---- a step that regresses against its own history (#335) ---------------------------------------------
// Home's morning summary (the Night watch / Self-healing card, views/nightwatch/nightwatch.js
// renderMorning, shown with its "Open Night watch" button when a watch ended less than 18 h ago):
// data-testid="nw-regression" is one flagged step (its text leads with the step and the rise, e.g.
// "test: +50% cost over 3 runs"), data-testid="nw-regression-run" one link to a run behind it
// (data-run: the run id; it opens the Run screen). Runs are written like run-card.steps.js' run, with
// one agent step: summary.json (sessions, progress) and events.jsonl; the app reads them on reload.

const MIN = 6e4;
const HOUR = 60 * MIN;
const WORKFLOW = 'software-development-local-hero';
const { trailOf } = require('@multiagent/shared/run-progress-model');
const regressions = (page) => page.getByTestId('nw-regression');
const regressionOf = (page, step) => regressions(page).filter({ hasText: new RegExp(`^\\s*${escapeRe(step)}:`) });
const morningCard = (page) => page.getByRole('button', { name: 'Open Night watch', exact: true });

// The watch on for 8 hours, ended `hours` ago (oracle/night-log.jsonl, packages/engine/domains/night/night-watch.js nightsOf)
Given('the Night watch ended {int} hours ago', async ({ e2e }, hours) => {
  const end = Date.now() - hours * HOUR;
  const startedAt = new Date(end - 8 * HOUR).toISOString();
  const until = new Date(end).toISOString();
  const dir = path.join(e2e.scratch, 'workspace', 'oracle');
  const lines = [
    { ts: startedAt, type: 'oracle.watch', on: true, until, startedAt, by: 'owner' },
    { ts: until, type: 'oracle.watch', on: false, until, startedAt, by: 'owner' },
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'night-log.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
});

// One successful run of the demo project whose only agent step `step` cost `cost` in `minutes`
function writeStepRun(e2e, { runId, start, step, cost, minutes, model, mock }) {
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const at = (m) => new Date(start + m * MIN).toISOString();
  const projectId = e2e.project.id;
  const task = `A run of the step ${step} (${runId})`;
  const session = {
    id: `s-${step}`, agent: 'test_writer', provider: 'claude', model, effort: 'medium', parent_id: null, step_id: step,
    turns: 1, tokens: { input: 1200, output: 3400, cache_read: 0, cache_creation: 0 }, cost_usd: cost, status: 'closed',
  };
  const events = [
    { ts: at(0), type: 'workflow.started', run_id: runId, workflow: WORKFLOW, file: `${WORKFLOW}.yaml`, project_id: projectId, mock, inputs: { task } },
    { ts: at(0), type: 'step.started', step_id: step, step_type: 'agent', agent: 'test_writer', visit: 1 },
    { ts: at(0), type: 'session.opened', session_id: session.id, session },
    { ts: at(minutes), type: 'session.message_received', session_id: session.id, step_id: step, text: 'Done.', cost_usd: cost, duration_ms: minutes * MIN, session },
    { ts: at(minutes), type: 'step.finished', step_id: step, duration_ms: minutes * MIN, output: { summary: 'Tests written.' } },
    { ts: at(minutes), type: 'workflow.finished', run_id: runId, status: 'success' },
  ].map((e, i) => ({ seq: i + 1, run_id: runId, ...e }));
  const files = {
    'events.jsonl': `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'summary.json': JSON.stringify({
      run_id: runId, workflow: WORKFLOW, project_id: projectId, mock, inputs: { task }, status: 'success',
      started_at: at(0), finished_at: at(minutes), duration_ms: minutes * MIN, sessions: [session], progress: trailOf(events),
    }, null, 2),
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

// `older` runs at `before` each (days back), then the `last` newest at `after` each (during the last
// night), every one 10 minutes long: only the cost changes. kind: finished (real runs) | simulated
// (mock runs, which never count). Run ids end in rg-<step>-<n>, n = 1 for the oldest.
Given('the step {string} cost US$ {float} in each of {int} {word} runs on {string}, then US$ {float} in each of the last {int} on {string}', async ({ e2e }, step, before, older, kind, oldModel, after, last, newModel) => {
  if (!['finished', 'simulated'].includes(kind)) throw new Error(`runs are "finished" or "simulated", not "${kind}"`);
  const total = older + last;
  for (let n = 1; n <= total; n += 1) {
    const k = total - n; // 0: the newest
    const start = k < last ? Date.now() - (3 + 2 * k) * HOUR : Date.now() - (k - last + 1) * 24 * HOUR - 12 * HOUR;
    const stamp = new Date(start).toISOString();
    const runId = `${stamp.slice(0, 10).replace(/-/g, '')}-${stamp.slice(11, 19).replace(/:/g, '')}-rg-${step}-${n}`;
    const newer = k < last;
    writeStepRun(e2e, { runId, start, step, cost: newer ? after : before, minutes: 10, model: newer ? newModel : oldModel, mock: kind === 'simulated' });
  }
});

Then('the morning summary is shown', async ({ e2e }) => {
  await expect(morningCard(e2e.window)).toBeVisible({ timeout: 30000 });
});

Then('the morning summary flags {string}', async ({ e2e }, text) => {
  await expect(morningCard(e2e.window)).toBeVisible({ timeout: 30000 });
  const step = text.split(':')[0];
  await expect(regressionOf(e2e.window, step)).toHaveCount(1);
  await expect(regressionOf(e2e.window, step)).toContainText(text);
});

Then('the morning summary flags no regression', async ({ e2e }) => {
  await expect(morningCard(e2e.window)).toBeVisible({ timeout: 30000 });
  await expect(regressions(e2e.window)).toHaveCount(0);
});

// the links are the runs of its last `count` (the runs ending in rg-<step>-<n>, newest numbers)
Then('the regression of {string} links to its last {int} runs', async ({ e2e }, step, count) => {
  const links = regressionOf(e2e.window, step).getByTestId('nw-regression-run');
  await expect(links).toHaveCount(count);
  const runs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('data-run') || ''));
  const numbers = runs.map((r) => Number((r.match(new RegExp(`-rg-${escapeRe(step)}-(\\d+)$`)) || [])[1])).sort((a, b) => a - b);
  const newest = Math.max(...numbers);
  expect(numbers, `the runs behind the regression of ${step}: ${runs.join(', ')}`).toEqual(Array.from({ length: count }, (_, i) => newest - count + 1 + i));
});

When('I open the newest run behind the regression of {string}', async ({ e2e }, step) => {
  const links = regressionOf(e2e.window, step).getByTestId('nw-regression-run');
  const runs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('data-run') || ''));
  const newest = [...runs].sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop())).at(-1);
  await links.and(e2e.window.locator(`[data-run="${newest}"]`)).click();
});

Then('the {string} switch is disabled', async ({ e2e }, name) => {
  // a switch is a checkbox named by its label (aria-label)
  const box = e2e.window.getByRole('checkbox', { name, exact: true });
  await expect(box).toBeVisible();
  await expect(box).toBeDisabled();
  await expect(box).not.toBeChecked();
});

Then('applying merged fixes to the app says {string}', async ({ e2e }, text) => {
  await expect(appUpdateRow(e2e.window).getByTestId('app-update-reason')).toContainText(text);
});

Then('applying merged fixes to the app names no source', async ({ e2e }) => {
  await expect(appUpdateRow(e2e.window)).toBeVisible();
  await expect(appUpdateRow(e2e.window).getByTestId('app-update-source')).toHaveCount(0);
});

// ---- Limits tonight (#337) -------------------------------------------------------------------------------
// The turn-on form (shown once the watch's switch is ticked) holds data-testid="nw-limits" (the group):
// "nw-limits-expand" (the "Expand all limits" switch, a checkbox), "nw-limits-multiplier" (a select,
// option values 1.5 / 2 / 3), "nw-limits-customize" (one row per limit: nw-limits-row-context / -cost /
// -duration / -turns / -budget), "nw-limits-summary" (off: "Runs keep each workflow's limits"; on:
// "×2 tonight: context …, turns ×2; nightly budget US$ …"), "nw-limits-warning" (no nightly budget).
// While the watch is on, data-testid="nw-active-limits" shows the limits in force.

const limits = (page) => page.getByTestId('nw-limits');
const expandAll = (page) => limits(page).getByTestId('nw-limits-expand');

When('I start turning the Night watch on', async ({ e2e }) => {
  const sw = watchSwitch(e2e.window);
  await expect(sw).toBeEnabled();
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(limits(e2e.window)).toBeVisible();
});

// `factor` as the owner reads it: "×1.5", "×2" or "×3" (the select's option values are the numbers)
When('I expand all limits to {string}', async ({ e2e }, factor) => {
  await expandAll(e2e.window).setChecked(true);
  await expect(expandAll(e2e.window)).toBeChecked();
  const select = limits(e2e.window).getByTestId('nw-limits-multiplier');
  await select.selectOption(factor.replace(/^×/, ''));
  await expect(select).toHaveValue(factor.replace(/^×/, ''));
});

When('I confirm turning the Night watch on', async ({ e2e }) => {
  await e2e.window.locator('#nw-form').getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(watchSwitch(e2e.window)).toBeChecked();
  await expect(e2e.window.getByText(/On until \d/)).toBeVisible();
});

Then('the limits switch {string} is off', async ({ e2e }, name) => {
  const box = expandAll(e2e.window);
  await expect(box).toHaveAccessibleName(new RegExp(escapeRe(name)));
  await expect(box).not.toBeChecked();
});

Then('the limits tonight say {string}', async ({ e2e }, text) => {
  await expect(limits(e2e.window).getByTestId('nw-limits-summary')).toContainText(text);
});

Then('the limits tonight do not say {string}', async ({ e2e }, text) => {
  const summary = limits(e2e.window).getByTestId('nw-limits-summary');
  await expect(summary).toBeVisible();
  await expect(summary).not.toContainText(text);
});

Then('the limits tonight warn {string}', async ({ e2e }, text) => {
  await expect(limits(e2e.window).getByTestId('nw-limits-warning')).toHaveText(new RegExp(escapeRe(text)));
});

Then('the Night watch shows the active limits {string}', async ({ e2e }, text) => {
  await expect(e2e.window.getByTestId('nw-active-limits')).toContainText(text);
});
