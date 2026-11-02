// Steps of #730: a project's page has the tabs Overview · City · Health · Conflict map (pt-BR Visão geral ·
// Cidade · Saúde · Mapa de conflitos), no Architecture tab (its Facts | City switch gone) and no Refactor tab;
// the Health tab shows the git facts, the Oracle's latest report and its findings, each filed from there.
// Scenarios: fronts/build/features/projects.feature and fronts/analyser/features/architecture.feature (@issue-730).
// Opening the project, its tabs ("I open the {string} project tab", "the project tab {string} is selected") and
// the seeded git project with its report and synced backlog are projects.steps.js's and architecture.steps.js's.
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps, fronts/analyser/views/project/; the same
// test ids as the unit acceptance tests fronts/analyser/test/project-health-730.test.js and project-tabs-730):
// - the project page's tablist (role="tablist"): its role="tab" buttons carry data-testid="project-tab-overview",
//   "project-tab-city", "project-tab-health", "project-tab-conflicts" (data-pv-tab overview | city | health |
//   conflicts, panels #project-panel-<id>);
// - #project-panel-city: the City tab (the project city of #373), with no "architecture-mode-facts" /
//   "architecture-mode-city" switch;
// - #project-panel-health: the Health tab. It holds, top to bottom: data-testid="architecture-facts" (the git
//   facts: the hotspot table with each file's path), data-testid="architecture-report" (the Oracle's latest
//   report: "architecture-report-summary", and one "architecture-verdict" per area, its name and its verdict),
//   then one data-testid="architecture-finding" per finding (its title). A finding not filed yet has two
//   buttons: data-testid="architecture-create-issue" ("Create issue": files a `refactor` issue on GitHub /
//   GitLab) and "architecture-create-issue-prioritize" ("Create issue and prioritize": the same, then a
//   planned roadmap item). Once filed, both buttons are gone and data-testid="architecture-finding-issue"
//   (a link, "#<number>"; "architecture-finding-stage" the roadmap stage when prioritized) takes their place.
//   "Create issues" (data-testid="architecture-create-issues") files the findings shown.
// In simulation the issue is filed into the synced backlog (<workspace>/backlog/<project id>.json) with the
// next free number, its labels kept (packages/engine/domains/discovery/discovery-commit.js simulatedExec).

const path = require('path');
const { expect } = require('@playwright/test');
const { When, Then } = require('../../../../features/steps/fixtures');

const root = path.join(__dirname, '..', '..', '..', '..');
const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (locator) => locator.filter({ visible: true });
const projectPage = (page) => visible(page.getByTestId('project-page')).first();
const projectTabs = (page) => projectPage(page).getByRole('tablist');
const health = (page) => visible(projectPage(page).locator('#project-panel-health')).first();
const healthFinding = (page, title) => health(page).getByTestId('architecture-finding').filter({ hasText: title }).first();
const ISSUE_LINK = 'architecture-finding-issue';
const BUTTONS = { 'Create issue': 'architecture-create-issue', 'Create issue and prioritize': 'architecture-create-issue-prioritize' };
const buttonId = (label) => {
  const id = BUTTONS[label];
  if (!id) throw new Error(`unknown finding button "${label}": one of ${Object.keys(BUTTONS).join(', ')}`);
  return id;
};

// ---- the project page's tabs ------------------------------------------------------------------------------

Then("the project page's tabs are {string}, {string}, {string} and {string}, in this order", async ({ e2e }, a, b, c, d) => {
  const tabs = projectTabs(e2e.window).getByRole('tab');
  await expect(tabs).toHaveCount(4, { timeout: LOAD_TIMEOUT });
  const ids = [a, b, c, d];
  for (let i = 0; i < ids.length; i += 1) {
    await expect(tabs.nth(i), `tab ${i + 1}`).toHaveAttribute('data-testid', ids[i]);
  }
});

Then('the project page has no {string} tab and no {string} tab', async ({ e2e }, a, b) => {
  const tabs = projectTabs(e2e.window);
  await expect(tabs.getByRole('tab').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const name of [a, b]) {
    await expect(tabs.getByRole('tab', { name: new RegExp(`^\\s*${escapeRe(name)}\\s*$`, 'i') }), `no "${name}" tab`).toHaveCount(0);
  }
});

Then('the City tab has no Facts and City switch', async ({ e2e }) => {
  const city = visible(projectPage(e2e.window).locator('#project-panel-city')).first();
  await expect(city).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(projectPage(e2e.window).getByTestId('architecture-mode-facts')).toHaveCount(0);
  await expect(projectPage(e2e.window).getByTestId('architecture-mode-city')).toHaveCount(0);
});

// ---- the Health tab --------------------------------------------------------------------------------------

Then("the Health tab shows the git facts of {string} and {string} above the Oracle's report", async ({ e2e }, a, b) => {
  const page = e2e.window;
  const facts = health(page).getByTestId('architecture-facts');
  const report = health(page).getByTestId('architecture-report');
  await expect(facts).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const file of [a, b]) await expect(facts, `the facts' "${file}"`).toContainText(file, { timeout: LOAD_TIMEOUT });
  await expect(report).toBeVisible();
  const factsBox = await facts.boundingBox();
  const reportBox = await report.boundingBox();
  expect(factsBox.y, 'the git facts come above the report').toBeLessThan(reportBox.y);
});

Then('the Health tab shows the report summary {string} with a verdict for the areas {string} and {string}', async ({ e2e }, summary, a, b) => {
  const report = health(e2e.window).getByTestId('architecture-report');
  await expect(report.getByTestId('architecture-report-summary')).toContainText(summary, { timeout: LOAD_TIMEOUT });
  for (const area of [a, b]) {
    const row = report.getByTestId('architecture-verdict').filter({ hasText: new RegExp(`(^|\\s)${escapeRe(area)}(\\s|:|$)`) }).first();
    await expect(row, `the area "${area}"`).toBeVisible();
    // the area's name and a verdict after it
    await expect(row).toHaveText(new RegExp(`${escapeRe(area)}\\W*\\S.*\\S`));
  }
});

Then('the Health finding {string} offers {string} and {string}', async ({ e2e }, title, a, b) => {
  const row = healthFinding(e2e.window, title);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const label of [a, b]) {
    const button = row.getByTestId(buttonId(label));
    await expect(button, `the finding's "${label}"`).toHaveRole('button');
    await expect(button).toHaveAccessibleName(new RegExp(`^\\s*${escapeRe(label)}\\s*$`, 'i'));
    await expect(button).toBeEnabled();
  }
  await expect(row.getByTestId(ISSUE_LINK)).toHaveCount(0);
});

When('I click {string} on the Health finding {string}', async ({ e2e }, label, title) => {
  const button = healthFinding(e2e.window, title).getByTestId(buttonId(label));
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await button.click();
});

// the synced backlog's issue filed for the finding: its title holds the finding's title
function filedIssue(e2e, name, title) {
  const projects = require(path.join(root, 'packages', 'engine', 'domains', 'project', 'projects'));
  const backlog = require(path.join(root, 'packages', 'engine', 'domains', 'backlog', 'backlog'));
  const ws = path.join(e2e.scratch, 'workspace');
  const project = projects.listProjects(path.join(ws, 'projects')).find((p) => p.name === name);
  if (!project) throw new Error(`no project "${name}" in the scratch workspace`);
  const data = backlog.readBacklog(path.join(ws, 'backlog'), project.id);
  const issue = (data?.issues || []).find((i) => String(i.title || '').includes(title));
  return { project, issue };
}

Then('the Health finding {string} shows the link to its issue instead of its buttons', async ({ e2e }, title) => {
  const row = healthFinding(e2e.window, title);
  const link = row.getByTestId(ISSUE_LINK);
  await expect(link).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(link).toHaveRole('link');
  await expect(link).toContainText(/#\d+/);
  for (const id of Object.values(BUTTONS)) await expect(row.getByTestId(id), `no "${id}" once filed`).toHaveCount(0);
});

Then('the synced backlog of {string} has the open issue of {string} labelled {string}', async ({ e2e }, name, title, label) => {
  await expect.poll(() => filedIssue(e2e, name, title).issue?.state || null, { timeout: LOAD_TIMEOUT, message: `an issue for "${title}"` }).toBe('open');
  const { issue } = filedIssue(e2e, name, title);
  expect((issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)), `the labels of #${issue.number}`).toContain(label);
  const link = healthFinding(e2e.window, title).getByTestId(ISSUE_LINK);
  await expect(link, 'the finding links this issue').toContainText(`#${issue.number}`);
});

Then('the roadmap of {string} does not plan the issue of {string}', async ({ e2e }, name, title) => {
  const roadmaps = require(path.join(root, 'packages', 'engine', 'domains', 'roadmap', 'roadmap'));
  const { project, issue } = filedIssue(e2e, name, title);
  expect(issue, `an issue for "${title}"`).toBeTruthy();
  const roadmap = roadmaps.readRoadmap(path.join(e2e.scratch, 'workspace', 'backlog'), project.id);
  const planned = [...roadmaps.issueStages(roadmap).keys()].map(Number);
  expect(planned, `#${issue.number} is not on the roadmap`).not.toContain(Number(issue.number));
});
