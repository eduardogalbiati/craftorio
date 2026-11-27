// Steps of features/98-local-folder-any-folder.feature (#98): the wizard's "Use a local repository" card takes any
// folder: right after the pick, step 2 says what the engine read in it (a repository is cloned, a plain folder gets a
// new git repository from a copy of its files, a missing folder keeps Next off); the original folder never changes.
// Reuses onboarding.steps.js (opening the wizard, "a local git repository is ready to import", "a local folder that
// is not a git repository is ready to import" — both leave the folder's file:// URL in e2e.localRepo —, Next, the
// wizard's step, "the next step of the wizard is unavailable").
//
// The native folder picker cannot be driven by Playwright: as settings-workspace-folder.steps.js does, the steps
// replace dialog.showOpenDialog in the main process (electronApp.evaluate) so api.pickFolder() answers the folder.
//
// What the screen exposes (the renderer's contract for these steps), data-testid only:
//   wizard-source-folder   step 1's "Use a local repository" card (picked, then Next opens the folder picker)
//   wizard-name            the project's name on step 2
//   wizard-folder-state    NEW (#98): step 2's state line, data-state = repository | empty-repository | plain |
//                          missing | unreadable, its text saying what will happen
//   wizard-next            the footer's Next

const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const STATES = ['repository', 'empty-repository', 'plain', 'missing', 'unreadable'];

const wizard = (page) => page.getByTestId('project-wizard');
const currentStep = (page) => wizard(page).locator('[aria-current="step"]').first();
const folderState = (page) => wizard(page).getByTestId('wizard-folder-state');

// every file under `dir` (relative path -> content), .git included; null when the folder does not exist
function snapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  const out = {};
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else out[child] = fs.readFileSync(path.join(dir, child), 'utf8');
    }
  };
  walk('');
  return out;
}

Given('a local folder that does not exist is ready to import', async ({ e2e }) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  e2e.localRepo = pathToFileURL(path.join(e2e.scratch, 'folders', 'never-made-98')).href;
});

// the card picked, Next opens the folder picker, which answers the local folder: step 2 shows it
When("I pick the local repository with the wizard's local repository card", async ({ e2e }) => {
  if (!e2e.localRepo) throw new Error('no local folder: use "a local ... is ready to import" first');
  const page = e2e.window;
  const folder = fileURLToPath(e2e.localRepo);
  e2e.pickedFolder = { dir: folder, before: snapshot(folder) };
  await e2e.app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, folder);
  await wizard(page).getByTestId('wizard-source-folder').click();
  if ((await currentStep(page).getAttribute('data-step')) === 'start') await wizard(page).getByTestId('wizard-next').click();
  await expect(currentStep(page)).toHaveAttribute('data-step', 'repository', { timeout: LOAD_TIMEOUT });
});

When("I name the project {string} on the wizard's folder step", async ({ e2e }, name) => {
  await wizard(e2e.window).getByTestId('wizard-name').fill(name);
});

Then("the wizard's folder state is {string}", async ({ e2e }, state) => {
  if (!STATES.includes(state)) throw new Error(`unknown folder state "${state}": one of ${STATES.join(', ')}`);
  const line = folderState(e2e.window);
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toHaveAttribute('data-state', state, { timeout: LOAD_TIMEOUT });
  await expect(line).not.toHaveText('');
});

Then("the wizard's folder state says a new git repository will be created and the original folder is not changed", async ({ e2e }) => {
  const line = folderState(e2e.window);
  await expect(line).toContainText(/new git repository/i);
  await expect(line).toContainText(/(not|never) (be )?(changed|modified|touched)|unchanged|untouched/i);
});

Then("the wizard's Next does not say {string}", async ({ e2e }, word) => {
  const next = wizard(e2e.window).getByTestId('wizard-next');
  await expect(next).toBeVisible();
  await expect(next).not.toContainText(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

Then('the picked folder is unchanged and still has no git repository', async ({ e2e }) => {
  const { dir, before } = e2e.pickedFolder || {};
  if (!dir) throw new Error("no picked folder: use \"I pick the local repository with the wizard's local repository card\" first");
  expect(fs.existsSync(path.join(dir, '.git')), `${dir} has no .git`).toBe(false);
  expect(snapshot(dir)).toEqual(before);
});
