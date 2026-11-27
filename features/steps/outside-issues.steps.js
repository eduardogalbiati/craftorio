// Steps of features/90-outside-issues.feature (#90): issues opened by outsiders on a public repository carry a
// badge on the Backlog and the Roadmap, the Product Owner's verdict, and wait for the owner's Approve; a suspected
// one is quarantined. Reuses app.steps.js (the app, the sidebar), backlog-archive.steps.js (the Board's list,
// selecting a row), backlog-plan-roadmap.steps.js (the Assign dialog), backlog.steps.js (the Roadmap, "the roadmap
// shows the item"), roadmap-stage-menu.steps.js and roadmap-summary.steps.js (scrolling the roadmap) and the
// Product Owner's steps (open, suggested question, answers, close). Locators are roles and data-testid only.
//
// The seed: the issue is added to the demo backlog (the scratch workspace's backlog/<project>.json, which the
// Backlog reads when it opens) as a GitHub sync leaves it once #90 records the author: `author` (the login, a
// string, as today) and `authorAssociation` (GitHub's author_association: OWNER, MEMBER, COLLABORATOR are trusted;
// CONTRIBUTOR, FIRST_TIMER, FIRST_TIME_CONTRIBUTOR, MANNEQUIN, NONE are outsiders).
//
// What the screens expose (the renderer's contract for these steps, NEW with #90):
// - data-testid="outside-issue-badge": on an outside issue's Backlog row (data-testid="backlog-issue") and on a
//   roadmap card holding one (data-testid="roadmap-item"); its text says "Outside" (any case);
// - data-testid="po-verdict": the Product Owner's verdict on an outside issue's row, its reasons in plain text:
//   "Well written" / "Not well written", "No injection suspected" / "Injection suspected", and the suspect lines
//   quoted as written in the issue;
// - the button "Approve" on an outside issue's row while it waits for the owner (gone once approved);
// - data-testid="issue-quarantined": on the row of an outside issue whose verdict suspects an injection;
// - the Product Owner's plan (aside "Product Owner", data-testid="po-recommendation" cards holding issue links
//   titled with the issue's title, exist) recommends no quarantined issue.

const fs = require('fs');
const { expect } = require('@playwright/test');
const path = require('path');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const OWNER = 'example'; // the demo repository's owner (https://github.com/example/demo-app)

// ---- the demo backlog with added issues --------------------------------------------------------------

const backlogFile = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.json`);

// adds one open issue at the top of the demo backlog, modelled on its plain issue #10 (no epic)
function addIssue(e2e, { title, body = '', author, authorAssociation }) {
  if (!e2e.scratch || !e2e.project) throw new Error('no demo project: open the app first');
  const file = backlogFile(e2e);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const model = data.issues.find((i) => i.number === 10);
  expect(model, "the demo backlog's issue #10").toBeTruthy();
  const number = Math.max(...data.issues.map((i) => i.number)) + 1;
  const issue = { ...model, number, title, body, state: 'open', labels: [], author, authorAssociation, url: model.url.replace(/\d+$/, String(number)), updatedAt: new Date().toISOString() };
  delete issue.epic;
  delete issue.isEpic;
  data.issues = [issue, ...data.issues];
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

Given('the backlog has the issue {string} opened by the owner', async ({ e2e }, title) => {
  addIssue(e2e, { title, author: OWNER, authorAssociation: 'OWNER' });
});

Given('the backlog has the issue {string} opened by the outsider {string}', async ({ e2e }, title, author) => {
  addIssue(e2e, { title, author, authorAssociation: 'NONE' });
});

Given('the backlog has the issue {string} opened by the outsider {string}, saying:', async ({ e2e }, title, author, body) => {
  addIssue(e2e, { title, body, author, authorAssociation: 'NONE' });
});

// ---- the Backlog's rows --------------------------------------------------------------------------------

const issueRow = (page, title) => page.getByTestId('backlog-list').getByTestId('backlog-issue').filter({ hasText: title }).first();
const approve = (page, title) => issueRow(page, title).getByRole('button', { name: 'Approve', exact: true });

Then('the issue {string} shows the outside badge', async ({ e2e }, title) => {
  const badge = issueRow(e2e.window, title).getByTestId('outside-issue-badge');
  await expect(badge).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(badge).toContainText(/outside/i);
});

Then('the issue {string} shows no outside badge', async ({ e2e }, title) => {
  const row = issueRow(e2e.window, title);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row.getByTestId('outside-issue-badge')).toHaveCount(0);
});

Then("the Product Owner's verdict on {string} says {string} and {string}", async ({ e2e }, title, first, second) => {
  const verdict = issueRow(e2e.window, title).getByTestId('po-verdict');
  await expect(verdict).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(verdict).toContainText(first);
  await expect(verdict).toContainText(second);
});

Then("the outside issue {string} waits for the owner's approval", async ({ e2e }, title) => {
  await expect(issueRow(e2e.window, title).getByTestId('outside-issue-badge')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(approve(e2e.window, title)).toBeEnabled();
});

When('I approve the outside issue {string}', async ({ e2e }, title) => {
  await approve(e2e.window, title).click();
});

// approved, it is still an outside issue: the badge stays, the Approve button goes
Then("the outside issue {string} no longer waits for the owner's approval", async ({ e2e }, title) => {
  await expect(approve(e2e.window, title)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
  await expect(issueRow(e2e.window, title).getByTestId('outside-issue-badge')).toBeVisible();
});

Then('the outside issue {string} is shown quarantined', async ({ e2e }, title) => {
  const row = issueRow(e2e.window, title);
  await expect(row.getByTestId('issue-quarantined')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row.getByTestId('outside-issue-badge')).toBeVisible();
});

// ---- the Product Owner's plan and the Roadmap ----------------------------------------------------------

const poDrawer = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });

Then("the Product Owner's plan does not recommend the issue {string}", async ({ e2e }, title) => {
  const drawer = poDrawer(e2e.window);
  await expect(drawer.getByTestId('po-recommendation').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(drawer.getByTestId('po-recommendation').filter({ has: e2e.window.getByTitle(title, { exact: true }) })).toHaveCount(0);
});

const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title });

Then('the roadmap item {string} shows the outside badge', async ({ e2e }, title) => {
  await expect(roadmapItem(e2e.window, title).first().getByTestId('outside-issue-badge')).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the roadmap does not show the item {string}', async ({ e2e }, title) => {
  await expect(e2e.window.getByTestId('roadmap-stage').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(roadmapItem(e2e.window, title)).toHaveCount(0);
});
