// Steps of features/releases.feature for a release on the project city (#376): "Show on the map" on a
// shipped release of the Releases screen opens the project's Architecture tab on the City with the
// release overlay (the city at the previous tag in grey, the release's changes in colour). Locators
// are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps):
// - Releases: data-testid="release-show-map" ("Show on the map", data-tag="<tag>") on a release row
//   ("release-row");
// - the city: data-testid="city-release-header" (the from and to tags, counts like "1 added",
//   "1 changed", "1 removed"), "city-release-district" / "city-release-zone" (the counts by district
//   and zone), selects "city-release-from" / "city-release-to" (the two tags compared),
//   "city-release-issue" (options "All issues" and "#n": only the files of the commits naming #n),
//   button "city-release-save-image" ("Save image", a PNG).
//
// The git project is a real repository in the scenario's scratch folder: tag 1.1.0 (src/keep.js),
// tag 1.1.1 (adds src/old.js and src/edit.js), then "Add the new module (#12)" (adds src/new.js) and
// "Remove old and edit (#13)" (deletes src/old.js, edits src/edit.js), tag 1.1.2. Its city plan has
// one zone "Core" with one district "Sources" (src/**). The shipped release 1.1.2 (tag 1.1.2, issues
// #12 and #13) is in the release history <workspace>/releases/<projectId>.json (releases.steps.js).
// So 1.1.1 → 1.1.2: 1 added, 1 changed, 1 removed; #12 only: 1 added; 1.1.0 → 1.1.2: 2 added
// (src/new.js, src/edit.js), nothing changed or removed.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const root = path.join(__dirname, '..', '..');
const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (locator) => locator.filter({ visible: true });
const projectPage = (page) => visible(page.getByTestId('project-page')).first();
const tab = (page) => projectPage(page).locator('#project-panel-architecture');
const byId = (page, id) => visible(tab(page).getByTestId(id)).first();
const releaseHeader = (page) => byId(page, 'city-release-header');

// git with a fixed identity, never the machine's config
function git(cwd, args, date) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, '..', 'empty.gitconfig') };
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

const lines = (name, n) => `${Array.from({ length: n }, (_, i) => `const ${name}${i} = ${i};`).join('\n')}\n`;

function seedTaggedRepo(folder) {
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  fs.writeFileSync(path.join(folder, '..', 'empty.gitconfig'), '');
  git(folder, ['init', '-q', '-b', 'main']);
  const commit = (message, date, { write = {}, remove = [] }) => {
    for (const [rel, content] of Object.entries(write)) fs.writeFileSync(path.join(folder, rel), content);
    for (const rel of remove) fs.rmSync(path.join(folder, rel));
    git(folder, ['add', '-A']);
    git(folder, ['commit', '-q', '-m', message], date);
  };
  commit('Add the keep module', '2026-09-01T10:00:00Z', { write: { 'src/keep.js': lines('keep', 10) } });
  git(folder, ['tag', '1.1.0']);
  commit('Add the old and edit modules', '2026-09-08T10:00:00Z', { write: { 'src/old.js': lines('old', 8), 'src/edit.js': lines('edit', 12) } });
  git(folder, ['tag', '1.1.1']);
  commit('Add the new module (#12)', '2026-09-15T10:00:00Z', { write: { 'src/new.js': lines('fresh', 6) } });
  commit('Remove old and edit (#13)', '2026-09-16T10:00:00Z', { write: { 'src/edit.js': lines('edit', 20) }, remove: ['src/old.js'] });
  git(folder, ['tag', '1.1.2']);
}

// The release history of #260 (<workspace>/releases/<projectId>.json); a release names its git tag
Given('the workspace has a git project {string} tagged {string}, {string} and {string} that shipped the release {string} with the issues {string} and {string}', async ({ e2e }, name, t0, t1, t2, version, a, b) => {
  if ([t0, t1, t2].join(' ') !== '1.1.0 1.1.1 1.1.2') throw new Error(`the seeded repository is tagged 1.1.0, 1.1.1 and 1.1.2 (not ${t0}, ${t1}, ${t2})`);
  const workspace = require(path.join(root, 'src', 'workspace'));
  const projects = require(path.join(root, 'src', 'projects'));
  const arch = require(path.join(root, 'src', 'oracle-architecture'));
  const ws = workspace.setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  const folder = path.join(e2e.scratch, 'repos', name);
  seedTaggedRepo(folder);
  const project = await projects.createProject(ws.projects, { name, folder, description: 'A git project with tagged releases (simulated data)' });
  arch.writePlan(path.join(ws.root, 'architecture'), project.id, {
    version: 1, project: name, summary: 'Three small modules (simulated data).',
    zones: [{ id: 'core', name: 'Core', kind: 'commercial' }],
    districts: [{ id: 'sources', name: 'Sources', zone: 'core', include: ['src/**'] }],
  }, new Date().toISOString());
  const issue = (ref) => {
    const number = Number(String(ref).replace('#', ''));
    return { number, title: number === 12 ? 'Add the new module' : 'Remove old and edit' };
  };
  const release = {
    version, tag: version, date: '2026-09-16T12:00:00.000Z', issues: [issue(a), issue(b)], runs: [],
    cost: 2.1, tests: { unit: { passed: 120, failed: 0 }, e2e: { passed: 12, failed: 0 } },
    notes: `${version}: the new module.`, status: 'shipped',
  };
  const dir = path.join(ws.root, 'releases');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${project.id}.json`), JSON.stringify({ releases: [release] }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

When('I click {string} on the release {string}', async ({ e2e }, label, version) => {
  const page = e2e.window;
  const row = page.getByTestId('release-row').filter({ hasText: version });
  await expect(row).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  const button = row.getByTestId('release-show-map');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('data-tag', version);
  await expect(button).toHaveText(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
  await button.click();
});

Then('the city release header compares {string} to {string}', async ({ e2e }, from, to) => {
  const header = releaseHeader(e2e.window);
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(header).toContainText(new RegExp(`${escapeRe(from)}[\\s\\S]*${escapeRe(to)}`), { timeout: LOAD_TIMEOUT });
});

// a count of 0 may read "0 changed" or be left out, never a positive number
Then('the city release header counts {int} added, {int} changed and {int} removed', async ({ e2e }, added, changed, removed) => {
  const header = releaseHeader(e2e.window);
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const [n, word] of [[added, 'added'], [changed, 'changed'], [removed, 'removed']]) {
    if (n > 0) await expect(header, `the header's "${n} ${word}"`).toContainText(new RegExp(`\\b${n}\\s+${word}\\b`, 'i'), { timeout: LOAD_TIMEOUT });
    else await expect(header, `no file ${word}`).not.toContainText(new RegExp(`\\b[1-9]\\d*\\s+${word}\\b`, 'i'), { timeout: LOAD_TIMEOUT });
  }
});

Then('the city release counts are given by the zone {string} and the district {string}', async ({ e2e }, zone, district) => {
  await expect(byId(e2e.window, 'city-release-zone')).toContainText(zone, { timeout: LOAD_TIMEOUT });
  await expect(byId(e2e.window, 'city-release-district')).toContainText(district, { timeout: LOAD_TIMEOUT });
});

Then('the city offers {string} for the release', async ({ e2e }, label) => {
  const button = byId(e2e.window, 'city-release-save-image');
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveAccessibleName(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
  await expect(button).toBeEnabled();
});

When('I pick the issue {string} in the release\'s issue filter', async ({ e2e }, issue) => {
  const select = byId(e2e.window, 'city-release-issue');
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await select.selectOption({ label: issue });
});

When('I pick {string} as the earlier tag of the release comparison', async ({ e2e }, tag) => {
  const select = byId(e2e.window, 'city-release-from');
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await select.selectOption(tag);
});
