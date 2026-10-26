// Steps of fronts/build/features/artifacts.feature and features/image-viewer.feature: a finished demo run's
// artifacts on the Run screen's Artifacts tab and the Artifacts screen, Produced / Show all and the
// category and kind chips (#225), the before/after screenshots with a new element (#185), and the
// image viewer's previous / next navigation with its counter (#182), agent-written forms and local
// links in a markdown artifact that never take the window off the app's page (#466), the Artifacts
// screen's Open kept for documents and replaced by Show in folder for unknown kinds (#477). Locators are roles and
// data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// one run's artifact listing (the Run screen's Artifacts tab, a gate's panel, a run group of the
// Artifacts screen): its Produced / Show all switch, its chips, its categories and its items
const artifacts = (page) => page.getByTestId('artifact-list').filter({ visible: true }).first();
// one screenshot of the listing (a pair or a single image), by its caption
const shot = (page, caption) => artifacts(page).getByTestId('artifact-shot').filter({ hasText: caption }).first();
// a shot's thumbnails: each opens the image viewer (ImageViewer.THUMB: role button)
const thumbs = (page, caption) => shot(page, caption).getByRole('button');
const viewer = (page) => page.getByTestId('image-viewer');
const arrow = (page, which) => viewer(page).getByRole('button', { name: which === 'previous' ? 'Previous image' : 'Next image', exact: true });

// The demo workspace's run whose id ends in `-<fragment>` (seeded with the app: features/support/app.js);
// the rest of the step text says what data the run holds (the feature file's comment details it)
Given('a finished demo run {string} with {}', async ({ e2e }, fragment, _data) => {
  const runs = path.join(e2e.scratch, 'workspace', 'runs');
  const dir = (fs.existsSync(runs) ? fs.readdirSync(runs) : []).find((d) => d.endsWith(`-${fragment}`));
  expect(dir, `the demo workspace has no run ending in -${fragment}`).toBeTruthy();
  const summary = JSON.parse(fs.readFileSync(path.join(runs, dir, 'summary.json'), 'utf8'));
  expect(summary.finished_at, `the demo run ${dir} is finished`).toBeTruthy();
});

// Home › Analytics › Run (#255: Analytics is a tab of Home) lists every finished run (searched
// first: the list shows the latest 80), and its Open run button goes to the Run screen
When('I open the demo run {string}', async ({ e2e }, fragment) => {
  const page = e2e.window;
  await page.getByRole('navigation').getByRole('button', { name: /^Home(\s+\d+)?$/ }).click();
  await page.getByTestId('home-tab-analytics').click();
  await page.getByRole('tablist', { name: 'Analytics' }).getByRole('tab', { name: 'Run', exact: true }).click();
  await page.getByTestId('an-run-search').fill(fragment);
  const option = page.getByTestId('an-run-pick').locator(`option[value*="${fragment}"]`);
  await expect(option).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await page.getByTestId('an-run-pick').selectOption(await option.getAttribute('value'));
  await expect(page.getByTestId('an-run-header')).toContainText(fragment, { timeout: LOAD_TIMEOUT });
  await page.getByTestId('an-run-header').getByRole('button', { name: 'Open run', exact: true }).click();
});

When('I open the run\'s Artifacts tab', async ({ e2e }) => {
  await e2e.window.getByTestId('run-tab-artifacts').click();
  await expect(artifacts(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// #254: the Artifacts screen is the Artifacts tab of Workflows › Runs (no sidebar entry of its own)
When('I open the Artifacts tab of Runs', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('navigation').getByRole('button', { name: /^Runs(\s+\d+)?$/ }).click();
  await page.getByRole('main').getByRole('tab', { name: 'Artifacts', exact: true }).click();
});

// the Artifacts screen's search opens the matching run's group
When('I find the run {string} on the Artifacts screen', async ({ e2e }, fragment) => {
  const page = e2e.window;
  await page.getByRole('textbox', { name: 'Search', exact: true }).filter({ visible: true }).first().fill(fragment);
  await expect(artifacts(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// ---- Produced first, categories and chips (#225) --------------------------------------------------

const viewSwitch = (page) => artifacts(page).getByRole('group', { name: 'Artifacts view' });

When('I choose {string} in the artifacts', async ({ e2e }, name) => {
  await viewSwitch(e2e.window).getByRole('button', { name, exact: true }).click();
});

Then('the artifacts show {string}', async ({ e2e }, name) => {
  await expect(viewSwitch(e2e.window).getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: LOAD_TIMEOUT });
});

Then('the first artifact is {string}', async ({ e2e }, name) => {
  await expect(artifacts(e2e.window).getByTestId('artifact-item').first()).toContainText(name, { timeout: LOAD_TIMEOUT });
});

// the categories in their order, e.g. "Result, Screenshots & images, Tests, Reports"
Then('the artifact categories are {string}', async ({ e2e }, list) => {
  const names = list.split(',').map((s) => s.trim()).filter(Boolean);
  await expect(artifacts(e2e.window).getByTestId('artifact-category-title')).toHaveText(names.map((n) => new RegExp(`^${escapeRe(n)}\\b`)), { timeout: LOAD_TIMEOUT });
});

Then('the artifacts list {string}', async ({ e2e }, name) => {
  await expect(artifacts(e2e.window)).toContainText(name, { timeout: LOAD_TIMEOUT });
});

Then('the artifacts do not list {string}', async ({ e2e }, name) => {
  // the listing has loaded (an item shows) before its absence counts
  await expect(artifacts(e2e.window).getByTestId('artifact-item').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(artifacts(e2e.window)).not.toContainText(name);
});

// the chips: one group by category, one by kind (image, markdown, JSON, log)
const chip = (page, name) => artifacts(page).getByRole('group', { name: /^Filter by (category|kind)$/ }).getByRole('button', { name, exact: true });

When('I filter the artifacts by {string}', async ({ e2e }, name) => {
  await chip(e2e.window, name).click();
});

Then('the artifact filter {string} is on', async ({ e2e }, name) => {
  await expect(chip(e2e.window, name)).toHaveAttribute('aria-pressed', 'true');
});

// ---- before/after screenshots and new elements (#185) --------------------------------------------

Then('the run\'s screenshot summary mentions {string}', async ({ e2e }, text) => {
  await expect(e2e.window.getByTestId('screenshots-summary').filter({ visible: true }).first()).toContainText(text, { timeout: LOAD_TIMEOUT });
});

Then('no screenshot error mentions {string}', async ({ e2e }, name) => {
  const page = e2e.window;
  await expect(page.getByTestId('screenshots-summary').filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('screenshot-error').filter({ hasText: name })).toHaveCount(0);
});

Then('a screenshot error mentions {string}', async ({ e2e }, name) => {
  await expect(e2e.window.getByTestId('screenshot-error').filter({ hasText: name }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the screenshot {string} shows only its modified image', async ({ e2e }, caption) => {
  const page = e2e.window;
  await expect(shot(page, caption)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(thumbs(page, caption)).toHaveCount(1);
  // no empty or broken original slot: no "Original (<base>)" side, no failed image
  await expect(shot(page, caption)).not.toContainText(/Original \(|Could not load/);
});

Then('the screenshot {string} is marked {string}', async ({ e2e }, caption, text) => {
  await expect(shot(e2e.window, caption)).toContainText(text, { timeout: LOAD_TIMEOUT });
});

Then('the screenshot {string} shows its original and modified images', async ({ e2e }, caption) => {
  const page = e2e.window;
  await expect(shot(page, caption)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(thumbs(page, caption)).toHaveCount(2);
});

// ---- agent-written HTML in a markdown artifact (#466) ---------------------------------------------
// The report is written into the demo run's folder (listed when the run's artifacts open); its form
// and its link point at a local page planted in the scratch folder, which the window must never open.

const { pathToFileURL } = require('url');

const localPage = (e2e) => {
  const dir = path.join(e2e.scratch, 'elsewhere');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'not-the-app.html');
  fs.writeFileSync(file, '<h1>Not the app</h1>');
  return pathToFileURL(file).href;
};

const writeReport = (e2e, fragment, name, body) => {
  const runs = path.join(e2e.scratch, 'workspace', 'runs');
  const dir = (fs.existsSync(runs) ? fs.readdirSync(runs) : []).find((d) => d.endsWith(`-${fragment}`));
  expect(dir, `the demo workspace has no run ending in -${fragment}`).toBeTruthy();
  fs.writeFileSync(path.join(runs, dir, name), body);
};

Given('the demo run {string} has a report {string} reading {string} with a form button {string} to a local page', async ({ e2e }, fragment, name, text, button) => {
  const url = localPage(e2e);
  writeReport(e2e, fragment, name, `# Audit\n\n${text}\n\n<form action="${url}"><button>${button}</button></form>\n`);
});

Given('the demo run {string} has a report {string} reading {string} with a link {string} to a local page', async ({ e2e }, fragment, name, text, link) => {
  const url = localPage(e2e);
  writeReport(e2e, fragment, name, `# Audit\n\n${text}\n\nSee [${link}](${url}).\n`);
});

// the open artifact's rendered markdown (an <article>)
const preview = (page) => page.getByRole('article').filter({ visible: true }).first();

When('I open the artifact {string}', async ({ e2e }, name) => {
  await artifacts(e2e.window).getByTestId('artifact-item').filter({ hasText: name }).first().click();
  await expect(preview(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the artifact shows {string}', async ({ e2e }, text) => {
  await expect(preview(e2e.window)).toContainText(text, { timeout: LOAD_TIMEOUT });
});

Then('the artifact shows no {string} button', async ({ e2e }, name) => {
  const doc = preview(e2e.window);
  await expect(doc).toBeVisible({ timeout: LOAD_TIMEOUT });
  // its words may stay as plain text: no control to press
  await expect(doc.getByRole('button', { name })).toHaveCount(0);
});

When('I click the link {string} in the artifact', async ({ e2e }, name) => {
  await preview(e2e.window).getByRole('link', { name, exact: true }).click();
});

// #466 (#556): the sanitizer keeps the link's words but drops its file: href; whatever element holds
// the words, none of the document's links points at a local file
Then('the artifact shows {string} with no link to a local page', async ({ e2e }, words) => {
  const doc = preview(e2e.window);
  // the words may be a bare <a> or plain text of their paragraph
  await expect(doc.getByText(words).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const hrefs = await doc.locator('[href], [action], [formaction]').evaluateAll((els) => els
    .flatMap((el) => ['href', 'action', 'formaction'].map((a) => el.getAttribute(a)))
    .filter((v) => v !== null));
  expect(hrefs.filter((v) => /^\s*file:/i.test(v)), 'no file: target left in the document').toEqual([]);
});

When('I click the words {string} in the artifact', async ({ e2e }, words) => {
  await preview(e2e.window).getByText(words).first().click();
});

// ---- Open only for the kinds the app knows (#477) -----------------------------------------------
// The Artifacts screen's viewer (data-testid="artifact-viewer": the selected file's toolbar and
// preview). Its actions are buttons named "Open", "Show in folder", "Copy path"; none is clicked here.

const artViewer = (page) => page.getByTestId('artifact-viewer').filter({ visible: true }).first();

Given('the demo run {string} has an agent-written file {string} reading {string}', async ({ e2e }, fragment, name, text) => {
  writeReport(e2e, fragment, name, `${text}\r\n`);
});

// a click on the listed file, whatever its kind (I open the artifact waits for a rendered document)
When('I select the artifact {string}', async ({ e2e }, name) => {
  await artifacts(e2e.window).getByTestId('artifact-item').filter({ hasText: name }).first().click();
  await expect(artViewer(e2e.window)).toContainText(name, { timeout: LOAD_TIMEOUT });
});

Then('the artifact viewer offers {string}', async ({ e2e }, name) => {
  await expect(artViewer(e2e.window).getByRole('button', { name, exact: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the artifact viewer offers no {string}', async ({ e2e }, name) => {
  const viewer = artViewer(e2e.window);
  // the file's preview has drawn (no "Loading…") before the absence counts
  await expect(viewer.getByRole('button', { name: 'Show in folder', exact: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(viewer).not.toContainText('Loading', { timeout: LOAD_TIMEOUT });
  await expect(viewer.getByRole('button', { name, exact: true })).toHaveCount(0);
});

// ---- the image viewer's previous / next (#182)---------------------------------------------------

When('I enlarge the screenshot {string}', async ({ e2e }, caption) => {
  const page = e2e.window;
  await thumbs(page, caption).first().click();
  await expect(viewer(page)).toBeVisible();
});

Then('the image viewer shows {string}', async ({ e2e }, caption) => {
  await expect(viewer(e2e.window).getByTestId('image-viewer-title')).toContainText(caption);
});

Then('the image viewer counter reads {string}', async ({ e2e }, text) => {
  await expect(viewer(e2e.window).getByTestId('image-viewer-counter')).toHaveText(text);
});

Then('the image viewer\'s {word} arrow is enabled', async ({ e2e }, which) => {
  await expect(arrow(e2e.window, which)).toBeEnabled();
});

Then('the image viewer\'s {word} arrow is disabled', async ({ e2e }, which) => {
  await expect(arrow(e2e.window, which)).toBeDisabled();
});

When('I press the {word} arrow key', async ({ e2e }, which) => {
  await e2e.window.keyboard.press(which === 'left' ? 'ArrowLeft' : 'ArrowRight');
});

When('I click the image viewer\'s {word} arrow', async ({ e2e }, which) => {
  await arrow(e2e.window, which).click();
});

Then('the image viewer shows no arrows and no counter', async ({ e2e }) => {
  const page = e2e.window;
  await expect(viewer(page)).toBeVisible();
  await expect(arrow(page, 'previous')).toHaveCount(0);
  await expect(arrow(page, 'next')).toHaveCount(0);
  await expect(viewer(page).getByTestId('image-viewer-counter')).toHaveCount(0);
});
