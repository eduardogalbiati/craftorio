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
// page-wide: since #430 the release's city may be the city modal over the Releases screen, not the
// project's Architecture tab (one city is visible at a time)
const byId = (page, id) => visible(page.getByTestId(id)).first();
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

// #441: what the release panel shows survives minimizing it
Then('the release\'s issue filter still shows {string}', async ({ e2e }, issue) => {
  const select = visible(e2e.window.getByTestId('city-release-issue')).first();
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => select.evaluate((s) => (s.selectedOptions[0]?.textContent || '').trim()), { timeout: LOAD_TIMEOUT, message: 'the issue picked' }).toBe(issue);
});

When('I pick {string} as the earlier tag of the release comparison', async ({ e2e }, tag) => {
  const select = byId(e2e.window, 'city-release-from');
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await select.selectOption(tag);
});

// ---------- #438: the change ramp and the rename sign; #439: an older release and today's plan ----------
//
// What the renderer exposes for these (the contract; the testids marked NEW do not exist yet):
// - data-testid="city-release-ramp" (NEW): the change ramp, four elements data-testid=
//   "city-release-ramp-shade" (NEW) from the lightest (fewest lines) to the strongest (most lines),
//   each with its own colour; in the legend each shade carries its line count (a number or a range,
//   in its text, title or aria-label). The "changed" chip ("city-release-count-changed") shows the
//   same ramp, not one dot.
// - data-testid="city-release-rename-sign" (NEW): the sign renamed files carry on the map (a marker or
//   an outline), on the legend's "Renamed" row and in the "renamed" chip ("city-release-count-renamed"),
//   in place of the orange dot (the ramp's second shade, #f2a541).
// - data-testid="city-release-missing" (NEW): in the release view, one muted line "At <tag>, N files
//   and M districts of today's plan did not exist yet" (never role alert, never red), with a
//   disclosure data-testid="city-release-missing-toggle" (NEW, aria-expanded) over the list (list
//   items: the files and the districts). The release view shows no "project-city-problems" note.
// - the city's notes: data-city-panel="notes" (project-city-notes.js), "project-city-stale" ("The plan
//   is older than the code") among them.

const ORANGE_DOT = 'rgb(242, 165, 65)';
const city = (page) => visible(page.locator('[data-city-mode]')).first();
const legend = (page) => visible(page.locator('[data-city-panel="legend"]')).first();
const legendRow = (page, label) => legend(page).getByRole('listitem').filter({ hasText: new RegExp(escapeRe(label), 'i') }).first();
const missingLine = (page) => byId(page, 'city-release-missing');

// a project folder, its plan and its shipped releases (each { version, issues }), then the window reloaded
async function seedProject(e2e, name, folder, plan, releases) {
  const workspace = require(path.join(root, 'src', 'workspace'));
  const projects = require(path.join(root, 'src', 'projects'));
  const arch = require(path.join(root, 'src', 'oracle-architecture'));
  const ws = workspace.setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  const project = await projects.createProject(ws.projects, { name, folder, description: 'A git project with tagged releases (simulated data)' });
  arch.writePlan(path.join(ws.root, 'architecture'), project.id, { version: 1, project: name, summary: 'Simulated data.', ...plan }, new Date().toISOString());
  const list = releases.map((r, i) => ({
    version: r.version, tag: r.version, date: `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`, issues: [], runs: [],
    cost: 1.2, tests: { unit: { passed: 100, failed: 0 }, e2e: { passed: 10, failed: 0 } }, notes: `${r.version} (simulated data).`, status: 'shipped',
  }));
  const dir = path.join(ws.root, 'releases');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${project.id}.json`), JSON.stringify({ releases: list }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
}

function newRepo(folder) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, '..', 'empty.gitconfig'), '');
  git(folder, ['init', '-q', '-b', 'main']);
  return (message, date, { write = {}, remove = [], move = [] }) => {
    for (const [rel, content] of Object.entries(write)) {
      fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
      fs.writeFileSync(path.join(folder, rel), content);
    }
    for (const rel of remove) fs.rmSync(path.join(folder, rel));
    for (const [a, b] of move) git(folder, ['mv', a, b]);
    git(folder, ['add', '-A']);
    git(folder, ['commit', '-q', '-m', message], date);
  };
}

// a file of `total` lines whose first `changed` lines are rewritten
const rewritten = (name, total, changed) => `${Array.from({ length: total }, (_, i) => (i < changed ? `const ${name}${i} = ${i} + 1; // changed` : `const ${name}${i} = ${i};`)).join('\n')}\n`;

// #438: tag <from> holds src/a.js … src/d.js (150 lines each), the file renamed later, src/drop.js;
// tag <to> rewrites a…d by the four line counts (so the ramp has four shades: relative to the most),
// moves the renamed file unchanged (git sees a pure rename), adds src/fresh.js, removes src/drop.js.
// One zone "Core", one district "Sources" (src/**).
Given('the workspace has a git project {string} whose release {string} after {string} changes four files by {int}, {int}, {int} and {int} lines, renames {string} to {string}, adds one file and removes one', async ({ e2e }, name, to, from, l1, l2, l3, l4, oldPath, newPath) => {
  const folder = path.join(e2e.scratch, 'repos', name);
  const commit = newRepo(folder);
  const files = ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js'];
  const counts = [l1, l2, l3, l4];
  if (counts.some((n) => n < 1 || n > 150)) throw new Error('each file has 150 lines: change 1 to 150 of them');
  commit('The first release', '2026-09-01T10:00:00Z', {
    write: { ...Object.fromEntries(files.map((f, i) => [f, rewritten(`v${i}`, 150, 0)])), [oldPath]: lines('moved', 40), 'src/drop.js': lines('drop', 9) },
  });
  git(folder, ['tag', from]);
  commit('Rename the module', '2026-09-08T10:00:00Z', { move: [[oldPath, newPath]] });
  commit('Change four modules, add one, remove one', '2026-09-09T10:00:00Z', {
    write: { ...Object.fromEntries(files.map((f, i) => [f, rewritten(`v${i}`, 150, counts[i])])), 'src/fresh.js': lines('fresh', 7) },
    remove: ['src/drop.js'],
  });
  git(folder, ['tag', to]);
  await seedProject(e2e, name, folder, {
    zones: [{ id: 'core', name: 'Core', kind: 'commercial' }],
    districts: [{ id: 'sources', name: 'Sources', zone: 'core', include: ['src/**'] }],
  }, [{ version: from }, { version: to }]);
});

// #439: tag <from> holds src/keep.js; tag <to> adds src/new.js; after it (today, no tag) the code gains
// the two files of the two new districts of today's plan (each file a landmark of the plan, so the old
// commit lacks both the files and the districts) and `extra` files under lib/ that no district covers
// (so today's plan is stale: today's city has the note "The plan is older than the code").
Given('the workspace has a git project {string} that shipped the release {string} after {string}, then added the districts {string} and {string} of its plan with the files {string} and {string}, and {int} files outside the plan', async ({ e2e }, name, to, from, d1, d2, f1, f2, extra) => {
  const folder = path.join(e2e.scratch, 'repos', name);
  const commit = newRepo(folder);
  commit('Add the keep module', '2026-09-01T10:00:00Z', { write: { 'src/keep.js': lines('keep', 10) } });
  git(folder, ['tag', from]);
  commit('Add the new module', '2026-09-08T10:00:00Z', { write: { 'src/new.js': lines('fresh', 6) } });
  git(folder, ['tag', to]);
  const later = { [f1]: lines('one', 8), [f2]: lines('two', 8) };
  for (let i = 0; i < extra; i++) later[`lib/util${i}.js`] = lines(`util${i}_`, 5);
  commit('Add the tools, the scripts and the helpers', '2026-09-20T10:00:00Z', { write: later });
  const district = (label, file) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: label, zone: 'core', include: [`${path.posix.dirname(file)}/**`] });
  await seedProject(e2e, name, folder, {
    zones: [{ id: 'core', name: 'Core', kind: 'commercial' }],
    districts: [{ id: 'sources', name: 'Sources', zone: 'core', include: ['src/**'] }, district(d1, f1), district(d2, f2)],
    landmarks: [{ path: f1, label: path.posix.basename(f1) }, { path: f2, label: path.posix.basename(f2) }],
  }, [{ version: from }, { version: to }]);
});

// the shades of a ramp: their colours and the first number each one shows (text, title or aria-label)
const shadesOf = (ramp) => ramp.getByTestId('city-release-ramp-shade').evaluateAll((els) => els.map((el) => {
  const said = `${el.textContent || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''}`;
  const m = /\d[\d,]*/.exec(said);
  return { colour: getComputedStyle(el).backgroundColor, lines: m ? Number(m[0].replace(/,/g, '')) : null };
}));

Then('the city legend shows the change ramp in {int} shades from few lines to many, each with its line count', async ({ e2e }, n) => {
  const row = legendRow(e2e.window, 'Changed');
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  const ramp = row.getByTestId('city-release-ramp');
  await expect(ramp).toBeVisible();
  await expect(ramp.getByTestId('city-release-ramp-shade')).toHaveCount(n);
  const shades = await shadesOf(ramp);
  expect(new Set(shades.map((s) => s.colour)).size, `${n} colours: ${shades.map((s) => s.colour).join(', ')}`).toBe(n);
  shades.forEach((s, i) => expect(s.lines, `shade ${i + 1} gives its line count`).not.toBeNull());
  for (let i = 1; i < shades.length; i++) expect(shades[i].lines, 'from few lines to many').toBeGreaterThanOrEqual(shades[i - 1].lines);
  expect(shades[shades.length - 1].lines, 'the strongest shade is for more lines than the lightest').toBeGreaterThan(shades[0].lines);
});

Then('the {string} chip of the release header shows the change ramp, not a single dot', async ({ e2e }, status) => {
  const chip = byId(e2e.window, `city-release-count-${status}`);
  await expect(chip).toBeVisible({ timeout: LOAD_TIMEOUT });
  const ramp = chip.getByTestId('city-release-ramp');
  await expect(ramp).toBeVisible();
  const shades = await shadesOf(ramp);
  expect(shades.length, 'the four shades of the ramp').toBe(4);
  expect(new Set(shades.map((s) => s.colour)).size, 'four colours').toBe(4);
});

Then('the city legend\'s {string} row shows the rename sign of the map', async ({ e2e }, label) => {
  const row = legendRow(e2e.window, label);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row.getByTestId('city-release-rename-sign'), 'the sign the map puts on renamed files').toBeVisible();
});

Then('the {string} chip of the release header shows the rename sign, not an orange dot', async ({ e2e }, status) => {
  const chip = byId(e2e.window, `city-release-count-${status}`);
  await expect(chip).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(chip.getByTestId('city-release-rename-sign')).toBeVisible();
  const fills = await chip.locator('*').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(fills, 'no orange dot in the chip').not.toContain(ORANGE_DOT);
});

Then('the city shows no note of problems in the city plan', async ({ e2e }) => {
  await expect(city(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(e2e.window.getByTestId('project-city-problems')), 'no "problems in the city plan" note').toHaveCount(0);
  await expect(city(e2e.window)).not.toContainText(/problems? in the city plan/i);
});

// muted: one line, a status (not an alert), not red, its list folded behind the disclosure
Then('the release view says in one muted line {string}', async ({ e2e }, text) => {
  const line = missingLine(e2e.window);
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(text, { timeout: LOAD_TIMEOUT });
  await expect(visible(e2e.window.getByTestId('city-release-missing')), 'at most one such line').toHaveCount(1);
  await expect(line).not.toHaveRole('alert');
  const toggle = line.getByTestId('city-release-missing-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(line.getByRole('listitem').filter({ visible: true }), 'the list is folded').toHaveCount(0);
  const { lineHeight, colour } = await line.evaluate((el) => {
    const s = getComputedStyle(el);
    return { lineHeight: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.5, colour: s.color };
  });
  const box = await line.boundingBox();
  expect(box.height, 'one line high').toBeLessThan(lineHeight * 1.8 + 8);
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(colour);
  if (m) expect(Number(m[1]) > 150 && Number(m[1]) > Number(m[2]) * 1.8, `not red (${colour})`).toBe(false);
});

When('I open the list of what did not exist yet', async ({ e2e }) => {
  const toggle = missingLine(e2e.window).getByTestId('city-release-missing-toggle');
  await expect(toggle).toBeVisible({ timeout: LOAD_TIMEOUT });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

Then('the list of what did not exist yet names {string}, {string}, {string} and {string}', async ({ e2e }, a, b, c, d) => {
  const items = missingLine(e2e.window).getByRole('listitem').filter({ visible: true });
  for (const name of [a, b, c, d]) await expect(items.filter({ hasText: name }).first(), `"${name}" is listed`).toBeVisible({ timeout: LOAD_TIMEOUT });
});

When('I close the release on the city', async ({ e2e }) => {
  const close = byId(e2e.window, 'city-release-close');
  await expect(close).toBeVisible({ timeout: LOAD_TIMEOUT });
  await close.click();
  await expect(visible(e2e.window.getByTestId('city-release')), 'the release card is gone').toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('the city\'s notes say {string}', async ({ e2e }, text) => {
  const notes = visible(e2e.window.locator('[data-city-panel="notes"]')).first();
  await expect(notes).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(notes).toContainText(text, { timeout: LOAD_TIMEOUT });
});

Then('the city no longer says what did not exist yet', async ({ e2e }) => {
  await expect(city(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(e2e.window.getByTestId('city-release-missing'))).toHaveCount(0);
  await expect(city(e2e.window)).not.toContainText(/did not exist yet/i);
});
