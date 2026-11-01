// #669: the new-project wizard (fronts/build/views/projects/project-wizard.js, .css) and the project page's
// Next steps card (fronts/analyser/views/project/project.js) follow the spec's mockups
// (docs/work/first-project-onboarding/images/mock-1, -2, -4, -6, -7.jpg; spec R2, R3, R5, R10, R11).
// Acceptance tests, written before the code, on the real page (packages/ui-kit/test/renderer-app-harness.js),
// with the contract of project-wizard.test.js's header (#641), project-wizard-review-642.test.js and
// project-next-steps-642.test.js, plus these additions (the mockups' English text is the source):
// - the step indicator: the existing data-step="<id>" elements are numbered pills: at step 1 each one reads
//   "<n> <label>" (1 Start, 2 Repository, 3 Analysis & workflows, 4 Review); exactly one aria-current="step";
// - step 1: the heading "Add a project" and the line "A project is the code the agents work on. You can change
//   everything later." (no "New project" heading); in each card (wizard-source-import / wizard-source-new) an
//   icon data-testid="wizard-card-icon" and three <li> bullets; Create new is enabled since #632 (no "soon"); the
//   selected card has aria-pressed="true" and Import is selected when the wizard opens (mock-1);
//   data-testid="wizard-other-sources" ("Other sources") with data-testid="wizard-source-git-url" (Any git URL:
//   to step 2 and its URL field) and data-testid="wizard-source-folder" (A folder on this computer:
//   api.pickFolder(), the existing folder pick of projects.js);
// - the footer: data-testid="wizard-footer" holding the navigation; at step 1 data-testid="wizard-cancel"
//   (Cancel, closes the wizard) before wizard-next (Next); its rule in project-wizard.css draws a border-top;
// - step 2 (mock-2): heading "Import a repository", labels "Repository" and "Project name", GitHub / GitLab
//   buttons, Next reads "Next: clone and continue";
// - step 3 (mock-4): "Analyze <name>", "Read-only. Nothing is written to the repository.", the rows Clone, Facts,
//   Ways of working profile, City and architecture, Refactor backlog, "Real models · estimated total",
//   "Suggested workflows", and in the footer "Analyze and continue";
// - step 4 (mock-6): a card per the project (its name, "How <name> is worked on", "Workflows"), "City" with
//   "Open the city", "Refactor backlog" with "<n> proposals · nothing added to the roadmap"; Back and Finish in
//   the footer;
// - Next steps (mock-7): "<name> is ready" in its head; entries next-step-refactors ("Add refactors to the
//   roadmap", a checkbox per proposal, "File and add …"), next-step-idea ("Capture the first idea", "Open
//   Inbox"), next-step-cadence ("Keep refactoring", "Add a refactor to the roadmap every 10 runs.", "Turn on"),
//   and, visible but disabled in this phase, next-step-release-ci ("Set up release CI", "Add to roadmap") and
//   next-step-screenshots ("Investigate screenshots", "Add spike to roadmap").
// - i18n: the new English strings are values of packages/shared/i18n/en.json, translated in pt-BR.json (the key
//   parity of the two catalogs is apps/desktop/test/i18n-every-screen-330.test.js's).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { clickRendered, existing, pageMarkup } = require('@multiagent/front-analyser/test/project-page-helpers');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PID = 'p-new';
const REPO = 'https://github.com/o/new.git';
const NAME = 'New one';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/new', exists: true };
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const ANALYZING = { projectId: PID, status: 'analyzing', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'running' } }), cli: CLI_OK };
const ANALYZED = { projectId: PID, status: 'analyzed', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done' }, projectMap: { status: 'done' }, ranking: { status: 'done' } }), cli: CLI_OK };
const PROPOSALS = [
  { id: 'rf-1', title: 'Split checkout.js', target: 'src/checkout.js', targetFiles: ['src/checkout.js'], files: ['src/checkout.js'], rank: 1 },
  { id: 'rf-2', title: 'Tests for refund.py', target: 'payments/refund.py', targetFiles: ['payments/refund.py'], files: ['payments/refund.py'], rank: 2 },
];
const FACTS = { state: 'ok', exclude: [], model: { files: [
  { file: 'src/checkout.js', lines: 900, commits: 40, complexity: 30, quadrant: 'Danger Zone', score: 82, language: 'js' },
  { file: 'payments/refund.py', lines: 300, commits: 25, complexity: 4, quadrant: 'Cowboy Code', score: 41, language: 'py' },
], danger_zone: [{ file: 'src/checkout.js', score: 82 }], complexity: { metric: 'cyclomatic', tool: 'test' } } };
const CITY = { state: 'ok', model: { grouping: 'folders', districts: [{ id: 'src', name: 'src', buildings: [{ file: 'src/checkout.js' }] }] }, validation: null, refresh: { suggested: false, unmatchedShare: 0, newFolders: [] }, mapRun: null };
const BACKLOG = { issues: [{ number: 12, title: 'Login fails on Safari', state: 'open', labels: [] }] };

const clone = (x) => JSON.parse(JSON.stringify(x));

function page() {
  return loadApp({
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async (id) => (id === PID ? clone(ANALYZED) : null),
      analyzeOnboarding: async (id) => ({ ...clone(ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      architectureEstimate: async () => ({ estimate: { usd: 0.9 } }),
      architectureCity: async () => clone(CITY),
      architectureFacts: async () => clone(FACTS),
      refactorProposals: async () => clone(PROPOSALS),
      getBacklog: async () => clone(BACKLOG),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      pickFolder: async () => 'C:/code/shop',
    },
  });
}

// The markup of an element by id, with what was written into the ids inside it
function markupOf(app, id) {
  const parts = [];
  const seen = new Set([id]);
  const follow = (el, depth) => {
    const html = String(el?.innerHTML || '');
    parts.push(html || String(el?.textContent || ''));
    if (depth > 3) return;
    for (const m of html.matchAll(/\bid="([\w-]+)"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const inner = existing(app, m[1]);
      if (inner && (inner.innerHTML || inner.textContent)) follow(inner, depth + 1);
    }
  };
  follow(existing(app, id), 0);
  return parts.join('\n');
}
const wizardMarkup = (app) => markupOf(app, 'project-wizard');
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const wizardText = (app) => H.visibleText(wizardMarkup(app));
const headings = (html) => H.findAll(html, (e) => /^h[1-6]$/.test(e.name)).map((e) => H.visibleText(e.inner));
const buttons = (html) => H.findAll(html, (e) => e.name === 'button').map((e) => H.visibleText(e.inner));
const labels = (html) => H.findAll(html, (e) => e.name === 'label').map((e) => H.visibleText(e.inner));
const isDisabled = (e) => 'disabled' in e.attrs || e.attrs['aria-disabled'] === 'true';
const stepsOf = (app) => H.findAll(wizardMarkup(app), (e) => !!e.attrs['data-step']);

function currentStep(app) {
  const el = H.findEl(wizardMarkup(app), (e) => e.attrs['data-step'] && e.attrs['aria-current'] === 'step');
  return el ? el.attrs['data-step'] : null;
}
const wizardClosed = (app) => H.findEl(wizardMarkup(app), (e) => 'data-step' in e.attrs) === null;

async function press(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

async function typeInto(app, sel, value) {
  const el = app.el(sel);
  el.value = value;
  el.tagName = 'INPUT';
  el.dataset.testid = sel.slice(1);
  const root = app.el('#project-wizard');
  for (const type of ['input', 'change', 'blur']) {
    for (const node of [el, root]) {
      const ev = { type, target: el, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === el) await el[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(5);
}

async function emit(app, state) {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(10);
}

async function opened() {
  const app = page();
  await app.boot();
  assert.equal(typeof app.sandbox.ProjectWizard?.open, 'function', 'window.ProjectWizard.open()');
  app.sandbox.ProjectWizard.open();
  await app.settle(10);
  return app;
}

async function atRepository() {
  const app = await opened();
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'repository');
  return app;
}

async function atAnalysis() {
  const app = await atRepository();
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, CLONING);
  await emit(app, READY);
  assert.equal(currentStep(app), 'analysis', 'the wizard went on to the analysis once the clone was ready');
  await app.settle(10);
  return app;
}

async function atReview() {
  const app = await atAnalysis();
  await emit(app, ANALYZED);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review');
  await app.settle(20);
  return app;
}

// the app on the project page after the wizard's Finish
async function finished() {
  const app = await atReview();
  await Promise.race([press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(30);
  return app;
}

const footer = (app) => byTestId(wizardMarkup(app), 'wizard-footer');

// ---- step 1 (mock-1) --------------------------------------------------------------------------------

test('#669 step 1: the title is "Add a project" with the mockup\'s line, and no "New project" heading', { timeout: 20000 }, async () => {
  const app = await opened();
  const hs = headings(wizardMarkup(app));
  assert.equal(hs.includes('Add a project'), true, `the headings: ${JSON.stringify(hs)}`);
  assert.equal(hs.some((h) => /^new project$/i.test(h)), false, `no "New project" heading: ${JSON.stringify(hs)}`);
  assert.equal(wizardText(app).includes('A project is the code the agents work on. You can change everything later.'), true, 'the line under the title');
});

test('#669 step 1: the indicator is four numbered pills, 1 Start, 2 Repository, 3 Analysis & workflows, 4 Review', { timeout: 20000 }, async () => {
  const app = await opened();
  const pills = stepsOf(app).map((e) => H.visibleText(e.inner));
  assert.deepEqual(pills, ['1 Start', '2 Repository', '3 Analysis & workflows', '4 Review']);
});

test('#669 step 1: exactly one pill is current, the first; after Next it is the second', { timeout: 20000 }, async () => {
  const app = await opened();
  const current = () => stepsOf(app).filter((e) => e.attrs['aria-current'] === 'step').map((e) => e.attrs['data-step']);
  assert.deepEqual(current(), ['start']);
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
  assert.deepEqual(current(), ['repository']);
});

for (const [id, name] of [['wizard-source-new', 'Create new project'], ['wizard-source-import', 'Import a repository']]) {
  test(`#669 step 1: the "${name}" card shows an icon`, { timeout: 20000 }, async () => {
    const app = await opened();
    const card = byTestId(wizardMarkup(app), id);
    assert.equal(card === null, false, `data-testid="${id}"`);
    assert.equal(byTestId(card.outer, 'wizard-card-icon') === null, false, 'data-testid="wizard-card-icon" inside the card');
  });

  test(`#669 step 1: the "${name}" card has its title and three bullets`, { timeout: 20000 }, async () => {
    const app = await opened();
    const card = byTestId(wizardMarkup(app), id);
    assert.equal(card === null, false, `data-testid="${id}"`);
    assert.equal(textOf(card).includes(name), true, `the title: ${textOf(card)}`);
    assert.equal(H.findAll(card.inner, (e) => e.name === 'li').length, 3, 'three <li> bullets');
  });
}

test('#669 step 1: the two cards\' icons differ (+ for Create, a download arrow for Import)', { timeout: 20000 }, async () => {
  const app = await opened();
  const icon = (id) => byTestId(byTestId(wizardMarkup(app), id)?.outer || '', 'wizard-card-icon')?.outer ?? null;
  const create = icon('wizard-source-new');
  const imp = icon('wizard-source-import');
  assert.equal(create === null || imp === null, false, 'both cards have an icon');
  assert.notEqual(create, imp);
});

test('#669 step 1: Import\'s bullets say cloned in the background, its history shows how you work, city and refactor backlog at the end', { timeout: 20000 }, async () => {
  const app = await opened();
  const items = H.findAll(byTestId(wizardMarkup(app), 'wizard-source-import')?.inner || '', (e) => e.name === 'li').map((e) => H.visibleText(e.inner));
  assert.equal(items.length, 3, `the bullets: ${JSON.stringify(items)}`);
  assert.match(items[0], /clon.*background/i);
  assert.match(items[1], /history.*how you work/i);
  assert.match(items[2], /city.*refactor backlog/i);
});

// #632 offers Create new project (mock-1 without "soon"); its step is tested in project-wizard-create-632.test.js
test('#669 #632 step 1: Create new project is enabled (no "soon") with its icon and bullets', { timeout: 20000 }, async () => {
  const app = await opened();
  const card = byTestId(wizardMarkup(app), 'wizard-source-new');
  assert.equal(card === null, false, 'data-testid="wizard-source-new"');
  assert.equal(isDisabled(card), false, 'enabled');
  assert.equal(/soon/i.test(textOf(card)), false, `the card: ${textOf(card)}`);
  assert.equal(byTestId(card.outer, 'wizard-card-icon') === null, false, 'its icon');
  assert.equal(H.findAll(card.inner, (e) => e.name === 'li').length, 3, 'its three bullets');
});

test('#669 step 1: Import is the selected card when the wizard opens (aria-pressed="true"), Create is not', { timeout: 20000 }, async () => {
  const app = await opened();
  const markup = wizardMarkup(app);
  assert.equal(byTestId(markup, 'wizard-source-import')?.attrs['aria-pressed'], 'true');
  assert.equal(byTestId(markup, 'wizard-source-new')?.attrs['aria-pressed'] === 'true', false);
});

test('#669 step 1: "Other sources" under the cards with "Any git URL" and "A folder on this computer"', { timeout: 20000 }, async () => {
  const app = await opened();
  const other = byTestId(wizardMarkup(app), 'wizard-other-sources');
  assert.equal(other === null, false, 'data-testid="wizard-other-sources"');
  assert.match(textOf(other), /Other sources/);
  assert.equal(textOf(byTestId(other.outer, 'wizard-source-git-url')), 'Any git URL');
  assert.equal(textOf(byTestId(other.outer, 'wizard-source-folder')), 'A folder on this computer');
});

test('#669 step 1: "Any git URL" goes to step 2 with the repository URL field', { timeout: 20000 }, async () => {
  const app = await opened();
  await press(app, 'wizard-source-git-url');
  assert.equal(currentStep(app), 'repository');
  assert.equal(byTestId(wizardMarkup(app), 'wizard-repo') === null, false, 'the URL field');
});

test('#669 step 1: "A folder on this computer" opens the local folder pick (api.pickFolder)', { timeout: 20000 }, async () => {
  const app = await opened();
  await press(app, 'wizard-source-folder');
  assert.equal(app.callsTo('pickFolder').length, 1);
});

test('#669 step 1: the footer holds Cancel then Next', { timeout: 20000 }, async () => {
  const app = await opened();
  const foot = footer(app);
  assert.equal(foot === null, false, 'data-testid="wizard-footer"');
  const cancel = byTestId(foot.outer, 'wizard-cancel');
  const next = byTestId(foot.outer, 'wizard-next');
  assert.equal(textOf(cancel), 'Cancel');
  assert.equal(textOf(next), 'Next');
  assert.equal(foot.outer.indexOf(cancel.outer) < foot.outer.indexOf(next.outer), true, 'Cancel on the left, Next on the right');
});

test('#669 step 1: Cancel closes the wizard', { timeout: 20000 }, async () => {
  const app = await opened();
  await press(app, 'wizard-cancel');
  assert.equal(wizardClosed(app), true);
  assert.equal(app.callsTo('startOnboarding').length, 0, 'nothing imported');
});

// ---- step 2 (mock-2) --------------------------------------------------------------------------------

test('#669 step 2: the heading "Import a repository" with the "Repository" and "Project name" fields', { timeout: 20000 }, async () => {
  const app = await atRepository();
  const markup = wizardMarkup(app);
  assert.equal(headings(markup).includes('Import a repository'), true, `the headings: ${JSON.stringify(headings(markup))}`);
  const ls = labels(markup);
  assert.equal(ls.some((l) => /^Repository\b(?! URL)/.test(l)), true, `a "Repository" label: ${JSON.stringify(ls)}`);
  assert.equal(ls.some((l) => /^Project name/.test(l)), true, `a "Project name" label: ${JSON.stringify(ls)}`);
});

test('#669 step 2: the GitHub / GitLab choice is shown as two buttons', { timeout: 20000 }, async () => {
  const app = await atRepository();
  const bs = buttons(wizardMarkup(app));
  assert.equal(bs.includes('GitHub') && bs.includes('GitLab'), true, `the buttons: ${JSON.stringify(bs)}`);
});

test('#669 step 2: the footer holds Back and "Next: clone and continue"', { timeout: 20000 }, async () => {
  const app = await atRepository();
  const foot = footer(app);
  assert.equal(foot === null, false, 'data-testid="wizard-footer"');
  assert.equal(textOf(byTestId(foot.outer, 'wizard-back')), 'Back');
  assert.equal(textOf(byTestId(foot.outer, 'wizard-next')), 'Next: clone and continue');
});

// mock-2's short form: "owner/repo" typed in the Repository field is imported from the picked provider
async function pressProvider(app, id) {
  const el = H.findEl(wizardMarkup(app), (e) => e.attrs.id === `wizard-provider-${id}`);
  assert.equal(el === null, false, `the provider button #wizard-provider-${id}`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}
async function importTyped(app, repo) {
  await typeInto(app, '#wizard-repo', repo);
  await typeInto(app, '#wizard-name', NAME);
  const into = String(existing(app, 'wizard-clone-into')?.textContent || '') || textOf(byTestId(wizardMarkup(app), 'wizard-clone-into'));
  await press(app, 'wizard-next');
  const calls = app.callsTo('startOnboarding');
  assert.equal(calls.length, 1, 'one api.startOnboarding call');
  return { repo: calls[0][0]?.repo, into };
}

// the clone's folder is owner-repo (OnboardingModel.repoNameFromUrl)
test('#669 step 2: "acme/shop" typed with GitHub picked is imported as https://github.com/acme/shop, cloned into repos/acme-shop', { timeout: 20000 }, async () => {
  const app = await atRepository();
  await pressProvider(app, 'github');
  const { repo, into } = await importTyped(app, 'acme/shop');
  assert.equal(repo, 'https://github.com/acme/shop');
  assert.match(into, /repos\/acme-shop\b/, `the clone line: "${into}"`);
});

test('#669 step 2: "acme/shop.git" typed with GitLab picked is imported as https://gitlab.com/acme/shop', { timeout: 20000 }, async () => {
  const app = await atRepository();
  await pressProvider(app, 'gitlab');
  const { repo, into } = await importTyped(app, 'acme/shop.git');
  assert.equal(repo, 'https://gitlab.com/acme/shop');
  assert.match(into, /repos\/acme-shop\b/, `the clone line: "${into}"`);
});

for (const typed of ['file:///C:/code/shop', 'git@gitlab.com:acme/shop.git', 'https://github.com/acme/shop.git']) {
  test(`#669 step 2: "${typed}" is imported as typed`, { timeout: 20000 }, async () => {
    const app = await atRepository();
    const { repo } = await importTyped(app, typed);
    assert.equal(repo, typed);
  });
}

// ---- step 3 (mock-4) --------------------------------------------------------------------------------

test('#669 step 3: "Analyze <name>" and "Read-only. Nothing is written to the repository."', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  const hs = headings(wizardMarkup(app));
  assert.equal(hs.includes(`Analyze ${NAME}`), true, `the headings: ${JSON.stringify(hs)}`);
  assert.equal(wizardText(app).includes('Read-only. Nothing is written to the repository.'), true);
});

test('#669 step 3: the analyses listed are Clone, Facts, Ways of working profile, City and architecture, Refactor backlog', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  const text = wizardText(app);
  const missing = ['Clone', 'Facts', 'Ways of working profile', 'City and architecture', 'Refactor backlog'].filter((s) => !text.includes(s));
  assert.deepEqual(missing, []);
});

test('#669 step 3: the cost reads "Real models · estimated total" next to "Skip, analyze later"', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  const cost = byTestId(wizardMarkup(app), 'wizard-cost');
  assert.equal(cost === null, false, 'data-testid="wizard-cost"');
  assert.equal(textOf(cost).includes('Real models · estimated total'), true, textOf(cost));
  assert.equal(textOf(byTestId(cost.outer, 'wizard-skip')), 'Skip, analyze later');
});

test('#669 step 3: the "Suggested workflows" column is shown', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  assert.equal(headings(wizardMarkup(app)).includes('Suggested workflows'), true, `the headings: ${JSON.stringify(headings(wizardMarkup(app)))}`);
});

test('#669 step 3: the footer holds Back and "Analyze and continue"', { timeout: 20000 }, async () => {
  const app = await atAnalysis();
  const foot = footer(app);
  assert.equal(foot === null, false, 'data-testid="wizard-footer"');
  assert.equal(textOf(byTestId(foot.outer, 'wizard-back')), 'Back');
  assert.equal(buttons(foot.outer).includes('Analyze and continue'), true, `the footer's buttons: ${JSON.stringify(buttons(foot.outer))}`);
});

// ---- step 4 (mock-6) --------------------------------------------------------------------------------

test('#669 step 4: the project\'s card with its name, "How <name> is worked on" and "Workflows"', { timeout: 20000 }, async () => {
  const app = await atReview();
  const text = wizardText(app);
  assert.equal(headings(wizardMarkup(app)).includes(NAME), true, `the headings: ${JSON.stringify(headings(wizardMarkup(app)))}`);
  assert.equal(text.includes(`How ${NAME} is worked on`), true);
  assert.equal(text.includes('Workflows'), true);
});

test('#669 step 4: the "City" card with "Open the city"', { timeout: 20000 }, async () => {
  const app = await atReview();
  const city = byTestId(wizardMarkup(app), 'wizard-review-city');
  assert.equal(city === null, false, 'data-testid="wizard-review-city"');
  assert.equal(headings(city.outer).includes('City'), true, `the headings: ${JSON.stringify(headings(city.outer))}`);
  assert.equal(buttons(city.outer).includes('Open the city'), true, `the buttons: ${JSON.stringify(buttons(city.outer))}`);
});

test('#669 step 4: the "Refactor backlog" card ends with "<n> proposals · nothing added to the roadmap"', { timeout: 20000 }, async () => {
  const app = await atReview();
  const refactors = byTestId(wizardMarkup(app), 'wizard-review-refactors');
  assert.equal(refactors === null, false, 'data-testid="wizard-review-refactors"');
  assert.equal(headings(refactors.outer).includes('Refactor backlog'), true);
  assert.equal(textOf(refactors).includes('2 proposals · nothing added to the roadmap'), true, textOf(refactors));
});

test('#669 step 4: the footer holds Back and Finish', { timeout: 20000 }, async () => {
  const app = await atReview();
  const foot = footer(app);
  assert.equal(foot === null, false, 'data-testid="wizard-footer"');
  assert.equal(textOf(byTestId(foot.outer, 'wizard-back')), 'Back');
  assert.equal(textOf(byTestId(foot.outer, 'wizard-finish')), 'Finish');
});

// ---- Next steps (mock-7) ----------------------------------------------------------------------------

const shownEl = (e) => !('hidden' in e.attrs) && !String(e.attrs.class || '').split(/\s+/).includes('hidden');
const card = (app) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-next-steps' && shownEl(e));
const entry = (app, id) => byTestId(card(app)?.outer || '', `next-step-${id}`);

test('#669 Next steps: the card\'s head says "<name> is ready"', { timeout: 20000 }, async () => {
  const app = await finished();
  assert.equal(card(app) === null, false, 'data-testid="project-next-steps"');
  assert.match(textOf(card(app)), new RegExp(`${NAME} is ready`));
});

test('#669 Next steps: "Add refactors to the roadmap" lists the proposals with a checkbox each and "File and add"', { timeout: 20000 }, async () => {
  const app = await finished();
  const e = entry(app, 'refactors');
  assert.equal(e === null, false, 'data-testid="next-step-refactors"');
  assert.equal(textOf(e).includes('Add refactors to the roadmap'), true, textOf(e));
  assert.equal(textOf(e).includes('Split checkout.js'), true, 'a proposal');
  assert.equal(H.findAll(e.inner, (x) => x.name === 'input' && x.attrs.type === 'checkbox').length, PROPOSALS.length, 'a checkbox per proposal');
  assert.equal(buttons(e.outer).some((b) => /^File and add/.test(b)), true, `the buttons: ${JSON.stringify(buttons(e.outer))}`);
});

test('#669 Next steps: "Capture the first idea" with its line and "Open Inbox"', { timeout: 20000 }, async () => {
  const app = await finished();
  const e = entry(app, 'idea');
  assert.equal(e === null, false, 'data-testid="next-step-idea"');
  assert.equal(textOf(e).includes('Capture the first idea'), true, textOf(e));
  assert.equal(textOf(e).includes('A line in the Inbox; Discovery shapes it into issues.'), true, textOf(e));
  assert.equal(buttons(e.outer).includes('Open Inbox'), true, `the buttons: ${JSON.stringify(buttons(e.outer))}`);
});

test('#669 Next steps: "Keep refactoring" with "every 10 runs" and "Turn on"', { timeout: 20000 }, async () => {
  const app = await finished();
  const e = entry(app, 'cadence');
  assert.equal(e === null, false, 'data-testid="next-step-cadence"');
  assert.equal(textOf(e).includes('Keep refactoring'), true, textOf(e));
  assert.equal(textOf(e).includes('Add a refactor to the roadmap every 10 runs.'), true, textOf(e));
  assert.equal(buttons(e.outer).includes('Turn on'), true, `the buttons: ${JSON.stringify(buttons(e.outer))}`);
});

for (const [id, title, action] of [['release-ci', 'Set up release CI', 'Add to roadmap'], ['screenshots', 'Investigate screenshots', 'Add spike to roadmap']]) {
  test(`#669 Next steps: "${title}" is shown with "${action}" disabled (a later phase)`, { timeout: 20000 }, async () => {
    const app = await finished();
    const e = entry(app, id);
    assert.equal(e === null, false, `data-testid="next-step-${id}"`);
    assert.equal(textOf(e).includes(title), true, textOf(e));
    const btn = H.findEl(e.outer, (x) => x.name === 'button' && H.visibleText(x.inner) === action);
    assert.equal(btn === null, false, `a "${action}" button`);
    assert.equal(isDisabled(btn), true, 'disabled');
  });
}

// ---- i18n -------------------------------------------------------------------------------------------

test('#669 i18n: the mockups\' new English strings are in en.json and translated in pt-BR.json', () => {
  const read = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
  const en = read('en');
  const pt = read('pt-BR');
  const norm = (s) => String(s).trim().replace(/[.:]$/, '');
  const strings = [
    'Add a project', 'A project is the code the agents work on. You can change everything later.',
    'Cloned into your workspace in the background', 'Its history shows how you work today', 'City and refactor backlog ready at the end',
    'A git repository in your workspace', 'Optionally a private GitHub repository', 'Three questions pick its workflows',
    'Other sources', 'Any git URL', 'A folder on this computer',
    'Next: clone and continue', 'Analyze and continue', 'Suggested workflows', 'Open the city',
    'Capture the first idea', 'Keep refactoring', 'Set up release CI', 'Investigate screenshots', 'Add spike to roadmap',
  ];
  const problems = [];
  for (const s of strings) {
    const key = Object.keys(en).find((k) => typeof en[k] === 'string' && norm(en[k]) === norm(s));
    if (!key) { problems.push(`no en.json value "${s}"`); continue; }
    if (typeof pt[key] !== 'string' || !pt[key].trim()) problems.push(`pt-BR.json has no ${key}`);
    else if (norm(pt[key]) === norm(en[key])) problems.push(`pt-BR.json ${key} is not translated`);
  }
  assert.deepEqual(problems, []);
});

// ---- CSS --------------------------------------------------------------------------------------------

const css = () => fs.readFileSync(path.join(ROOT, 'fronts', 'build', 'views', 'projects', 'project-wizard.css'), 'utf8');
const rules = () => [...css().replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

test('#669 CSS: the step pills are rounded', () => {
  assert.equal(rules().some((r) => /wizard-step/.test(r.sel) && /border-radius\s*:/.test(r.body)), true, 'a wizard-step rule with a border-radius');
});

test('#669 CSS: the footer is drawn over a divider', () => {
  assert.equal(rules().some((r) => /wizard-foot/.test(r.sel) && /border-top\s*:/.test(r.body)), true, 'a wizard-foot(er) rule with a border-top');
});
