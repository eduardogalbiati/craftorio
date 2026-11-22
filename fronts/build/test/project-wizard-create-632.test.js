// #632 (spec docs/work/first-project-onboarding/spec.md R4 / D5; mock-1 and mock-3): "Create new project" in
// the new-project wizard (fronts/build/views/projects/project-wizard.js). Acceptance tests, written before the
// code, on the real page (packages/ui-kit/test/renderer-app-harness.js), with the contract of
// project-wizard-mockups-669.test.js's header plus:
// - step 1: wizard-source-new is enabled (no disabled / aria-disabled, no "soon"), keeps its wizard-card-icon
//   and three bullets; Import stays selected when the wizard opens; a click selects Create (aria-pressed).
// - Create, then Next (wizard-next): the create step (pill "2 Repository"; the pills read Start, Repository,
//   Workflows, Review), heading "Create new project"; the name input data-testid="wizard-new-name"; the radios
//   data-testid="wizard-new-starts" value="readme" (checked by default, "README and .gitignore", "A first commit
//   on main.") / value="empty" ("Empty", "git init only."); the checkbox data-testid="wizard-new-remote"
//   (unchecked by default; disabled while api.onboardingAccounts reports no signed-in CLI) with the select
//   data-testid="wizard-new-remote-provider" (GitHub, GitLab) and the hint data-testid="wizard-new-remote-hint"
//   ("<account>/<slug>"); the folder line data-testid="wizard-new-folder" ("<workspace>/projects/<slug>");
//   the groups data-testid="wizard-question" data-question="mode" | "ci" | "release", each with chips
//   data-testid="wizard-chip" (aria-pressed="true" on the picked one), and the line "Change them any time in
//   Ways of working. Setting up CI is offered as a next step."
// - Next sends api.createOnboarding({ name, starts, remote: null | { provider }, answers: { mode, ci, release } })
//   (the values of packages/shared/onboarding-model.js); never with an empty name.
// The controls are driven like project-wizard-mockups-669.test.js's typeInto: a fake target carrying the
// rendered element's attributes, its value / checked set, then click, input and change on it and on the wizard.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@craftorio/front-analyser/test/project-page-helpers');

const NAME = 'Field Notes';
const GH_IN = { provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'eduardo' };
const GL_IN = { provider: 'gitlab', cli: 'glab', installed: true, signedIn: true, account: 'eduardo' };
const GH_OUT = { provider: 'github', cli: 'gh', installed: true, signedIn: false };
const GL_OUT = { provider: 'gitlab', cli: 'glab', installed: false, signedIn: false };
const jobs = () => ({
  clone: { status: 'skipped' }, facts: { status: 'waiting' }, profile: { status: 'done', profile: { mode: 'local', ci: 'release', release: 'milestone' } },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' },
});
const CREATED = { projectId: 'field-notes', status: 'ready', jobs: jobs(), cli: null };

const clone = (x) => JSON.parse(JSON.stringify(x));

function page(accounts) {
  return loadApp({
    api: {
      listProjects: async () => [],
      onboardingAccounts: async () => clone(accounts),
      onboardingRepos: async () => [],
      createOnboarding: async () => clone(CREATED),
      onboardingStatus: async () => clone(CREATED),
      architectureEstimate: async () => ({ estimate: { usd: 0.9 } }),
    },
  });
}

// the markup of an element by id, with what was written into the ids inside it (as in the #669 test)
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
const allByTestId = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id);
const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const wizardText = (app) => H.visibleText(wizardMarkup(app));
const headings = (html) => H.findAll(html, (e) => /^h[1-6]$/.test(e.name)).map((e) => H.visibleText(e.inner));
const isDisabled = (e) => 'disabled' in e.attrs || e.attrs['aria-disabled'] === 'true';
const isChecked = (e) => 'checked' in e.attrs;

// a line the wizard may update in place (its #id's textContent, as wizard-clone-into), else its markup's text
function liveText(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  const live = el?.attrs.id ? String(existing(app, el.attrs.id)?.textContent || '') : '';
  return live || textOf(el);
}

async function press(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
let fakes = 0;

// drives a rendered control: a fake target with its attributes, `props` set (value, checked), then the
// events `types` on it and on the wizard's root (its delegated listeners)
async function drive(app, el, props, types) {
  const sel = el.attrs.id ? `#${el.attrs.id}` : `[data-fake-control-${(fakes += 1)}]`;
  const target = app.el(sel);
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k.startsWith('data-')) target.dataset[camel(k.slice(5))] = v;
    else if (k === 'class') target.className = v;
    else if (k !== 'id') target.attrs[k] = v;
  }
  target.tagName = el.name.toUpperCase();
  if (el.attrs.type) target.type = el.attrs.type;
  if (el.attrs.name) target.name = el.attrs.name;
  if (el.attrs.value !== undefined) target.value = el.attrs.value;
  Object.assign(target, props);
  const root = app.el('#project-wizard');
  for (const type of types) {
    for (const node of [target, root]) {
      const ev = { type, target, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === target) await target[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(5);
}

async function typeName(app, value) {
  const el = byTestId(wizardMarkup(app), 'wizard-new-name');
  assert.ok(el, 'the name field data-testid="wizard-new-name"');
  await drive(app, el, { value }, ['input', 'change', 'blur']);
}

async function tickRemote(app) {
  const el = byTestId(wizardMarkup(app), 'wizard-new-remote');
  assert.ok(el, 'the checkbox data-testid="wizard-new-remote"');
  await drive(app, el, { checked: true }, ['click', 'input', 'change']);
}

async function pickStarts(app, value) {
  const el = allByTestId(wizardMarkup(app), 'wizard-new-starts').find((e) => e.attrs.value === value);
  assert.ok(el, `the radio wizard-new-starts value="${value}"`);
  await drive(app, el, { checked: true, value }, ['click', 'input', 'change']);
}

async function pickProvider(app, value) {
  const el = byTestId(wizardMarkup(app), 'wizard-new-remote-provider');
  assert.ok(el, 'the select data-testid="wizard-new-remote-provider"');
  await drive(app, el, { value }, ['input', 'change']);
}

const question = (app, id) => H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-question' && e.attrs['data-question'] === id);
const chipsOf = (app, id) => allByTestId(question(app, id)?.outer || '', 'wizard-chip');
const chipTexts = (app, id) => chipsOf(app, id).map((e) => H.visibleText(e.inner));
const pressedOf = (app, id) => chipsOf(app, id).filter((e) => e.attrs['aria-pressed'] === 'true').map((e) => H.visibleText(e.inner));

async function pickChip(app, id, label) {
  const chip = chipsOf(app, id).find((e) => H.visibleText(e.inner).startsWith(label));
  assert.ok(chip, `the chip "${label}" of the question ${id}`);
  await clickRendered(app, chip, ['#project-wizard']);
  await app.settle(10);
}

// the chips read, in order, the expected labels (each chip's text starts with its label, a line may follow)
function assertLabels(texts, expected) {
  assert.equal(texts.length, expected.length, `the chips: ${JSON.stringify(texts)}`);
  expected.forEach((label, i) => assert.equal(texts[i].startsWith(label), true, `chip ${i + 1} "${texts[i]}" starts with "${label}"`));
}

async function opened(accounts = [GH_IN, GL_OUT]) {
  const app = page(accounts);
  await app.boot();
  assert.equal(typeof app.sandbox.ProjectWizard?.open, 'function', 'window.ProjectWizard.open()');
  app.sandbox.ProjectWizard.open();
  await app.settle(20);
  return app;
}

async function atCreate(accounts) {
  const app = await opened(accounts);
  await press(app, 'wizard-source-new');
  await press(app, 'wizard-next');
  assert.ok(byTestId(wizardMarkup(app), 'wizard-new-name'), 'the create step with its name field');
  return app;
}

// the create step with "Field Notes" typed, Next pressed: what api.createOnboarding received (plain data)
async function sent(app) {
  await press(app, 'wizard-next');
  const calls = app.callsTo('createOnboarding');
  assert.equal(calls.length, 1, 'one api.createOnboarding call');
  return JSON.parse(JSON.stringify(calls[0][0] ?? null));
}

// ---- step 1 (mock-1) --------------------------------------------------------------------------------

test('#632 step 1: the "Create new project" card is enabled and no longer says "soon"', { timeout: 20000 }, async () => {
  const app = await opened();
  const card = byTestId(wizardMarkup(app), 'wizard-source-new');
  assert.equal(card === null, false, 'data-testid="wizard-source-new"');
  assert.equal(isDisabled(card), false, 'not disabled');
  assert.equal(/soon/i.test(textOf(card)), false, `the card: ${textOf(card)}`);
});

test('#632 step 1: the "Create new project" card keeps its icon and three bullets', { timeout: 20000 }, async () => {
  const app = await opened();
  const card = byTestId(wizardMarkup(app), 'wizard-source-new');
  assert.equal(card === null, false, 'data-testid="wizard-source-new"');
  assert.equal(byTestId(card.outer, 'wizard-card-icon') === null, false, 'its icon');
  assert.deepEqual(H.findAll(card.inner, (e) => e.name === 'li').map((e) => H.visibleText(e.inner)),
    ['A git repository in your workspace', 'Optionally a private GitHub repository', 'Three questions pick its workflows']);
});

test('#632 step 1: Import is still the selected card when the wizard opens', { timeout: 20000 }, async () => {
  const app = await opened();
  const markup = wizardMarkup(app);
  assert.equal(byTestId(markup, 'wizard-source-import')?.attrs['aria-pressed'], 'true');
  assert.equal(byTestId(markup, 'wizard-source-new')?.attrs['aria-pressed'] === 'true', false);
});

test('#632 step 1: a click on "Create new project" selects it (aria-pressed) instead of Import', { timeout: 20000 }, async () => {
  const app = await opened();
  await press(app, 'wizard-source-new');
  const markup = wizardMarkup(app);
  assert.equal(byTestId(markup, 'wizard-source-new')?.attrs['aria-pressed'], 'true');
  assert.equal(byTestId(markup, 'wizard-source-import')?.attrs['aria-pressed'] === 'true', false);
});

// ---- the create step (mock-3) -----------------------------------------------------------------------

test('#632 create step: Create then Next shows the heading "Create new project"', { timeout: 20000 }, async () => {
  const app = await atCreate();
  const hs = headings(wizardMarkup(app));
  assert.equal(hs.includes('Create new project'), true, `the headings: ${JSON.stringify(hs)}`);
});

test('#632 create step: the pills read Start, Repository, Workflows, Review with Repository current', { timeout: 20000 }, async () => {
  const app = await atCreate();
  const pills = H.findAll(wizardMarkup(app), (e) => !!e.attrs['data-step']);
  assert.deepEqual(pills.map((e) => H.visibleText(e.inner).replace(/^\d+\s*/, '')), ['Start', 'Repository', 'Workflows', 'Review']);
  assert.deepEqual(pills.filter((e) => e.attrs['aria-current'] === 'step').map((e) => H.visibleText(e.inner).replace(/^\d+\s*/, '')), ['Repository']);
});

test('#632 create step: the "Project name" field', { timeout: 20000 }, async () => {
  const app = await atCreate();
  const input = byTestId(wizardMarkup(app), 'wizard-new-name');
  assert.equal(input?.name, 'input');
  assert.equal(wizardText(app).includes('Project name'), true, 'its label');
});

test('#632 create step: "Starts with" offers README and .gitignore (checked) and Empty', { timeout: 20000 }, async () => {
  const app = await atCreate();
  const radios = allByTestId(wizardMarkup(app), 'wizard-new-starts');
  assert.deepEqual(radios.map((e) => [e.attrs.type, e.attrs.value, isChecked(e)]), [['radio', 'readme', true], ['radio', 'empty', false]]);
});

test('#632 create step: the "Starts with" choices read as the mockup', { timeout: 20000 }, async () => {
  const app = await atCreate();
  const text = wizardText(app);
  const missing = ['Starts with', 'README and .gitignore', 'A first commit on main.', 'Empty', 'git init only.'].filter((s) => !text.includes(s));
  assert.deepEqual(missing, []);
});

test('#632 create step: the private-repository box is unchecked by default and enabled when gh is signed in', { timeout: 20000 }, async () => {
  const app = await atCreate([GH_IN, GL_OUT]);
  const box = byTestId(wizardMarkup(app), 'wizard-new-remote');
  assert.equal(box === null, false, 'data-testid="wizard-new-remote"');
  assert.equal(box.attrs.type, 'checkbox');
  assert.equal(isChecked(box), false, 'unchecked');
  assert.equal(isDisabled(box), false, 'enabled');
});

test('#632 create step: the private-repository box is disabled when no CLI is signed in', { timeout: 20000 }, async () => {
  const app = await atCreate([GH_OUT, GL_OUT]);
  const box = byTestId(wizardMarkup(app), 'wizard-new-remote');
  assert.equal(box === null, false, 'data-testid="wizard-new-remote"');
  assert.equal(isDisabled(box), true, 'disabled');
});

test('#632 create step: the box reads "Also create a private repository on" with GitHub and GitLab to pick', { timeout: 20000 }, async () => {
  const app = await atCreate();
  assert.equal(wizardText(app).includes('Also create a private repository on'), true);
  const select = byTestId(wizardMarkup(app), 'wizard-new-remote-provider');
  assert.equal(select === null, false, 'data-testid="wizard-new-remote-provider"');
  assert.deepEqual(H.findAll(select.inner, (e) => e.name === 'option').map((e) => H.visibleText(e.inner)), ['GitHub', 'GitLab']);
});

test('#632 create step: the hint names the repository <account>/<slug> (eduardo/field-notes)', { timeout: 20000 }, async () => {
  const app = await atCreate();
  await typeName(app, NAME);
  await tickRemote(app);
  assert.match(liveText(app, 'wizard-new-remote-hint'), /eduardo\/field-notes/);
});

test('#632 create step: the folder line reads <workspace>/projects/field-notes', { timeout: 20000 }, async () => {
  const app = await atCreate();
  await typeName(app, NAME);
  assert.match(liveText(app, 'wizard-new-folder'), /<workspace>\/projects\/field-notes\b/);
});

test('#632 create step: "How will you work on it?" asks where changes land, CI and how you release', { timeout: 20000 }, async () => {
  const app = await atCreate();
  const groups = allByTestId(wizardMarkup(app), 'wizard-question').map((e) => e.attrs['data-question']);
  assert.deepEqual(groups, ['mode', 'ci', 'release']);
  const text = wizardText(app);
  const missing = ['How will you work on it?', 'Where changes land', 'CI', 'How you release'].filter((s) => !text.includes(s));
  assert.deepEqual(missing, []);
});

test('#632 create step: "Where changes land" offers Local and Local + remote', { timeout: 20000 }, async () => {
  const app = await atCreate();
  assertLabels(chipTexts(app, 'mode'), ['Local', 'Local + remote']);
  const text = H.visibleText(question(app, 'mode')?.inner || '');
  assert.equal(text.includes('merge here, push main') && text.includes('pull requests on GitHub'), true, text);
});

test('#632 create step: "CI" offers None, On releases and On pull requests and releases', { timeout: 20000 }, async () => {
  const app = await atCreate();
  assertLabels(chipTexts(app, 'ci'), ['None', 'On releases', 'On pull requests and releases']);
  assert.equal(H.visibleText(question(app, 'ci')?.inner || '').includes('build macOS, Linux, Windows'), true);
});

test('#632 create step: "How you release" offers Milestones (tags), Every merge, Release train, RC → stable', { timeout: 20000 }, async () => {
  const app = await atCreate();
  assertLabels(chipTexts(app, 'release'), ['Milestones (tags)', 'Every merge', 'Release train', 'RC → stable']);
});

test('#632 create step: the picked chips by default are Local, On releases and Milestones (tags)', { timeout: 20000 }, async () => {
  const app = await atCreate();
  const picked = ['mode', 'ci', 'release'].map((q) => pressedOf(app, q));
  assert.deepEqual(picked.map((p) => p.length), [1, 1, 1], `the picked chips: ${JSON.stringify(picked)}`);
  assert.equal(picked[0][0].startsWith('Local') && !picked[0][0].startsWith('Local +'), true, picked[0][0]);
  assert.equal(picked[1][0].startsWith('On releases'), true, picked[1][0]);
  assert.equal(picked[2][0].startsWith('Milestones (tags)'), true, picked[2][0]);
});

test('#632 create step: the line "Change them any time in Ways of working. Setting up CI is offered as a next step."', { timeout: 20000 }, async () => {
  const app = await atCreate();
  assert.equal(wizardText(app).includes('Change them any time in Ways of working. Setting up CI is offered as a next step.'), true);
});

test('#632 create step: a click on a chip makes it the picked one of its question', { timeout: 20000 }, async () => {
  const app = await atCreate();
  await pickChip(app, 'ci', 'On pull requests and releases');
  const picked = pressedOf(app, 'ci');
  assert.equal(picked.length, 1, JSON.stringify(picked));
  assert.equal(picked[0].startsWith('On pull requests and releases'), true, picked[0]);
});

// ---- Next: api.createOnboarding ---------------------------------------------------------------------

test('#632 Next sends the name, README start, no remote and the default answers', { timeout: 20000 }, async () => {
  const app = await atCreate();
  await typeName(app, NAME);
  assert.deepEqual(await sent(app), { name: 'Field Notes', starts: 'readme', remote: null, answers: { mode: 'local', ci: 'release', release: 'milestone' } });
});

test('#632 Next with the private-repository box ticked sends remote { provider: github }', { timeout: 20000 }, async () => {
  const app = await atCreate([GH_IN, GL_OUT]);
  await typeName(app, NAME);
  await tickRemote(app);
  assert.deepEqual((await sent(app)).remote, { provider: 'github' });
});

test('#632 Next with the box ticked and GitLab picked sends remote { provider: gitlab }', { timeout: 20000 }, async () => {
  const app = await atCreate([GH_IN, GL_IN]);
  await typeName(app, NAME);
  await tickRemote(app);
  await pickProvider(app, 'gitlab');
  assert.deepEqual((await sent(app)).remote, { provider: 'gitlab' });
});

test('#632 Next with Empty picked sends starts: empty', { timeout: 20000 }, async () => {
  const app = await atCreate();
  await typeName(app, NAME);
  await pickStarts(app, 'empty');
  assert.equal((await sent(app)).starts, 'empty');
});

for (const [q, label, answers] of [
  ['mode', 'Local + remote', { mode: 'remote', ci: 'release', release: 'milestone' }],
  ['ci', 'None', { mode: 'local', ci: 'none', release: 'milestone' }],
  ['ci', 'On pull requests and releases', { mode: 'local', ci: 'pr+release', release: 'milestone' }],
  ['release', 'Every merge', { mode: 'local', ci: 'release', release: 'per-merge' }],
  ['release', 'Release train', { mode: 'local', ci: 'release', release: 'train' }],
  ['release', 'RC → stable', { mode: 'local', ci: 'release', release: 'rc-stable' }],
]) {
  test(`#632 Next after picking "${label}" sends the answers ${JSON.stringify(answers)}`, { timeout: 20000 }, async () => {
    const app = await atCreate();
    await typeName(app, NAME);
    await pickChip(app, q, label);
    assert.deepEqual((await sent(app)).answers, answers);
  });
}

test('#632 Next with an empty name creates nothing and stays on the create step', { timeout: 20000 }, async () => {
  const app = await atCreate();
  await typeName(app, '   ');
  await press(app, 'wizard-next');
  assert.equal(app.callsTo('createOnboarding').length, 0);
  assert.equal(byTestId(wizardMarkup(app), 'wizard-new-name') === null, false, 'still the create step');
});

// ---- review fixes (66bba2e6): the wizard follows the project while its remote is created --------------

// the page whose api.createOnboarding answers only when the test resolves it
function pendingPage(accounts) {
  let answer;
  const answered = new Promise((resolve) => { answer = resolve; });
  const app = loadApp({
    api: {
      listProjects: async () => [],
      onboardingAccounts: async () => clone(accounts),
      onboardingRepos: async () => [],
      createOnboarding: () => answered,
      onboardingStatus: async () => clone(CREATED),
      architectureEstimate: async () => ({ estimate: { usd: 0.9 } }),
    },
  });
  return { app, answer };
}

const changed = async (app, state) => {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(20);
};
const currentStep = (app) => H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-step-pill' && e.attrs['aria-current'] === 'step')?.attrs['data-step'] || null;

async function pendingCreate(name, state) {
  const { app, answer } = pendingPage([GH_IN, GL_OUT]);
  await app.boot();
  app.sandbox.ProjectWizard.open();
  await app.settle(20);
  await press(app, 'wizard-source-new');
  await press(app, 'wizard-next');
  await typeName(app, name);
  await tickRemote(app);
  const pressing = press(app, 'wizard-next'); // waits on api.createOnboarding
  await app.settle(20);
  await changed(app, state);
  return { app, answer, pressing };
}

test('#632 the wizard adopts the project pushed with the typed name before create() answers, showing its remote being created', { timeout: 20000 }, async () => {
  const creating = { ...clone(CREATED), name: NAME, remote: { provider: 'github', status: 'creating' } };
  const { app, answer, pressing } = await pendingCreate(NAME, creating);
  assert.equal(currentStep(app), 'analysis', 'step 3 while the remote is created');
  const html = wizardMarkup(app);
  assert.equal(byTestId(html, 'wizard-remote-creating') === null, false, 'data-testid="wizard-remote-creating"');
  assert.match(textOf(byTestId(html, 'wizard-remote-creating')), /GitHub/);
  answer({ ...creating, remote: { provider: 'github', status: 'created', url: 'https://github.com/eduardo/field-notes' } });
  await pressing;
  await changed(app, { ...creating, remote: { provider: 'github', status: 'created', url: 'https://github.com/eduardo/field-notes' } });
  assert.equal(byTestId(wizardMarkup(app), 'wizard-remote-creating') === null, true, 'the creating line is gone');
  assert.equal(currentStep(app), 'analysis');
});

test('#632 a project pushed with another name does not move the wizard off the create step', { timeout: 20000 }, async () => {
  const other = { ...clone(CREATED), projectId: 'other', name: 'Other', remote: { provider: 'github', status: 'creating' } };
  const { app, answer, pressing } = await pendingCreate(NAME, other);
  assert.equal(currentStep(app), 'repository');
  assert.equal(byTestId(wizardMarkup(app), 'wizard-remote-creating') === null, true, 'no creating line');
  answer({ ...clone(CREATED), name: NAME });
  await pressing;
});
