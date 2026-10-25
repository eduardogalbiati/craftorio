// Steps of features/resumed-runs.feature (#384): a failed run that was resumed from a step. Opening
// the Runs screen and searching a run reuse app.steps.js and display-names.steps.js; the row's
// status, the roadmap's run chip and the Run screen's run id reuse roadmap.steps.js.
// Locators are roles and data-testid only (skills/ui-conventions). What the screens expose:
//   run-list-row             one run of the list (data-run: the run id); its status is the row's
//                            first status-label (data-status: the status id, "resumed" for a failed
//                            run that a later run resumed)
//   run-resumed-link         in that row: a link reading "Resumed → <the resumed run's status>"
//                            (succeeded, running, failed…), data-run = the resumed run's id; a click
//                            opens that run (it does not expand the row)
//   roadmap-run-history      on a roadmap card: the item's earlier runs (its runs other than the one
//                            that holds its status), each a roadmap-run-history-entry with
//                            data-run = the run id and a status-label
// Seeding writes run folders into the scratch workspace like run-card.steps.js (events.jsonl,
// summary.json); the run list reads the runs folder when the screen opens, the roadmap follows its file.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const MIN = 6e4;
const WORKFLOW = 'software-development-local-hero';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const runsDir = (e2e) => path.join(e2e.scratch, 'workspace', 'runs');
const runRow = (page, fragment) => page.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true }).first();
const resumedLink = (page, fragment) => runRow(page, fragment).getByTestId('run-resumed-link');
const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).first();
const stamp = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
const iso = (t) => new Date(t).toISOString();

function writeRun(e2e, runId, events, summary) {
  const dir = path.join(runsDir(e2e), runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e, i) => JSON.stringify({ seq: i + 1, run_id: runId, ...e })).join('\n')}\n`);
  if (summary) {
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow: WORKFLOW, project_id: e2e.project.id, mock: false, sessions: [], ...summary,
    }, null, 2));
  }
  return dir;
}

// a live run of another machine (a host that is not this one): its heartbeat kept fresh while the
// scratch workspace exists (like scripts/screenshot/views/roadmap.js demoRoadmapRuns)
function keepAlive(dir) {
  const data = { pid: 4242, host: `${os.hostname()}-studio-pc`, role: 'run', started_at: iso(Date.now() - 3600e3) };
  let timer = null;
  const beat = () => {
    try { fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ ...data, heartbeat_at: iso(Date.now()) })); } catch (e) { if (!timer) throw e; clearInterval(timer); }
  };
  beat();
  timer = setInterval(beat, 5000);
  timer.unref?.();
}

// the failed run: develop, code review, then its tests failed (days back unless `start` is given)
function writeFailedRun(e2e, suffix, start = Date.now() - 2 * 864e5) {
  const runId = `${stamp(start)}-101500-${suffix}`;
  const task = `A run that failed in its tests (${suffix})`;
  const error = 'The suite failed: 3 tests in test/report.test.js';
  const end = start + 40 * MIN;
  writeRun(e2e, runId, [
    { ts: iso(start), type: 'workflow.started', workflow: WORKFLOW, file: `${WORKFLOW}.yaml`, project_id: e2e.project.id, mock: false, inputs: { task } },
    { ts: iso(start + 1e3), type: 'step.started', step_id: 'develop', step_type: 'agent', agent: 'developer' },
    { ts: iso(start + 25 * MIN), type: 'step.finished', step_id: 'develop', duration_ms: 25 * MIN },
    { ts: iso(start + 25 * MIN), type: 'step.started', step_id: 'test', step_type: 'agent', agent: 'test_writer' },
    { ts: iso(end), type: 'step.finished', step_id: 'test', duration_ms: 15 * MIN, error },
    { ts: iso(end), type: 'workflow.finished', status: 'failed', error },
  ], { inputs: { task }, status: 'failed', error, started_at: iso(start), finished_at: iso(end), duration_ms: end - start });
  return { runId, task, end };
}

// the run that resumes `failedId` from its test step: finished (success) or still running
function writeResumedRun(e2e, failedId, suffix, outcome, { task, start }) {
  const runId = `${stamp(start)}-${new Date(start).toISOString().slice(11, 19).replace(/:/g, '')}-${suffix}`;
  const events = [
    { ts: iso(start), type: 'workflow.started', workflow: WORKFLOW, file: `${WORKFLOW}.yaml`, project_id: e2e.project.id, mock: false, inputs: { task }, resumed_from: { run_id: failedId, step: 'test' } },
    { ts: iso(start + 1e3), type: 'step.started', step_id: 'test', step_type: 'agent', agent: 'test_writer' },
  ];
  if (outcome === 'running') {
    keepAlive(writeRun(e2e, runId, events, null));
    return runId;
  }
  const end = start + 12 * MIN;
  events.push(
    { ts: iso(end - 1e3), type: 'step.finished', step_id: 'test', duration_ms: 12 * MIN - 2e3 },
    { ts: iso(end), type: 'workflow.finished', status: 'success' },
  );
  writeRun(e2e, runId, events, { inputs: { task }, status: 'success', started_at: iso(start), finished_at: iso(end), duration_ms: end - start });
  return runId;
}

const OUTCOMES = { 'succeeded': 'success', 'is still running': 'running' };

Given('the failed run {string} was resumed as the run {string}, which succeeded', async ({ e2e }, failed, resumed) => {
  const run = writeFailedRun(e2e, failed);
  writeResumedRun(e2e, run.runId, resumed, OUTCOMES.succeeded, { task: run.task, start: run.end + 30 * MIN });
});

Given('the failed run {string} was resumed as the run {string}, which is still running', async ({ e2e }, failed, resumed) => {
  const run = writeFailedRun(e2e, failed, Date.now() - 3 * 3600e3);
  writeResumedRun(e2e, run.runId, resumed, OUTCOMES['is still running'], { task: run.task, start: Date.now() - 10 * MIN });
});

// the demo roadmap's failed run resumed, recorded on its item as src/domains/roadmap/roadmap.js adoptResumed does
Given('the failed run {string} of the roadmap item {string} was resumed as the run {string}, which is still running', async ({ e2e }, failed, title, resumed) => {
  const dir = fs.readdirSync(runsDir(e2e)).find((d) => d.endsWith(`-${failed}`));
  expect(dir, `the demo workspace has a run ending in -${failed}`).toBeTruthy();
  const summary = JSON.parse(fs.readFileSync(path.join(runsDir(e2e), dir, 'summary.json'), 'utf8'));
  expect(summary.status, `the demo run ${failed} failed`).toBe('failed');
  const newId = writeResumedRun(e2e, dir, resumed, 'running', { task: summary.inputs?.task || 'Demo roadmap run', start: Date.now() - 10 * MIN });

  const file = path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.roadmap.json`);
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const item = r.stages.flatMap((s) => s.items).find((x) => (x.issues?.[0]?.title || x.title) === title);
  expect(item, `a roadmap item "${title}"`).toBeTruthy();
  expect(item.runId, `the roadmap item "${title}" holds the run ${failed}`).toBe(dir);
  Object.assign(item, { status: 'running', runId: newId, runs: [...(item.runs || []), newId], error: null });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...r, updatedAt: iso(Date.now()) }, null, 2));
  fs.renameSync(tmp, file);
});

Then('the run list row of {string} does not show the status {string}', async ({ e2e }, fragment, label) => {
  const row = runRow(e2e.window, fragment);
  await expect(row.getByTestId('status-label').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row.getByTestId('status-label').filter({ hasText: new RegExp(`^\\s*${escapeRe(label)}\\s*$`) })).toHaveCount(0);
});

Then('the run list row of {string} says {string} with a link to the run {string}', async ({ e2e }, fragment, text, resumed) => {
  const link = resumedLink(e2e.window, fragment);
  await expect(link).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(link).toHaveText(new RegExp(`^\\s*${escapeRe(text)}\\s*$`));
  await expect(link).toHaveAttribute('data-run', new RegExp(`${escapeRe(resumed)}$`));
  await expect(link).toHaveRole('link');
});

When('I follow the resumed link of the run {string}', async ({ e2e }, fragment) => {
  await resumedLink(e2e.window, fragment).click();
});

Then('the run history of the roadmap item {string} lists the run {string} as {string}', async ({ e2e }, title, fragment, label) => {
  const history = roadmapItem(e2e.window, title).getByTestId('roadmap-run-history');
  await expect(history).toBeVisible({ timeout: LOAD_TIMEOUT });
  const entry = history.locator(`[data-testid="roadmap-run-history-entry"][data-run$="${fragment}"]`);
  await expect(entry).toBeVisible();
  await expect(entry.getByTestId('status-label')).toHaveText(label);
});
