// Steps of features/onboarding.feature (#641, onboarding step 4 of docs/work/first-project-onboarding/plan.md):
// the new-project wizard (fronts/build/views/projects/project-wizard.js) and the onboarding's progress
// tray. Opening the app reuses app.steps.js ("the app is open").
//
// What the screens expose (the renderer's contract for these steps), skills/ui-conventions:
// - data-testid="project-wizard": the wizard; its steps carry data-step="start|repository|analysis|review",
//   the current one aria-current="step";
// - wizard-source-import / wizard-source-new: step 1's cards; wizard-next / wizard-back / wizard-close;
// - wizard-repo, wizard-name: step 2's inputs; wizard-provider; wizard-import-status;
// - wizard-error (data-error="no-access" | "clone-failed"), with a role="button" named /Retry/;
//   wizard-cli-warning (gh / glab missing: a warning, the import goes on);
// - step 3 (layout rework and #100, 2026-11-26): wizard-analysis data-state="choose|analyzing|failed|analyzed|manual",
//   one screen per state. choose: only wizard-workflows-choice-analyze ("Analyze with AI", with
//   wizard-workflows-choice-cost) and wizard-workflows-choice-manual; wizard-next ("Continue") is disabled until the
//   workflows are defined and never starts the analysis; there is no wizard-skip. The jobs (wizard-cost,
//   wizard-cost-total, data-part="profile|projectMap", #730: no "ranking") are listed only while the analysis runs or
//   after a job failed. analyzed / manual: the rows, each row's choices as wizard-workflow-tile buttons (its
//   wizard-workflow-select not shown), then wizard-work-model;
// - data-testid="onboarding-tray": the progress tray, outside the wizard; each project a
//   data-testid="tray-item" with data-status="cloning|analyzing|ready|analyzed|failed", holding the
//   project's name, and when failed the reason in words and a role="button" named /Retry/.
//
// A reachable repository without network: a local git repository under the scenario's scratch folder,
// imported by its file:// URL (git ls-remote and git clone accept it; no provider, so no gh / glab check).
//
// #642 (onboarding step 5): the review and the project page's "Next steps" card.
// - data-testid="wizard-review": the review step's body; wizard-review-city (the project's city),
//   wizard-review-backlog (the backlog), wizard-review-refactors (the refactor backlog), its rows
//   data-testid="wizard-review-refactor", each a role="checkbox" named by the refactor's title (the pick),
//   the file's score (0 to 100) and its quadrant (Danger Zone, Cowboy Code, Fertile Ground, Healthy Closure);
//   wizard-review-idea: the idea's text field; wizard-finish: Finish (any time, never waits for an analysis);
// - data-testid="project-next-steps": the card on the project page, its entries links or buttons named by
//   what they do (the refactors to the roadmap, the first idea, the refactor cadence); next-steps-dismiss.
// An analysis still running: another holder of the analysis slot (packages/engine/engine/machine-slot.js) in
// a folder of the scenario's own (CRAFTORIO_LOCKS_DIR), so the project map waits and the analysis stays on.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// the access check (git ls-remote, up to 30 s in the engine) and a local clone
const IMPORT_TIMEOUT = 45000;

const wizard = (page) => page.getByTestId('project-wizard');
const currentStep = (page) => wizard(page).locator('[aria-current="step"]').first();
const tray = (page) => page.getByTestId('onboarding-tray');
// the name is its own element (the tray's <strong>), read as text with no word after it: "missing-641failed" has no \b
const trayItem = (page, name) => tray(page).getByTestId('tray-item').filter({ has: page.getByText(name, { exact: true }) });
// an amount of money ("$0.42", "$ 1", "0.42 USD") or an estimate said unknown (onboarding-model's
// costSummary: a missing estimate is null, never $0)
const AMOUNT = /\$\s?\d|\d(\.\d+)?\s*USD\b|unknown|not known|no estimate/i;

// a source file with branches (a measurable complexity), its version n so later commits change it
const sourceFile = (n) => `function route(kind, value) {\n  if (kind === 'a') return value + ${n};\n  if (kind === 'b') { for (let i = 0; i < value; i++) if (i % 2) return i; }\n  switch (kind) { case 'c': return -value; case 'd': return value * 2; default: return ${n}; }\n}\nmodule.exports = { route };\n`;

// a git repository with one commit (fixed identity, no machine config); withCode: a few source files
// and more commits on one of them, so the analysis has files to score (complexity and churn)
// files: more files of the first commit, { <relative path>: <text> } (#30: package-lock.json)
function makeRepository(scratch, name, { withCode = false, pkg = {}, files = {} } = {}) {
  const folder = path.join(scratch, 'folders', name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), `# ${name}\n`);
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, private: true, scripts: { test: 'node -e ""' }, ...pkg }, null, 2));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
    fs.writeFileSync(path.join(folder, rel), text);
  }
  if (withCode) {
    fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'src', 'router.js'), sourceFile(0));
    fs.writeFileSync(path.join(folder, 'src', 'util.js'), 'const add = (a, b) => a + b;\nmodule.exports = { add };\n');
  }
  const config = path.join(scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  const git = (args) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: folder, env, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'First commit']);
  if (withCode) {
    for (let n = 1; n <= 3; n++) {
      fs.writeFileSync(path.join(folder, 'src', 'router.js'), sourceFile(n));
      git(['commit', '-q', '-am', `Change the router (${n})`]);
    }
  }
  return pathToFileURL(folder).href;
}

Given('a local git repository is ready to import', async ({ e2e }) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  e2e.localRepo = makeRepository(e2e.scratch, 'sample-repo');
});

// #75: a web front end (react in its dependencies): its kind is frontend, so the Next steps card keeps the
// screenshots step (left out for a backend, docs or empty project)
Given('a local git repository of a web front end is ready to import', async ({ e2e }) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  e2e.localRepo = makeRepository(e2e.scratch, 'sample-repo', { pkg: { dependencies: { react: '^18.0.0' } } });
});

Given('a local git repository with some code is ready to import', async ({ e2e }) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  e2e.localRepo = makeRepository(e2e.scratch, 'sample-repo', { withCode: true });
});

// #30: an npm project whose package-lock.json is committed and whose node_modules is not (never
// installed): its `check` script needs a dependency, so the machine checks cannot run before npm ci
Given('a local git repository with a lockfile and no installed dependencies is ready to import', async ({ e2e }) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const dep = 'left-pad';
  const name = 'deps-repo';
  const lock = {
    name,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name, dependencies: { [dep]: '1.3.0' } },
      [`node_modules/${dep}`]: { version: '1.3.0', resolved: `https://registry.npmjs.org/${dep}/-/${dep}-1.3.0.tgz`, license: 'WTFPL' },
    },
  };
  e2e.localRepo = makeRepository(e2e.scratch, name, {
    withCode: true,
    pkg: { scripts: { test: 'node -e ""', check: `node -e "require('${dep}')"` }, dependencies: { [dep]: '1.3.0' } },
    files: { 'package-lock.json': JSON.stringify(lock, null, 2), '.gitignore': 'node_modules/\n' },
  });
});

// ---- #844: a repository whose history the ways of working must read right -----------------------------------
// A local git repository (file:// URL, as above) whose history is built commit by commit with its own author and
// date: the owner's pushes straight to main, outside contributors' pull requests merged by the owner as GitHub
// does ("Merge pull request #<n> from <login>/<branch>", --no-ff), tags, and package.json with or without a test
// command. Git identities: the owner commits under every identity left once each other person has one (same
// name or same e-mail: "Ana Lima <ana@shop.dev>", "Ana Lima <ana.lima@gmail.com>", "ana <ana@shop.dev>"...).
const OWNER_IDENTITIES = [['Ana Lima', 'ana@shop.dev'], ['Ana Lima', 'ana.lima@gmail.com'], ['ana', 'ana@shop.dev'], ['A. Lima', 'ana.lima@gmail.com'], ['ana-lima', 'ana@shop.dev']];
const OUTSIDERS = [['Bruno Reis', 'bruno@outside.dev', 'bruno-reis'], ['Carla Dias', 'carla@outside.dev', 'carla-dias'], ['Davi Sousa', 'davi@outside.dev', 'davi-sousa'], ['Eva Rocha', 'eva@outside.dev', 'eva-rocha']];

function historyRepository(scratch, name, { scripts = {}, files = {} } = {}) {
  const folder = path.join(scratch, 'folders', name);
  fs.mkdirSync(folder, { recursive: true });
  const config = path.join(scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  let day = 0;
  const git = (args, [who, email] = OWNER_IDENTITIES[0]) => {
    day += 1;
    const date = new Date(Date.UTC(2026, 6, 1) + day * 86400000).toISOString();
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: folder, env, encoding: 'utf8' });
  };
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
    fs.writeFileSync(path.join(folder, rel), text);
  };
  write('README.md', `# ${name}\n`);
  write('package.json', JSON.stringify({ name, private: true, scripts }, null, 2));
  write('src/router.js', sourceFile(0));
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'First commit']);
  // a change on main by `identity`, its file the n-th version of the router
  let n = 0;
  const push = (identity, message) => { n += 1; write('src/router.js', sourceFile(n)); git(['commit', '-q', '-am', message], identity); };
  // a pull request of `login` (its commit by `identity`) merged into main by the owner, as GitHub merges it
  let pr = 10;
  const pull = (identity, login) => {
    pr += 1;
    const branch = `change-${pr}`;
    git(['checkout', '-q', '-b', branch]);
    n += 1;
    write(`src/change-${pr}.js`, `module.exports = ${n};\n`);
    git(['add', '-A']);
    git(['commit', '-q', '-m', `Change ${pr}`], identity);
    git(['checkout', '-q', 'main']);
    git(['merge', '-q', '--no-ff', '-m', `Merge pull request #${pr} from ${login}/${branch}`, branch]);
    git(['branch', '-q', '-D', branch]);
  };
  const tag = (name) => git(['tag', name]);
  return { folder, push, pull, tag, url: pathToFileURL(folder).href };
}

// {people} people under {identities} identities: the owner (identities - people + 1 of them) pushes straight to
// main, the others are outside contributors whose pull requests are merged; a tag after each round; no test
// command and no test file
Given("a local git repository is ready to import where {int} people commit under {int} git identities, the owner pushes straight to main, outside contributors' pull requests are merged, releases are tagged and nothing is tested", async ({ e2e }, people, identities) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const ownerIdentities = identities - people + 1;
  if (people < 2 || ownerIdentities < 1 || ownerIdentities > OWNER_IDENTITIES.length || people - 1 > OUTSIDERS.length) {
    throw new Error(`cannot seed ${people} people under ${identities} identities (at most ${OWNER_IDENTITIES.length} for the owner, ${OUTSIDERS.length} outsiders)`);
  }
  const repo = historyRepository(e2e.scratch, 'history-repo', { scripts: { start: 'node src/router.js' } });
  const outsiders = OUTSIDERS.slice(0, people - 1);
  for (let round = 1; round <= 3; round++) {
    OWNER_IDENTITIES.slice(0, ownerIdentities).forEach((identity, i) => repo.push(identity, `Round ${round}: change ${i + 1} on main`));
    outsiders.forEach(([who, email, login]) => repo.pull([who, email], login));
    repo.tag(`v1.${round - 1}.0`);
  }
  e2e.localRepo = repo.url;
});

// the counterpart: every change lands through a pull request (one author), and the tests run with a test command
Given('a local git repository is ready to import where every change lands through a merged pull request and the tests run with {string}', async ({ e2e }, command) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const script = command.replace(/^npm (run )?/, '');
  if (script !== 'test') throw new Error(`only "npm test" is seeded (got "${command}")`);
  const repo = historyRepository(e2e.scratch, 'pr-repo', {
    scripts: { test: 'node --test' },
    files: { 'test/router.test.js': "const test = require('node:test');\nconst { route } = require('../src/router');\ntest('route', () => { route('a', 1); });\n" },
  });
  const [who, email] = OWNER_IDENTITIES[0];
  for (let i = 0; i < 4; i++) repo.pull([who, email], 'ana-lima');
  repo.tag('v1.0.0');
  e2e.localRepo = repo.url;
});

// the app's machine slots in a folder of this scenario's own (never the machine's: no other run waits),
// where the analysis slot is held by this test process (alive, so never stale) until the app closes
Given("the app is open while another analysis holds the machine's analysis slot", async ({ e2e }) => {
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-e2e-locks-'));
  const slots = require('@craftorio/engine/engine/machine-slot');
  fs.writeFileSync(slots.slotFile(slots.ANALYSIS_SLOT, locks), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'e2e-642', started: Date.now(), holder: 'another analysis (e2e)' }));
  await e2e.open({ env: { CRAFTORIO_LOCKS_DIR: locks } });
  const close = e2e.close;
  e2e.close = async () => { await close(); fs.rmSync(locks, { recursive: true, force: true }); };
});

// The page global opens the wizard directly; Projects › New project and the Setup's last step also
// open it since #643 (features/setup-projects-onboarding.feature drives those paths). #726: the app is
// ready when its sidebar shows, whatever the interface language (no wait on the English "Home")
When('I open the project wizard', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByRole('navigation').first().getByRole('button').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => typeof window.ProjectWizard?.open === 'function', null, { timeout: LOAD_TIMEOUT });
  await page.evaluate(() => window.ProjectWizard.open());
  await expect(wizard(page)).toBeVisible();
  await expect(currentStep(page)).toHaveAttribute('data-step', 'start');
});

When('I choose to import a repository in the wizard', async ({ e2e }) => {
  const page = e2e.window;
  await wizard(page).getByTestId('wizard-source-import').click();
  // a card may move on by itself, or wait for Next
  if ((await currentStep(page).getAttribute('data-step')) === 'start') await wizard(page).getByTestId('wizard-next').click();
  await expect(currentStep(page)).toHaveAttribute('data-step', 'repository');
});

async function enterRepository(page, repo, name) {
  await wizard(page).getByTestId('wizard-repo').fill(repo);
  await wizard(page).getByTestId('wizard-name').fill(name);
}

When('I enter the repository {string} and the project name {string}', async ({ e2e }, repo, name) => {
  await enterRepository(e2e.window, repo, name);
});

When('I enter the local repository and the project name {string}', async ({ e2e }, name) => {
  if (!e2e.localRepo) throw new Error('no local repository: use "a local git repository is ready to import" first');
  await enterRepository(e2e.window, e2e.localRepo, name);
});

// The local repository by its folder's plain path (no file:// URL), in the URL field: step 2 stays the import's
// own screen, with the provider's parts (#738's fork notice). A file:// URL turns step 2 into the local-repository
// screen (the folder, Change folder), which has none of them
When('I enter the path of the local repository and the project name {string}', async ({ e2e }, name) => {
  if (!e2e.localRepo) throw new Error('no local repository: use "a local git repository is ready to import" first');
  await enterRepository(e2e.window, require('url').fileURLToPath(e2e.localRepo), name);
});

When('I go to the next step of the wizard', async ({ e2e }) => {
  await wizard(e2e.window).getByTestId('wizard-next').click();
});

// #743: on the Repository step the first Next starts the clone and the button turns into "Cloning <name>…"
// (disabled while the start call is in flight); once enabled again, the next click goes on to the analysis
// with the clone still running
When('I go on to the analysis while the import runs', async ({ e2e }) => {
  const next = wizard(e2e.window).getByTestId('wizard-next');
  await expect(next).toHaveText(/Cloning/, { timeout: IMPORT_TIMEOUT });
  await expect(next).toBeEnabled({ timeout: IMPORT_TIMEOUT });
  await next.click();
});

Then('the wizard is on its {string} step', async ({ e2e }, step) => {
  await expect(currentStep(e2e.window)).toHaveAttribute('data-step', step, { timeout: IMPORT_TIMEOUT });
});

Then('the wizard says the repository could not be reached and offers to retry', async ({ e2e }) => {
  const error = wizard(e2e.window).getByTestId('wizard-error');
  await expect(error).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(error).toHaveAttribute('data-error', 'no-access');
  await expect(error).toContainText(/could not be reached/i);
  await expect(error.getByRole('button', { name: /Retry/ })).toBeVisible();
});

Then('the progress tray shows the project {string} as failed with its reason and a Retry', async ({ e2e }, name) => {
  const item = trayItem(e2e.window, name);
  await expect(item).toHaveAttribute('data-status', 'failed', { timeout: IMPORT_TIMEOUT });
  await expect(item).toContainText(/could not be reached/i);
  await expect(item.getByRole('button', { name: /Retry/ })).toBeVisible();
});

Then('the progress tray shows the project {string} as {word}', async ({ e2e }, name, status) => {
  await expect(trayItem(e2e.window, name)).toHaveAttribute('data-status', status, { timeout: IMPORT_TIMEOUT });
});

// Before the analysis is asked for, step 3 is only its two choices (wizard-analysis data-state="choose"): what the
// analysis may cost is said once, on the Analyze with AI card (wizard-workflows-choice-cost, "Cost: <estimate>");
// the jobs with each part's amount (wizard-cost) show only while the analysis runs or after a job failed
const choiceCost = (page) => wizard(page).getByTestId('wizard-workflows-choice-analyze').getByTestId('wizard-workflows-choice-cost');

Then('the wizard says what the analysis may cost before anything starts', async ({ e2e }) => {
  const page = e2e.window;
  await expect(choiceCost(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(choiceCost(page)).toContainText(AMOUNT);
  await expect(wizard(page).getByTestId('wizard-cost'), 'no job list before the analysis is asked for').toHaveCount(0);
});

Then('the wizard offers to start the analysis', async ({ e2e }) => {
  // #725: the analysis starts from the workflows column's "Analyze with AI" choice
  // ("Analyze and continue", wizard-analyze, is gone).
  const analyze = wizard(e2e.window).getByTestId('wizard-workflows-choice-analyze');
  await expect(analyze).toBeEnabled();
  await expect(analyze).toContainText(/Analyze with AI/i);
});

// #100: "Skip, analyze later" (wizard-skip) is gone. The free way past step 3 is Define manually (nothing runs),
// then Continue: the review is reached with the analyses left for later
When('I define the workflows manually and continue, leaving the analysis for later', async ({ e2e }) => {
  const page = e2e.window;
  const w = wizard(page);
  const manual = w.getByTestId('wizard-workflows-choice-manual');
  await expect(manual).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(w.getByTestId('wizard-skip'), 'no "Skip, analyze later"').toHaveCount(0);
  await manual.click();
  await expect(w.getByTestId('wizard-workflows-column')).toHaveAttribute('data-state', 'manual');
  const next = w.getByTestId('wizard-footer').getByTestId('wizard-next');
  await expect(next).toBeEnabled();
  await next.click();
});

// a confirm, if closing asks one, is accepted (the import goes on in the tray either way)
When('I close the project wizard', async ({ e2e }) => {
  const page = e2e.window;
  await wizard(page).getByTestId('wizard-close').click();
  const confirm = page.getByTestId('confirm-modal');
  // the wizard has closed, or a confirm asks first
  await expect.poll(async () => (await confirm.isVisible()) || !(await wizard(page).isVisible())).toBe(true);
  if (await confirm.isVisible()) {
    await confirm.getByRole('button').filter({ hasNotText: /^\s*Cancel\s*$/ }).last().click();
    await expect(confirm).toBeHidden();
  }
});

// #643: opened from the Setup's last step or Projects › New project (not the old project dialog)
Then('the project wizard is open on its first step', async ({ e2e }) => {
  const page = e2e.window;
  await expect(wizard(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(currentStep(page)).toHaveAttribute('data-step', 'start');
  await expect(page.getByTestId('project-dialog').filter({ visible: true })).toHaveCount(0);
});

Then('the project wizard is not shown', async ({ e2e }) => {
  await expect(wizard(e2e.window)).toBeHidden();
});

// ---- #669: step 1 as in docs/work/first-project-onboarding/images/mock-1.jpg -----------------------------
// - the title is a heading of the wizard, the intro line its own text;
// - data-testid="wizard-steps": the numbered steps, each a data-testid="wizard-step-pill" reading its
//   number then its label ("1 Start"), the current one aria-current="step";
// - each card of step 1 (wizard-source-import / wizard-source-new) holds a data-testid="wizard-card-icon"
//   and its points as list items; Create new project is disabled (or aria-disabled);
// - data-testid="wizard-other-sources": "Other sources:" and its links (or buttons) named by the source;
// - data-testid="wizard-footer": wizard-cancel (Cancel, left) and wizard-next (Next, right).

const sourceCard = (page, title) => wizard(page).locator('[data-testid^="wizard-source-"]').filter({ hasText: title });
const otherSources = (page) => wizard(page).getByTestId('wizard-other-sources');
const otherSource = (page, name) => otherSources(page).getByRole('link', { name, exact: true })
  .or(otherSources(page).getByRole('button', { name, exact: true }));
const footer = (page) => wizard(page).getByTestId('wizard-footer');

Then("the wizard's title reads {string}", async ({ e2e }, title) => {
  await expect(wizard(e2e.window).getByRole('heading', { name: title, exact: true })).toBeVisible();
});

Then('the wizard says {string}', async ({ e2e }, text) => {
  await expect(wizard(e2e.window).getByText(text, { exact: true })).toBeVisible();
});

Then("the wizard's steps read {string}, {string}, {string} and {string}, numbered from 1, with {string} current", async ({ e2e }, a, b, c, d, current) => {
  const pills = wizard(e2e.window).getByTestId('wizard-steps').getByTestId('wizard-step-pill');
  const labels = [a, b, c, d];
  await expect(pills).toHaveText(labels.map((label, i) => new RegExp(`^\\s*${i + 1}\\s*${escapeRe(label)}\\s*$`)));
  for (const label of labels) {
    const pill = pills.filter({ hasText: label });
    if (label === current) await expect(pill, `the step "${label}" is current`).toHaveAttribute('aria-current', 'step');
    else await expect(pill, `the step "${label}" is not current`).not.toHaveAttribute('aria-current', 'step');
  }
});

Then("the wizard's {string} card has an icon and the points {string}, {string} and {string}", async ({ e2e }, title, a, b, c) => {
  const card = sourceCard(e2e.window, title);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('wizard-card-icon')).toBeVisible();
  await expect(card.getByRole('listitem')).toHaveText([a, b, c]);
});

Then("the wizard's {string} card cannot be chosen", async ({ e2e }, title) => {
  await expect(sourceCard(e2e.window, title)).toBeDisabled();
});

// #632: Create new project is enabled (mock-1 no longer marks it "soon")
Then("the wizard's {string} card can be chosen", async ({ e2e }, title) => {
  const card = sourceCard(e2e.window, title);
  await expect(card).toBeVisible();
  await expect(card).toBeEnabled();
  await expect(card).not.toHaveAttribute('aria-disabled', 'true');
  await expect(card).not.toContainText(/\bsoon\b/i);
});

// The one other source left under the cards: a link for who only has the repository's address (the folder on
// this computer is the third card, wizard-source-folder: picked, Next asks for the folder)
Then('the wizard asks {string} and offers the other source {string}', async ({ e2e }, question, name) => {
  await expect(otherSources(e2e.window)).toContainText(question);
  await expect(otherSource(e2e.window, name), `the other source "${name}"`).toBeVisible();
  await expect(otherSources(e2e.window).getByRole('button').or(otherSources(e2e.window).getByRole('link'))).toHaveCount(1);
});

// a click picks the card (aria-pressed), the only one picked; the step stays put until Next
When("I pick the wizard's {string} card", async ({ e2e }, title) => {
  const page = e2e.window;
  const card = sourceCard(page, title);
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(wizard(page).locator('[data-testid^="wizard-source-"][aria-pressed="true"]')).toHaveCount(1);
  await expect(currentStep(page)).toHaveAttribute('data-step', 'start');
});

// the footer's buttons sit together at the right on every step, the step's action last
Then("the wizard's footer has {string} then {string}, together on the right", async ({ e2e }, first, second) => {
  const page = e2e.window;
  const bar = footer(page);
  const firstButton = bar.getByRole('button', { name: first, exact: true });
  const secondButton = bar.getByRole('button', { name: second, exact: true });
  await expect(firstButton).toBeVisible();
  await expect(secondButton).toBeVisible();
  const [box, a, b] = await Promise.all([bar.boundingBox(), firstButton.boundingBox(), secondButton.boundingBox()]);
  const middle = box.x + box.width / 2;
  expect(a.x, `"${first}" in the footer's right half`).toBeGreaterThanOrEqual(middle);
  expect(b.x, `"${second}" after "${first}"`).toBeGreaterThanOrEqual(a.x + a.width);
  expect(b.x - (a.x + a.width), `"${first}" and "${second}" side by side`).toBeLessThanOrEqual(24);
  expect(box.x + box.width - (b.x + b.width), `"${second}" at the footer's right edge`).toBeLessThanOrEqual(48);
});

When('I choose the other source {string} in the wizard', async ({ e2e }, name) => {
  await otherSource(e2e.window, name).click();
});

Then("the wizard's git URL field is ready to type in", async ({ e2e }) => {
  const field = wizard(e2e.window).getByTestId('wizard-repo');
  await expect(field).toBeVisible();
  await expect(field).toBeEditable();
  await expect(field).toBeFocused();
});

When('I cancel the project wizard', async ({ e2e }) => {
  await wizard(e2e.window).getByTestId('wizard-cancel').click();
});

// ---- #642: the review, Finish and the project page's "Next steps" card ----------------------------------

// the simulated analysis: the free part and the project map (#730: no refactor ranking), without a model call
const ANALYSIS_TIMEOUT = 90000;
// Finish never waits for an analysis: the wizard is gone well before any job could end
const FINISH_TIMEOUT = 5000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const review = (page) => wizard(page).getByTestId('wizard-review');
const projectPage = (page) => page.getByTestId('project-page').filter({ visible: true }).first();
const nextSteps = (page) => projectPage(page).getByTestId('project-next-steps');
// an entry of the card (mock-7): its title and line say what it does ("roadmap", "idea"…), its button
// acts ("File and add", "Open Inbox", "Turn on"); the first entry whose text has the words
const nextStepsEntry = (page, words) => nextSteps(page).getByTestId(/^next-step-/)
  .filter({ hasText: new RegExp(escapeRe(words), 'i') }).first();
const nextStepsAction = (page, words) => nextStepsEntry(page, words).getByRole('button').first();

When('I start the analysis in the wizard', async ({ e2e }) => {
  // #725: "Analyze the repository" in the workflows column starts the analysis (the step stays put).
  await wizard(e2e.window).getByTestId('wizard-workflows-choice-analyze').click();
});

Then("the review shows the project's city and its backlog", async ({ e2e }) => {
  const page = e2e.window;
  await expect(review(page)).toBeVisible();
  await expect(review(page).getByTestId('wizard-review-city')).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(review(page).getByTestId('wizard-review-backlog')).toBeVisible();
});

When('I type the idea {string} in the review', async ({ e2e }, idea) => {
  await review(e2e.window).getByTestId('wizard-review-idea').fill(idea);
});

When('I finish the wizard', async ({ e2e }) => {
  await wizard(e2e.window).getByTestId('wizard-finish').click();
});

Then('the project wizard closes right away', async ({ e2e }) => {
  await expect(wizard(e2e.window)).toBeHidden({ timeout: FINISH_TIMEOUT });
});

Then('the project page shows the Next steps card', async ({ e2e }) => {
  await expect(nextSteps(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the project page does not show the Next steps card', async ({ e2e }) => {
  await expect(projectPage(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(nextSteps(e2e.window)).toHaveCount(0);
});

Then('the Next steps card offers {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  for (const words of [a, b, c]) {
    await expect(nextStepsEntry(e2e.window, words), `the Next steps entry "${words}"`).toBeVisible();
    await expect(nextStepsAction(e2e.window, words), `the button of the Next steps entry "${words}"`).toBeEnabled();
  }
});

Then('the Next steps card offers {string} and {string}', async ({ e2e }, a, b) => {
  for (const words of [a, b]) {
    await expect(nextStepsEntry(e2e.window, words), `the Next steps entry "${words}"`).toBeVisible();
    await expect(nextStepsAction(e2e.window, words), `the button of the Next steps entry "${words}"`).toBeEnabled();
  }
});

// mock-7: what phase 1 does not do yet (release CI, screenshots) stays visible, its button disabled
Then('the Next steps card shows {string} as coming later', async ({ e2e }, words) => {
  await expect(nextStepsEntry(e2e.window, words), `the Next steps entry "${words}"`).toBeVisible();
  await expect(nextStepsAction(e2e.window, words), `the button of the Next steps entry "${words}"`).toBeDisabled();
});

Then('the Next steps card shows {string} and {string} as coming later', async ({ e2e }, a, b) => {
  for (const words of [a, b]) {
    await expect(nextStepsEntry(e2e.window, words), `the Next steps entry "${words}"`).toBeVisible();
    await expect(nextStepsAction(e2e.window, words), `the button of the Next steps entry "${words}"`).toBeDisabled();
  }
});

When('I open the {string} entry of the Next steps card', async ({ e2e }, words) => {
  await nextStepsAction(e2e.window, words).click();
});

When('I dismiss the Next steps card', async ({ e2e }) => {
  await nextSteps(e2e.window).getByTestId('next-steps-dismiss').click();
});

// the idea typed in the review is kept as a local idea card of the Inbox (no issue on a provider)
Then('the Inbox lists the idea {string}', async ({ e2e }, title) => {
  const cards = e2e.window.getByTestId('inbox-list').getByTestId('inbox-card');
  await expect(cards.filter({ hasText: title })).toHaveCount(1, { timeout: LOAD_TIMEOUT });
});

// #630: step 3 "Analysis & workflows" (docs/work/first-project-onboarding/images/mock-4.jpg) shows the
// ways of working profile read from the git history and the suggested workflows.
// - data-testid="wizard-profile": the ways of working profile;
// - data-testid="wizard-workflow": one row per suggested workflow, data-kind="feature|fix|release|ci",
//   in that order; inside it wizard-workflow-reason (the "Why: ..." text) and wizard-workflow-select
//   (an enabled selector to change the workflow).
const workflowRows = (page) => wizard(page).getByTestId('wizard-workflow');

Then('the wizard suggests the workflows {string}, {string}, {string} and {string}', async ({ e2e }, a, b, c, d) => {
  const rows = workflowRows(e2e.window);
  await expect(rows).toHaveCount(4, { timeout: IMPORT_TIMEOUT });
  const kinds = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')));
  expect(kinds).toEqual([a, b, c, d]);
});

Then('each suggested workflow shows why it is suggested', async ({ e2e }) => {
  const rows = workflowRows(e2e.window);
  const count = await rows.count();
  expect(count, 'suggested workflows').toBeGreaterThan(0);
  const reasons = wizard(e2e.window).getByTestId('wizard-workflow-reason');
  await expect(reasons).toHaveCount(count);
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i).getByTestId('wizard-workflow-reason'), `the reason of workflow ${i + 1}`).toHaveText(/\S/);
  }
});

// a row's choices are tiles (wizard-workflow-tile, the picked one aria-pressed="true"); the row's
// wizard-workflow-select stays in the DOM, not shown, and follows the tiles
Then('I can change the suggested {string} workflow', async ({ e2e }, kind) => {
  const row = wizard(e2e.window).locator(`[data-testid="wizard-workflow"][data-kind="${kind}"]`);
  await expect(row).toHaveCount(1);
  const tiles = row.getByTestId('wizard-workflow-tile');
  await expect(tiles.first(), `the choices of the "${kind}" workflow`).toBeVisible();
  expect(await tiles.count(), `more than one choice for the "${kind}" workflow`).toBeGreaterThan(1);
  for (const tile of await tiles.all()) await expect(tile).toBeEnabled();
  await expect(row.locator('[data-testid="wizard-workflow-tile"][aria-pressed="true"]'), `one choice picked for the "${kind}" workflow`).toHaveCount(1);
  await expect(row.getByTestId('wizard-workflow-select'), `the selector of the "${kind}" workflow`).toBeEnabled();
});

// The profile's line (wizard-profile) is the profile job's row, listed only while the analysis runs. Once analyzed,
// what the profile found shows with the workflows it gives: the way of working on the lead line
// (wizard-way-of-working data-mode="local|remote|fork") and each row's reason
Then('the wizard shows the ways of working profile', async ({ e2e }) => {
  const column = workflowsColumn(e2e.window);
  await expect(column).toHaveAttribute('data-state', 'analyzed', { timeout: IMPORT_TIMEOUT });
  const way = column.getByTestId('wizard-way-of-working');
  await expect(way).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(way).toHaveAttribute('data-mode', /^(local|remote|fork)$/);
  await expect(way).toHaveText(/\S/);
});

// ---- #632: Create new project (docs/work/first-project-onboarding/images/mock-3.jpg, spec R4 / D5 B) ------
// - wizard-new-name: the project name; wizard-new-starts: the "Starts with" radios (value readme | empty),
//   named "README and .gitignore" / "Empty"; wizard-new-remote: "Also create a private repository on …"
//   (disabled with no gh / glab signed in, as in the simulated E2E app); wizard-new-remote-provider;
//   wizard-new-folder: the folder line "<workspace>/projects/<slug>";
// - data-testid="wizard-question" data-question="mode|ci|release": a question group, its title ("Where
//   changes land", "CI", "How you release") and its chips (class wizard-chip, role button, the chosen one
//   aria-pressed="true"), each chip reading its label first ("Local: merge here, push main").
// The repository is made in the scratch workspace (CRAFTORIO_WORKSPACE, features/support/app.js).

const question = (page, title) => wizard(page).getByTestId('wizard-question').filter({ hasText: title });
// an answer is a tile (wizard-chip: an icon, a short title, one line) whose accessible name is the answer's whole
// label ("Local merge, then push main")
const chip = (page, title, label) => question(page, title).getByRole('button', { name: label, exact: true });
const workspaceFolder = (e2e, rel) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  return path.join(e2e.scratch, 'workspace', ...rel.split('/'));
};
// git in the created repository, with no machine config (the scratch's empty one)
function gitIn(e2e, folder, args) {
  const config = path.join(e2e.scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config };
  return execFileSync('git', ['-C', folder, ...args], { env, encoding: 'utf8' }).trim();
}

When('I choose to create a new project in the wizard', async ({ e2e }) => {
  const page = e2e.window;
  await wizard(page).getByTestId('wizard-source-new').click();
  // a card may move on by itself, or wait for Next
  if ((await currentStep(page).getAttribute('data-step')) === 'start') await wizard(page).getByTestId('wizard-next').click();
  await expect(wizard(page).getByTestId('wizard-new-name')).toBeVisible();
});

When('I name the new project {string}', async ({ e2e }, name) => {
  await wizard(e2e.window).getByTestId('wizard-new-name').fill(name);
});

When('I start the new project with {string}', async ({ e2e }, label) => {
  const radio = wizard(e2e.window).getByRole('radio', { name: new RegExp(`^\\s*${escapeRe(label)}`) });
  await radio.check();
  await expect(radio).toBeChecked();
});

Then('the new project starts with {string}', async ({ e2e }, label) => {
  await expect(wizard(e2e.window).getByRole('radio', { name: new RegExp(`^\\s*${escapeRe(label)}`) })).toBeChecked();
});

// the folder line shows the workspace's projects folder and the name made a slug
Then('the new project will be created in {string} of the workspace', async ({ e2e }, rel) => {
  const tail = rel.split('/').map(escapeRe).join('[\\\\/]');
  await expect(wizard(e2e.window).getByTestId('wizard-new-folder')).toContainText(new RegExp(`${tail}\\s*$`));
});

When('I answer {string} to {string} in the wizard', async ({ e2e }, label, title) => {
  const button = chip(e2e.window, title, label);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

Then('the wizard asks {string} with {string} chosen', async ({ e2e }, title, label) => {
  const page = e2e.window;
  await expect(question(page, title)).toBeVisible();
  await expect(chip(page, title, label)).toHaveAttribute('aria-pressed', 'true');
  await expect(question(page, title).locator('[aria-pressed="true"]'), `one answer chosen for "${title}"`).toHaveCount(1);
});

Then('the private repository option cannot be ticked', async ({ e2e }) => {
  const remote = wizard(e2e.window).getByTestId('wizard-new-remote');
  await expect(remote).toBeVisible();
  await expect(remote).toBeDisabled();
  await expect(remote).not.toBeChecked();
});

Then('the next step of the wizard is unavailable', async ({ e2e }) => {
  await expect(wizard(e2e.window).getByTestId('wizard-next')).toBeDisabled();
});

Then("the workspace's {string} is a git repository with {string} and {string} committed on main", async ({ e2e }, rel, a, b) => {
  const folder = workspaceFolder(e2e, rel);
  await expect.poll(() => fs.existsSync(path.join(folder, '.git')), { message: `${rel} is a git repository`, timeout: IMPORT_TIMEOUT }).toBe(true);
  expect(gitIn(e2e, folder, ['rev-parse', '--abbrev-ref', 'HEAD']), 'the branch').toBe('main');
  const files = gitIn(e2e, folder, ['ls-tree', '--name-only', 'main']).split(/\r?\n/);
  expect(files).toEqual(expect.arrayContaining([a, b]));
  expect(Number(gitIn(e2e, folder, ['rev-list', '--count', 'main'])), 'commits on main').toBe(1);
});

Then("the workspace's {string} is a git repository with no commit", async ({ e2e }, rel) => {
  const folder = workspaceFolder(e2e, rel);
  await expect.poll(() => fs.existsSync(path.join(folder, '.git')), { message: `${rel} is a git repository`, timeout: IMPORT_TIMEOUT }).toBe(true);
  // git init only: HEAD names a branch with no commit yet
  expect(() => gitIn(e2e, folder, ['rev-parse', '--verify', '-q', 'HEAD']), 'no commit').toThrow();
});

Then("the workspace's {string} has no remote", async ({ e2e }, rel) => {
  expect(gitIn(e2e, workspaceFolder(e2e, rel), ['remote']), 'the remotes').toBe('');
});

// ---- #725: step 3's "Suggested workflows" column: two choices first, an analyzing look, failed jobs -------
// What the screen exposes (to be added by #725):
// - wizard-workflows-column: the right column (its heading, the choices or the rows, the analyzing notice);
// - wizard-workflows-choice-analyze / wizard-workflows-choice-manual: the two choices, buttons named
//   "Analyze the repository" / "Define manually", shown until one is chosen (no row before);
// - wizard-workflows-rows: the rows' list (the wizard-workflow rows of #630), aria-busy="true" while dimmed;
// - wizard-workflows-analyzing (#781): the role="status" wrapper over the dimmed rows, holding
//   wizard-analysis-phases and its three activity lines (no spinner in the column);
// - a failed job's row of the left column (data-part="<job>", as the cost's parts) holds
//   wizard-job-error-<job> (the reason under its title) and wizard-job-retry-<job> (Retry:
//   api.retryOnboarding(projectId)); its amount reads "—";
// - wizard-next: the footer's Continue to the review, enabled all along step 3; wizard-analyze is gone.
//
// E2E HOOKS THE DEVELOPER MUST ADD (none exists yet), read by the simulated onboarding's jobs
// (packages/engine/service/areas/project-onboarding.js, its `jobs`, only when CRAFTORIO_SIMULATION_ONLY=1):
// - CRAFTORIO_E2E_ONBOARDING_HOLD=<job>[,<job>]: that job stays `running` until the app closes (a promise
//   that never settles), so its in-progress look can be checked and screenshotted;
// - CRAFTORIO_E2E_ONBOARDING_FAIL=<job>[,<job>]: that job throws "The simulated <job> failed (e2e)."
//   so it ends `failed` with that error as its reason (a Retry fails again the same way).

// the analyses in the owner's words → the onboarding's job ids
const ONBOARDING_JOB = { 'ways of working': 'profile', 'project map': 'projectMap', facts: 'facts' };
const jobId = (words) => {
  const id = ONBOARDING_JOB[words];
  if (!id) throw new Error(`unknown analysis "${words}": one of ${Object.keys(ONBOARDING_JOB).join(', ')}`);
  return id;
};
const WORKFLOW_CHOICE = { 'Analyze with AI': 'wizard-workflows-choice-analyze', 'Define manually': 'wizard-workflows-choice-manual' };
const choiceTestid = (label) => {
  const id = WORKFLOW_CHOICE[label];
  if (!id) throw new Error(`unknown choice "${label}": one of ${Object.keys(WORKFLOW_CHOICE).join(', ')}`);
  return id;
};
const workflowsColumn = (page) => wizard(page).getByTestId('wizard-workflows-column');
const jobRow = (page, words) => wizard(page).getByTestId('wizard-cost').locator(`[data-part="${jobId(words)}"]`);

Given('the app is open while the {string} analysis keeps running', async ({ e2e }, words) => {
  await e2e.open({ env: { CRAFTORIO_E2E_ONBOARDING_HOLD: jobId(words) } });
});

// #852: two jobs held at once (CRAFTORIO_E2E_ONBOARDING_HOLD takes a comma-separated list)
Given('the app is open while the {string} and {string} analyses keep running', async ({ e2e }, a, b) => {
  await e2e.open({ env: { CRAFTORIO_E2E_ONBOARDING_HOLD: [jobId(a), jobId(b)].join(',') } });
});

Given('the app is open where the {string} analysis fails', async ({ e2e }, words) => {
  await e2e.open({ env: { CRAFTORIO_E2E_ONBOARDING_FAIL: jobId(words) } });
});

Then("the wizard's suggested workflows offer {string} and {string} and no workflow yet", async ({ e2e }, a, b) => {
  const column = workflowsColumn(e2e.window);
  await expect(column).toBeVisible({ timeout: IMPORT_TIMEOUT });
  for (const label of [a, b]) {
    const choice = column.getByTestId(choiceTestid(label));
    await expect(choice, `the choice "${label}"`).toBeVisible();
    await expect(choice).toBeEnabled();
    await expect(choice).toContainText(label);
  }
  await expect(column.getByTestId('wizard-workflow'), 'no workflow row before a choice').toHaveCount(0);
});

When("I choose {string} in the wizard's suggested workflows", async ({ e2e }, label) => {
  const choice = workflowsColumn(e2e.window).getByTestId(choiceTestid(label));
  await expect(choice).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await choice.click();
});

// #781: the "ways of working" job is held before it reads anything, so the git history's line runs and the
// other two wait (OnboardingModel.analysisPhases: a running job with no interview yet)
// While the profile job runs (wizard-analysis data-state="analyzing") the rows wait in the DOM (aria-busy, inert),
// not shown: the column shows the analysis phases, and wizard-cost the progress and the jobs
Then("the wizard's suggested workflows wait, not shown, under the analysis phases, with no spinner", async ({ e2e }) => {
  const column = workflowsColumn(e2e.window);
  await expect(column).toHaveAttribute('data-state', 'analyzing');
  const analyzing = column.getByTestId('wizard-workflows-analyzing');
  await expect(analyzing).toBeVisible();
  await expect(analyzing).toHaveRole('status');
  const phases = analyzing.getByTestId('wizard-analysis-phases');
  await expect(phases).toBeVisible();
  const git = phases.getByTestId('wizard-phase-git');
  await expect(git).toHaveAttribute('data-state', 'running');
  await expect(git).toContainText(/git history/i);
  const files = phases.getByTestId('wizard-phase-files');
  await expect(files).toHaveAttribute('data-state', 'pending');
  await expect(files).toContainText(/files/i);
  const oracle = phases.getByTestId('wizard-phase-oracle');
  await expect(oracle).toHaveAttribute('data-state', 'pending');
  await expect(oracle).toContainText(/Oracle/);
  await expect(column.locator('.spinner'), 'no spinner in the column').toHaveCount(0);
  const rows = column.getByTestId('wizard-workflows-rows');
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute('aria-busy', 'true');
  await expect(rows, 'the rows are not shown while the analysis runs').toBeHidden();
  // the progress of the analysis, over its jobs
  const cost = wizard(e2e.window).getByTestId('wizard-cost');
  await expect(cost.getByTestId('wizard-progress')).toBeVisible();
  await expect(cost.locator('[data-part="profile"]')).toBeVisible();
  await expect(cost.locator('[data-part="projectMap"]')).toBeVisible();
});

// #100: Continue waits for the workflows to be defined, by hand or by the analysis: disabled on the two choices
Then('the wizard does not let me continue before the workflows are defined', async ({ e2e }) => {
  const page = e2e.window;
  await expect(workflowsColumn(page)).toHaveAttribute('data-state', /^(choose|failed)$/, { timeout: IMPORT_TIMEOUT });
  const next = footer(page).getByTestId('wizard-next');
  await expect(next).toBeVisible();
  await expect(next).toContainText(/Continue/i);
  await expect(next).toBeDisabled();
});

Then("the wizard's suggested workflows are not dimmed", async ({ e2e }) => {
  const column = workflowsColumn(e2e.window);
  await expect(column.getByTestId('wizard-workflows-rows')).toBeVisible();
  await expect(column.getByTestId('wizard-workflows-rows')).not.toHaveAttribute('aria-busy', 'true');
  await expect(column.getByTestId('wizard-workflows-analyzing')).toHaveCount(0);
});

// the footer's Continue to the review, on step 3 whatever the analysis is doing
Then('the wizard lets me continue to the review', async ({ e2e }) => {
  const page = e2e.window;
  const next = footer(page).getByTestId('wizard-next');
  await expect(next).toBeVisible();
  await expect(next).toBeEnabled();
  await expect(next).toContainText(/Continue/i);
  await expect(wizard(page).getByTestId('wizard-analyze'), '"Analyze and continue" is gone').toHaveCount(0);
});

// modelled on "the sidebar looks like the baseline" (sidebar-footer.steps.js): the column only (the left
// one shows the scratch folder's repository URL, which changes per run)
Then("the wizard's suggested workflows look like the baseline {string}", async ({ e2e }, name) => {
  await expect(workflowsColumn(e2e.window)).toHaveScreenshot(name);
});

Then("the wizard's {string} analysis says why it failed and offers to retry it", async ({ e2e }, words) => {
  const id = jobId(words);
  const row = jobRow(e2e.window, words);
  await expect(row.getByTestId(`wizard-job-error-${id}`)).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(row.getByTestId(`wizard-job-error-${id}`)).toHaveText(/\S/);
  const retry = row.getByTestId(`wizard-job-retry-${id}`);
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await expect(retry).toContainText(/Retry/i);
});

Then("the wizard's {string} analysis shows no amount", async ({ e2e }, words) => {
  const row = jobRow(e2e.window, words);
  await expect(row).toContainText('—');
  await expect(row).not.toContainText(AMOUNT);
});

Then('the wizard does not offer to analyze everything again', async ({ e2e }) => {
  const w = wizard(e2e.window);
  await expect(w.getByTestId('wizard-analyze')).toHaveCount(0);
  await expect(w.getByTestId('wizard-workflows-choice-analyze')).toHaveCount(0);
  await expect(w.getByRole('button', { name: /analy[sz]e (everything|all|again)|analy[sz]e and continue/i })).toHaveCount(0);
});

// ---- #726: the suggested workflows column in the interface language ------------------------------------
// Every text of step 3's "Suggested workflows" column (and the left column's ways of working profile line)
// follows the interface language: the reasons, the selectors' options, the "Why" of each reason. What the
// screen exposes:
// - data-testid="wizard-workflow-why" (new): in each wizard-workflow row with a reason, the word "Why:" /
//   "Por quê:" as an element of its own, bold and in the accent colour (var(--accent)), before the reason;
// - wizard-workflow-select's options: the labels of packages/shared/onboarding-model.js CHOICES, now read
//   from the catalogs (an entry whose English value is the label, e.g. "Local merge · E2E first").
// A language switch with the wizard open: what Settings › General › Language saves (window.api.setSettings,
// 'settings:set'), pushed to every window as 'settings:changed' (packages/ui-kit/interface-language.js);
// the wizard re-renders in the new language and keeps the owner's picks (cur.workflows).
// The expected text in a language is read from the catalogs (packages/shared/i18n/<lang>.json), as
// interface-language.steps.js does, so the steps never depend on the Portuguese wording.

const I18N_DIR = path.join(__dirname, '..', '..', 'packages', 'shared', 'i18n');
const LANGUAGE_CODES = { English: 'en', 'Português (Brasil)': 'pt-BR' };
const languageCode = (language) => {
  const code = LANGUAGE_CODES[language];
  if (!code) throw new Error(`no catalog for the language "${language}" (known: ${Object.keys(LANGUAGE_CODES).join(', ')})`);
  return code;
};
const catalogOf = (code) => JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${code}.json`), 'utf8'));
// the texts an English label reads as in the language (one per catalog entry carrying the label)
function inLanguage(english, language) {
  const code = languageCode(language);
  if (code === 'en') return [english];
  const en = catalogOf('en');
  const other = catalogOf(code);
  const keys = Object.keys(en).filter((k) => en[k] === english && typeof other[k] === 'string');
  if (!keys.length) throw new Error(`no catalog entry has the English text "${english}" with a ${language} value: the wizard's workflows are not translated yet`);
  return [...new Set(keys.map((k) => other[k]))];
}
const workflowRow = (page, kind) => wizard(page).locator(`[data-testid="wizard-workflow"][data-kind="${kind}"]`);
const WIZARD_PART = {
  'suggested workflows': (page) => workflowsColumn(page),
  // what step 3 shows of the profile once analyzed: the way of working (the profile's mode) on the lead line
  'ways of working profile': (page) => wizard(page).getByTestId('wizard-way-of-working'),
  // #23: step 4, the review (its cards, the language legend, the idea's help line)
  review: (page) => review(page),
};

// none of the texts anywhere in the element: its text, its titles and aria-labels (case-sensitive)
async function expectNoEnglishTexts(el, table, what) {
  await expect(el).toBeVisible({ timeout: IMPORT_TIMEOUT });
  const texts = table.raw().map((r) => String(r[0] || '').trim()).filter(Boolean);
  await expect.poll(async () => {
    const all = await el.evaluate((n) => [n, ...n.querySelectorAll('*')]
      .map((x) => `${x === n ? x.textContent : ''} ${x.getAttribute('title') || ''} ${x.getAttribute('aria-label') || ''}`).join(' '));
    return texts.filter((t) => all.includes(t));
  }, { message: `English texts left in ${what}`, timeout: LOAD_TIMEOUT }).toEqual([]);
}

// every row (feature, fix, release, CI) once analyzed: its "Why" label, an element of its own before the reason's
// text. The layout rework (2026-11-26, project-wizard.css `.wizard-analysis .wizard-workflow-why`) took its accent
// colour and bold away (#726 had asked for them): it now reads in the reason's muted colour, set apart by a
// heavier weight only, which is what is checked
Then('every suggested workflow shows its {string} label, set apart from the reason', async ({ e2e }, label) => {
  const page = e2e.window;
  const rows = workflowRows(page);
  await expect(rows).toHaveCount(4, { timeout: IMPORT_TIMEOUT });
  await expect(wizard(page).getByTestId('wizard-workflow-why'), 'a "Why" label in every row').toHaveCount(4, { timeout: IMPORT_TIMEOUT });
  for (let i = 0; i < 4; i++) {
    const row = rows.nth(i);
    const kind = await row.getAttribute('data-kind');
    const why = row.getByTestId('wizard-workflow-why');
    await expect(why, `the "${kind}" workflow's label`).toBeVisible();
    await expect(why, `the "${kind}" workflow's label`).toHaveText(label);
    const look = await why.evaluate((el) => {
      const weightOf = (x) => { const w = getComputedStyle(x).fontWeight; return Number(w) || (w === 'bold' ? 700 : 400); };
      return { own: el.children.length === 0 && el.parentElement !== null, weight: weightOf(el), around: weightOf(el.parentElement) };
    });
    expect(look.own, `the "${kind}" workflow's label is an element of its own`).toBe(true);
    expect(look.weight, `the "${kind}" workflow's label heavier than its reason's text`).toBeGreaterThan(look.around);
    const reason = (await row.getByTestId('wizard-workflow-reason').innerText()).replace(label, '').trim();
    expect(reason, `the "${kind}" workflow's reason after its label`).toMatch(/\S/);
  }
});

// none of the texts (one per row of the table) anywhere in that part of the wizard: its text, its
// selectors' options, its titles and aria-labels
Then("the wizard's {string} shows none of these English texts:", async ({ e2e }, part, table) => {
  const locate = WIZARD_PART[part];
  if (!locate) throw new Error(`unknown part of the wizard "${part}": one of ${Object.keys(WIZARD_PART).join(', ')}`);
  await expectNoEnglishTexts(locate(e2e.window), table, `the wizard's ${part}`);
});

// #23: the Next steps card on the project page after Finish (project-next-steps), e.g. with the interface in
// Português (Brasil) its idea entry says "Caixa de entrada", never "Inbox"
Then('the Next steps card shows none of these English texts:', async ({ e2e }, table) => {
  await expectNoEnglishTexts(nextSteps(e2e.window), table, 'the Next steps card');
});

Then('the Next steps card says {string}', async ({ e2e }, text) => {
  await expect(nextSteps(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(nextSteps(e2e.window)).toContainText(text, { timeout: LOAD_TIMEOUT });
});

// #30: a repository imported with a lockfile and no node_modules: the card's entry
// data-testid="next-step-install-deps" (NEW) names the install command (npm ci, with --ignore-scripts
// when the project's "install without scripts" setting is on) and its button installs them
Then('the Next steps card offers to install the dependencies with {string}', async ({ e2e }, command) => {
  const entry = nextSteps(e2e.window).getByTestId('next-step-install-deps');
  await expect(entry).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(entry).toContainText(command);
  await expect(entry.getByRole('button').first()).toBeEnabled();
});

// A row's choices are tiles (wizard-workflow-tile data-value="<variant>", its title the choice's whole label, the
// picked one aria-pressed="true"); the row's select (wizard-workflow-select) is not shown and follows the pick
const workflowTiles = (page, kind) => workflowRow(page, kind).getByTestId('wizard-workflow-tile');
const pickedTile = (page, kind) => workflowRow(page, kind).locator('[data-testid="wizard-workflow-tile"][aria-pressed="true"]');

When('I pick {string} for the suggested {string} workflow', async ({ e2e }, label, kind) => {
  const page = e2e.window;
  const tiles = workflowTiles(page, kind);
  await expect(tiles.first()).toBeEnabled({ timeout: IMPORT_TIMEOUT });
  const value = await tiles.evaluateAll((els, l) => els.find((el) => (el.getAttribute('title') || '').trim() === l)?.getAttribute('data-value') ?? null, label);
  if (value == null) throw new Error(`the "${kind}" workflow offers no "${label}"`);
  await workflowRow(page, kind).locator(`[data-testid="wizard-workflow-tile"][data-value="${value}"]`).click();
  await expect(pickedTile(page, kind)).toHaveAttribute('data-value', value);
  await expect(workflowRow(page, kind).getByTestId('wizard-workflow-select')).toHaveValue(value);
  e2e.workflowPicks = { ...(e2e.workflowPicks || {}), [kind]: { label, value } };
});

When('the interface language is switched to {string} while the wizard stays open', async ({ e2e }, language) => {
  const code = languageCode(language);
  const page = e2e.window;
  await expect(wizard(page)).toBeVisible();
  await page.evaluate(async (c) => { await window.api.setSettings({ language: { interface: c } }); }, code);
  await expect(page.locator('html')).toHaveAttribute('lang', code === 'en' ? /^en/ : code, { timeout: LOAD_TIMEOUT });
  await expect(wizard(page), 'the wizard stays open').toBeVisible();
  await expect(currentStep(page)).toHaveAttribute('data-step', 'analysis');
});

// the same pick (the option's value), its label now in the language
Then('the suggested {string} workflow still has {string} picked, read in {string}', async ({ e2e }, kind, label, language) => {
  const pick = e2e.workflowPicks?.[kind];
  if (!pick || pick.label !== label) throw new Error(`no "${label}" was picked for the "${kind}" workflow: use "I pick {string} for the suggested {string} workflow" first`);
  const tile = pickedTile(e2e.window, kind);
  await expect(tile).toHaveAttribute('data-value', pick.value, { timeout: LOAD_TIMEOUT });
  const texts = inLanguage(label, language);
  await expect(tile).toHaveAttribute('title', new RegExp(`^\\s*(${texts.map(escapeRe).join('|')})\\s*$`), { timeout: LOAD_TIMEOUT });
  await expect(tile).toBeVisible();
  await expect(workflowRow(e2e.window, kind).getByTestId('wizard-workflow-select')).toHaveValue(pick.value);
});

// #741: the wizard reopened on an unfinished onboarding (its Continue, or New project with the same URL)
// shows the pick made before it was closed: the same option, read in English
Then('the suggested {string} workflow still has {string} picked', async ({ e2e }, kind, label) => {
  const pick = e2e.workflowPicks?.[kind];
  if (!pick || pick.label !== label) throw new Error(`no "${label}" was picked for the "${kind}" workflow: use "I pick {string} for the suggested {string} workflow" first`);
  const tile = pickedTile(e2e.window, kind);
  await expect(tile).toHaveAttribute('data-value', pick.value, { timeout: IMPORT_TIMEOUT });
  await expect(tile).toHaveAttribute('title', new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
  await expect(tile).toBeVisible();
  await expect(workflowRow(e2e.window, kind).getByTestId('wizard-workflow-select')).toHaveValue(pick.value);
});

// ---- #724: the tray never covers the wizard; #739: the name from the URL; #743: cloning in place ---------
// What the screens expose (#724 / #743):
// - wizard-spinner: the circular spinner of a running import inside the wizard's footer, in
//   wizard-clone-progress (the import's name and state; data-status="running|done|failed" = the clone
//   job's status; when failed its reason and a role="button" named /Retry/) or in wizard-next while it
//   reads "Cloning <name>…" (#743: the Repository step's Next turned into the cloning state; disabled only
//   while the start call is in flight, then a click goes on to the analysis with the clone running);
// - wizard-panel: the dialog's panel (.wizard-panel), measured for its size on every step;
// - tray-spinner: the spinner of a running import's tray-item;
// - the toast "<name> imported" (the shell's data-testid="toast") with its button "Open the project".
// The tray (onboarding-tray) is hidden while the wizard is open, whatever the imports' states.
//
// The E2E hooks of the clone, read by the simulated onboarding (packages/engine/service/areas/
// project-onboarding.js, only when CRAFTORIO_SIMULATION_ONLY=1):
// - CRAFTORIO_E2E_ONBOARDING_HOLD=clone: the clone stays running (status cloning) until the app closes;
// - CRAFTORIO_E2E_ONBOARDING_CLONE_DELAY_MS=<ms>: the clone waits that long, then runs as usual.

const CLONING = (name) => new RegExp(`Cloning\\s+${escapeRe(name)}\\s*(…|\\.\\.\\.)`);
// the size of the wizard's panel, unchanged to the pixel
const SIZE_TOLERANCE = 1;
const panel = (page) => wizard(page).getByTestId('wizard-panel');

Given('the app is open while the clone of an import keeps running', async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_ONBOARDING_HOLD: 'clone' } });
});

Given('the app is open where the clone of an import takes {int} seconds', async ({ e2e }, seconds) => {
  await e2e.open({ env: { CRAFTORIO_E2E_ONBOARDING_CLONE_DELAY_MS: String(seconds * 1000) } });
});

Then('the progress tray is not shown', async ({ e2e }) => {
  await expect(tray(e2e.window)).toBeHidden();
});

Then('the progress tray does not list the project {string}', async ({ e2e }, name) => {
  // a finished import leaves the tray about 5 s after it ended
  await expect(trayItem(e2e.window, name)).toHaveCount(0, { timeout: IMPORT_TIMEOUT });
});

Then('the progress tray shows the project {string} as {word} with a spinner', async ({ e2e }, name, status) => {
  const page = e2e.window;
  await expect(tray(page)).toBeVisible({ timeout: IMPORT_TIMEOUT });
  const item = trayItem(page, name);
  await expect(item).toHaveAttribute('data-status', status, { timeout: IMPORT_TIMEOUT });
  await expect(item).toBeVisible();
  await expect(item.getByTestId('tray-spinner')).toBeVisible();
});

// the import's progress inside the wizard: the footer's clone progress, or (#743) the action button
// cloning in place, holding the name and a spinner
Then('the wizard shows the import of {string} running with a spinner', async ({ e2e }, name) => {
  const progress = footer(e2e.window).locator('[data-testid="wizard-clone-progress"], [data-testid="wizard-next"]')
    .filter({ hasText: name }).filter({ has: e2e.window.getByTestId('wizard-spinner') });
  await expect(progress.first()).toBeVisible({ timeout: IMPORT_TIMEOUT });
});

Then('the wizard shows the import of {string} as {word}', async ({ e2e }, name, status) => {
  const progress = footer(e2e.window).getByTestId('wizard-clone-progress');
  await expect(progress).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(progress).toContainText(name);
  await expect(progress).toHaveAttribute('data-status', status, { timeout: IMPORT_TIMEOUT });
});

// The footer's clone progress is for a clone still running or failed: once done it keeps its place and its state
// (data-status="done", "Clone of <name>") but is not shown any more
Then('the wizard has the import of {string} done, its progress no longer shown', async ({ e2e }, name) => {
  const progress = footer(e2e.window).getByTestId('wizard-clone-progress');
  await expect(progress).toHaveAttribute('data-status', 'done', { timeout: IMPORT_TIMEOUT });
  await expect(progress).toContainText(name);
  await expect(progress).toBeHidden();
  await expect(footer(e2e.window).getByTestId('wizard-spinner')).toHaveCount(0);
});

// the step's action (Next / the cloning state) is on screen and the topmost element at its centre is
// the button itself (or inside it): no tray, toast or panel over it
Then("the wizard's action button is visible and nothing covers it", async ({ e2e }) => {
  const action = footer(e2e.window).getByTestId('wizard-next');
  await expect(action).toBeVisible();
  await expect(action).toBeInViewport({ ratio: 1 });
  const onTop = await action.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(top && (top === el || el.contains(top)));
  });
  expect(onTop, 'the action button is the topmost element at its centre').toBe(true);
});

Then('the app says {string} and offers to open the project', async ({ e2e }, words) => {
  const toast = e2e.window.getByTestId('toast');
  await expect(toast).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(toast).toContainText(words);
  await expect(toast.getByRole('button', { name: /Open the project/i })).toBeVisible();
});

When('I open the project from the {string} notice', async ({ e2e }, words) => {
  const toast = e2e.window.getByTestId('toast').filter({ hasText: words });
  await toast.getByRole('button', { name: /Open the project/i }).click();
});

// #739: a paste through the clipboard (Ctrl / Cmd+V), as the owner does
When('I paste the repository {string} in the wizard', async ({ e2e }, repo) => {
  const field = wizard(e2e.window).getByTestId('wizard-repo');
  await e2e.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), repo);
  await field.click();
  await field.press('ControlOrMeta+A');
  await field.press('ControlOrMeta+V');
  await expect(field).toHaveValue(repo);
});

// typed key by key (the URL replaces what the field held)
When('I type the repository {string} in the wizard', async ({ e2e }, repo) => {
  const field = wizard(e2e.window).getByTestId('wizard-repo');
  await field.clear();
  await field.pressSequentially(repo);
  await expect(field).toHaveValue(repo);
});

When('I type the project name {string} in the wizard', async ({ e2e }, name) => {
  const field = wizard(e2e.window).getByTestId('wizard-name');
  await field.clear();
  await field.pressSequentially(name);
});

Then("the wizard's project name reads {string}", async ({ e2e }, name) => {
  await expect(wizard(e2e.window).getByTestId('wizard-name')).toHaveValue(name);
});

// #743
When("I note the wizard's size", async ({ e2e }) => {
  await expect(panel(e2e.window)).toBeVisible();
  e2e.wizardSize = await panel(e2e.window).boundingBox();
});

Then('the wizard has the size I noted', async ({ e2e }) => {
  if (!e2e.wizardSize) throw new Error('no size noted: use "I note the wizard\'s size" first');
  // the panel is drawn again on each step change: wait for it before measuring
  await expect(panel(e2e.window)).toBeVisible();
  // a redraw between the check above and the measure leaves no box for a moment: measure until there is one
  let box = null;
  await expect.poll(async () => { box = await panel(e2e.window).boundingBox(); return box !== null; }, { message: 'the wizard panel is on screen' }).toBe(true);
  expect(Math.abs(box.width - e2e.wizardSize.width), `the width ${box.width} vs ${e2e.wizardSize.width}`).toBeLessThanOrEqual(SIZE_TOLERANCE);
  expect(Math.abs(box.height - e2e.wizardSize.height), `the height ${box.height} vs ${e2e.wizardSize.height}`).toBeLessThanOrEqual(SIZE_TOLERANCE);
});

Then("the wizard's action button shows a spinner and {string}", async ({ e2e }, text) => {
  const action = footer(e2e.window).getByTestId('wizard-next');
  const name = text.replace(/^Cloning\s+/, '').replace(/\s*(…|\.\.\.)$/, '');
  await expect(action).toContainText(text.startsWith('Cloning') ? CLONING(name) : text, { timeout: IMPORT_TIMEOUT });
  await expect(action.getByTestId('wizard-spinner')).toBeVisible();
});

Then('the wizard shows no import status card and its repository fields are read-only', async ({ e2e }) => {
  const w = wizard(e2e.window);
  await expect(w.getByTestId('wizard-import-status')).toHaveCount(0);
  const repo = w.getByTestId('wizard-repo');
  await expect(repo).toHaveCount(1);
  if ((await repo.getAttribute('type')) === 'hidden') {
    // a local repository (file://): step 2 shows its folder (wizard-folder-path) instead of a URL field, and
    // Change folder (wizard-folder-change) is off from Next on
    await expect(w.getByTestId('wizard-folder-path')).toBeVisible();
    await expect(w.getByTestId('wizard-folder-change')).toBeDisabled();
  } else await expect(repo).not.toBeEditable();
  await expect(w.getByTestId('wizard-name')).not.toBeEditable();
});

// ---- #731: the onboarding's city analysis draws the city plan ----------------------------------------------
// The "Cidade e arquitetura" job (projectMap) draws the city plan (the cartographer's city-plan.json, as the
// Architecture tab's "Analyze this project" does), then runs the Oracle. Once it is done the project's City
// is grouped by the plan's districts, not by folder. What the screen exposes (existing test ids):
// - the review's "Open the city" (wizard-open-city) finishes the wizard and opens the project's
//   City tab (#730; window.ProjectArchitecture.openCity);
// - the City tab: project-city-header ("<n> districts", "plan covers <share>"), no project-city-no-plan;
//   its action (architecture-analyze or project-city-analyze; #782: "Analyze again" on a current plan) is
//   offered with a plan too, its title the refresh one ("a refresh keeps the names you saw").
//
// E2E HOOK THE DEVELOPER MUST ADD, read by the simulated onboarding's projectMap job only when
// CRAFTORIO_SIMULATION_ONLY=1: CRAFTORIO_E2E_CITY_PLAN_FAIL=1 makes drawing the city plan throw
// "The simulated city plan failed (e2e)." so the job ends `failed` with that reason (a Retry fails again).

// #730: the City is a tab of its own (#project-panel-city); the Architecture tab is gone
const architectureTab = (page) => projectPage(page).locator('#project-panel-architecture, #project-panel-city').filter({ visible: true }).first();
const cityPart = (page, id) => architectureTab(page).getByTestId(id).filter({ visible: true }).first();

Given('the app is open where drawing the city plan fails', async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_CITY_PLAN_FAIL: '1' } });
});

When('I open the city from the review', async ({ e2e }) => {
  const open = review(e2e.window).getByTestId('wizard-open-city');
  await expect(open).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(open).toBeEnabled();
  await open.click();
});

Then('the city is drawn from its plan, with its districts', async ({ e2e }) => {
  const header = cityPart(e2e.window, 'project-city-header');
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(header, 'the city is grouped by the plan').toContainText(/plan covers/i, { timeout: LOAD_TIMEOUT });
  await expect(header).toContainText(/\b[1-9]\d*\s+districts?\b/i);
  await expect(architectureTab(e2e.window).getByTestId('project-city-no-plan')).toHaveCount(0);
});

Then('the City tab does not say there is no city plan yet', async ({ e2e }) => {
  const tab = architectureTab(e2e.window);
  await expect(tab).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(tab.getByTestId('project-city-no-plan')).toHaveCount(0);
  await expect(tab.getByText(/no city plan yet/i).filter({ visible: true })).toHaveCount(0);
});

// #730: the City tab's action (its own "architecture-analyze", or the city's "project-city-analyze"), shown
// with a plan too, its title the refresh one ("a refresh keeps the names you saw")
Then('the City tab offers {string} only as a refresh of the city plan', async ({ e2e }, label) => {
  const button = architectureTab(e2e.window).locator('[data-testid="architecture-analyze"], [data-testid="project-city-analyze"]').filter({ visible: true }).first();
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toContainText(label);
  await expect(button, 'the refresh title').toHaveAttribute('title', /refresh/i);
});

Then("the wizard's {string} analysis gives a reason that mentions {string}", async ({ e2e }, words, text) => {
  const error = jobRow(e2e.window, words).getByTestId(`wizard-job-error-${jobId(words)}`);
  await expect(error).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(error).toContainText(new RegExp(escapeRe(text), 'i'));
});

// ---- #730: no refactor ranking in the analysis; the review files the Oracle's findings -----------------------
// The analysis's jobs are the free part and the project map (the city plan, then the Oracle): no "ranking" job,
// so wizard-cost has no data-part="ranking" row and no word of a ranking or of the Product Owner. The findings of
// the Oracle's report are sent nowhere on their own. What the review exposes (to be added by #730):
// - data-testid="wizard-review-findings": the findings' list, one data-testid="wizard-review-finding" per
//   finding (its title), each with the buttons data-testid="wizard-review-create-issue" ("Create issue")
//   and "wizard-review-create-issue-prioritize" ("Create issue and prioritize"); once filed, the link
//   data-testid="wizard-review-finding-issue" ("#<n>", and the roadmap stage when prioritized) takes the
//   buttons' place (the same ids as fronts/build/test/project-wizard-findings-730.test.js).

const REVIEW_FINDING_BUTTONS = { 'Create issue': 'wizard-review-create-issue', 'Create issue and prioritize': 'wizard-review-create-issue-prioritize' };
const reviewFindings = (page) => review(page).getByTestId('wizard-review-findings').getByTestId('wizard-review-finding');

// Step 3 lists its jobs (wizard-cost) only while the analysis runs or after a job failed: whatever it shows, no
// part is a ranking and no word of one is said; when the jobs are listed, the project map is one of them
Then("the wizard's analysis has no refactor ranking row", async ({ e2e }) => {
  const w = wizard(e2e.window);
  await expect(workflowsColumn(e2e.window)).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(w.locator('[data-part="ranking"]'), 'no ranking row').toHaveCount(0);
  await expect(w.getByText(/ranking|Product Owner/i), 'no word of a ranking').toHaveCount(0);
  const jobs = w.getByTestId('wizard-cost').getByRole('listitem');
  if (await jobs.count()) await expect(w.getByTestId('wizard-cost').locator('[data-part="projectMap"]'), 'the project map row').toBeVisible();
});

// the review's costs (wizard-review-costs): one line per analysis that ran, the project map among them, no ranking
Then("the review's analysis costs list the project map and no refactor ranking", async ({ e2e }) => {
  const costs = review(e2e.window).getByTestId('wizard-review-costs');
  await expect(costs).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(costs.locator('[data-part="projectMap"]'), 'the project map line').toBeVisible();
  await expect(costs.locator('[data-part="ranking"]'), 'no ranking line').toHaveCount(0);
  await expect(costs.getByText(/ranking|Product Owner/i), 'no word of a ranking').toHaveCount(0);
});

Then("the review lists the Oracle's findings, each with {string} and {string}", async ({ e2e }, a, b) => {
  const rows = reviewFindings(e2e.window);
  await expect(rows.first()).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  for (const row of await rows.all()) {
    await expect(row, 'the finding has a title').toHaveText(/\S/);
    for (const label of [a, b]) {
      const id = REVIEW_FINDING_BUTTONS[label];
      if (!id) throw new Error(`unknown finding button "${label}": one of ${Object.keys(REVIEW_FINDING_BUTTONS).join(', ')}`);
      const button = row.getByTestId(id);
      await expect(button, `the finding's "${label}"`).toHaveRole('button');
      await expect(button).toHaveAccessibleName(new RegExp(`^\\s*${escapeRe(label)}\\s*$`, 'i'));
      await expect(button).toBeEnabled();
    }
  }
  // the old refactor backlog with its pick is gone
  await expect(review(e2e.window).getByTestId('wizard-review-refactor')).toHaveCount(0);
});

Then('no finding of the review has an issue yet', async ({ e2e }) => {
  await expect(reviewFindings(e2e.window).first()).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(review(e2e.window).getByTestId('wizard-review-finding-issue')).toHaveCount(0);
});

// ---- #744: the Next steps card's PO step, no empty refactors step, the reason of a disabled step ---------------------
// What the card exposes (project-next-steps, as #642):
// - its entries keep data-testid="next-step-<id>" (the PO's first: next-step-po-issue, as the unit tests of
//   #744 name it), each holding its button; the testids nested in an entry (next-step-po-issue-open,
//   next-step-po-issue-link, next-step-reason) hold no button, so the entries are the "next-step-…" holding one;
// - the PO entry reads "Create an issue with the PO", its button "Open the PO": the Product Owner's drawer
//   (aside "Product Owner") opens on "Register an issue" (its "Registering an issue for <name>" line; #785: the
//   mode toggle is gone), for the card's project, its message box (agent-chat-input) focused;
// - with no refactor proposals (once read) there is no next-step-refactors entry and no "… and add 0" button;
// - a disabled button's reason: its title (or its wrapper's, as a disabled button gets no hover), the same text
//   shown as a line of the entry.
const nextStepsEntries = (page) => nextSteps(page).getByTestId(/^next-step-/).filter({ has: page.getByRole('button') });
const poChat = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });

Then('the first step of the Next steps card is {string} with the button {string}', async ({ e2e }, title, label) => {
  const first = nextStepsEntries(e2e.window).first();
  await expect(first).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(first).toContainText(title);
  const button = first.getByRole('button', { name: label, exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
});

When('I click {string} in the Next steps card', async ({ e2e }, label) => {
  await nextSteps(e2e.window).getByRole('button', { name: label, exact: true }).click();
});

Then("the Product Owner's chat is open on {string} for the project {string}", async ({ e2e }, mode, name) => {
  expect(mode, 'the only thing this step checks').toBe('Register an issue');
  const drawer = poChat(e2e.window);
  await expect(drawer).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(drawer).toContainText(`Registering an issue for ${name}`, { timeout: LOAD_TIMEOUT });
});

Then("the Product Owner's message box is focused", async ({ e2e }) => {
  await expect(poChat(e2e.window).getByTestId('agent-chat-input')).toBeFocused({ timeout: LOAD_TIMEOUT });
});

Then('the Next steps card has no refactors step and no button that adds 0', async ({ e2e }) => {
  const card = nextSteps(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  // the proposals read: no "Reading the proposals…" left
  await expect(card).not.toContainText(/Reading the proposals/i, { timeout: LOAD_TIMEOUT });
  await expect(card.getByTestId('next-step-refactors')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /\badd 0\b/i })).toHaveCount(0);
  await expect(card).not.toContainText(/\badd 0\b/i);
});

Then('every disabled step of the Next steps card says why, in its tooltip and in a visible line', async ({ e2e }) => {
  const entries = nextStepsEntries(e2e.window);
  await expect(entries.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  let disabled = 0;
  for (const entry of await entries.all()) {
    const button = entry.getByRole('button').first();
    if (await button.isEnabled()) continue;
    disabled += 1;
    const name = (await entry.innerText()).split(/\r?\n/)[0].trim();
    const reason = ((await button.getAttribute('title')) || (await button.locator('xpath=..').getAttribute('title')) || '').trim();
    expect(reason, `the tooltip of the disabled step "${name}"`).not.toBe('');
    await expect(entry.getByText(reason, { exact: true }).filter({ visible: true }).first(), `the reason line of "${name}"`).toBeVisible();
  }
  expect(disabled, 'disabled steps on the card').toBeGreaterThan(0);
});

// ---- #738: Fork + PR, a repository the owner can't push to ------------------------------------------------------
// When gh answers permissions.push=false for the imported repository, the wizard suggests a fork. What the
// screen exposes (to be added by #738):
// - data-testid="wizard-fork-notice": the notice "You can't push to <owner/repo>. Create a fork in your account
//   to contribute?", holding wizard-create-fork ("Create a fork": gh repo fork, origin = the fork, upstream =
//   the original) and wizard-work-locally ("Work locally": the Local way of working, no pull request);
// - data-testid="wizard-way-of-working": in step 3's suggested workflows column, the chosen way of working
//   ("Local", "Remote" or "Fork + PR"; Local says "no pull request").
//
// E2E HOOK THE DEVELOPER MUST ADD, read only when CRAFTORIO_SIMULATION_ONLY=1 (the simulated onboarding,
// packages/engine/service/areas/project-onboarding.js): CRAFTORIO_E2E_REPO_PUSH=0|1 stands for gh's answer
// (permissions.push false | true) for the imported repository, a local file:// one included, without calling
// gh; with 0 "Create a fork" is simulated (no gh repo fork, no network): the project's origin becomes the
// simulated fork and upstream the original.

const forkNotice = (page) => wizard(page).getByTestId('wizard-fork-notice');
const FORK_CHOICE = { 'Create a fork': 'wizard-create-fork', 'Work locally': 'wizard-work-locally' };

Given("the app is open where I can't push to the repositories I import", async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_REPO_PUSH: '0' } });
});

Given('the app is open where I can push to the repositories I import', async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_REPO_PUSH: '1' } });
});

Then('the wizard suggests creating a fork to contribute, or working locally', async ({ e2e }) => {
  const notice = forkNotice(e2e.window);
  await expect(notice).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(notice).toContainText(/You can.t push to \S+/);
  await expect(notice).toContainText('Create a fork in your account to contribute?');
  for (const [label, id] of Object.entries(FORK_CHOICE)) {
    const button = notice.getByTestId(id);
    await expect(button, `the "${label}" button`).toHaveRole('button');
    await expect(button).toHaveAccessibleName(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
    await expect(button).toBeEnabled();
  }
});

When('I choose {string} in the fork suggestion', async ({ e2e }, label) => {
  const id = FORK_CHOICE[label];
  if (!id) throw new Error(`unknown choice "${label}": one of ${Object.keys(FORK_CHOICE).join(', ')}`);
  await forkNotice(e2e.window).getByTestId(id).click();
  await expect(forkNotice(e2e.window)).toBeHidden({ timeout: IMPORT_TIMEOUT });
});

Then('the wizard does not suggest a fork', async ({ e2e }) => {
  await expect(forkNotice(e2e.window)).toHaveCount(0);
  await expect(wizard(e2e.window).getByText(/You can.t push to/)).toHaveCount(0);
});

Then("the wizard's suggested workflows use the {string} way of working", async ({ e2e }, mode) => {
  const way = workflowsColumn(e2e.window).getByTestId('wizard-way-of-working');
  await expect(way).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(way).toContainText(new RegExp(`^\\s*${escapeRe(mode)}(?!\\s*\\+)`));
});

Then("the wizard's suggested workflows say {string}", async ({ e2e }, text) => {
  await expect(workflowsColumn(e2e.window)).toContainText(new RegExp(escapeRe(text), 'i'), { timeout: IMPORT_TIMEOUT });
});

// ---- #633 (onboarding phase 5): the AI-native SDLC work model (docs/work/first-project-onboarding/images/mock-5.jpg)
// Step 3 "Analysis & workflows" has a section "How work on <name> is documented":
// - data-testid="wizard-work-model": the section (both columns of the mockup); its radios (role="radio" or input[type=radio]) carry
//   data-testid="wizard-work-model-light|standard|full", each named by its model ("Light", "Standard", "Full")
//   and followed by its description; Standard is checked by default;
// - data-testid="wizard-work-model-files": the "Where the files live" panel ("In the repository", the
//   docs/work/<item>/... path with its files, and chips such as "fix: issue only").
// The pick is the project's workModel (light | standard | full), saved with the wizard while it is open, so an
// onboarding resumed from the Projects screen (#741) shows it again.
const workModel = (page) => wizard(page).getByTestId('wizard-work-model');
const workModelFiles = (page) => wizard(page).getByTestId('wizard-work-model-files');
const workModelRadio = (page, model) => workModel(page).getByTestId(`wizard-work-model-${String(model).trim().toLowerCase()}`);

// The section shows with the workflows' rows (step 3's analyzed / manual states), under them
Then('the wizard shows how the work is documented', async ({ e2e }) => {
  const section = workModel(e2e.window);
  await expect(section).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(section.getByRole('heading', { name: 'How the work is documented' })).toBeVisible();
  await expect(section).toContainText('How much each step writes down for the next one to read and a person to approve.');
});

// Owner's decision (2026-11-26): Standard and Full are not ready: their tiles are shown, disabled, marked
// "Coming soon" (wizard-work-model-soon, inside the model's <label>), and a click picks nothing
Then('the {string} work model cannot be picked yet, marked {string}', async ({ e2e }, model, label) => {
  const page = e2e.window;
  const radio = workModelRadio(page, model);
  await expect(radio).toHaveCount(1, { timeout: IMPORT_TIMEOUT });
  await expect(radio).toBeDisabled();
  await expect(radio).not.toBeChecked();
  const tag = radio.locator('xpath=ancestor::label[1]').getByTestId('wizard-work-model-soon');
  await expect(tag).toBeVisible();
  await expect(tag).toHaveText(label);
  // a click on its tile changes nothing
  await radio.locator('xpath=ancestor::label[1]').click({ force: true });
  await expect(radio).not.toBeChecked();
});

// a table of | model | description |, in the order shown
Then('the wizard offers the work models:', async ({ e2e }, table) => {
  const rows = table.raw().map((r) => r.map((c) => String(c || '').trim())).filter((r) => r[0]);
  const section = workModel(e2e.window);
  await expect(section.getByRole('radio')).toHaveCount(rows.length, { timeout: IMPORT_TIMEOUT });
  for (const [model, description] of rows) {
    await expect(section.getByRole('radio', { name: new RegExp(`^\\s*${escapeRe(model)}\\b`) }), `the "${model}" radio`).toHaveCount(1);
    await expect(workModelRadio(e2e.window, model), `the "${model}" radio by its test id`).toHaveCount(1);
    if (description) await expect(section, `the description of "${model}"`).toContainText(description);
  }
});

When('I pick the {string} work model in the wizard', async ({ e2e }, model) => {
  await workModelRadio(e2e.window, model).click();
});

Then('the wizard has the {string} work model picked', async ({ e2e }, model) => {
  const section = workModel(e2e.window);
  await expect(workModelRadio(e2e.window, model)).toBeChecked({ timeout: IMPORT_TIMEOUT });
  await expect(section.getByRole('radio', { checked: true }), 'only one work model picked').toHaveCount(1);
});

Then("the wizard's work model files live {string} in {string} as {string}, {string} and {string}", async ({ e2e }, where, folder, a, b, c) => {
  const panel = workModelFiles(e2e.window);
  await expect(panel).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(panel).toContainText('Where the files live');
  await expect(panel).toContainText(where);
  await expect(panel).toContainText(folder);
  for (const file of [a, b, c]) await expect(panel, `the file ${file}`).toContainText(file);
});

Then("the wizard's work model files show the chips {string}, {string} and {string}", async ({ e2e }, a, b, c) => {
  const panel = workModelFiles(e2e.window);
  for (const chip of [a, b, c]) await expect(panel.getByText(chip, { exact: true }), `the chip "${chip}"`).toBeVisible();
});

Then("the wizard's work model looks like the baseline {string}", async ({ e2e }, name) => {
  await expect(workModel(e2e.window)).toHaveScreenshot(name);
});

// ---- #781: the analysis says what it is doing and what it found -------------------------------------------------
// Acceptance tests, written before the code. What the screens expose (ActivityLine, packages/ui-kit/activity-line.js:
// its root carries data-state = pending | running | done | failed | skipped and the line's test id; done starts with ✓):
// - step 3: wizard-analysis-phases holds wizard-phase-git, wizard-phase-files and wizard-phase-oracle, shown while
//   analyzing and, once the analysis ran in this wizard, after it;
// - step 4: wizard-review-languages in the project card holds the Health tab's language bar
//   (architecture-languages-bar, architecture-language-segment, architecture-language-legend,
//   architecture-language-entry, the text "JavaScript 74.3%"; ordered by share, Other last);
// - wizard-kind-select opens on the detected kind, with no "Detect from the files" option, and
//   wizard-kind-detected says "Detected: <kind>"; wizard-review-backlog-activity: the Backlog card's line.

const ANALYSIS_PHASE = { 'git history': 'wizard-phase-git', files: 'wizard-phase-files', Oracle: 'wizard-phase-oracle' };
const analysisPhase = (page, words) => {
  const id = ANALYSIS_PHASE[words];
  if (!id) throw new Error(`unknown analysis phase "${words}": one of ${Object.keys(ANALYSIS_PHASE).join(', ')}`);
  return wizard(page).getByTestId('wizard-analysis-phases').getByTestId(id);
};

Then("the wizard's {string} analysis phase ends {word} saying {string}", async ({ e2e }, words, state, text) => {
  const line = analysisPhase(e2e.window, words);
  await expect(line).toHaveAttribute('data-state', state, { timeout: ANALYSIS_TIMEOUT });
  await expect(line).toContainText(new RegExp(escapeRe(text), 'i'));
  if (state === 'done') await expect(line, 'a done line has its check').toContainText('✓');
});

Then("the review's project card shows the language bar led by {string}, its legend ordered by share", async ({ e2e }, language) => {
  const languages = review(e2e.window).getByTestId('wizard-review-languages');
  const bar = languages.getByTestId('architecture-languages-bar');
  await expect(bar).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  const entries = languages.getByTestId('architecture-language-legend').getByTestId('architecture-language-entry');
  await expect(entries.first()).toContainText(language);
  const shown = (await entries.allInnerTexts()).map((text) => ({ text, share: Number(/(\d+(?:\.\d+)?)\s*%/.exec(text)?.[1]) }));
  await expect(bar.getByTestId('architecture-language-segment'), 'one segment per language').toHaveCount(shown.length);
  const named = shown.filter((l) => !/^\s*Other\b/.test(l.text));
  expect(named.map((l) => l.share), 'each language gives its share').not.toContain(NaN);
  expect(named.map((l) => l.share), 'ordered by share').toEqual(named.map((l) => l.share).sort((a, b) => b - a));
  const other = shown.findIndex((l) => /^\s*Other\b/.test(l.text));
  if (other >= 0) expect(other, '"Other" comes last').toBe(shown.length - 1);
});

Then("the review's Project type opens on {string}, marked as detected", async ({ e2e }, kind) => {
  const select = review(e2e.window).getByTestId('wizard-kind-select');
  await expect(select).toHaveValue(kind, { timeout: ANALYSIS_TIMEOUT });
  await expect(select.getByRole('option', { name: /Detect from the files/i, includeHidden: true }), 'nothing left to detect').toHaveCount(0);
  await expect(review(e2e.window).getByTestId('wizard-kind-detected')).toContainText(new RegExp(`Detected:\\s*${escapeRe(kind)}`, 'i'));
  // the kinds are tiles (wizard-kind-tile; the select is not shown): the detected one is the picked tile, and no
  // tile offers to detect
  const tiles = review(e2e.window).getByTestId('wizard-kind-tile');
  await expect(review(e2e.window).locator('[data-testid="wizard-kind-tile"][aria-pressed="true"]')).toHaveAttribute('data-value', kind);
  await expect(tiles.filter({ hasText: /Detect from the files/i }), 'no tile left to detect').toHaveCount(0);
});

Then("the review's Backlog card ends with {string}", async ({ e2e }, text) => {
  const line = review(e2e.window).getByTestId('wizard-review-backlog').getByTestId('wizard-review-backlog-activity');
  await expect(line).toHaveAttribute('data-state', 'done', { timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(text);
});

// ---- #846: Finish opens the project page without the Start panel; no second analysis of the project -------------
// The Start panel is the app's drawer (index.html #drawer): closed it is visibility:hidden, so its own Start button
// (data-testid="start-workflow") is hidden. While the onboarding's analysis runs, a Start of analyze-project on the
// project says an analysis is already running (in the panel or a notice) and starts no run of its own.
// The settle time lets a Start panel opened late (after the project page) show up before it is checked.
const START_PANEL_SETTLE = 1500;

Then('the Start panel is not shown', async ({ e2e }) => {
  const start = e2e.window.getByTestId('start-workflow');
  await expect(start).toBeHidden({ timeout: LOAD_TIMEOUT });
  await e2e.window.waitForTimeout(START_PANEL_SETTLE);
  await expect(start).toBeHidden();
});

Then('the app says an analysis of the project is already running', async ({ e2e }) => {
  await expect(e2e.window.getByText(/already running|j[áa] est[áa] (em execu[çc][ãa]o|rodando)|em andamento/i).filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// the scratch workspace's started runs whose workflow is that one (a name or a file): features/support/started-runs.js
const { startedRuns, workflowBase } = require('../support/started-runs');
const startedRunsOf = (e2e, name) => startedRuns(e2e).filter((ev) => workflowBase(ev.workflow) === workflowBase(name));

// no Run screen came up, and at most the onboarding's own run of the workflow exists
Then('no second run of the workflow {string} has started', async ({ e2e }, name) => {
  const page = e2e.window;
  await page.waitForTimeout(START_PANEL_SETTLE);
  await expect(page.getByTestId('run-screen-status').filter({ visible: true })).toHaveCount(0);
  expect(startedRunsOf(e2e, name).length, `runs of ${name}`).toBeLessThanOrEqual(1);
});

// ---- #848: the Repository step's list filters while typing ----------------------------------------------------------
// The list under wizard-repo (data-testid="wizard-repo-list", one data-testid="wizard-repo-option" with
// data-repo="owner/name" each) shows the repositories whose owner/name holds what the field holds (any case), at most
// 5; an empty field shows the 5 newest; no match shows no list (the typed URL is still imported by Next).
//
// E2E HOOK THE DEVELOPER MUST ADD, read only when CRAFTORIO_SIMULATION_ONLY=1 (the simulated onboarding,
// packages/engine/service/areas/project-onboarding.js): CRAFTORIO_E2E_GITHUB_REPOS=<JSON array of { name:
// 'owner/repo', private, updatedAt }>, newest first, stands for gh: onboardingAccounts answers GitHub installed and
// signed in (account e2e-owner) and onboardingRepos('github') answers that array, without calling gh.
const repoOptions = (page) => wizard(page).getByTestId('wizard-repo-list').getByTestId('wizard-repo-option');

// a table | repository | updated |, newest first (updated: a date, YYYY-MM-DD)
Given('the app is open where my GitHub account has the repositories:', async ({ e2e }, table) => {
  const repos = table.hashes().map((r) => ({ name: String(r.repository).trim(), private: false, updatedAt: `${String(r.updated).trim()}T10:00:00Z` }));
  await e2e.open({ env: { CRAFTORIO_E2E_GITHUB_REPOS: JSON.stringify(repos) } });
});

// The list has its own filter box (wizard-repo-filter, "Filter by name"): the URL field (wizard-repo) no longer
// filters it. Typed key by key, as the owner does (what the box held is replaced)
When('I filter my repositories by {string} in the wizard', async ({ e2e }, text) => {
  const box = wizard(e2e.window).getByTestId('wizard-repo-filter');
  await expect(box).toBeVisible({ timeout: LOAD_TIMEOUT });
  await box.clear();
  await box.pressSequentially(text);
  await expect(box).toHaveValue(text);
});

When('I clear the repository filter in the wizard', async ({ e2e }) => {
  const box = wizard(e2e.window).getByTestId('wizard-repo-filter');
  await box.click();
  await box.press('ControlOrMeta+A');
  await box.press('Backspace');
  await expect(box).toHaveValue('');
});

When('I clear the repository field in the wizard', async ({ e2e }) => {
  const field = wizard(e2e.window).getByTestId('wizard-repo');
  await field.click();
  await field.press('ControlOrMeta+A');
  await field.press('Backspace');
  await expect(field).toHaveValue('');
});

// a table of one repository (owner/name) per row, no header, in the order shown
Then("the wizard's repository list shows, in order:", async ({ e2e }, table) => {
  const names = table.raw().map((r) => String(r[0] || '').trim()).filter(Boolean);
  const options = repoOptions(e2e.window);
  await expect(options).toHaveCount(names.length, { timeout: LOAD_TIMEOUT });
  await expect(options.filter({ visible: true })).toHaveCount(names.length);
  expect(await options.evaluateAll((els) => els.map((el) => el.getAttribute('data-repo')))).toEqual(names);
});

Then('the wizard shows no repository list', async ({ e2e }) => {
  await expect(repoOptions(e2e.window)).toHaveCount(0);
  await expect(wizard(e2e.window).getByTestId('wizard-repo-list').filter({ visible: true })).toHaveCount(0);
});

// ---- #845: a repository with Issues turned off is a state, not a failed Backlog read ------------------------------
// What the screens expose (to be added by #845):
// - in the review's wizard-review-backlog: data-testid="wizard-review-backlog-issues-disabled", the line "Issues are
//   turned off in this repository" (no wizard-review-backlog-retry), holding the link
//   data-testid="wizard-review-backlog-settings-link" (an <a> to https://github.com/<owner>/<repo>/settings);
// - on the Backlog screen: data-testid="backlog-issues-disabled", the same line, instead of the sync error (#bl-error
//   stays empty).
// A network or auth failure keeps today's failed line (wizard-review-backlog-activity data-state="failed") with its
// reason and wizard-review-backlog-retry.
//
// E2E HOOK THE DEVELOPER MUST ADD, read only when CRAFTORIO_SIMULATION_ONLY=1: CRAFTORIO_E2E_ISSUES_FAIL=
// disabled|network stands for gh issue list on any project's backlog read (the review's getBacklog / syncBacklog and
// the Backlog screen's sync), a local file:// import included, which then stands for the GitHub repository
// https://github.com/e2e-owner/<the local folder's name>; without calling gh the read fails as gh does:
// - disabled: "gh issue list failed: the 'e2e-owner/<name>' repository has disabled issues";
// - network: "gh issue list failed: error connecting to api.github.com".
const ISSUES_DISABLED = 'Issues are turned off in this repository';
const reviewBacklog = (page) => review(page).getByTestId('wizard-review-backlog');

Given('the app is open where the GitHub repositories I import have their Issues turned off', async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_ISSUES_FAIL: 'disabled' } });
});

Given('the app is open where reading GitHub issues fails because the network is down', async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_ISSUES_FAIL: 'network' } });
});

Then("the review's Backlog card says {string} without a Retry", async ({ e2e }, text) => {
  const card = reviewBacklog(e2e.window);
  const line = card.getByTestId('wizard-review-backlog-issues-disabled');
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(text);
  await expect(card.getByTestId('wizard-review-backlog-retry')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /retry/i })).toHaveCount(0);
  await expect(card.getByText(/gh issue list failed|has disabled issues/i)).toHaveCount(0);
});

Then("the review's Backlog card links to the repository's settings", async ({ e2e }) => {
  const link = reviewBacklog(e2e.window).getByTestId('wizard-review-backlog-settings-link');
  await expect(link).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(link).toHaveAttribute('href', /^https:\/\/github\.com\/[^/]+\/[^/]+\/settings\b/);
});

Then('the Backlog says {string} and shows no sync error', async ({ e2e }, text) => {
  const page = e2e.window;
  const line = page.getByTestId('backlog-issues-disabled').filter({ visible: true });
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(text);
  await expect(page.locator('#bl-error')).toHaveText('');
  await expect(page.getByText(/gh issue list failed|has disabled issues/i).filter({ visible: true })).toHaveCount(0);
});

Then("the review's Backlog card says why the issues could not be read, mentioning {string}, and offers a Retry", async ({ e2e }, reason) => {
  const card = reviewBacklog(e2e.window);
  const line = card.getByTestId('wizard-review-backlog-activity');
  await expect(line).toHaveAttribute('data-state', 'failed', { timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(reason);
  await expect(card.getByTestId('wizard-review-backlog-retry')).toBeVisible();
});

Then("the review's Backlog card does not say {string}", async ({ e2e }, text) => {
  const card = reviewBacklog(e2e.window);
  await expect(card.getByTestId('wizard-review-backlog-issues-disabled')).toHaveCount(0);
  await expect(card.getByText(text)).toHaveCount(0);
});

// ---- #37: the review's Backlog card counts and lists only the open, non-archived issues -----------------------------
// In wizard-review-backlog (exists): the count ("3 open issues", onboarding.backlog_read today says "N issues read") and
// one <li> per issue (role listitem, exists) holding its title; a closed issue or one labelled "archived" is never
// listed nor counted; with no open issue the card ends on "No open issues." (wizard-review-backlog-activity, exists).
Then("the review's Backlog card says {string} and lists only the issues:", async ({ e2e }, count, table) => {
  const card = reviewBacklog(e2e.window);
  await expect(card.getByTestId('wizard-review-backlog-activity')).toHaveAttribute('data-state', 'done', { timeout: LOAD_TIMEOUT });
  await expect(card).toContainText(count);
  const titles = table.raw().map((r) => String(r[0] || '').trim()).filter(Boolean);
  const rows = card.getByRole('listitem');
  await expect(rows).toHaveCount(titles.length);
  for (const title of titles) await expect(rows.filter({ hasText: title }), `the issue "${title}"`).toHaveCount(1);
});

Then("the review's Backlog card lists no issue", async ({ e2e }) => {
  const card = reviewBacklog(e2e.window);
  await expect(card.getByTestId('wizard-review-backlog-activity')).toHaveAttribute('data-state', 'done', { timeout: LOAD_TIMEOUT });
  await expect(card.getByRole('listitem')).toHaveCount(0);
  await expect(card).not.toContainText(/issues? read/i);
});

// ---- #40: the repository's own default workflow waits for the owner's acceptance ------------------------------------
// What the screens expose (NEW, to be added by #40):
// - data-testid="wizard-default-awaiting-acceptance": on step 3 (analysis) and on step 4 (review), the notice that the
//   project's default workflow (named in it) must be reviewed and accepted before it runs, with a link or button
//   "Review and accept" (pt-BR "Revisar e aceitar") to the Definitions page;
// - data-testid="next-step-accept-workflows": the project page's Next steps entry "Accept the repository's workflows"
//   (pt-BR "Aceitar os workflows do repositório"), shown until the repository's workflows are accepted.
const defaultAwaiting = (page) => wizard(page).getByTestId('wizard-default-awaiting-acceptance').filter({ visible: true });

// Step 3 says it with the workflows' rows (not on the two choices): in the Default row, in its hint's place, the
// row's select naming the workflow; the review says it under the project's workflows, naming the workflow itself
Then("the wizard says the default workflow {string} must be reviewed and accepted before it runs, offering {string}", async ({ e2e }, name, label) => {
  const notice = defaultAwaiting(e2e.window);
  await expect(notice).toBeVisible({ timeout: LOAD_TIMEOUT });
  const row = wizard(e2e.window).locator('[data-testid="wizard-workflow"][data-kind="default"]').filter({ has: e2e.window.getByTestId('wizard-default-awaiting-acceptance') });
  if (await row.count()) await expect(row.getByTestId('wizard-workflow-select'), 'the Default row names the workflow').toHaveValue(name);
  else await expect(notice).toContainText(name);
  await expect(notice).toContainText(/accept/i);
  const action = notice.getByRole('link', { name: label, exact: true }).or(notice.getByRole('button', { name: label, exact: true }));
  await expect(action.first()).toBeVisible();
});

Then("the Next steps card asks to accept the repository's workflows", async ({ e2e }) => {
  const entry = nextSteps(e2e.window).getByTestId('next-step-accept-workflows');
  await expect(entry).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(entry).toContainText("Accept the repository's workflows");
});

Then("the Next steps card no longer asks to accept the repository's workflows", async ({ e2e }) => {
  await expect(projectPage(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(nextSteps(e2e.window).getByTestId('next-step-accept-workflows')).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

// ---- #844: what the wizard reads from a repository with no tests and tagged milestones ------------------------------
// The ways of working profile (wizard-profile) of a repository with no test command and no test file says so ("No
// tests found") or leaves the tests open, never "Unit tests"; the release row's selector (wizard-workflow
// data-kind="release", wizard-workflow-select) shows the release style the project is saved with.
// Once analyzed the profile's own line is not printed (see "the wizard shows the ways of working profile"): what it
// found about the tests is said by the workflows it gives. Their reasons say no test was found (or leave the tests
// open), the Fix row's choices are the ones without a unit test ("… · Code only"), and nothing says "Unit tests"
Then("the wizard's ways of working profile says no tests were found or leaves the tests open", async ({ e2e }) => {
  const page = e2e.window;
  const column = workflowsColumn(page);
  await expect(column).toHaveAttribute('data-state', 'analyzed', { timeout: IMPORT_TIMEOUT });
  await expect(column).toContainText(/no tests?( command or test file)?( was| were)? found|tests?\b[^·]*\bopen\b|tests?\s*\?/i, { timeout: IMPORT_TIMEOUT });
  await expect(column).not.toContainText(/unit tests|unit and e2e/i);
  const fix = await workflowTiles(page, 'fix').evaluateAll((els) => els.map((el) => el.getAttribute('title') || ''));
  expect(fix.length, 'the choices of the fix workflow').toBeGreaterThan(0);
  expect(fix.filter((label) => /\bunit\b/i.test(label)), 'no fix choice promises a unit test').toEqual([]);
});

Then('the suggested {string} workflow has {string} picked', async ({ e2e }, kind, label) => {
  const tile = pickedTile(e2e.window, kind);
  await expect(tile).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(tile).toHaveAttribute('title', new RegExp(`^\\s*${escapeRe(label)}\\s*$`), { timeout: IMPORT_TIMEOUT });
  // the row's select, not shown, has the same pick
  const select = workflowRow(e2e.window, kind).getByTestId('wizard-workflow-select');
  await expect(select).toHaveValue(await tile.getAttribute('data-value'));
});

// ---- #850 #851 #852: step 3 and the review ------------------------------------------------------------------------
// Acceptance tests, written before the code. What the screens expose:
// - #850 (a new project): step 3's job row of an analysis left for later (wizard-cost's data-part="<job>") holds
//   data-testid="wizard-job-later-<job>" (new), the reason in words; no wizard-skip ("Skip, analyze later"). The
//   review's project card is data-testid="wizard-review-project" (new); it says the answer to "Where changes land".
// - #851: data-testid="wizard-recommended" (new): the "Recommended" label, inside the recommended work model's
//   <label> (Light) and inside wizard-workflows-choice-analyze; Light is picked by default and
//   wizard-work-model-files is hidden until Standard (or Full) is picked.
// - #852: a review card still running (data-state="pending") shows the "running" badge in its header, the City card
//   next to its wizard-open-city; before the facts are read wizard-review-languages-loading holds a placeholder (no bar).
const REVIEW_CARD = { City: 'wizard-review-city', Findings: 'wizard-review-findings' };
const reviewCard = (page, name) => {
  const id = REVIEW_CARD[name];
  if (!id) throw new Error(`unknown review card "${name}": one of ${Object.keys(REVIEW_CARD).join(', ')}`);
  return review(page).getByTestId(id);
};
const workModelLabel = (page, model) => workModelRadio(page, model).locator('xpath=ancestor::label[1]');

Then("the wizard's {string} analysis is left for later, saying why", async ({ e2e }, words) => {
  const later = jobRow(e2e.window, words).getByTestId(`wizard-job-later-${jobId(words)}`);
  await expect(later).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(later).toHaveText(/\S/);
});

// A new project's step 3 opens on its workflows' rows with no job list (wizard-cost): what is left for later is
// said on the review, whose City and Findings cards are data-state="later" with the reason in words
Then("the wizard's step 3 lists the workflows and no analysis", async ({ e2e }) => {
  const page = e2e.window;
  await expect(workflowsColumn(page).getByTestId('wizard-workflows-rows')).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(workflowRows(page).first()).toBeVisible();
  await expect(wizard(page).getByTestId('wizard-cost'), 'no job list on a new project').toHaveCount(0);
});

Then("the review's {string} card says its analysis is left for later, and where to start it", async ({ e2e }, name) => {
  const card = reviewCard(e2e.window, name);
  await expect(card).toHaveAttribute('data-state', 'later', { timeout: LOAD_TIMEOUT });
  await expect(card).toContainText("Not analyzed yet: start the analysis from the project's page.");
});

Then('the wizard offers no {string} button', async ({ e2e }, label) => {
  const w = wizard(e2e.window);
  await expect(w.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  if (label === 'Skip, analyze later') await expect(w.getByTestId('wizard-skip')).toHaveCount(0);
});

Then("the review's project card says {string}", async ({ e2e }, text) => {
  const card = review(e2e.window).getByTestId('wizard-review-project');
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).toContainText(text, { timeout: LOAD_TIMEOUT });
});

// #23: a card once its analysis is done (data-state="ready"), e.g. the City card's line "<n> arquivos · <n> bairros"
Then("the review's {string} card says {string}", async ({ e2e }, name, text) => {
  const card = reviewCard(e2e.window, name);
  await expect(card).toHaveAttribute('data-state', 'ready', { timeout: ANALYSIS_TIMEOUT });
  await expect(card).toContainText(text, { timeout: LOAD_TIMEOUT });
});

Then('the review does not say {string}', async ({ e2e }, text) => {
  await expect(review(e2e.window)).toBeVisible();
  await expect(review(e2e.window).getByText(text)).toHaveCount(0);
});

Then('the {string} work model is labelled {string}', async ({ e2e }, model, label) => {
  const tag = workModelLabel(e2e.window, model).getByTestId('wizard-recommended');
  await expect(tag).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(tag).toHaveText(label);
  await expect(workModel(e2e.window).getByTestId('wizard-recommended'), 'one work model is recommended').toHaveCount(1);
});

Then("the wizard's {string} choice is labelled {string}", async ({ e2e }, choice, label) => {
  const tag = workflowsColumn(e2e.window).getByTestId(choiceTestid(choice)).getByTestId('wizard-recommended');
  await expect(tag).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(tag).toHaveText(label);
});

Then('the wizard does not show where the files live', async ({ e2e }) => {
  await expect(workModel(e2e.window)).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(workModelFiles(e2e.window)).toBeHidden();
});

Then("the review's {string} card shows it is still running", async ({ e2e }, name) => {
  const card = reviewCard(e2e.window, name);
  await expect(card).toHaveAttribute('data-state', 'pending', { timeout: LOAD_TIMEOUT });
  await expect(card.locator('header').getByText('running', { exact: true })).toBeVisible();
});

Then("the review's City card still offers {string}", async ({ e2e }, label) => {
  const open = reviewCard(e2e.window, 'City').getByTestId('wizard-open-city');
  await expect(open).toBeVisible();
  await expect(open).toBeEnabled();
  await expect(open).toHaveText(label);
});

Then("the review's project card shows a placeholder for the languages", async ({ e2e }) => {
  const languages = review(e2e.window).getByTestId('wizard-review-languages-loading');
  await expect(languages).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(languages).toHaveText(/\S/);
  await expect(languages.getByTestId('architecture-languages-bar')).toHaveCount(0);
});

// ---- #20 #21: step 3 of an import with "Define manually", and step 3 of a new project ------------------------------
// Acceptance tests, written before the code (features/20-21-project-wizard-import-manual-new-step3.feature). They use
// what the screens already expose: step 3's job rows (wizard-cost's list items, the paid ones data-part="<job>", each
// with its checkbox named by the analysis, its status dot a role="img" named by the status: "waiting", "running",
// "done"...; a failed one wizard-job-error-<job>, one left for later wizard-job-later-<job>), the footer's
// wizard-back, the review (wizard-review) and its cards' data-state (pending | ready | failed | skipped | later).

When('I go back to the previous step of the wizard', async ({ e2e }) => {
  await footer(e2e.window).getByTestId('wizard-back').click();
});

Then("the wizard's {string} analysis is ticked", async ({ e2e }, words) => {
  const row = jobRow(e2e.window, words);
  await expect(row).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(row.getByRole('checkbox')).toBeChecked();
});

Then('the review says {string}', async ({ e2e }, text) => {
  await expect(review(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(review(e2e.window).getByText(text)).toBeVisible();
});

// running (pending, its "running" badge) or done (ready): never "later", the look of analyses skipped in the wizard
Then("the review's {string} card is running or done, not left for later", async ({ e2e }, name) => {
  const card = reviewCard(e2e.window, name);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).toHaveAttribute('data-state', /^(pending|ready)$/, { timeout: LOAD_TIMEOUT });
  await expect(card).not.toContainText('Not analyzed yet');
});

Then('the wizard does not say {string}', async ({ e2e }, text) => {
  await expect(wizard(e2e.window)).toBeVisible();
  await expect(wizard(e2e.window).getByText(text)).toHaveCount(0);
});

Then('the wizard has no heading that reads {string}', async ({ e2e }, text) => {
  await expect(wizard(e2e.window)).toBeVisible();
  await expect(wizard(e2e.window).getByRole('heading', { name: text })).toHaveCount(0);
});

Then("the wizard's suggested workflows do not say {string}", async ({ e2e }, text) => {
  const column = workflowsColumn(e2e.window);
  await expect(column).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(column).not.toContainText(new RegExp(escapeRe(text), 'i'));
});

// every row of step 3's left column runs, is done, failed saying why, or is left for later saying why: none stays
// "waiting" with nothing said (checked over a few seconds, so a row that only starts late is not a failure)
// (a new project's step 3 lists no job at all: then none waits)
Then("no analysis of the wizard is left waiting without saying why", async ({ e2e }) => {
  const rows = wizard(e2e.window).getByTestId('wizard-cost').getByRole('listitem');
  await expect(workflowsColumn(e2e.window).getByTestId('wizard-workflows-rows')).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect.poll(async () => {
    const silent = [];
    for (const row of await rows.all()) {
      const waiting = await row.getByRole('img', { name: 'waiting', exact: true }).count();
      const why = row.locator('[data-testid^="wizard-job-later-"], [data-testid^="wizard-job-error-"]');
      const said = (await why.count()) && /\S/.test(await why.first().innerText());
      if (waiting && !said) silent.push((await row.innerText()).split('\n')[0].trim());
    }
    return silent;
  }, { message: 'the rows waiting with no reason', timeout: IMPORT_TIMEOUT }).toEqual([]);
});

// ---- #22: the project page reads what the onboarding recorded --------------------------------------------------------
// A project "just onboarded" is what the wizard's Finish leaves (written here, not through the wizard): the project
// record with its `kind` ('backend' | 'frontend' | 'full-stack') and its `workflows` (the Feature one with the variant
// picked in step 3), the Next steps card left open (localStorage craftorio.nextSteps = { <projectId>: 'open' }), and
// the idea typed in the review kept as an Inbox card (api.createDiscoveryCard, column inbox) or none.
// What the card exposes (project-next-steps, as #642/#744):
// - next-step-idea ("Capture the first idea", its button "Open the Inbox"): with an idea in the project's Inbox
//   (api.listDiscoveryCards(projectId, 'inbox')) it shows data-testid="next-step-idea-done" and no "Open the Inbox",
//   or the entry is left out; with none it stays as before;
// - next-step-screenshots: absent for a backend project, or disabled with a no-interface reason
//   ("projeto sem interface" in Portuguese); frontend / full-stack projects keep it.
// the Feature variants of step 3 by their label: features/support/workflows.js
const { FEATURE, FEATURE_VARIANTS } = require('../support/workflows');
const NO_INTERFACE = /no (user )?interface|without (an? |a user )?interface|no UI\b|sem interface/i;

async function seedOnboardedProject(e2e, name, { kind, variant = 'local-e2e', idea = null }) {
  const root = path.join(__dirname, '..', '..');
  const workspace = require(path.join(root, 'packages', 'engine', 'domains', 'workspace', 'workspace'));
  const projects = require(path.join(root, 'packages', 'engine', 'domains', 'project', 'projects'));
  const ws = workspace.setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  const created = await projects.createProject(ws.projects, { name, description: 'A project just onboarded (simulated data)' });
  const project = projects.updateProject(ws.projects, created.id, {
    repo: `https://github.com/example/${name}`,
    kind,
    workflows: [{ name: FEATURE.name, origin: 'bundled', category: 'build', variant }],
    defaultWorkflow: FEATURE.name,
  });
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
  const res = await e2e.window.evaluate(async ({ projectId, idea }) => {
    try {
      localStorage.setItem('craftorio.nextSteps', JSON.stringify({ ...JSON.parse(localStorage.getItem('craftorio.nextSteps') || '{}'), [projectId]: 'open' }));
      if (idea) await window.api.createDiscoveryCard(projectId, idea, idea, 'idea');
      return {};
    } catch (e) {
      return { thrown: String(e?.message || e) };
    }
  }, { projectId: project.id, idea });
  expect(res?.thrown, `the onboarding of "${name}" could not be recorded`).toBeFalsy();
}

Given('the workspace has a just-onboarded {string} project {string} with the idea {string} in its Inbox', async ({ e2e }, kind, name, idea) => {
  await seedOnboardedProject(e2e, name, { kind, idea });
});

Given('the workspace has a just-onboarded {string} project {string} with no idea in its Inbox', async ({ e2e }, kind, name) => {
  await seedOnboardedProject(e2e, name, { kind });
});

Given('the workspace has a just-onboarded {string} project {string} whose Feature workflow is {string}', async ({ e2e }, kind, name, label) => {
  const variant = FEATURE_VARIANTS[label];
  if (!variant) throw new Error(`"${label}": expected one of ${Object.keys(FEATURE_VARIANTS).join(', ')}`);
  await seedOnboardedProject(e2e, name, { kind, variant });
});

Then('the Next steps card shows the first idea as captured', async ({ e2e }) => {
  const card = nextSteps(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  // done, or left out: never an "Open the Inbox" to capture what is already there
  await expect(card.locator('button[data-next-step="idea"]:not([disabled])')).toHaveCount(0, { timeout: LOAD_TIMEOUT });
  const entry = card.getByTestId('next-step-idea');
  if (await entry.count()) await expect(card.getByTestId('next-step-idea-done'), 'the idea step marked done').toBeVisible();
});

Then('the Next steps card still offers {string} for the first idea', async ({ e2e }, label) => {
  const entry = nextSteps(e2e.window).getByTestId('next-step-idea');
  await expect(entry).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(entry.getByRole('button', { name: label, exact: true })).toBeEnabled();
  await expect(nextSteps(e2e.window).getByTestId('next-step-idea-done')).toHaveCount(0);
});

Then('the Next steps card does not propose investigating screenshots', async ({ e2e }) => {
  const card = nextSteps(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  const entry = card.getByTestId('next-step-screenshots');
  if (!(await entry.count())) return;
  // or kept, disabled, saying the project has no interface
  const button = entry.getByRole('button').first();
  await expect(button, 'the screenshots step of a project with no interface').toBeDisabled();
  await expect(entry, 'the reason: the project has no interface').toContainText(NO_INTERFACE);
});

Then('the Next steps card still lists the screenshots step', async ({ e2e }) => {
  const entry = nextSteps(e2e.window).getByTestId('next-step-screenshots');
  await expect(entry).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(entry).not.toContainText(NO_INTERFACE);
});

// #75: no screenshots step at all (a disabled one is not enough), once the card has drawn what it reads and after
// the settle time (the kind may be read after the card's first drawing)
Then('the Next steps card has no screenshots step', async ({ e2e }) => {
  const card = nextSteps(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card.getByTestId('next-step-po-issue')).toBeVisible();
  await expect(card.getByTestId('next-step-screenshots')).toHaveCount(0, { timeout: LOAD_TIMEOUT });
  await e2e.window.waitForTimeout(START_PANEL_SETTLE);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('next-step-screenshots')).toHaveCount(0);
});

// ---- #74: what the import's analyses cost, before they run and in the review ---------------------------------
// Acceptance tests, written before the code (features/onboarding.feature, @issue-74). What the screens expose
// (the renderer's contract for these steps):
// - step 3's profile row gets data-part="profile" (as the paid rows have their data-part); its amount, like
//   theirs, is in the row: the estimate before the analysis, never "free" when the Oracle may complete the
//   profile; wizard-cost-total sums both;
// - data-testid="wizard-review-costs"       NEW: the review's costs, one data-part="<job>" per analysis that ran
//   (profile, projectMap) with its amount; absent when the analyses were skipped;
// - data-testid="wizard-review-cost-total"  NEW: inside it, the total.
//
// E2E HOOK THE DEVELOPER MUST ADD (it does not exist yet), read by the simulated onboarding
// (packages/engine/service/areas/project-onboarding.js, only when CRAFTORIO_SIMULATION_ONLY=1):
// - CRAFTORIO_E2E_ONBOARDING_COSTS=<JSON {"profile":0.42,"projectMap":0.74}>: the simulated analyses act as paid
//   ones, with no model call: the profile is one the Oracle completes once the analysis starts (not before),
//   these amounts are both rows' estimates before anything runs, and what each records as its cost when it
//   ends (jobs.<job>.costUsd).

// "$0.42" / "US$ 0,42": the space of a currency may be a no-break one, and no digit follows
const amountText = (amount) => new RegExp(`${escapeRe(amount).replace(/\s+/g, '\\s*')}(?!\\d)`);
const reviewCosts = (page) => review(page).getByTestId('wizard-review-costs');
const reviewCost = (page, words) => reviewCosts(page).locator(`[data-part="${jobId(words)}"]`);

Given('the app is open where the {string} analysis costs {float} and the {string} analysis {float}', async ({ e2e }, a, costA, b, costB) => {
  await e2e.open({ env: { CRAFTORIO_E2E_ONBOARDING_COSTS: JSON.stringify({ [jobId(a)]: costA, [jobId(b)]: costB }) } });
});

Then("the wizard's {string} analysis shows the amount {string}", async ({ e2e }, words, amount) => {
  const row = jobRow(e2e.window, words);
  await expect(row).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(row).toContainText(amountText(amount), { timeout: LOAD_TIMEOUT });
});

Then("the wizard's {string} analysis does not say {string}", async ({ e2e }, words, text) => {
  const row = jobRow(e2e.window, words);
  await expect(row).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(row).not.toContainText(text);
});

// Before anything runs the estimate is one amount, on the Analyze with AI card ("Cost: $1.16"): the sum of what
// its analyses may cost (the profile's Oracle turn included); each part's amount shows on the review
Then("the wizard's {string} choice says it may cost {string}", async ({ e2e }, choice, amount) => {
  const cost = workflowsColumn(e2e.window).getByTestId(choiceTestid(choice)).getByTestId('wizard-workflows-choice-cost');
  await expect(cost).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(cost).toHaveText(amountText(amount), { timeout: LOAD_TIMEOUT });
});

Then("the wizard's {string} choice does not say {string}", async ({ e2e }, choice, text) => {
  const card = workflowsColumn(e2e.window).getByTestId(choiceTestid(choice));
  await expect(card.getByTestId('wizard-workflows-choice-cost')).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(card).not.toContainText(text);
});

Then("the wizard's estimated total is {string}", async ({ e2e }, amount) => {
  await expect(wizard(e2e.window).getByTestId('wizard-cost-total')).toHaveText(amountText(amount), { timeout: LOAD_TIMEOUT });
});

Then('the review says the {string} analysis cost {string}', async ({ e2e }, words, amount) => {
  await expect(reviewCost(e2e.window, words)).toContainText(amountText(amount), { timeout: ANALYSIS_TIMEOUT });
});

Then('the review says the analyses cost {string} in total', async ({ e2e }, amount) => {
  await expect(reviewCosts(e2e.window).getByTestId('wizard-review-cost-total')).toContainText(amountText(amount), { timeout: ANALYSIS_TIMEOUT });
});

Then('the review shows no analysis cost', async ({ e2e }) => {
  await expect(review(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(reviewCosts(e2e.window)).toHaveCount(0);
});

// ---- #107: a failed import says its own cause, in the interface's language, and leaves no project -----------------
// What the screen exposes (to be added by #107): step 2's wizard-error (the existing failure box of an import) with
// data-error="repo-not-found" | "repo-no-access" | "not-a-git-repo" (the codes the engine's start() answers, see
// packages/engine/test/project/import-failure-107.test.js; besides today's "clone-failed" / no-network), its text
// in the interface's language naming that cause; "credentials" only for repo-no-access. A failed import is not kept in
// the Projects list (data-testid="project-card" of projects-screen).
//
// E2E HOOK THE DEVELOPER MUST ADD, read only when CRAFTORIO_SIMULATION_ONLY=1 (the access check of the simulated
// onboarding, packages/engine/service/areas/project-onboarding.js / projects.checkAccess): CRAFTORIO_E2E_REPO_ACCESS=
// not-found|no-access stands for git ls-remote and gh's answer on any http(s) repository URL, without the network:
// not-found = the repository does not exist; no-access = it exists, private, and the account has no access to it.
// A local folder (file:// URL) is never simulated: the real folder without .git fails as git does.
const IMPORT_CAUSE = {
  'the repository does not exist': 'repo-not-found',
  'I have no access to the repository': 'repo-no-access',
  'the folder is not a git repository': 'not-a-git-repo',
};
const importError = (page) => wizard(page).getByTestId('wizard-error');

Given('the app is open where GitHub says the repository I import does not exist', async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_REPO_ACCESS: 'not-found' } });
});

Given('the app is open where GitHub says the repository I import is private and I have no access to it', async ({ e2e }) => {
  await e2e.open({ env: { CRAFTORIO_E2E_REPO_ACCESS: 'no-access' } });
});

// a folder with files and no .git, imported by its file:// URL as step 1's folder card does
Given('a local folder that is not a git repository is ready to import', async ({ e2e }) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const folder = path.join(e2e.scratch, 'folders', 'not-a-repo');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), '# not a repository\n');
  e2e.localRepo = pathToFileURL(folder).href;
});

Then('the wizard says the import failed because {string}', async ({ e2e }, cause) => {
  const code = IMPORT_CAUSE[cause];
  if (!code) throw new Error(`unknown cause "${cause}": one of ${Object.keys(IMPORT_CAUSE).join(', ')}`);
  const error = importError(e2e.window);
  await expect(error).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(error).toHaveAttribute('data-error', code);
});

Then("the wizard's import error reads {string}", async ({ e2e }, text) => {
  const error = importError(e2e.window);
  await expect(error).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(error).toContainText(new RegExp(escapeRe(text), 'i'));
});

Then("the wizard's import error does not read {string}", async ({ e2e }, text) => {
  const error = importError(e2e.window);
  await expect(error).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(error).not.toContainText(new RegExp(escapeRe(text), 'i'));
});

// the screen has loaded its cards (the demo workspace's "demo-app") before the absence is read
Then('the Projects screen does not list the project {string}', async ({ e2e }, name) => {
  const screen = e2e.window.getByTestId('projects-screen').filter({ visible: true }).first();
  await expect(screen.getByTestId('project-card').filter({ hasText: 'demo-app' }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(screen.getByTestId('project-card').filter({ hasText: name })).toHaveCount(0);
});

// ---- #108: Create new project's name: required, and the folder it really gets ---------------------------------------
// What the screen exposes: data-testid="wizard-name-required" (to be added by #108), the line under wizard-new-name
// saying a name is required, shown while the name is empty (after it was touched), tied to the field with
// aria-describedby; wizard-new-folder (exists) reads the folder the project will really get, the name's slug with
// -2, -3… when a project already holds it (projects.createProject's id rule).
const nameRequired = (page) => wizard(page).getByTestId('wizard-name-required');

// a project with no repository, written with the engine's own functions (its folder <workspace>/projects/<slug>),
// then the app reloads to read the project list again (as local-backlog.steps.js does)
Given('the workspace has a project {string}', async ({ e2e }, name) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const projects = require('@craftorio/engine/domains/project/projects');
  const ws = require('@craftorio/engine/domains/workspace/workspace').setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  await projects.createProject(ws.projects, { name, description: 'An existing project (simulated data)' });
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

When("I clear the new project's name", async ({ e2e }) => {
  const field = wizard(e2e.window).getByTestId('wizard-new-name');
  await field.click();
  await field.press('ControlOrMeta+A');
  await field.press('Backspace');
  await expect(field).toHaveValue('');
});

Then('the wizard says under the project name that a name is required', async ({ e2e }) => {
  const line = nameRequired(e2e.window);
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toHaveText(/\S/);
  const id = await line.getAttribute('id');
  expect(id, 'the line has an id the field points to').toBeTruthy();
  await expect(wizard(e2e.window).getByTestId('wizard-new-name')).toHaveAttribute('aria-describedby', new RegExp(`(^|\\s)${escapeRe(id)}(\\s|$)`));
});

Then('the wizard no longer says that a project name is required', async ({ e2e }) => {
  await expect(nameRequired(e2e.window)).toBeHidden();
});
