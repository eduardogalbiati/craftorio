// Steps of features/pulls.feature: the PRs / MRs screen, every open pull request of the project grouped
// by what it needs, the menu entry's count, Merge from the list, stacks and the empty state (#812). The
// sidebar's entry is app.steps.js's (`I open "PRs" in the sidebar`) and the platform's record of a merge
// is pr-merge.steps.js's (#810), reused. Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screen exposes (the renderer's contract for these steps):
// - the sidebar's entry "PRs" (GitHub) / "MRs" (GitLab), a role="button" in the navigation; inside it
//   data-testid="pulls-menu-count"  NEW: how many pull requests need me (a number), absent at 0
// - data-testid="pulls-screen"         NEW: the screen
// - data-testid="pulls-group"          NEW: a group, data-group="need-you" ("Need you"), "waiting"
//                                      ("Waiting") or "others" ("Others"), its heading reading its name
//                                      (the same ids as fronts/build/test/renderer-pulls-812.test.js)
// - data-testid="pulls-entry"          NEW: one per pull request (data-number="<n>"), its text has
//                                      "#<number>" and its title;
//                                      it is the Run screen's PR card, so its buttons keep #810's and
//                                      #811's ids: data-testid="pr-merge" ("Merge"), "pr-merge-admin"
//                                      ("Merge ignoring protection"), "pr-close" ("Close"), "pr-ask-fix"
//                                      ("Ask for a fix", never on a pull request no run opened)
// - data-testid="pulls-stack"          NEW: the stacked pull requests, their pulls-entry inside it from
//                                      the bottom of the stack (merged first) to its top
// - data-testid="pulls-empty"          NEW: the empty state; data-reason="none" (no open pull request),
//                                      "no_remote" or "no_cli" (no gh / glab)
//
// The platform's side (the feature's comment): the open pull requests are the E2E PR file's `pulls`
// (gh's `pr view --json` vocabulary), read by the fake platform of features/support/electron-main.js.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');
const { LOAD_TIMEOUT, escapeRe } = require('../support/run-screen');
const workflows = require('../support/workflows');

const PR_FILE = 'pull-requests.json'; // in the launch's scratch folder (MULTIAGENT_E2E_PR_FILE)
const READ_TIMEOUT = 60000;
const MINUTE = 60000;

const GROUPS = { 'Need you': 'need-you', Waiting: 'waiting', Others: 'others' };

const entryName = (name) => new RegExp(`^${escapeRe(name)}(\\s+\\d+)?$`);
const menuEntry = (page, name) => page.getByRole('navigation').getByRole('button', { name: entryName(name) });
const screen = (page) => page.getByTestId('pulls-screen').filter({ visible: true }).first();
const pullCards = (scope) => scope.getByTestId('pulls-entry');
const pullCard = (scope, number) => pullCards(scope).filter({ hasText: new RegExp(`#${number}\\b`) });
const groupOf = (scope, key) => scope.getByTestId('pulls-group').and(scope.locator(`[data-group="${key}"]`));
const group = (page, name) => {
  const key = GROUPS[name];
  expect(key, `a group of the PRs screen (${Object.keys(GROUPS).join(', ')})`).toBeTruthy();
  return groupOf(screen(page), key);
};

// ---- the platform's pull requests, in gh's vocabulary ------------------------------------------------

const check = (name, status, conclusion) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status, conclusion });
const passed = [check('unit-tests', 'COMPLETED', 'SUCCESS'), check('lint', 'COMPLETED', 'SUCCESS')];

// what a pull request needs, as the table says it → gh's fields
const STATES = {
  'ready to merge': () => ({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: passed, reviewDecision: 'APPROVED', latestReviews: [{ author: { login: 'ana' }, state: 'APPROVED' }] }),
  'changes requested': () => ({ mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', statusCheckRollup: passed, reviewDecision: 'CHANGES_REQUESTED', latestReviews: [{ author: { login: 'maria' }, state: 'CHANGES_REQUESTED' }] }),
  conflict: () => ({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', statusCheckRollup: passed, reviewDecision: 'APPROVED', latestReviews: [{ author: { login: 'ana' }, state: 'APPROVED' }] }),
  'CI running': () => ({ mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', statusCheckRollup: [check('unit-tests', 'IN_PROGRESS', null), check('lint', 'COMPLETED', 'SUCCESS')], reviewDecision: 'APPROVED', latestReviews: [{ author: { login: 'ana' }, state: 'APPROVED' }] }),
  "someone else's review": () => ({ mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', statusCheckRollup: passed, reviewDecision: 'REVIEW_REQUIRED', latestReviews: [], reviewRequests: [{ login: 'maria' }] }),
};

// "dependabot[bot]" is gh's app author; anyone else a person
const authorOf = (who) => (/\[bot\]$/.test(who)
  ? { login: `app/${who.replace(/\[bot\]$/, '')}`, name: who.replace(/\[bot\]$/, ''), is_bot: true }
  : { login: who, is_bot: false });

function pullOf(e2e, row) {
  const number = Number(row.number);
  const state = STATES[row.state];
  expect(state, `a pull request's state (${Object.keys(STATES).join(', ')})`).toBeTruthy();
  return {
    number,
    title: row.title,
    url: `${e2e.project.repo}/pull/${number}`,
    author: authorOf(row.author || 'e2e-owner'),
    baseRefName: row.base || 'main',
    headRefName: row.head || `e2e/pr-${number}`,
    state: 'OPEN',
    isDraft: false,
    comments: [],
    ...state(),
  };
}

function writePulls(e2e, pulls) {
  const file = path.join(e2e.scratch, PR_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ pulls }));
  fs.renameSync(tmp, file); // the app reads it at any moment: never half a file
}

// A finished run of Feature in Remote mode that opened the pull request (#797's shape): the PR has a run
function writeRunOf(e2e, pull, index) {
  const now = Date.now();
  const startedAt = new Date(now - (40 + index) * MINUTE).toISOString();
  const finishedAt = new Date(now - (10 + index) * MINUTE).toISOString();
  const stamp = startedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const runId = `${stamp}-pr${pull.number}`;
  const runDir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const { name: workflow, file } = workflows.FEATURE;
  const issue = { number: 3000 + pull.number, url: `${e2e.project.repo}/issues/${3000 + pull.number}`, title: pull.title, body: `A small change for the scenarios of #812: ${pull.title}.`, knownPullRequests: [] };
  const summary = {
    run_id: runId, workflow, project_id: e2e.project.id, status: 'success', mock: false, started_at: startedAt, finished_at: finishedAt, inputs: workflows.REMOTE, issues: [issue], sessions: [],
  };
  const events = [
    { ts: startedAt, type: 'workflow.started', workflow, file, project_id: e2e.project.id, inputs: workflows.REMOTE, issues: [issue], mock: false, run_dir: runDir },
    { ts: startedAt, type: 'step.started', step_id: 'pr_open', step_type: 'action' },
    { ts: finishedAt, type: 'step.finished', step_id: 'pr_open', duration_ms: 30 * MINUTE, output: { pr_url: pull.url, pr_number: pull.number } },
    { ts: finishedAt, type: 'workflow.finished', status: 'success', summary },
  ];
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${events.map((e, i) => JSON.stringify({ seq: i + 1, run_id: runId, ...e })).join('\n')}\n`);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary));
}

// | number | title | author | state | run (yes/no) | base | head |: the platform's open pull requests; a
// "yes" run is written as the run that opened it
Given('the app is open with these pull requests open on the platform:', async ({ e2e }, table) => {
  await e2e.open({ env: { MULTIAGENT_E2E_PR_FILE: PR_FILE } });
  const rows = table.hashes();
  const pulls = rows.map((row) => pullOf(e2e, row));
  writePulls(e2e, pulls);
  rows.forEach((row, i) => { if (/^yes$/i.test(String(row.run || '').trim())) writeRunOf(e2e, pulls[i], i); });
  e2e.pulls = pulls;
  await reloadWithPulls(e2e);
});

Given('the app is open with no pull request open on the platform', async ({ e2e }) => {
  await e2e.open({ env: { MULTIAGENT_E2E_PR_FILE: PR_FILE } });
  writePulls(e2e, []);
  e2e.pulls = [];
  await reloadWithPulls(e2e);
});

// The scratch folder exists only once the app is open, so the PR file and the runs are written after the launch;
// the page is reloaded so its first read (the menu's count, at boot) already sees them, instead of waiting for the
// next timed read minutes later (as app.steps.js addProject)
async function reloadWithPulls(e2e) {
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
}

// ---- the menu's entry --------------------------------------------------------------------------------

Then('the {string} menu entry counts {int} pull request(s) that need(s) me', async ({ e2e }, name, count) => {
  const entry = menuEntry(e2e.window, name);
  await expect(entry).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(entry.getByTestId('pulls-menu-count')).toHaveText(String(count), { timeout: READ_TIMEOUT });
});

Then('the {string} menu entry shows no count', async ({ e2e }, name) => {
  const entry = menuEntry(e2e.window, name);
  await expect(entry).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(entry.getByTestId('pulls-menu-count')).toHaveCount(0);
  await expect(entry).toHaveAccessibleName(entryName(name));
  await expect(entry).not.toHaveAccessibleName(/\d/);
});

// ---- the screen's groups -----------------------------------------------------------------------------

async function expectUnder(e2e, numbers, name) {
  const page = e2e.window;
  await expect(screen(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const g = group(page, name);
  await expect(g).toBeVisible({ timeout: READ_TIMEOUT });
  await expect(g).toContainText(name);
  for (const n of numbers) {
    await expect(pullCard(g, n), `the pull request #${n} under "${name}"`).toHaveCount(1, { timeout: READ_TIMEOUT });
    const title = e2e.pulls?.find((p) => p.number === n)?.title;
    if (title) await expect(pullCard(g, n)).toContainText(title);
    // in that group only
    for (const other of Object.keys(GROUPS).filter((x) => x !== name)) {
      await expect(pullCard(group(page, other), n), `the pull request #${n} not under "${other}"`).toHaveCount(0);
    }
  }
}

Then('the PRs screen lists the pull requests #{int} and #{int} under {string}', async ({ e2e }, a, b, name) => {
  await expectUnder(e2e, [a, b], name);
});

Then('the PRs screen lists the pull request #{int} under {string}', async ({ e2e }, n, name) => {
  await expectUnder(e2e, [n], name);
});

// ---- a pull request's card ---------------------------------------------------------------------------

const cardOf = async (page, number) => {
  await expect(screen(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const c = pullCard(screen(page), number);
  await expect(c, `the pull request #${number} on the PRs screen`).toHaveCount(1, { timeout: READ_TIMEOUT });
  return c;
};

Then('the pull request #{int} offers Merge and Close', async ({ e2e }, number) => {
  const c = await cardOf(e2e.window, number);
  const merge = c.getByTestId('pr-merge');
  await expect(merge).toBeVisible({ timeout: READ_TIMEOUT });
  await expect(merge).toBeEnabled();
  await expect(merge).toHaveAccessibleName(/^Merge\b/);
  await expect(c.getByTestId('pr-close')).toBeVisible();
  await expect(c.getByTestId('pr-close')).toHaveAccessibleName(/^Close\b/);
});

Then('the pull request #{int} offers no Merge', async ({ e2e }, number) => {
  const c = await cardOf(e2e.window, number);
  await expect(c.getByTestId('pr-close')).toBeVisible({ timeout: READ_TIMEOUT });
  await expect(c.getByTestId('pr-merge')).toHaveCount(0);
  await expect(c.getByRole('button', { name: /^Merge$/ })).toHaveCount(0);
});

// "Ask for a fix" (pr-ask-fix) or another of the card's buttons, by its name
Then('the pull request #{int} offers no {string}', async ({ e2e }, number, button) => {
  const c = await cardOf(e2e.window, number);
  await expect(c.getByTestId('pr-close')).toBeVisible({ timeout: READ_TIMEOUT });
  if (button === 'Ask for a fix') await expect(c.getByTestId('pr-ask-fix')).toHaveCount(0);
  await expect(c.getByRole('button', { name: button, exact: true })).toHaveCount(0);
});

When('I merge the pull request #{int} from the PRs screen', async ({ e2e }, number) => {
  const c = await cardOf(e2e.window, number);
  await c.getByTestId('pr-merge').click({ timeout: READ_TIMEOUT });
});

// merged: it leaves "Need you" (gone from the screen, or shown as merged)
Then('the pull request #{int} no longer waits for me on the PRs screen', async ({ e2e }, number) => {
  const page = e2e.window;
  const left = async () => {
    const c = pullCard(group(page, 'Need you'), number);
    if (!(await c.count())) return 'left';
    return /\bMerged\b/.test(await c.first().innerText()) ? 'left' : 'still waiting';
  };
  await expect.poll(left, { timeout: READ_TIMEOUT }).toBe('left');
  await expect(pullCard(screen(page), number).getByTestId('pr-merge')).toHaveCount(0);
});

// ---- a stack -----------------------------------------------------------------------------------------

Then('the PRs screen shows the pull requests #{int}, #{int} and #{int} together as a stack, in that order', async ({ e2e }, a, b, c) => {
  const page = e2e.window;
  await expect(screen(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const stack = screen(page).getByTestId('pulls-stack').filter({ has: pullCard(page, a) });
  await expect(stack, `one stack holds the pull request #${a}`).toHaveCount(1, { timeout: READ_TIMEOUT });
  const numbers = async () => (await pullCards(stack).allInnerTexts()).map((t) => Number((/#(\d+)\b/.exec(t) || [])[1]));
  await expect.poll(numbers, { timeout: READ_TIMEOUT }).toEqual([a, b, c]);
});

// ---- the empty state ---------------------------------------------------------------------------------

Then('the PRs screen says the project has no open pull request', async ({ e2e }) => {
  const page = e2e.window;
  await expect(screen(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const empty = screen(page).getByTestId('pulls-empty');
  await expect(empty).toBeVisible({ timeout: READ_TIMEOUT });
  await expect(empty).toHaveAttribute('data-reason', 'none');
  await expect(empty).toContainText(/no open pull request/i);
});

Then('the PRs screen lists no pull request', async ({ e2e }) => {
  const page = e2e.window;
  await expect(screen(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(pullCards(screen(page))).toHaveCount(0);
  for (const key of Object.values(GROUPS)) await expect(pullCards(groupOf(screen(page), key))).toHaveCount(0);
});
