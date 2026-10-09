// Steps of features/run-card.feature (#289): the expanded row of the shared run list (run-list.js:
// Workflows › Runs, Projects › Project) with its two columns. Opening the Runs screen and searching a
// run reuse app.steps.js and display-names.steps.js; the demo run res00225 is artifacts.steps.js'.
// Locators are roles and data-testid only (skills/ui-conventions). The row is run-list-row (data-run:
// the run id); its header (.pr-row, no role) expands it. Expanded:
//   run-card-artifacts         the Artifacts column: its head "n of m" (produced of all), the empty
//                              state "Nothing produced yet" with a "Show all (n)" button
//   run-card-artifact-filter   its Produced / Show all switch (aria-pressed) and the category chips
//   run-card-artifact          one file row
//   run-card-repository        the Repository column: run-card-repo-branch, run-card-repo-state,
//                              run-card-repo-totals, run-card-commits with its run-card-commit rows
//                              (the short hash and the subject), run-card-commits-more ("Show n more")
//   run-card-review-changes    "Review changes": opens the changes viewer (diff-viewer.js: a dialog
//                              named "Changes")

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;

const runRow = (page, fragment) => page.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true }).first();
// the one expanded row's columns
const artifactsColumn = (page) => page.getByTestId('run-card-artifacts').filter({ visible: true }).first();
const artifactFilter = (page) => artifactsColumn(page).getByTestId('run-card-artifact-filter');
const artifactRows = (page) => artifactsColumn(page).getByTestId('run-card-artifact');
const repository = (page) => page.getByTestId('run-card-repository').filter({ visible: true }).first();
const commits = (page) => repository(page).getByTestId('run-card-commit');

// A finished run of the demo project, days back, with nothing produced: only a developer log and a
// handoff note (process files), written like scripts/screenshot.js demoArtifactRuns. The run list
// reads the runs folder when the screen opens (runs.listRunsAsync), so no reload is needed.
Given('the demo workspace gains a finished run {string} that only has logs and a handoff note', async ({ e2e }, suffix) => {
  const min = 6e4;
  const workflow = 'software-development-local-hero';
  const start = Date.now() - 4 * 864e5;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-111500-${suffix}`;
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const at = (m) => new Date(start + m * min).toISOString();
  const task = `A run that produced nothing (${suffix})`;
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
    'logs/develop-1.log': 'developer turn 1\n',
    'handoffs/developer-1.md': '# Handoff\n\n- Goal: nothing produced yet.\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
});

When('I expand the run {string} in the list', async ({ e2e }, fragment) => {
  const row = runRow(e2e.window, fragment);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await row.locator('.pr-row').first().click();
  await expect(row.getByTestId('run-card-artifacts')).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// ---- the Artifacts column ------------------------------------------------------------------------------

// Produced | Show all
Then('the run card\'s artifacts show {string}', async ({ e2e }, name) => {
  await expect(artifactFilter(e2e.window).getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: LOAD_TIMEOUT });
});

// the head reads "n of m": the produced files out of all the run's listed files (never the internal ones)
Then('the run card counts its produced artifacts out of all of them', async ({ e2e }) => {
  const column = artifactsColumn(e2e.window);
  await expect(column).toContainText(/\b\d+ of \d+\b/, { timeout: LOAD_TIMEOUT });
  const [, n, m] = (await column.innerText()).match(/\b(\d+) of (\d+)\b/);
  expect(Number(n), `${n} produced of ${m}`).toBeGreaterThan(0);
  expect(Number(n), `${n} produced of ${m}`).toBeLessThanOrEqual(Number(m));
});

Then('the run card lists the artifact {string}', async ({ e2e }, name) => {
  await expect(artifactRows(e2e.window).filter({ hasText: name }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the run card does not list the artifact {string}', async ({ e2e }, name) => {
  // the listing has loaded (a row shows) before its absence counts
  await expect(artifactRows(e2e.window).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(artifactRows(e2e.window).filter({ hasText: name })).toHaveCount(0);
});

// a category chip, e.g. "Tests"
When('I filter the run card\'s artifacts by {string}', async ({ e2e }, name) => {
  await artifactFilter(e2e.window).getByRole('button', { name, exact: true }).click();
});

Then('the run card\'s artifacts say {string}', async ({ e2e }, text) => {
  await expect(artifactsColumn(e2e.window)).toContainText(text, { timeout: LOAD_TIMEOUT });
});

// the empty state's "Show all (n)" button
When('I show all the run card\'s artifacts from its empty state', async ({ e2e }) => {
  await artifactsColumn(e2e.window).getByRole('button', { name: /^Show all \(\d+\)$/ }).click();
});

// ---- the Repository column -----------------------------------------------------------------------------

Then('the run card\'s repository is on the base {string}', async ({ e2e }, base) => {
  const repo = repository(e2e.window);
  await expect(repo.getByTestId('run-card-repo-branch')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(repo).toContainText(base);
});

Then('the run card lists {int} commits', async ({ e2e }, count) => {
  await expect(commits(e2e.window)).toHaveCount(count, { timeout: LOAD_TIMEOUT });
});

// a commit row by its short hash, reading its subject
Then('the run card lists the commit {string} {string}', async ({ e2e }, hash, subject) => {
  const row = commits(e2e.window).filter({ hasText: hash }).first();
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row).toContainText(subject);
});

When('I review the run card\'s changes', async ({ e2e }) => {
  await repository(e2e.window).getByTestId('run-card-review-changes').click();
});

Then('the changes viewer opens', async ({ e2e }) => {
  await expect(e2e.window.getByRole('dialog', { name: 'Changes', exact: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
});
