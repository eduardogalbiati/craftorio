// Steps of fronts/build/features/roadmap-waiting-merge-797.feature: a roadmap item whose run ended well
// with its PR still open waits for the merge (#797). The reasons of the seed are in the feature's
// comment. Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="roadmap-item" and its data-testid="status-label": data-status="waiting_merge"
//   (en "Waiting for PR merge", pt-BR "Aguardando merge do PR").
// - data-testid="roadmap-item-pr-link": on the card, href = the PR's URL, its text has "#<number>".
// - data-testid="roadmap-merge-wait": on the roadmap while an item waits, its text has "#<number>"
//   and "merge".
// - data-testid="roadmap-item-merge-wait": on the card, why the PR could not be read; only then.
//
// The PR's answers go in a JSON file features/support/electron-main.js reads on each call: gh's
// `pr view --json` answer, or { fail: message }. The scratch folder is made by the launch, so the
// app gets the file's name and electron-main.js finds it in that folder.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');
const workflows = require('../../../../features/support/workflows');

const LOAD_TIMEOUT = 30000;
const PR_FILE = 'pull-request.json';
const MINUTE = 60000;

const OPEN = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [] };

const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).first();

function answerPr(e2e, number, answer) {
  expect(number, 'the pull request this scenario seeded').toBe(e2e.pullRequest.number);
  const file = path.join(e2e.scratch, PR_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(answer));
  fs.renameSync(tmp, file); // the app reads it at any moment: never half a file
}

// ---- the demo workspace, edited once the app is open (the app follows the files) ----------------

function editRoadmap(e2e, fn) {
  const file = path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.roadmap.json`);
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(r);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...r, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
}

// A finished run of Feature in Remote mode that opened the PR: a real run for the engine (`mock: false`)
function writeFinishedRun(e2e, issue) {
  const now = Date.now();
  const startedAt = new Date(now - 30 * MINUTE).toISOString();
  const finishedAt = new Date(now - MINUTE).toISOString();
  const stamp = startedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const runId = `${stamp}-merge${e2e.pullRequest.number}`;
  const runDir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const { name: workflow, file } = workflows.FEATURE;
  const { number: pr_number, url: pr_url } = e2e.pullRequest;
  const summary = {
    run_id: runId, workflow, project_id: e2e.project.id, status: 'success', mock: false, started_at: startedAt, finished_at: finishedAt, inputs: workflows.REMOTE, issues: [issue], sessions: [],
  };
  const events = [
    { ts: startedAt, type: 'workflow.started', workflow, file, project_id: e2e.project.id, inputs: workflows.REMOTE, issues: [issue], mock: false, run_dir: runDir },
    { ts: startedAt, type: 'step.started', step_id: 'pr_open', step_type: 'action' },
    { ts: finishedAt, type: 'step.finished', step_id: 'pr_open', duration_ms: 29 * MINUTE, output: { pr_url, pr_number } },
    { ts: finishedAt, type: 'workflow.finished', status: 'success', summary },
  ];
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${events.map((e, i) => JSON.stringify({ seq: i + 1, run_id: runId, ...e })).join('\n')}\n`);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary));
  return runId;
}

Given('the app is open with the pull request #{int} open on the platform', async ({ e2e }, number) => {
  await e2e.open({ env: { CRAFTORIO_E2E_PR_FILE: PR_FILE } });
  e2e.pullRequest = { number, url: `${e2e.project.repo}/pull/${number}` };
  answerPr(e2e, number, OPEN);
});

// The demo's stages replaced by two (issues #3970 and #3971, made up): the run is written first, so the
// roadmap never names a run that is not there
Given('the roadmap is running the item {string}, whose run finished with the pull request #{int}, before the stage of {string}', async ({ e2e }, title, number, nextTitle) => {
  expect(number, 'the pull request this scenario seeded').toBe(e2e.pullRequest.number);
  const issue = (n, name) => ({ number: n, url: `${e2e.project.repo}/issues/${n}`, title: name, body: `A small change for the scenarios of #797: ${name}.`, knownPullRequests: [] });
  const waiting = issue(3970, title);
  const runId = writeFinishedRun(e2e, { number: waiting.number, url: waiting.url, title });
  editRoadmap(e2e, (r) => {
    const model = r.stages.flatMap((s) => s.items).find((x) => x.status === 'planned' && !x.runId && !x.error);
    expect(model, 'a planned item in the demo roadmap').toBeTruthy();
    const item = (id, fields) => {
      const base = JSON.parse(JSON.stringify(model));
      for (const k of ['issues', 'reason', 'modeReason', 'origin', 'cost']) delete base[k];
      return { ...base, id, workflow: workflows.FEATURE.file, workflowName: workflows.FEATURE.name, runs: [], error: null, ...fields };
    };
    Object.assign(r, {
      state: 'running', simulated: true, pausedBy: null, error: null, scope: null, budget: null, live: false,
      stages: [
        { id: 'stage-merge-1', name: 'Behind a PR', note: '', items: [item('merge-item', { ...waiting, mock: false, inputs: workflows.REMOTE, status: 'running', runId, runs: [runId] })] },
        { id: 'stage-merge-2', name: 'After the merge', note: '', items: [item('next-item', { ...issue(3971, nextTitle), mock: true, inputs: { ...workflows.LOCAL, ...workflows.VALIDATED }, status: 'planned', runId: null })] },
      ],
    });
  });
});

When('the pull request #{int} is merged on the platform', async ({ e2e }, number) => {
  answerPr(e2e, number, { ...OPEN, state: 'MERGED' });
});

When('the pull request #{int} is closed without merging on the platform', async ({ e2e }, number) => {
  answerPr(e2e, number, { ...OPEN, state: 'CLOSED' });
});

When('reading the pull request #{int} fails with {string}', async ({ e2e }, number, message) => {
  answerPr(e2e, number, { fail: message });
});

// ---- what I do (the labels in English or in the language scenario 1 chooses) --------------------

const finishedSyncs = (e2e) => e2e.app.evaluate(() => global.multiagentE2E.backlogSyncs);

// waits for the sync's answer (electron-main.js counts them): the screen's label comes back too fast to
// tell, and what follows may read that nothing changed
When('I sync the backlog', async ({ e2e }) => {
  const before = await finishedSyncs(e2e);
  await e2e.window.getByRole('button', { name: /^(Sync|Sincronizar)$/ }).filter({ visible: true }).first().click();
  await expect.poll(() => finishedSyncs(e2e), { timeout: LOAD_TIMEOUT }).toBe(before + 1);
});

When('I show all the items of the roadmap', async ({ e2e }) => {
  const all = e2e.window.getByRole('group', { name: /^(Roadmap items|Itens do roadmap)$/ }).getByRole('button', { name: /^(All|Todos)$/ });
  await all.click();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
});

// ---- what the Roadmap says ----------------------------------------------------------------------

Then('the roadmap item {string} waits for the merge of the pull request #{int}', async ({ e2e }, title, number) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toHaveAttribute('data-status', 'waiting_merge', { timeout: LOAD_TIMEOUT });
  await expect(item.getByTestId('status-label').first()).toHaveAttribute('data-status', 'waiting_merge');
  const link = item.getByTestId('roadmap-item-pr-link');
  await expect(link).toHaveAttribute('href', e2e.pullRequest.url);
  await expect(link).toContainText(`#${number}`);
  await expect(item).not.toContainText('finished without merging');
});

Then('the roadmap item {string} gives no reason for a failed read', async ({ e2e }, title) => {
  await expect(roadmapItem(e2e.window, title).getByTestId('roadmap-item-merge-wait')).toHaveCount(0);
});

Then('the roadmap item {string} says the pull request could not be read: {string}', async ({ e2e }, title, reason) => {
  await expect(roadmapItem(e2e.window, title).getByTestId('roadmap-item-merge-wait')).toContainText(reason, { timeout: LOAD_TIMEOUT });
});

Then('the roadmap says it waits for the merge of the pull request #{int}', async ({ e2e }, number) => {
  const line = e2e.window.getByTestId('roadmap-merge-wait').filter({ visible: true }).first();
  await expect(line).toContainText(`#${number}`, { timeout: LOAD_TIMEOUT });
  await expect(line).toContainText('merge');
});

Then('the roadmap no longer waits for a merge', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('roadmap-merge-wait')).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

// neither paused nor showing an error alert (a pause by an item is a role="alert" on the page, #270)
Then('the roadmap is running with no error', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByTestId('roadmap-bar').getByTestId('roadmap-state-dot')).toHaveAttribute('data-state', 'running', { timeout: LOAD_TIMEOUT });
  await expect(page.getByRole('alert').filter({ visible: true })).toHaveCount(0);
});
