// Steps of fronts/build/features/releases.feature (#260): a cut line drawn on the Roadmap between two stages
// ("Release here", a name), the Releases screen (Code & Build › Releases: the shipped releases and
// the next one, its notes editable before Ship), the release run's human-only Ship gate (Ship or
// Hold), the recent releases and "Suggest version" in the cut line dialog and on the Releases screen
// (#436), saving the cut line dialog: its toast with Undo, a save refused because the roadmap changed
// elsewhere (#454). Locators are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');
const { openStartPanel } = require('../../../../features/support/run-screen');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stages = (page) => page.getByTestId('roadmap-stage');
const cutLines = (page) => page.getByTestId('roadmap-cut-line');
const sidebar = (page) => page.getByRole('navigation');
const navItem = (page, name) => sidebar(page).getByRole('button', { name: new RegExp(`^${escapeRe(name)}(\\s+\\d+)?$`) });
const nextRelease = (page) => page.getByTestId('release-next');

// ---- the Roadmap's cut line ---------------------------------------------------------------------

// stage n (1-based) as shown, top to bottom
When('I draw a cut line {string} after stage {int}', async ({ e2e }, name, n) => {
  const page = e2e.window;
  const stage = stages(page).nth(n - 1);
  await expect(stage, `the roadmap's stage ${n}`).toBeVisible();
  // #282: the stage's actions are in its ⋮ menu
  await stage.getByTestId('roadmap-stage-menu').click();
  // #748 renamed the stage menu's entry "Release here" to "Release after this stage"
  await page.getByRole('menu').getByRole('menuitem', { name: /Release after this stage/ }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Release name' }) });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Release name' }).fill(name);
  await dialog.getByRole('button', { name: 'Add cut line', exact: true }).click();
  await expect(dialog).toBeHidden();
});

// the cut line comes after stage n and before stage n + 1 in the page (document order)
Then('the roadmap shows a cut line {string} between stage {int} and stage {int}', async ({ e2e }, name, a, b) => {
  const page = e2e.window;
  const line = cutLines(page).filter({ hasText: name });
  await expect(line).toHaveCount(1);
  await expect(line).toBeVisible();
  // #748: the cut line's own label may follow the stage menu's new name, or keep its own
  await expect(line).toContainText(/Release here|Release after this stage/);
  const handle = await line.elementHandle();
  const before = await stages(page).nth(a - 1).elementHandle();
  const after = await stages(page).nth(b - 1).elementHandle();
  const order = await page.evaluate(([l, x, y]) => ({
    afterFirst: !!(x.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING),
    beforeSecond: !!(l.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING),
  }), [handle, before, after]);
  expect(order.afterFirst, `the cut line "${name}" comes after stage ${a}`).toBe(true);
  expect(order.beforeSecond, `the cut line "${name}" comes before stage ${b}`).toBe(true);
});

// ---- the Releases screen ------------------------------------------------------------------------

// Assumption (the developer persists the release history): one file per project,
// <workspace>/releases/<projectId>.json = { releases: [{ version, date, issues: [{ number, title }],
// runs: [runId], cost (USD), tests: { unit: { passed, failed }, e2e: { passed, failed } }, notes,
// status: 'shipped' }] }. Written into the scratch workspace, then the app reloads to read it.
Given('the project shipped the release {string} with the issue {string}', async ({ e2e }, version, title) => {
  const dir = path.join(e2e.scratch, 'workspace', 'releases');
  fs.mkdirSync(dir, { recursive: true });
  const release = {
    version, date: '2026-01-10T18:00:00.000Z', issues: [{ number: 12, title }], runs: ['20260110-170000-rel00260'],
    cost: 1.84, tests: { unit: { passed: 412, failed: 0 }, e2e: { passed: 37, failed: 0 } },
    notes: `${version}: first release.`, status: 'shipped',
  };
  fs.writeFileSync(path.join(dir, `${e2e.project.id}.json`), JSON.stringify({ releases: [release] }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('{string} comes right after {string} in the sidebar', async ({ e2e }, name, previous) => {
  const page = e2e.window;
  const labels = [];
  for (const button of await sidebar(page).getByRole('button').filter({ visible: true }).all()) {
    labels.push((await button.innerText()).replace(/\s+\d+$/, '').trim());
  }
  const at = labels.indexOf(previous);
  expect(at, `"${previous}" in the sidebar (${labels.join(', ')})`).toBeGreaterThanOrEqual(0);
  expect(labels[at + 1], `the entry after "${previous}"`).toBe(name);
  await expect(navItem(page, name)).toBeVisible();
});

Then('the Releases list shows the release {string} with its issues, cost and test results', async ({ e2e }, version) => {
  const row = e2e.window.getByTestId('release-row').filter({ hasText: version });
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await expect(row).toContainText('#12');
  await expect(row).toContainText(/\$\s?1\.84/);
  await expect(row).toContainText(/unit/i);
  await expect(row).toContainText(/e2e/i);
  await expect(row).toContainText('412');
});

Then('the next release lists the issue {string}', async ({ e2e }, title) => {
  await expect(nextRelease(e2e.window)).toContainText(title);
});

// blurs the field so the notes are saved
When('I write {string} in the next release\'s notes', async ({ e2e }, text) => {
  const notes = nextRelease(e2e.window).locator('textarea[data-testid="release-notes"]');
  await expect(notes).toBeEditable();
  await notes.fill(text);
  await notes.blur();
});

Then('the next release\'s notes read {string}', async ({ e2e }, text) => {
  await expect(nextRelease(e2e.window).locator('textarea[data-testid="release-notes"]')).toHaveValue(text);
});

// ---- the release run's Ship gate ----------------------------------------------------------------

// The Start panel's workflow select (labelled "Workflow"), picked by file; the workflow's display
// name is "Release". The release workflow may have no main text input: filled only when shown.
When('I start a simulated run of the workflow {string}', async ({ e2e }, file) => {
  const page = e2e.window;
  // #412: no Start in the header: from Projects › the demo project's "Start workflow"
  await openStartPanel(e2e);
  const select = page.getByRole('combobox', { name: 'Workflow', exact: true });
  await select.selectOption(file);
  await expect.poll(() => select.evaluate((el) => el.selectedOptions[0]?.textContent.trim())).toMatch(/^Release\b/);
  const main = page.getByTestId('start-main-input');
  if (await main.isVisible()) await main.fill('Release v1.0');
  await page.getByRole('checkbox', { name: /Simulation mode/ }).check();
  await page.getByTestId('start-workflow').click();
});

Then('the gate card offers {string} and {string}', async ({ e2e }, a, b) => {
  const card = e2e.window.getByTestId('run-gate').first();
  for (const name of [a, b]) await expect(card.getByTestId('run-gate-choice').filter({ hasText: new RegExp(`^\\s*${escapeRe(name)}\\s*$`) })).toBeEnabled();
});

// ---- the release summary (#290) -----------------------------------------------------------------

const SUMMARY_TIMEOUT = 120000;
const gateCard = (page) => page.getByTestId('run-gate').first();

// A simulated release run whose unit suite is red on its first round (the fix, then both suites
// green), started the way the Start panel starts one (window.api.startRun, channel run:start) with
// the engine's simulation scenario mockSequences.suite (the Start panel has no such choice), then
// shown on the Run screen (window.showRun, as the Start panel does for the run it started).
Given('a simulated release run {string} whose unit suite was red once is open', async ({ e2e }, version) => {
  const page = e2e.window;
  const project = e2e.project;
  const res = await page.evaluate(async ({ version, projectId, folder }) => {
    try {
      const out = await window.api.startRun({
        file: 'release.yaml', mock: true, projectId,
        inputs: { task: `Release ${version}`, version, repo_path: folder },
        mockSequences: { suite: { unit: ['fail', 'pass'] } },
      });
      return { runId: out?.runId || null, answer: out };
    } catch (e) { return { thrown: String(e?.message || e) }; }
  }, { version, projectId: project.id, folder: project.folder || project.repo });
  expect(res.thrown, 'window.api.startRun rejected').toBeFalsy();
  expect(res.runId, `the release run started (${JSON.stringify(res.answer)})`).toBeTruthy();
  await page.evaluate((runId) => window.showRun(runId, { running: true }), res.runId);
});

// The summary (data-testid release-summary) rendered as Markdown: a verdict line first, then the
// sections as headings in this order, the Timeline as a table. On the gate card it is in the
// message, which may sit in the card's collapsed Details.
async function expectReleaseSummary(summary, sections) {
  await expect(summary).toBeVisible({ timeout: SUMMARY_TIMEOUT });
  // the sections in this order (a title heading of its own may come first)
  const named = async () => (await summary.getByRole('heading').allInnerTexts()).map((t) => t.trim())
    .filter((t) => sections.some((s) => t.startsWith(s)));
  await expect.poll(named, { message: 'the release summary\'s sections, in order' }).toEqual(sections);
  await expect(summary.getByRole('table').first(), 'the Timeline table').toBeVisible();
  const text = (await summary.innerText()).trim();
  const verdict = text.slice(0, text.indexOf(sections[0])).trim();
  expect(verdict, 'a verdict line before the first section').not.toBe('');
}

Then('the gate card shows the release summary with {string}, {string}, {string} and {string}', async ({ e2e }, a, b, c, d) => {
  const card = gateCard(e2e.window);
  const summary = card.getByTestId('release-summary');
  await expect(summary).toBeAttached({ timeout: SUMMARY_TIMEOUT });
  if (!(await summary.isVisible())) await card.getByText('Details', { exact: true }).click();
  await expectReleaseSummary(summary, [a, b, c, d]);
});

// the summary leads the gate's message: it comes before the commits not on origin yet
Then('the release summary comes before {string} in the gate card', async ({ e2e }, text) => {
  const card = gateCard(e2e.window);
  await expect(card).toContainText(text, { timeout: SUMMARY_TIMEOUT });
  const order = await card.evaluate((el, needle) => {
    const summary = el.querySelector('[data-testid="release-summary"]');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent.includes(needle)) node = walker.nextNode();
    if (!summary || !node) return { summary: !!summary, text: !!node };
    return { summary: true, text: true, before: !!(summary.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) && !summary.contains(node) };
  }, text);
  expect(order.summary, 'the gate card has the release summary').toBe(true);
  expect(order.text, `the gate card reads "${text}"`).toBe(true);
  expect(order.before, `the release summary comes before "${text}"`).toBe(true);
});

// Assumption (the developer decides the link's source): a shipped release's `runs` names its release
// run, whose folder holds release-summary.md; the release history is the file of #260
// (<workspace>/releases/<projectId>.json). Written into the scratch workspace, then the app reloads.
const RELEASE_RUN = '20260110-170000-rel00290';
const SUMMARY_MD = [
  'Ready to ship: both suites are green on the local main after 1 fix round.',
  '',
  '## Timeline',
  '',
  '| Round | Unit | E2E | Fix |',
  '| --- | --- | --- | --- |',
  '| 1 | red (1 failure) | not run | the workflow loader |',
  '| 2 | green | green | |',
  '',
  '## The fixes',
  '',
  '- The workflow loader read the YAML examples before they merged (#8).',
  '',
  '## Before you ship',
  '',
  '- Read the diff of the fix on the release branch.',
  '',
  '## Follow-ups',
  '',
  '- A unit test for the loader with the examples folder missing.',
  '',
].join('\n');

Given('the project shipped the release {string} whose release run wrote a release summary', async ({ e2e }, version) => {
  const ws = path.join(e2e.scratch, 'workspace');
  const runDir = path.join(ws, 'runs', RELEASE_RUN);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'release-summary.md'), SUMMARY_MD);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: RELEASE_RUN, workflow: 'release.yaml', workflow_name: 'Release', status: 'completed', mock: false,
    project_id: e2e.project.id, started_at: '2026-01-10T17:00:00.000Z', finished_at: '2026-01-10T18:00:00.000Z',
    inputs: { version },
  }, null, 2));
  const dir = path.join(ws, 'releases');
  fs.mkdirSync(dir, { recursive: true });
  const release = {
    version, date: '2026-01-10T18:00:00.000Z', issues: [{ number: 8, title: 'Document the workflow YAML' }], runs: [RELEASE_RUN],
    cost: 6.84, tests: { unit: { passed: 412, failed: 0 }, e2e: { passed: 37, failed: 0 } },
    notes: `${version}: the loader fix.`, status: 'shipped',
  };
  fs.writeFileSync(path.join(dir, `${e2e.project.id}.json`), JSON.stringify({ releases: [release] }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

// the release's row links its summary (data-testid release-summary-link)
When('I open the release summary of the release {string}', async ({ e2e }, version) => {
  const row = e2e.window.getByTestId('release-row').filter({ hasText: version });
  await expect(row).toHaveCount(1);
  await row.getByTestId('release-summary-link').click();
});

Then('the release summary shows {string}, {string}, {string} and {string}', async ({ e2e }, a, b, c, d) => {
  await expectReleaseSummary(e2e.window.getByTestId('release-summary').filter({ visible: true }).first(), [a, b, c, d]);
});

// ---- #436: the recent releases and "Suggest version" ---------------------------------------------
// What the screens expose (new for #436), in the cut line dialog ("Release here" on the Roadmap) and
// next to the Releases screen's version field (#rel-version, label "Version"):
// - data-testid="recent-releases": the last three shipped releases as text, newest first, one per line
//   ("1.1.2 · 2026-10-13 · 4 issues"), above the field; "No release yet" without any;
// - data-testid="suggest-version": a button "Suggest version" (type="button": it never submits) that
//   fills the field with the recommended next version;
// - data-testid="suggest-version-reason": the line under the field saying why ("Minor: 6 enhancements
//   and 3 bugs since 1.1.2").
// Assumption: the suggestion is one bump of the latest shipped version (patch, minor or major, a "v"
// prefix allowed), and its reason starts with that bump's name and names the version it follows.

const cutLineDialog = (page) => page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Release name', exact: true }) });
const releaseVersionField = (page) => nextRelease(page).getByRole('textbox', { name: 'Version', exact: true });

// The project's release history (the file of #260, <workspace>/releases/<projectId>.json): one shipped
// release per row (version, date YYYY-MM-DD, issues: how many), replacing the history; the app reloads.
Given('the project shipped these releases:', async ({ e2e }, table) => {
  const releases = table.hashes().map((row, k) => ({
    version: row.version, tag: row.version, date: `${row.date}T12:00:00.000Z`, base: 'main',
    issues: Array.from({ length: Number(row.issues) }, (_, i) => ({ number: 500 + k * 20 + i, title: `Shipped change ${k + 1}.${i + 1}` })),
    runs: [`${row.date.replace(/-/g, '')}-120000-rel${String(k).padStart(5, '0')}`], cost: 2.5,
    tests: { unit: { status: 'pass', passed: 412, failed: 0 }, e2e: { status: 'pass', passed: 37, failed: 0 } },
    notes: `# ${row.version}`, status: 'shipped',
  }));
  const dir = path.join(e2e.scratch, 'workspace', 'releases');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${e2e.project.id}.json`), JSON.stringify({ releases, next: { notes: '' } }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('the cut line dialog shows the recent releases {string}, {string} and {string} above the {string} field', async ({ e2e }, a, b, c, label) => {
  const dialog = cutLineDialog(e2e.window);
  await expect(dialog).toBeVisible();
  const recent = dialog.getByTestId('recent-releases');
  await expect(recent).toBeVisible();
  const text = (await recent.innerText()).replace(/\s+/g, ' ');
  const at = [a, b, c].map((line) => text.indexOf(line));
  expect(at.every((i) => i >= 0), `the recent releases read ${a}, ${b} and ${c}: "${text}"`).toBe(true);
  expect(at[0] < at[1] && at[1] < at[2], `newest first: "${text}"`).toBe(true);
  const box = await recent.boundingBox();
  const field = await dialog.getByRole('textbox', { name: label, exact: true }).boundingBox();
  expect(box.y + box.height, `the recent releases end above the "${label}" field`).toBeLessThanOrEqual(field.y + 1);
});

Then('the cut line dialog does not list the release {string}', async ({ e2e }, version) => {
  await expect(cutLineDialog(e2e.window).getByTestId('recent-releases')).not.toContainText(new RegExp(`(^|\\s)${escapeRe(version)} ·`));
});

When('I click {string} in the cut line dialog', async ({ e2e }, name) => {
  const button = cutLineDialog(e2e.window).getByRole('button', { name, exact: true });
  if (name === 'Suggest version') await expect(button).toHaveAttribute('data-testid', 'suggest-version');
  await button.click();
});

When('I click {string} next to the release version', async ({ e2e }, name) => {
  const button = nextRelease(e2e.window).getByRole('button', { name, exact: true });
  await expect(button).toBeVisible();
  if (name === 'Suggest version') await expect(button).toHaveAttribute('data-testid', 'suggest-version');
  await button.click();
});

// one bump of `previous` (x.y.z): patch, minor or major, and the reason names that bump and `previous`
async function expectSuggestion(field, reason, previous) {
  const [M, m, p] = previous.split('.').map(Number);
  const bumps = { Patch: `${M}.${m}.${p + 1}`, Minor: `${M}.${m + 1}.0`, Major: `${M + 1}.0.0` };
  await expect(field).toHaveValue(new RegExp(`^v?(${Object.values(bumps).map(escapeRe).join('|')})$`));
  const value = (await field.inputValue()).replace(/^v/, '');
  await expect(reason).toBeVisible();
  const kind = Object.keys(bumps).find((k) => bumps[k] === value);
  await expect(reason).toContainText(new RegExp(`^\\s*${kind}\\b`));
  await expect(reason).toContainText(`since ${previous}`);
}

Then('the {string} field holds the version suggested after {string}, with the reason', async ({ e2e }, label, previous) => {
  const dialog = cutLineDialog(e2e.window);
  await expectSuggestion(dialog.getByRole('textbox', { name: label, exact: true }), dialog.getByTestId('suggest-version-reason'), previous);
});

Then('the cut line dialog is still open', async ({ e2e }) => {
  await expect(cutLineDialog(e2e.window)).toBeVisible();
});

Then('the release version holds the version suggested after {string}, with the reason', async ({ e2e }, previous) => {
  const page = e2e.window;
  await expectSuggestion(releaseVersionField(page), nextRelease(page).getByTestId('suggest-version-reason'), previous);
});

// ---- #454: saving the cut line dialog: the toast with Undo, a refused save -----------------------
// What the screen exposes: the dialog (data-testid="cut-line-modal", role dialog, the textbox "Release
// name", buttons "Add cut line" and "Cancel"); data-testid="cut-line-error" (NEW) on the dialog's
// error line, where a refused save's reason shows; the toast (data-testid="toast", as #281) "Set the
// cut line <name>" with "Undo"; each cut line data-testid="roadmap-cut-line" (as #260). A refused save
// (the service's `conflict`, packages/engine/domains/roadmap/roadmap-merge.js) keeps the dialog open, or reopens it, with the
// name typed. Stage n is the stage the roadmap numbers "Stage n" (stage 1, done, is hidden in Planned).

const LOAD_TIMEOUT = 30000;
const numberedStage = (page, n) => stages(page).filter({ hasText: new RegExp(`\\bStage ${n}\\b`) }).first();
const cutLine = (page, name) => cutLines(page).filter({ hasText: new RegExp(`(^|\\s)${escapeRe(name)}(?![\\w.])`) });

// the roadmap file edited outside the app (another window, the Oracle, a script), as the app follows it
function editRoadmapFile(e2e, fn) {
  const file = path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.roadmap.json`);
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(r);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...r, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
}

When('I type {string} as the release name in the cut line dialog', async ({ e2e }, name) => {
  const dialog = cutLineDialog(e2e.window);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Release name', exact: true }).fill(name);
});

When('the cut line {string} is drawn after stage {int} outside the app', async ({ e2e }, name, n) => {
  editRoadmapFile(e2e, (r) => {
    const stage = r.stages[n - 1];
    expect(stage, `the demo roadmap's stage ${n}`).toBeTruthy();
    stage.release = { name };
  });
});

Then('the cut line dialog is closed', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('cut-line-modal')).toBeHidden({ timeout: LOAD_TIMEOUT });
});

// after stage n in the page, with no other stage between them
Then('the roadmap shows the cut line {string} right after stage {int}', async ({ e2e }, name, n) => {
  const page = e2e.window;
  const line = cutLine(page, name);
  await expect(line).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(/Release here|Release after this stage/);
  const before = await line.evaluate((el) => {
    const shown = Array.from(document.querySelectorAll('[data-testid="roadmap-stage"]'))
      .filter((s) => s.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    return shown.length ? shown[shown.length - 1].textContent : '';
  });
  expect(before, `the stage right before the cut line "${name}"`).toMatch(new RegExp(`\\bStage ${n}\\b`));
  await expect(numberedStage(page, n)).toBeVisible();
});

Then('the roadmap does not show the cut line {string}', async ({ e2e }, name) => {
  const page = e2e.window;
  await expect(stages(page).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cutLine(page, name)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then("the cut line dialog's {string} field holds {string}", async ({ e2e }, label, value) => {
  await expect(cutLineDialog(e2e.window).getByRole('textbox', { name: label, exact: true })).toHaveValue(value, { timeout: LOAD_TIMEOUT });
});

Then("the cut line dialog's error says {string}", async ({ e2e }, text) => {
  const error = cutLineDialog(e2e.window).getByTestId('cut-line-error');
  await expect(error).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(error).toContainText(new RegExp(escapeRe(text), 'i'));
});
