// Steps of features/architecture.feature (#356): a project's Architecture tab, its git facts (the
// hotspot table), "Analyze with the Oracle" with its cost estimate, a saved report (summary,
// findings marked new/gone, "Send to Refactor"), and its states. Locators are roles and data-testid
// only (skills/ui-conventions).
//
// What the tab exposes (the renderer's contract for these steps, src/renderer/views/project/):
// - #project-panel-architecture holds the tab; data-testid="architecture-state-not-git" /
//   "architecture-state-never" / ...: the tab's states;
// - data-testid="architecture-analyze": the "Analyze with the Oracle" button, its text or title has
//   the estimate "≈ US$";
// - data-testid="architecture-report-summary", "architecture-findings" (rows "architecture-finding",
//   each with its "new"/"gone" mark and its "architecture-send-refactor" control);
// - data-testid="architecture-hotspots": the hotspot table; "architecture-limits": what the numbers
//   cannot tell.
//
// The git project is seeded in the scenario's scratch folder after the app opened (like app.steps.js's
// second project): a repository on main with a .js and a .py file and three commits, the project
// entry, and optionally a saved report under <workspace>/architecture/<project id>/<stamp>.json in the
// shape architecture:analyze saves; the app reloads to read the project list again.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const root = path.join(__dirname, '..', '..');
const LOAD_TIMEOUT = 30000;
const ANALYSIS_TIMEOUT = 60000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (locator) => locator.filter({ visible: true });
const projectPage = (page) => visible(page.getByTestId('project-page')).first();
const tab = (page) => projectPage(page).locator('#project-panel-architecture');
const byId = (page, id) => visible(tab(page).getByTestId(id)).first();
const analyzeButton = (page) => tab(page).getByTestId('architecture-analyze');

const SUMMARY = 'Billing rules are split between the API and the export script.';
const FINDING = 'Discount rule duplicated in the API and the export';

// git with a fixed identity and commit date, never the machine's config
function git(cwd, args, date) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, '..', 'empty.gitconfig') };
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

const jsBody = (n) => `${['function discount(total) {', '  return total > 100 ? total * 0.9 : total;', '}'].join('\n')}\n${Array.from({ length: n }, (_, i) => `const rate${i} = ${i};`).join('\n')}\nmodule.exports = { discount };\n`;
const pyBody = (n) => `${['def discount(total):', '    return total * 0.9 if total > 100 else total'].join('\n')}\n${Array.from({ length: n }, (_, i) => `RATE_${i} = ${i}`).join('\n')}\n`;

// A git repository on main: src/billing.js and tools/export.py, three commits → its head
function seedRepo(folder) {
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(folder, '..', 'empty.gitconfig'), '');
  git(folder, ['init', '-q', '-b', 'main']);
  const commit = (message, date, files) => {
    for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(folder, rel), content);
    git(folder, ['add', '-A']);
    git(folder, ['commit', '-q', '-m', message], date);
  };
  commit('Add billing and export', '2026-09-01T10:00:00Z', { 'src/billing.js': jsBody(10), 'tools/export.py': pyBody(5) });
  commit('Change the discount rule', '2026-09-08T10:00:00Z', { 'src/billing.js': jsBody(20), 'tools/export.py': pyBody(8) });
  commit('Grow billing', '2026-09-15T10:00:00Z', { 'src/billing.js': jsBody(30) });
  return { commit: git(folder, ['rev-parse', 'HEAD']), date: '2026-09-15T10:00:00Z' };
}

// The saved report architecture:analyze writes (contract-356 §3), dated a minute ago
function savedReport(projectId, head) {
  const date = new Date(Date.now() - 60000).toISOString();
  const id = date.replace(/[:.]/g, '-');
  return {
    // a real (non-simulated) cost, so the Analyze button has an estimate from it (≈ US$ 0.42)
    id, date, project_id: projectId, costUsd: 0.42, tokens: 12000, simulated: false, head,
    report: {
      summary: SUMMARY,
      areas: [{ area: 'src', verdict: 'The API holds the billing rules.' }, { area: 'tools', verdict: 'The export repeats one of them.' }],
      findings: [{
        kind: 'duplicated-rule', title: FINDING, severity: 'medium',
        files: [{ path: 'src/billing.js', lines: '1-3' }, { path: 'tools/export.py', lines: '1-2' }],
        evidence: 'Both files apply 10% off above 100.', refactor: 'Keep the rule in one module the export calls.',
      }],
    },
  };
}

async function seedGitProject(e2e, name, withReport) {
  const workspace = require(path.join(root, 'src', 'workspace'));
  const projects = require(path.join(root, 'src', 'projects'));
  const ws = workspace.setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  const folder = path.join(e2e.scratch, 'repos', name);
  const head = seedRepo(folder);
  const project = await projects.createProject(ws.projects, { name, folder, description: 'A git project (simulated data)' });
  if (withReport) {
    const report = savedReport(project.id, head);
    const dir = path.join(ws.root, 'architecture', project.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${report.id}.json`), JSON.stringify(report, null, 2));
  }
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
}

Given('the workspace has a git project {string} with a JavaScript and a Python file and a saved architecture report', async ({ e2e }, name) => {
  await seedGitProject(e2e, name, true);
});

Given('the workspace has a git project {string} with a JavaScript and a Python file and no architecture report', async ({ e2e }, name) => {
  await seedGitProject(e2e, name, false);
});

Then('the Architecture tab says the project folder is not a git repository', async ({ e2e }) => {
  const state = byId(e2e.window, 'architecture-state-not-git');
  await expect(state).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(state).toContainText(/not a git repository/i);
});

Then('the Architecture tab offers no {string} button', async ({ e2e }, label) => {
  await expect(byId(e2e.window, 'architecture-state-not-git')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(analyzeButton(e2e.window))).toHaveCount(0);
  await expect(visible(tab(e2e.window).getByRole('button', { name: new RegExp(escapeRe(label), 'i') }))).toHaveCount(0);
});

Then('the Architecture tab shows the report summary {string}', async ({ e2e }, text) => {
  const summary = byId(e2e.window, 'architecture-report-summary');
  await expect(summary).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(summary).toContainText(text);
});

Then('the Architecture tab lists the finding {string} marked {string} with a {string} control', async ({ e2e }, title, mark, control) => {
  const findings = byId(e2e.window, 'architecture-findings');
  await expect(findings).toBeVisible({ timeout: LOAD_TIMEOUT });
  const row = findings.getByTestId('architecture-finding').filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(new RegExp(`\\b${escapeRe(mark)}\\b`, 'i'));
  const send = row.getByTestId('architecture-send-refactor');
  await expect(send).toBeVisible();
  await expect(send).toContainText(new RegExp(escapeRe(control), 'i'));
});

Then('the Architecture hotspot table lists {string} and {string} below the report summary', async ({ e2e }, a, b) => {
  const page = e2e.window;
  const hotspots = byId(page, 'architecture-hotspots');
  await expect(hotspots).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const file of [a, b]) await expect(hotspots, `the hotspot table's "${file}"`).toContainText(file, { timeout: LOAD_TIMEOUT });
  const summaryBox = await byId(page, 'architecture-report-summary').boundingBox();
  const tableBox = await hotspots.boundingBox();
  expect(tableBox.y, 'the hotspot table comes below the report summary').toBeGreaterThan(summaryBox.y);
});

Then('the Architecture tab says what the numbers cannot tell', async ({ e2e }) => {
  const limits = tab(e2e.window).getByTestId('architecture-limits').first();
  await expect(limits).toBeAttached({ timeout: LOAD_TIMEOUT });
  await expect(limits).not.toBeEmpty();
});

Then('the Architecture tab says the project was never analysed', async ({ e2e }) => {
  await expect(byId(e2e.window, 'architecture-state-never')).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the {string} button shows a cost estimate in US$', async ({ e2e }, label) => {
  const button = analyzeButton(e2e.window);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toContainText(new RegExp(escapeRe(label), 'i'));
  // the estimate is in its text or its title
  await expect.poll(async () => `${await button.innerText()} ${(await button.getAttribute('title')) || ''}`, { timeout: LOAD_TIMEOUT })
    .toMatch(/≈\s*US\$\s*\d/);
});

Then('the Architecture tab offers the {string} button', async ({ e2e }, label) => {
  const button = analyzeButton(e2e.window);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toContainText(new RegExp(escapeRe(label), 'i'));
});

When('I click {string} on the Architecture tab', async ({ e2e }, label) => {
  const button = analyzeButton(e2e.window);
  await expect(button).toContainText(new RegExp(escapeRe(label), 'i'));
  await button.click();
});

Then('the Architecture tab shows a report summary', async ({ e2e }) => {
  const summary = byId(e2e.window, 'architecture-report-summary');
  await expect(summary).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(summary).not.toBeEmpty();
});
