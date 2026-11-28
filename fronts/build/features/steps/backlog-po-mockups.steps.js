// Steps of fronts/build/features/product-owner.feature's #670 scenarios: a signed-off spec's mockups
// reach the issues. "Create epic and phase issues" on a Documents item (fronts/plan, #647) opens the
// Product Owner's proposal of the epic and one issue per phase; before its "add to the roadmap" action
// the proposal shows a COVERAGE block: every mockup of the spec and the issue that covers it. A mockup
// in scope that no issue covers blocks the proposal ("mock-4.jpg has no issue", the add-to-roadmap
// action disabled); a mockup of a later phase is listed as a later phase and blocks nothing.
// Reuses app.steps.js ("I open {string} in the sidebar") and fronts/plan's docs.steps.js ("I choose
// {string} on the item {string}": the signed-off item's row offers "Create epic and phase issues").
//
// The seed: the item's intent (accepted) and spec (signed off) committed to the demo project's folder
// (a git repository, fixed identity), as an earlier write-doc run leaves them, with the mockups as
// images under docs/work/<item>/images/ shown in the spec's requirements (`![..](images/mock-n.jpg)`,
// docs/work/write-doc/spec.md's convention). The spec's "Phases" section names, per phase, the
// mockups it delivers; "Later phases" names the out-of-scope ones; a mockup no phase names is in scope
// and uncovered.
// Assumption (the seam): the simulated Product Owner (CRAFTORIO_SIMULATION_ONLY, no model call)
// proposes one issue per phase of the "Phases" section, titled with the phase's name, covering the
// mockups that phase names; the coverage is computed from the spec and the proposed issues.
//
// Assumes these data-testids (the developer adds them; skills/ui-conventions):
//   po-spec-proposal         the Product Owner's proposal of a spec's epic and phase issues (in the
//                            drawer, role=complementary "Product Owner"); its add-to-roadmap action
//                            is a button whose name says "to the roadmap"
//   po-mockup-coverage       the COVERAGE block inside it, above the actions
//   po-mockup-coverage-row   one row per covered mockup: the mockup's file name and the issue covering it
//   po-mockup-missing        one message per in-scope mockup with no issue ("mock-4.jpg has no issue")
//   po-mockup-later          one entry per mockup of a later phase (its name, marked as a later phase)
// Locators are roles and data-testid only.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, Then } = require('../../../../features/steps/fixtures');

const RUN_TIMEOUT = 60000; // the simulated Product Owner's turn
const slugOf = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const poDrawer = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });
const proposal = (page) => poDrawer(page).getByTestId('po-spec-proposal').last();
const coverage = (page) => proposal(page).getByTestId('po-mockup-coverage');
const addToRoadmap = (page) => proposal(page).getByRole('button', { name: /to the roadmap/i });

// a 1x1 JPEG: the mockup's bytes do not matter here, only that it is an image the spec shows
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

// git in the project's folder with a fixed identity, never the machine's config
function git(e2e, cwd, args) {
  const config = path.join(e2e.scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

// no issue yet: the scenarios create the epic and its phase issues (#12 hides that action once `issue:` names one)
const frontMatter = (slug, stage, status, own, other) => [
  '---', `item: ${slug}`, 'issue: ""', `stage: ${stage}`, `status: ${status}`, 'approver: Owner', 'date: 2026-10-01',
  own === 'en' ? `translation: ${other}` : `source: ${other}`, '---', '',
];

const intentMd = (slug, title, lang) => [
  ...frontMatter(slug, 'intent', 'accepted', lang, lang === 'en' ? 'intent.pt-BR.md' : 'intent.md'),
  `# Intent: ${title}`, '',
  '## Problem', '', 'Owners cannot take a list of runs out of the app to share it.', '',
  '## Proposed outcome', '', 'A button exports the visible runs as a CSV file.', '',
].join('\n');

// rows: [{ mockup, phase }]; phase "Phase n" (in scope), "Later" (a later phase) or empty (in scope, no phase)
function specMd(slug, title, lang, rows) {
  const phases = [...new Set(rows.map((r) => r.phase).filter((p) => p && p !== 'Later'))];
  const later = rows.filter((r) => r.phase === 'Later').map((r) => r.mockup);
  const lines = [
    ...frontMatter(slug, 'spec', 'signed-off', lang, lang === 'en' ? 'spec.pt-BR.md' : 'spec.md'),
    `# Spec: ${title}`, '',
    '## Requirements', '',
  ];
  rows.forEach((r, n) => {
    lines.push(`**R${n + 1}. Screen ${n + 1}.** The export as drawn in ${r.mockup}.`, '', `![Screen ${n + 1}](images/${r.mockup})`, '');
  });
  lines.push('## Phases', '');
  for (const phase of phases) {
    lines.push(`### ${phase}`, '', `Mockups: ${rows.filter((r) => r.phase === phase).map((r) => r.mockup).join(', ')}`, '');
  }
  if (later.length) lines.push('## Later phases', '', `### Phase ${phases.length + 1}`, '', `Mockups: ${later.join(', ')}`, '');
  return lines.join('\n');
}

Given('the demo project\'s repository has the item {string} with a signed-off spec and these mockups', async ({ e2e }, title, table) => {
  const folder = e2e.project && e2e.project.folder;
  expect(folder, 'the demo project has a folder').toBeTruthy();
  const rows = table.hashes().map((r) => ({ mockup: r.mockup.trim(), phase: (r.phase || '').trim() }));
  const slug = slugOf(title);
  const dir = path.join(folder, 'docs', 'work', slug);
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  if (!fs.existsSync(path.join(folder, '.git'))) git(e2e, folder, ['init', '-q', '-b', 'main']);
  for (const r of rows) fs.writeFileSync(path.join(dir, 'images', r.mockup), TINY_JPEG);
  fs.writeFileSync(path.join(dir, 'intent.md'), intentMd(slug, title, 'en'));
  fs.writeFileSync(path.join(dir, 'intent.pt-BR.md'), intentMd(slug, title, 'pt-BR'));
  fs.writeFileSync(path.join(dir, 'spec.md'), specMd(slug, title, 'en', rows));
  fs.writeFileSync(path.join(dir, 'spec.pt-BR.md'), specMd(slug, title, 'pt-BR', rows));
  git(e2e, folder, ['add', '-A']);
  git(e2e, folder, ['commit', '-q', '-m', `Sign off the spec of ${title}`]);
  e2e.docItem = { title, slug, dir };
});

// each expected mockup has its own coverage row naming the issue (the phase) that covers it
Then('the Product Owner\'s proposal shows the mockup coverage', async ({ e2e }, table) => {
  const page = e2e.window;
  await expect(poDrawer(page)).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(coverage(page)).toBeVisible({ timeout: RUN_TIMEOUT });
  for (const { mockup, issue } of table.hashes()) {
    const row = coverage(page).getByTestId('po-mockup-coverage-row').filter({ hasText: mockup.trim() });
    await expect(row, `one coverage row for ${mockup}`).toHaveCount(1);
    await expect(row, `${mockup} is covered by the issue of ${issue}`).toContainText(new RegExp(escapeRe(issue.trim()), 'i'));
  }
});

Then('the proposal says {string}', async ({ e2e }, message) => {
  const missing = proposal(e2e.window).getByTestId('po-mockup-missing').filter({ hasText: message });
  await expect(missing).toHaveCount(1);
  await expect(missing).toBeVisible();
});

Then('the proposal says no mockup is missing an issue', async ({ e2e }) => {
  await expect(coverage(e2e.window)).toBeVisible();
  await expect(proposal(e2e.window).getByTestId('po-mockup-missing')).toHaveCount(0);
});

Then('the proposal lists {string} as a later phase', async ({ e2e }, mockup) => {
  const page = e2e.window;
  const later = proposal(page).getByTestId('po-mockup-later').filter({ hasText: mockup });
  await expect(later).toHaveCount(1);
  await expect(later).toBeVisible();
  await expect(later).toContainText(/later/i);
  // a later mockup is not counted as covered by this proposal's issues
  await expect(coverage(page).getByTestId('po-mockup-coverage-row').filter({ hasText: mockup })).toHaveCount(0);
});

Then('the proposal can be added to the roadmap', async ({ e2e }) => {
  const button = addToRoadmap(e2e.window);
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
});

Then('the proposal cannot be added to the roadmap', async ({ e2e }) => {
  const button = addToRoadmap(e2e.window);
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
});
