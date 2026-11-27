// Steps of features/settings.feature's @issue-106 scenarios: Settings › General › Workspace folder ›
// Change… takes an empty folder or an existing Craftorio workspace; a folder holding other files is
// refused with a message saying why, in the interface language, and nothing is written into it.
// Opening Settings and its tab is app.steps.js's; choosing the interface language is
// settings-language.steps.js's.
//
// The native folder picker cannot be driven by Playwright: the steps replace dialog.showOpenDialog in
// the main process (electronApp.evaluate) so it answers the scenario's folder, as if the user chose it.
// The folders live in the scenario's scratch folder (under os.tmpdir(), removed when the app closes),
// outside the workspace.
//
// What the screen exposes (the renderer's contract for these steps), roles and data-testid only:
//   the "Change…" button        role button, named settings.general.change in the interface language
//   settings-workspace-path     the workspace folder shown (today's #set-ws-path)
//   workspace-folder-error      the refusal's message, role="alert" (today's #ws-error)

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const I18N_DIR = path.join(__dirname, '..', '..', 'packages', 'shared', 'i18n');
const catalog = (code) => JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${code}.json`), 'utf8'));
// "Change…" in every catalog the interface offers in E2E (English, Português (Brasil))
const CHANGE_NAME = new RegExp(`^(${['en', 'pt-BR'].map((c) => escapeRe(catalog(c)['settings.general.change'])).join('|')})$`);

const workspacePath = (page) => page.getByTestId('settings-workspace-path').filter({ visible: true });
const workspaceError = (page) => page.getByTestId('workspace-folder-error').filter({ visible: true });

// every entry under dir, relative, with each file's content: what "left exactly as it was" compares
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (entry.isDirectory()) { out[`${rel}/`] = ''; walk(full); } else out[rel] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

function folders(e2e) {
  e2e.folders = e2e.folders || {};
  return e2e.folders;
}

// a small Node project's folder, a git repository: none of it is a Craftorio workspace's
Given("a folder that holds another project's files", async ({ e2e }) => {
  const dir = path.join(e2e.scratch, 'elsewhere', 'other-project');
  const files = {
    'package.json': '{\n  "name": "other-project",\n  "version": "1.0.0"\n}\n',
    'README.md': '# Other project\n',
    'src/index.js': "console.log('other project');\n",
    '.git/HEAD': 'ref: refs/heads/main\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  folders(e2e).other = { dir, before: snapshot(dir) };
});

Given('an empty folder', async ({ e2e }) => {
  const dir = path.join(e2e.scratch, 'elsewhere', 'empty-folder');
  fs.mkdirSync(dir, { recursive: true });
  folders(e2e).empty = { dir };
});

// the folder picker answers `dir`, then Change… is clicked
async function changeWorkspaceTo(e2e, dir) {
  await e2e.app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, dir);
  await e2e.window.getByRole('button', { name: CHANGE_NAME }).filter({ visible: true }).click();
}

When("I change the workspace folder to the folder that holds another project's files", async ({ e2e }) => {
  await changeWorkspaceTo(e2e, folders(e2e).other.dir);
});

When('I change the workspace folder to the empty folder', async ({ e2e }) => {
  await changeWorkspaceTo(e2e, folders(e2e).empty.dir);
});

// the message says why: the folder should be empty or a Craftorio workspace, in the interface language
Then('Settings says the workspace folder must be empty or a Craftorio workspace, in English', async ({ e2e }) => {
  const error = workspaceError(e2e.window);
  await expect(error).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error).toContainText(/empty/i);
  await expect(error).toContainText(/Craftorio/);
});

Then('Settings says the workspace folder must be empty or a Craftorio workspace, in Portuguese', async ({ e2e }) => {
  const error = workspaceError(e2e.window);
  await expect(error).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error).toContainText(/vazia/i);
  await expect(error).toContainText(/Craftorio/);
  await expect(error).not.toContainText(/\bempty\b/i);
});

Then('the workspace folder shown is still the demo workspace', async ({ e2e }) => {
  await expect(workspacePath(e2e.window)).toHaveText(path.resolve(e2e.scratch, 'workspace'));
});

Then("the folder that holds another project's files is exactly as it was", async ({ e2e }) => {
  const { dir, before } = folders(e2e).other;
  expect(snapshot(dir), 'the folder\'s entries and contents after Change…').toEqual(before);
});

Then('the workspace folder shown is the empty folder', async ({ e2e }) => {
  await expect(workspacePath(e2e.window)).toHaveText(path.resolve(folders(e2e).empty.dir), { timeout: LOAD_TIMEOUT });
});

Then('Settings shows no workspace folder error', async ({ e2e }) => {
  await expect(e2e.window.getByTestId('workspace-folder-error').filter({ hasText: /\S/ })).toHaveCount(0);
});
