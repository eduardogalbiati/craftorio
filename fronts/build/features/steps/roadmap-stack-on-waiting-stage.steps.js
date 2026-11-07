// Steps of fronts/build/features/roadmap-stack-on-waiting-stage-807.feature: a roadmap stage whose run
// waits for its PR's merge (the pr_review gate of the PR pipeline) says so under the stage and offers
// Move on or Stack (#807). The reasons of the seed are in the feature's comment. Locators are roles and
// data-testid only (skills/ui-conventions). Reused: "I open the Roadmap", "the roadmap item {string}
// has started / has not started" (roadmap.steps.js).
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="roadmap-merge-wait-notice": under the waiting stage, with data-stage = that stage's
//   data-stage (the index the stage's data-testid="roadmap-stage" section carries); its text has
//   "#<number>" and "merge".
// - data-testid="roadmap-merge-wait-pr-link" inside it: href = the PR's URL, its text has "#<number>".
// - data-testid="roadmap-merge-wait-move-on" (text "Move on"; its text or title says the next stage
//   starts from the current base, e.g. "main") and data-testid="roadmap-merge-wait-stack" (text
//   "Stack"), buttons; no Stack in Fork + PR mode.
// - data-testid="roadmap-item-stacked-on": on a stacked item's card, its text has the branch it
//   starts from; absent on an item that is not stacked.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');
const workflows = require('../../../../features/support/workflows');

const LOAD_TIMEOUT = 30000;
const MINUTE = 60000;
const MODES = { Remote: workflows.REMOTE, 'Fork + PR': workflows.FORK };
const CHOICES = { 'Move on': 'roadmap-merge-wait-move-on', Stack: 'roadmap-merge-wait-stack' };

const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).first();
const stageNamed = (page, name) => page.getByTestId('roadmap-stage').filter({ hasText: name }).first();

// the notice of the stage named `name`: the one whose data-stage is that stage's
async function noticeOf(page, name) {
  const stage = stageNamed(page, name);
  await expect(stage).toBeVisible({ timeout: LOAD_TIMEOUT });
  const index = await stage.getAttribute('data-stage');
  return page.locator(`[data-testid="roadmap-merge-wait-notice"][data-stage="${index}"]`).filter({ visible: true }).first();
}

function choiceOf(notice, label) {
  expect(Object.keys(CHOICES), `a choice labelled "${label}"`).toContain(label);
  return notice.getByTestId(CHOICES[label]);
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

// the run lives in another app (studio-pc): its heartbeat stays fresh until the scratch folder goes
function keepOwnerAlive(runDir) {
  const data = { pid: 4242, host: 'studio-pc', role: 'run', started_at: new Date(Date.now() - 40 * MINUTE).toISOString() };
  let timer = null;
  const beat = () => {
    try { fs.writeFileSync(path.join(runDir, 'owner.json'), JSON.stringify({ ...data, heartbeat_at: new Date().toISOString() })); } catch { clearInterval(timer); }
  };
  beat();
  timer = setInterval(beat, 5000);
  timer.unref?.();
}

// A run of Feature (`mock: false`) that developed on `branch`, opened the PR, saw its CI green and
// waits at the pr_review gate ("Team review") for the team's merge
function writeWaitingRun(e2e, issue, inputs, pr, branch) {
  const now = Date.now();
  const at = (m) => new Date(now - m * MINUTE).toISOString();
  const stamp = at(40).replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const runId = `${stamp}-stack${pr.number}`;
  const runDir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const { name: workflow, file } = workflows.FEATURE;
  const ci = { pr_url: pr.url, pr_number: pr.number, ci_status: 'green', branch };
  const events = [
    { ts: at(40), type: 'workflow.started', workflow, file, project_id: e2e.project.id, inputs, issues: [issue], mock: false, run_dir: runDir },
    { ts: at(39), type: 'step.started', step_id: 'develop', step_type: 'agent', agent: 'developer' },
    { ts: at(20), type: 'step.finished', step_id: 'develop', duration_ms: 19 * MINUTE, output: { branch } },
    { ts: at(19), type: 'step.started', step_id: 'ci', step_type: 'action' },
    { ts: at(5), type: 'step.finished', step_id: 'ci', duration_ms: 14 * MINUTE, output: ci },
    { ts: at(4), type: 'step.started', step_id: 'pr_review', step_type: 'human_approval' },
    { ts: at(4), type: 'approval.requested', step_id: 'pr_review', approval_id: `gate-pr${pr.number}`, message: `PR/MR #${pr.number} (${pr.url}) is green.\nThe team reviews and merges it on the platform.` },
  ];
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${events.map((e, i) => JSON.stringify({ seq: i + 1, run_id: runId, ...e })).join('\n')}\n`);
  keepOwnerAlive(runDir);
  return runId;
}

// The demo's stages replaced by two (issues #3970 and #3971, made up): the run is written first, so the
// roadmap never names a run that is not there
Given('the roadmap\'s stage {string} waits for the merge of the pull request #{int} of {string}, made in {string} mode on the branch {string}, before the stage of {string}', async ({ e2e }, stageName, number, title, modeLabel, branch, nextTitle) => {
  expect(Object.keys(MODES), `a mode labelled "${modeLabel}"`).toContain(modeLabel);
  const mode = MODES[modeLabel];
  e2e.pullRequest = { number, url: `${e2e.project.repo}/pull/${number}` };
  const issue = (n, name) => ({ number: n, url: `${e2e.project.repo}/issues/${n}`, title: name, body: `A small change for the scenarios of #807: ${name}.`, knownPullRequests: [] });
  const waiting = issue(3970, title);
  const runId = writeWaitingRun(e2e, { number: waiting.number, url: waiting.url, title }, mode, e2e.pullRequest, branch);
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
        { id: 'stage-stack-1', name: stageName, note: '', items: [item('stack-item', { ...waiting, mock: false, inputs: mode, status: 'running', runId, runs: [runId] })] },
        { id: 'stage-stack-2', name: 'After the merge', note: '', items: [item('stack-next-item', { ...issue(3971, nextTitle), mock: true, inputs: { ...mode, ...workflows.VALIDATED }, status: 'planned', runId: null })] },
      ],
    });
  });
});

// ---- what the Roadmap says and what I choose ----------------------------------------------------

Then('the stage {string} says the roadmap waits for the merge of the pull request #{int}', async ({ e2e }, name, number) => {
  const notice = await noticeOf(e2e.window, name);
  await expect(notice).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(notice).toContainText(`#${number}`);
  await expect(notice).toContainText(/merge/i);
  const link = notice.getByTestId('roadmap-merge-wait-pr-link');
  await expect(link).toHaveAttribute('href', e2e.pullRequest.url);
  await expect(link).toContainText(`#${number}`);
});

Then('the notice of the stage {string} offers {string} and {string}', async ({ e2e }, name, a, b) => {
  const notice = await noticeOf(e2e.window, name);
  for (const label of [a, b]) {
    const choice = choiceOf(notice, label);
    await expect(choice).toBeEnabled({ timeout: LOAD_TIMEOUT });
    await expect(choice).toContainText(label);
  }
});

Then('the notice of the stage {string} offers {string} but not {string}', async ({ e2e }, name, offered, missing) => {
  const notice = await noticeOf(e2e.window, name);
  const choice = choiceOf(notice, offered);
  await expect(choice).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await expect(choice).toContainText(offered);
  await expect(choiceOf(notice, missing)).toHaveCount(0);
});

// what the choice says: its text or its tooltip (title)
Then('the {string} choice of the stage {string} says the next stage starts from {string}', async ({ e2e }, label, name, base) => {
  const choice = choiceOf(await noticeOf(e2e.window, name), label);
  await expect(choice).toBeVisible({ timeout: LOAD_TIMEOUT });
  const said = `${await choice.innerText()} ${(await choice.getAttribute('title')) || ''}`;
  expect(said, `what "${label}" says`).toContain(base);
});

When('I choose {string} in the notice of the stage {string}', async ({ e2e }, label, name) => {
  const choice = choiceOf(await noticeOf(e2e.window, name), label);
  await expect(choice).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await choice.click();
});

Then('the roadmap item {string} is stacked on the branch {string}', async ({ e2e }, title, branch) => {
  await expect(roadmapItem(e2e.window, title).getByTestId('roadmap-item-stacked-on')).toContainText(branch, { timeout: LOAD_TIMEOUT });
});

Then('the roadmap item {string} is not stacked on another branch', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(item.getByTestId('roadmap-item-stacked-on')).toHaveCount(0);
});
