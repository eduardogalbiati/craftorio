// Steps of fronts/build/features/roadmap-item-inputs.feature: the developer's effort in a roadmap item's Edit and
// on its card (#286), on the demo roadmap (scripts/screenshot.js demoRoadmap). The stage of planned
// items comes from fronts/build/features/steps/roadmap.steps.js. Locators are roles and data-testid only
// (skills/ui-conventions).
//
// What the screen exposes, inside data-testid="roadmap-item":
// - the Edit form (role group "Edit the inputs of this item") draws the workflow's inputs, "Developer
//   effort" a row of pills next to "Developer model";
// - the card shows the item's inputs as data-testid="input-pill" ("Developer effort: High"), an input
//   at its default ('default') left out.
// - #287, saving after the roadmap changed elsewhere (the roadmap file edited outside the app while the
//   form is open): data-testid="roadmap-changed-notice" in the open form ("the roadmap changed: 1 item
//   updated elsewhere"); Save merges the form into the item as it is now; when the edit cannot apply
//   (its stage removed) nothing is saved, data-testid="roadmap-save-conflict" says why (the stage was
//   removed) and the roadmap reloads, the form's values kept.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');
const { openRow } = require('../../../../features/support/roadmap-row');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).first();
// #785 reads the editor in Portuguese
const editForm = (page, title) => roadmapItem(page, title).getByRole('group', { name: /^(Edit the inputs of this item|Editar as entradas deste item)$/ });

// ---- the demo workspace, edited before the screen opens (the app follows the files) -----------------

const roadmapFile = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.roadmap.json`);
function editRoadmap(e2e, fn) {
  const file = roadmapFile(e2e);
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(r);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...r, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
}
const titleOf = (x) => x.issues?.[0]?.title || x.title || '';

// ---- #286: the developer's effort in a roadmap item's Edit and on its card ---------------------------

// the item's workflow set in the roadmap file (a planned item, so the app redraws it from the file)
Given('the roadmap item {string} runs the workflow {string}', async ({ e2e }, title, name) => {
  editRoadmap(e2e, (r) => {
    const item = r.stages.flatMap((s) => s.items).find((x) => titleOf(x) === title);
    expect(item, `a roadmap item "${title}"`).toBeTruthy();
    Object.assign(item, { workflow: `${name}.yaml`, workflowName: name });
  });
});

When('I edit the inputs of the roadmap item {string}', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await item.scrollIntoViewIfNeeded();
  await openRow(item, LOAD_TIMEOUT); // Edit is in the item's open row (features/support/roadmap-row.js)
  await item.getByRole('button', { name: /^(Edit|Editar)$/ }).click();
  await expect(editForm(e2e.window, title)).toBeVisible();
});

When('I save the inputs of the roadmap item {string}', async ({ e2e }, title) => {
  const form = editForm(e2e.window, title);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toBeHidden();
});

Then('the roadmap item {string} shows the input {string}', async ({ e2e }, title, text) => {
  const item = await openRow(roadmapItem(e2e.window, title), LOAD_TIMEOUT); // the inputs are in the item's open row
  const pill = item.getByTestId('input-pill').filter({ hasText: text });
  await expect(pill.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the roadmap item {string} shows no {string} input', async ({ e2e }, title, label) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(item.getByTestId('input-pill').filter({ hasText: new RegExp(`^\\s*${escapeRe(label)}:`) })).toHaveCount(0);
});

// ---- #287: saving an Edit form after the roadmap changed elsewhere ------------------------------------

const readRoadmap = (e2e) => JSON.parse(fs.readFileSync(roadmapFile(e2e), 'utf8'));
const findItem = (r, title) => r.stages.flatMap((s) => s.items).find((x) => titleOf(x) === title);

// an outside script appends an issue to the item (its first issue, so its title, unchanged)
When('the issue {string} is added to the roadmap item {string} outside the app', async ({ e2e }, issueTitle, title) => {
  editRoadmap(e2e, (r) => {
    const item = findItem(r, title);
    expect(item, `a roadmap item "${title}"`).toBeTruthy();
    const number = 1900 + (item.issues?.length || 0);
    const issue = { number, url: `https://github.com/example/demo-app/issues/${number}`, title: issueTitle, body: '', knownPullRequests: [] };
    item.issues = [...(item.issues || []), issue];
  });
});

// an outside script removes the whole stage holding the item
When('the stage of the roadmap item {string} is removed outside the app', async ({ e2e }, title) => {
  editRoadmap(e2e, (r) => {
    const at = r.stages.findIndex((s) => s.items.some((x) => titleOf(x) === title));
    expect(at, `a stage holding the roadmap item "${title}"`).toBeGreaterThanOrEqual(0);
    r.stages.splice(at, 1);
  });
});

// Save pressed; the form may stay open (a refused save keeps its values)
When('I try to save the inputs of the roadmap item {string}', async ({ e2e }, title) => {
  await editForm(e2e.window, title).getByRole('button', { name: 'Save', exact: true }).click();
});

Then('the Edit form of the roadmap item {string} says {string}', async ({ e2e }, title, text) => {
  const notice = roadmapItem(e2e.window, title).getByTestId('roadmap-changed-notice');
  await expect(notice).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(notice).toContainText(new RegExp(escapeRe(text), 'i'));
  await expect(editForm(e2e.window, title)).toBeVisible();
});

Then('the roadmap file still lists the issue {string} on the item {string}', async ({ e2e }, issueTitle, title) => {
  const item = findItem(readRoadmap(e2e), title);
  expect(item, `a roadmap item "${title}" in the file`).toBeTruthy();
  expect((item.issues || []).map((i) => i.title)).toContain(issueTitle);
});

Then('the roadmap says the edit was not saved because its stage was removed', async ({ e2e }) => {
  const message = e2e.window.getByTestId('roadmap-save-conflict').filter({ visible: true }).first();
  await expect(message).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(message).toContainText(/not saved|could not be saved|nothing was saved/i);
  await expect(message).toContainText(/stage/i);
  await expect(message).toContainText(/removed|no longer exists|deleted/i);
});

// nothing saved: the refused edit did not bring the item (or its stage) back
Then('the roadmap file has no item {string}', async ({ e2e }, title) => {
  expect(findItem(readRoadmap(e2e), title), `the roadmap item "${title}" in the file`).toBeUndefined();
});
