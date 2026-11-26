// Steps of features/79-84-import-push-and-kind.feature (#79, #84), written before the code.
// Reused: "the app is open", the wizard's steps (onboarding.steps.js), the Start panel and its simulated run
// (fronts/build/features/steps/run.steps.js), the gate card (run-environment.steps.js).
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps):
// - #79 data-testid="wizard-push-notice" (NEW): in the import wizard, shown before Finish (on the analysis or
//   the review step) when the clone cannot push: it says so ("can't push" / "cannot push") and names the command
//   to run, e.g. `gh auth setup-git`; it holds data-testid="wizard-push-fix" (NEW), a button that runs it and
//   checks the push again; the notice goes away once the push works;
// - #79 the "CI failed" gate (ci_failed) of a run whose CI step opened no pull request reads
//   "no PR was opened: <reason>" (data-testid="run-gate", existing), never "CI on  did not pass";
// - #84 data-testid="wizard-clone-into" (existing): the Repository step's line naming where the clone goes,
//   "<workspace>/repos/<folder>"; a local folder path's clone folder is its own folder's name;
// - #84 data-testid="wizard-kind-select" (existing) in the review: a docs-only repository does not open on
//   "backend"; it opens on a documentation kind, or on no kind with a line or option that says it was not
//   detected and asks the owner to choose one.
//
// E2E HOOKS THE DEVELOPER MUST ADD, read only when CRAFTORIO_SIMULATION_ONLY=1:
// - CRAFTORIO_E2E_GIT_PUSH=0: the import's push check of the clone fails as git does without credentials (gh,
//   through CRAFTORIO_E2E_REPO_PUSH=1, says the owner may push); the simulated `gh auth setup-git` run by
//   wizard-push-fix succeeds and the next check passes. No gh, no git push, no network.
// - CRAFTORIO_E2E_CI_NO_PR=<reason>: a simulated run's CI step (fragments/pr-pipeline.yaml `ci`) answers
//   { pr_url: '', pr_number: 0, ci_status: 'failed', failure_class: 'infra', failure_log: <reason> }, so the run
//   goes to the ci_failed gate.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// the access check and a local clone (onboarding.steps.js IMPORT_TIMEOUT)
const IMPORT_TIMEOUT = 45000;
const ANALYSIS_TIMEOUT = 120000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wizard = (page) => page.getByTestId('project-wizard');
const review = (page) => wizard(page).getByTestId('wizard-review');
const pushNotice = (page) => wizard(page).getByTestId('wizard-push-notice');
const gateCard = (page) => page.getByTestId('run-gate').filter({ visible: true }).first();

// a git repository with one commit of the given files (fixed identity, no machine config), under the
// scenario's scratch folder at folders/<rel>
function makeRepository(scratch, rel, files) {
  const folder = path.join(scratch, 'folders', ...rel.split('/'));
  fs.mkdirSync(folder, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), text);
  const config = path.join(scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  const git = (args) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: folder, env, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'First commit']);
  return folder;
}

// ---- #79: the clone can push, or the wizard says what to run ------------------------------------------------------

Given('the app is open where git cannot push to the repositories I import until its credentials are set up', async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_REPO_PUSH: '1', CRAFTORIO_E2E_GIT_PUSH: '0' } });
});

Then('the wizard warns that the clone cannot push and says to run {string}', async ({ e2e }, command) => {
  const notice = pushNotice(e2e.window);
  await expect(notice).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(notice).toContainText(/can.?t push|cannot push/i);
  await expect(notice).toContainText(command);
});

Then("the push warning offers a button to set up git's credentials", async ({ e2e }) => {
  const button = pushNotice(e2e.window).getByTestId('wizard-push-fix');
  await expect(button).toHaveRole('button');
  await expect(button).toBeEnabled();
});

When("I set up git's credentials from the push warning", async ({ e2e }) => {
  await pushNotice(e2e.window).getByTestId('wizard-push-fix').click();
});

Then('the wizard no longer warns that the clone cannot push', async ({ e2e }) => {
  await expect(pushNotice(e2e.window)).toHaveCount(0, { timeout: IMPORT_TIMEOUT });
  await expect(wizard(e2e.window)).toBeVisible();
});

Given("the app is open where a simulated run's CI step opens no pull request because {string}", async ({ e2e }, reason) => {
  await e2e.open({ env: { CRAFTORIO_E2E_CI_NO_PR: reason } });
});

// anywhere in the card, its collapsed Details (the gate's message) included
Then('the gate card does not say {string}', async ({ e2e }, words) => {
  const card = gateCard(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).not.toContainText(new RegExp(escapeRe(words), 'i'));
});

// ---- #84: a local folder's name, a docs-only repository's kind ----------------------------------------------------

Given('a local git repository in the folder {string} is ready to import', async ({ e2e }, rel) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const name = rel.split('/').pop();
  e2e.localFolder = makeRepository(e2e.scratch, rel, {
    'README.md': `# ${name}\n`,
    'package.json': JSON.stringify({ name, private: true, scripts: { test: 'node -e ""' } }, null, 2),
    'index.js': 'module.exports = () => 42;\n',
  });
});

Given('a local git repository with only a README and a LICENSE is ready to import', async ({ e2e }) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const folder = makeRepository(e2e.scratch, 'docs-repo', {
    'README.md': '# Notes\n\nA handbook kept in plain text.\n',
    LICENSE: 'MIT License\n\nCopyright (c) 2026 E2E\n',
  });
  e2e.localRepo = require('url').pathToFileURL(folder).href;
});

// the folder's plain path (as typed on this computer, no file:// URL), typed key by key in the git URL field
When("I type the local repository's folder path in the wizard", async ({ e2e }) => {
  if (!e2e.localFolder) throw new Error('no local folder: use "a local git repository in the folder {string} is ready to import" first');
  const field = wizard(e2e.window).getByTestId('wizard-repo');
  await field.clear();
  await field.pressSequentially(e2e.localFolder);
  await expect(field).toHaveValue(e2e.localFolder);
});

Then('the wizard says the repository will be cloned into the folder {string}', async ({ e2e }, folder) => {
  const line = wizard(e2e.window).getByTestId('wizard-clone-into');
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  // "<workspace>/repos/<folder>": the last part of the path is the folder itself
  await expect(line).toContainText(new RegExp(`[\\\\/]${escapeRe(folder)}(?![\\w.-])`));
  await expect(line).not.toContainText(new RegExp(`[\\w.]-${escapeRe(folder)}`));
});

Then('the workspace has the repository cloned into the folder {string}', async ({ e2e }, folder) => {
  const repos = path.join(e2e.scratch, 'workspace', 'repos');
  await expect.poll(() => fs.existsSync(path.join(repos, folder, '.git')), { message: `${folder} cloned in ${repos}`, timeout: IMPORT_TIMEOUT }).toBe(true);
  const others = fs.readdirSync(repos).filter((d) => d !== folder && d.endsWith(`-${folder}`));
  expect(others, `no other clone folder ending in -${folder}`).toEqual([]);
});

const kindSelect = (page) => review(page).getByTestId('wizard-kind-select');
const selectedKindLabel = (page) => kindSelect(page).evaluate((el) => (el.selectedOptions?.[0]?.textContent ?? el.textContent ?? '').trim());

Then("the review's Project type is not {string}", async ({ e2e }, label) => {
  const select = kindSelect(e2e.window);
  await expect(select).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect.poll(() => selectedKindLabel(e2e.window), { timeout: LOAD_TIMEOUT }).not.toBe(label);
  await expect(review(e2e.window).getByTestId('wizard-kind-detected').filter({ hasText: label })).toHaveCount(0);
});

// a documentation kind picked (or detected), or no kind with the words "not detected" / "choose" next to it
Then("the review's Project type reads documentation or asks me to choose one", async ({ e2e }) => {
  const page = e2e.window;
  const field = kindSelect(page).locator('xpath=..');
  await expect.poll(async () => {
    const picked = await selectedKindLabel(page);
    const around = await field.innerText();
    return /document|docs/i.test(picked) || /not detected|choose/i.test(`${picked}\n${around}`);
  }, { message: 'the Project type reads documentation, or says it was not detected and asks to choose', timeout: LOAD_TIMEOUT }).toBe(true);
});

// ---- #57: a new project asks its kind, an import keeps "Detect from the files" ---------------------------------
// Steps of features/850-851-852-project-wizard-step3-review.feature's @issue-57 scenarios, written before the code.
// - data-testid="wizard-kind-select" (existing, a native <select>, aria-label "Kind of project") in the review:
//   for a new project its options are the kinds (Frontend, Full-stack, Backend (no UI)...) with no
//   "Detect from the files" (onboarding.kind_detect); for an import whose kind is not known yet it keeps that
//   option, picked. The kind picked is saved on the project at Finish (the project's `kind`).

const kindOptionLabels = (page) => kindSelect(page).locator('option').evaluateAll((els) => els.map((el) => (el.textContent || '').trim()));

Then("the review's Project type offers {string}, {string} and {string}", async ({ e2e }, a, b, c) => {
  const page = e2e.window;
  await expect(kindSelect(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const label of [a, b, c]) {
    await expect.poll(() => kindOptionLabels(page), { message: `the Project type offers "${label}"`, timeout: LOAD_TIMEOUT }).toContain(label);
  }
});

Then("the review's Project type does not offer {string}", async ({ e2e }, label) => {
  const page = e2e.window;
  await expect(kindSelect(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  expect(await kindOptionLabels(page), `the Project type's options`).not.toContain(label);
});

Then("the review's Project type has {string} picked", async ({ e2e }, label) => {
  const page = e2e.window;
  await expect(kindSelect(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => selectedKindLabel(page), { message: `the Project type has "${label}" picked`, timeout: LOAD_TIMEOUT }).toBe(label);
});

When("I pick {string} as the review's Project type", async ({ e2e }, label) => {
  const select = kindSelect(e2e.window);
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await select.selectOption({ label });
  await expect.poll(() => selectedKindLabel(e2e.window), { timeout: LOAD_TIMEOUT }).toBe(label);
});
