// Steps of fronts/build/features/run-pr-fix-811.feature: asking for a fix from the PR monitor's card
// (#811). The app's launch with the fake platform, the start of the simulated run, the card's lines and
// the run's state are #797's, #809's and #810's steps (roadmap-waiting-merge.steps.js,
// pr-monitor.steps.js, pr-merge.steps.js, run.steps.js), reused. Locators are roles and data-testid only
// (skills/ui-conventions).
//
// What the card exposes (the renderer's contract for these steps), inside data-testid="pr-monitor-card":
// - data-testid="pr-request-item"       NEW: one per request (changes requested, unanswered comment,
//                                       failed CI): its author, its file and line ("src/health.js" and
//                                       "12", e.g. "src/health.js:12"), its text, a role="link" to it on
//                                       the platform (href = the comment's URL) and a role="checkbox" to
//                                       select it for the fix
// - data-testid="pr-request-untrusted"  NEW: inside an item whose author has no write access: the mark
//                                       ("untrusted"); that item's checkbox is disabled
// - data-testid="pr-fix-note"           NEW: the note to the developer (a textbox)
// - data-testid="pr-ask-fix"            NEW: the button "Ask for a fix"; nothing reaches an agent before it
// - data-testid="pr-fix-round"          NEW: one per fix asked: "Fix <n> of 5", the agent ("developer"),
//                                       what was sent (each request's author, file:line, the note)
// - data-testid="pr-fix-tokens"         NEW: inside a finished fix round: the tokens it spent ("12.4k tokens")
//
// The platform's side (the feature's comment): the PR file carries gh's review, its review threads and
// each author's access; the E2E launch records each reply on a thread in global.multiagentE2E.prActions
// ({ action: 'reply', number, thread }) and adds the reply to that thread in the file, leaving it
// unresolved (resolving it is the reviewer's).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const PR_FILE = 'pull-request.json'; // the file name roadmap-waiting-merge.steps.js launches the app with
const LOAD_TIMEOUT = 30000;
const READ_TIMEOUT = 60000;
// a simulated developer turn (mock delays scaled down), its push and reply, then a read of the PR
const FIX_TIMEOUT = 150000;

const card = (page) => page.getByTestId('pr-monitor-card').filter({ visible: true }).first();
const requestOf = (page, author) => card(page).getByTestId('pr-request-item').filter({ hasText: author }).first();
const fixRounds = (page) => card(page).getByTestId('pr-fix-round');

const prActions = (e2e) => e2e.app.evaluate(() => global.multiagentE2E?.prActions || []);
const repliesTo = async (e2e, thread) => (await prActions(e2e)).filter((a) => a.action === 'reply' && a.thread === thread);

// ---- what the platform says ---------------------------------------------------------------------

const prFile = (e2e) => path.join(e2e.scratch, PR_FILE);

function editPr(e2e, number, fn) {
  expect(number, 'the pull request this scenario seeded').toBe(e2e.pullRequest?.number);
  const file = prFile(e2e);
  const answer = fn(JSON.parse(fs.readFileSync(file, 'utf8')));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(answer));
  fs.renameSync(tmp, file); // the app reads it at any moment: never half a file
}

const check = (name, conclusion) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status: 'COMPLETED', conclusion });

// an unresolved review thread with one comment, kept by author in e2e.prThreads (its id, its URL)
function thread(e2e, author, file, line, body, association) {
  const n = Object.keys(e2e.prThreads || {}).length + 1;
  const id = `PRRT_e2e811_${n}`;
  const url = `${e2e.pullRequest.url}#discussion_r811${String(n).padStart(3, '0')}`;
  e2e.prThreads = { ...(e2e.prThreads || {}), [author]: { id, url, body } };
  return {
    id, isResolved: false, path: file, line,
    comments: { nodes: [{ id: `PRRC_e2e811_${n}`, databaseId: 811000 + n, author: { login: author }, authorAssociation: association, body, url, createdAt: new Date().toISOString() }] },
  };
}

Given('the pull request #{int} on the platform has changes requested by {string}, who has write access, on {string} line {int}: {string}', async ({ e2e }, number, reviewer, file, line, body) => {
  editPr(e2e, number, (answer) => {
    const t = thread(e2e, reviewer, file, line, body, 'COLLABORATOR');
    return {
      ...answer,
      state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
      statusCheckRollup: [check('unit-tests', 'SUCCESS'), check('lint', 'SUCCESS')],
      reviewDecision: 'CHANGES_REQUESTED',
      latestReviews: [{ author: { login: reviewer }, authorAssociation: 'COLLABORATOR', state: 'CHANGES_REQUESTED', body }],
      reviews: [{ author: { login: reviewer }, authorAssociation: 'COLLABORATOR', state: 'CHANGES_REQUESTED', body }],
      comments: [],
      reviewThreads: [t],
      e2ePermissions: { ...(answer.e2ePermissions || {}), [reviewer]: 'write' },
    };
  });
});

Given('the pull request #{int} on the platform also has a comment by {string}, who has no write access, on {string} line {int}: {string}', async ({ e2e }, number, author, file, line, body) => {
  editPr(e2e, number, (answer) => ({
    ...answer,
    reviewThreads: [...(answer.reviewThreads || []), thread(e2e, author, file, line, body, 'NONE')],
    e2ePermissions: { ...(answer.e2ePermissions || {}), [author]: 'read' },
  }));
});

// ---- what the card lists ------------------------------------------------------------------------

Then('the PR monitor lists the request of {string} on {string} line {int}, with a link to it', async ({ e2e }, author, file, line) => {
  const item = requestOf(e2e.window, author);
  await expect(item).toBeVisible({ timeout: READ_TIMEOUT });
  await expect(item).toContainText(file);
  await expect(item).toContainText(String(line));
  await expect(item.getByRole('link').first()).toHaveAttribute('href', e2e.prThreads[author].url);
});

Then('the request of {string} is marked as untrusted and cannot be selected', async ({ e2e }, author) => {
  const item = requestOf(e2e.window, author);
  await expect(item.getByTestId('pr-request-untrusted')).toBeVisible({ timeout: READ_TIMEOUT });
  await expect(item.getByTestId('pr-request-untrusted')).toContainText(/untrusted/i);
  const box = item.getByRole('checkbox');
  await expect(box).toBeDisabled();
  await expect(box).not.toBeChecked();
});

// no fix round on the card, no reply on any thread: the request stayed with the owner
Then('nothing has gone to the developer', async ({ e2e }) => {
  await expect(card(e2e.window).getByTestId('pr-request-item').first()).toBeVisible({ timeout: READ_TIMEOUT });
  await expect(fixRounds(e2e.window)).toHaveCount(0);
  expect((await prActions(e2e)).filter((a) => a.action === 'reply')).toEqual([]);
});

// ---- what I do ----------------------------------------------------------------------------------

When('I select the request of {string} on the PR monitor', async ({ e2e }, author) => {
  const box = requestOf(e2e.window, author).getByRole('checkbox');
  await box.check({ timeout: READ_TIMEOUT });
  await expect(box).toBeChecked();
});

When('I add the note {string} to the fix', async ({ e2e }, note) => {
  await card(e2e.window).getByTestId('pr-fix-note').fill(note);
});

When('I ask for a fix from the PR monitor', async ({ e2e }) => {
  const button = card(e2e.window).getByTestId('pr-ask-fix');
  await expect(button).toHaveAccessibleName(/Ask for a fix/);
  await button.click({ timeout: READ_TIMEOUT });
});

// ---- what the developer was given, what it did --------------------------------------------------

async function askedFix(e2e, author, file, line) {
  const round = fixRounds(e2e.window).last();
  await expect(round).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(round).toContainText(/developer/i);
  await expect(round).toContainText(author);
  await expect(round).toContainText(file);
  await expect(round).toContainText(String(line));
  return round;
}

Then('the developer was asked to fix the request of {string} on {string} line {int}', async ({ e2e }, author, file, line) => {
  await askedFix(e2e, author, file, line);
});

Then('the developer was asked to fix the request of {string} on {string} line {int}, with the note {string}', async ({ e2e }, author, file, line, note) => {
  const round = await askedFix(e2e, author, file, line);
  await expect(round).toContainText(note);
});

Then('the fix does not include the comment of {string}', async ({ e2e }, author) => {
  const round = fixRounds(e2e.window).last();
  await expect(round).not.toContainText(author);
  await expect(round).not.toContainText(e2e.prThreads[author].body);
});

Then('the developer replied on the thread of {string}', async ({ e2e }, author) => {
  const { id } = e2e.prThreads[author];
  await expect.poll(async () => (await repliesTo(e2e, id)).length, { timeout: FIX_TIMEOUT }).toBe(1);
  expect((await repliesTo(e2e, id))[0]).toMatchObject({ action: 'reply', number: e2e.pullRequest.number, thread: id });
});

Then('nothing was replied on the thread of {string}', async ({ e2e }, author) => {
  expect(await repliesTo(e2e, e2e.prThreads[author].id)).toEqual([]);
});

// the round has ended (its tokens are known) and the card offers "Ask for a fix" again: back in the monitor
Then('the PR monitor shows the fix round {int} of {int} with the tokens it spent', async ({ e2e }, round, max) => {
  const page = e2e.window;
  const line = fixRounds(page).nth(round - 1);
  await expect(fixRounds(page)).toHaveCount(round, { timeout: FIX_TIMEOUT });
  await expect(line).toContainText(new RegExp(`\\b${round}\\b.*\\b${max}\\b`));
  await expect(line.getByTestId('pr-fix-tokens')).toContainText(/[1-9][\d.,]*\s*[kKM]?\s*tokens/, { timeout: FIX_TIMEOUT });
  await expect(card(page).getByTestId('pr-ask-fix')).toBeVisible({ timeout: READ_TIMEOUT });
});
