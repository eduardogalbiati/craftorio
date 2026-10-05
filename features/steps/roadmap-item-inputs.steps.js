// Steps of features/roadmap-item-inputs.feature: the developer's effort in a roadmap item's Edit and
// on its card (#286), on the demo roadmap (scripts/screenshot.js demoRoadmap). The stage of planned
// items comes from features/steps/roadmap.steps.js. Locators are roles and data-testid only
// (skills/ui-conventions).
//
// What the screen exposes, inside data-testid="roadmap-item":
// - the Edit form (role group "Edit the inputs of this item") draws the workflow's inputs, "Developer
//   effort" a row of pills next to "Developer model";
// - the card shows the item's inputs as data-testid="input-pill" ("Developer effort: High"), an input
//   at its default ('default') left out.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).first();
const editForm = (page, title) => roadmapItem(page, title).getByRole('group', { name: 'Edit the inputs of this item', exact: true });

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
  await item.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editForm(e2e.window, title)).toBeVisible();
});

When('I save the inputs of the roadmap item {string}', async ({ e2e }, title) => {
  const form = editForm(e2e.window, title);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toBeHidden();
});

Then('the roadmap item {string} shows the input {string}', async ({ e2e }, title, text) => {
  const pill = roadmapItem(e2e.window, title).getByTestId('input-pill').filter({ hasText: text });
  await expect(pill.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the roadmap item {string} shows no {string} input', async ({ e2e }, title, label) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(item.getByTestId('input-pill').filter({ hasText: new RegExp(`^\\s*${escapeRe(label)}:`) })).toHaveCount(0);
});
