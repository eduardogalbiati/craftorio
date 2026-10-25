// Steps of features/releases.feature for #489 (Releases as rc + stable): the Releases screen lists the
// release candidates (one vX.Y.Z-rc.N per merge into main, with its run and issues), each with
// "Promote to stable" and "Hold"; the promotion shows the stable version suggested from the issues'
// labels, editable, before it is confirmed; a held candidate is marked held; promoting a commit that
// has no rc is refused with the reason. Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screen exposes (NEW for #489, apps/desktop/renderer/views/releases/releases.js):
// - data-testid="release-candidate": one per candidate, newest first, its text holding the rc version,
//   its run id and its issues ("#12"), and "Held" when held; data-attribute data-held="true" too;
// - data-testid="promote-to-stable": the candidate's button "Promote to stable";
// - data-testid="hold-candidate": the candidate's button "Hold";
// - the promotion's confirmation (role dialog, data-testid="promote-dialog") with the textbox "Stable
//   version" (data-testid="stable-version-input", prefilled with the suggestion), a button "Promote"
//   (data-testid="confirm-promote") and an error line data-testid="promote-error" for a refusal;
// - a shipped stable release row (data-testid="release-row", as #260) reading its version and, for the
//   newest stable one, "Latest" (data-testid="release-latest" inside the row); the promoted candidate
//   names the stable version it became ("Promoted to 1.3.0" or the like) or leaves the candidates list.
//
// Seeding assumption (the developer persists candidates): the release history file of #260,
// <workspace>/releases/<projectId>.json, gets `candidates: [{ tag: 'v1.3.0-rc.N', commit, date, runId,
// issues: [{ number, title, labels }], held? }]` next to `releases` (the shape of the unit tests,
// test/releases-rc-stable-489.test.js). The service refuses a promotion whose commit has no candidate.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const candidates = (page) => page.getByTestId('release-candidate');
const candidate = (page, version) => candidates(page).filter({ hasText: new RegExp(`(^|\\s)${escapeRe(version)}(?![\\w.-])`) });
const promoteDialog = (page) => page.getByRole('dialog').filter({ has: page.getByTestId('stable-version-input') });
const historyFile = (e2e) => path.join(e2e.scratch, 'workspace', 'releases', `${e2e.project.id}.json`);

const RUN_OF = { 'v1.3.0-rc.1': '20261020-101500-rc000001', 'v1.3.0-rc.2': '20261022-143000-rc000002' };
const ISSUES_OF = {
  'v1.3.0-rc.1': [{ number: 12, title: 'Crash when the workspace folder is renamed', labels: ['bug'] }],
  'v1.3.0-rc.2': [{ number: 13, title: 'Export a run report as Markdown', labels: ['enhancement'] }],
};

Given('the project has the release candidates {string} and {string} since the stable release {string}', async ({ e2e }, rc1, rc2, stable) => {
  const shipped = {
    version: stable, tag: `v${stable.replace(/^v/, '')}`, date: '2026-10-10T12:00:00.000Z', base: 'main',
    issues: [{ number: 9, title: 'Document the workflow YAML', labels: ['documentation'] }],
    runs: ['20261010-110000-rel00489'], cost: 2.5,
    tests: { unit: { status: 'pass', passed: 412, failed: 0 }, e2e: { status: 'pass', passed: 37, failed: 0 } },
    notes: `# ${stable}`, status: 'shipped',
  };
  const rc = (tag, k) => ({
    tag, commit: k === 0 ? 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0' : 'f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9',
    date: k === 0 ? '2026-10-20T10:15:00.000Z' : '2026-10-22T14:30:00.000Z',
    runId: RUN_OF[tag] || `2026102${k}-120000-rc00000${k}`,
    issues: ISSUES_OF[tag] || [{ number: 20 + k, title: `Change ${k + 1}`, labels: ['bug'] }],
  });
  fs.mkdirSync(path.dirname(historyFile(e2e)), { recursive: true });
  fs.writeFileSync(historyFile(e2e), JSON.stringify({ releases: [shipped], candidates: [rc(rc1, 0), rc(rc2, 1)], next: { notes: '' } }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('the Releases screen lists the candidates {string} and {string}, newest first, each with its run and issues', async ({ e2e }, newer, older) => {
  const page = e2e.window;
  await expect(candidates(page).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const texts = (await candidates(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  const at = [newer, older].map((v) => texts.findIndex((t) => t.includes(v)));
  expect(at.every((i) => i >= 0), `the candidates ${newer} and ${older} are listed: ${JSON.stringify(texts)}`).toBe(true);
  expect(at[0] < at[1], `newest first: ${JSON.stringify(texts)}`).toBe(true);
  for (const version of [newer, older]) {
    const row = candidate(page, version);
    await expect(row).toHaveCount(1);
    if (RUN_OF[version]) await expect(row, `${version} names its run`).toContainText(RUN_OF[version]);
    for (const issue of ISSUES_OF[version] || []) await expect(row, `${version} lists #${issue.number}`).toContainText(`#${issue.number}`);
    await expect(row.getByTestId('promote-to-stable')).toBeVisible();
    await expect(row.getByTestId('hold-candidate')).toBeVisible();
  }
});

When('I click {string} on the candidate {string}', async ({ e2e }, name, version) => {
  const row = candidate(e2e.window, version);
  await expect(row).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  const button = row.getByRole('button', { name, exact: true });
  const testId = { 'Promote to stable': 'promote-to-stable', Hold: 'hold-candidate' }[name];
  if (testId) await expect(button).toHaveAttribute('data-testid', testId);
  await button.click();
});

// the suggestion is shown before the promotion, and the field takes another version
Then('the stable version suggested for the promotion is {string}, and I can edit it', async ({ e2e }, version) => {
  const page = e2e.window;
  const dialog = promoteDialog(page);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  const field = dialog.getByTestId('stable-version-input');
  await expect(field).toHaveValue(new RegExp(`^v?${escapeRe(version)}$`));
  await expect(field).toBeEditable();
  await field.fill('9.9.9');
  await expect(field).toHaveValue('9.9.9');
  await field.fill(version);
  await expect(field).toHaveValue(version);
});

When('I confirm the promotion', async ({ e2e }) => {
  const dialog = promoteDialog(e2e.window);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  const button = dialog.getByRole('button', { name: 'Promote', exact: true });
  await expect(button).toHaveAttribute('data-testid', 'confirm-promote');
  await button.click();
});

Then('the candidate {string} shows as the stable release {string}, marked latest', async ({ e2e }, rc, version) => {
  const page = e2e.window;
  await expect(promoteDialog(page)).toBeHidden({ timeout: LOAD_TIMEOUT });
  const row = page.getByTestId('release-row').filter({ hasText: new RegExp(`(^|\\s)v?${escapeRe(version)}(?![\\w.-])`) });
  await expect(row).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(row.getByTestId('release-latest')).toBeVisible();
  await expect(row, `the stable release ${version} names the candidate it came from`).toContainText(rc);
  // the candidate is no longer offered for promotion
  const left = candidate(page, rc);
  if (await left.count()) await expect(left.getByTestId('promote-to-stable')).toHaveCount(0);
});

Then('the candidate {string} is marked held', async ({ e2e }, version) => {
  const row = candidate(e2e.window, version);
  await expect(row).toHaveAttribute('data-held', 'true', { timeout: LOAD_TIMEOUT });
  await expect(row).toContainText(/\bheld\b/i);
});

Then('the candidate {string} is not marked held', async ({ e2e }, version) => {
  const row = candidate(e2e.window, version);
  await expect(row).toHaveCount(1);
  await expect(row).not.toHaveAttribute('data-held', 'true');
  await expect(row).not.toContainText(/\bheld\b/i);
});

// the candidate leaves the history file outside the app (another window, a script)
When('the release candidate {string} is removed outside the app', async ({ e2e }, version) => {
  const file = historyFile(e2e);
  const h = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = (h.candidates || []).length;
  h.candidates = (h.candidates || []).filter((c) => c.tag !== version);
  expect(h.candidates.length, `the candidate ${version} was in the history`).toBe(before - 1);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(h, null, 2));
  fs.renameSync(tmp, file);
});

Then('the promotion is refused with a reason saying the commit has no release candidate', async ({ e2e }) => {
  const error = e2e.window.getByTestId('promote-error');
  await expect(error).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(error).toContainText(/no (release )?candidate|no rc\b/i);
});

Then('no release {string} is shown as stable', async ({ e2e }, version) => {
  const page = e2e.window;
  await expect(page.getByTestId('release-row').filter({ hasText: new RegExp(`(^|\\s)v?${escapeRe(version)}(?![\\w.-])`) })).toHaveCount(0);
  const file = historyFile(e2e);
  const h = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect((h.releases || []).some((r) => r.version.replace(/^v/, '') === version), `no stable ${version} in the history`).toBe(false);
});
