// #726: the new-project wizard's analysis step (fronts/build/views/projects/project-wizard.js and
// project-wizard-workflows.js) speaks the interface language in its "Suggested workflows" column and its
// profile line: the reasons, the selects' options and the profile's labels come from the model's i18n keys
// (packages/shared/onboarding-model.js), and the "Why:" / "Por quê:" of each reason is its own highlighted
// element. Acceptance tests, written before the code, on the real page
// (packages/ui-kit/test/renderer-app-harness.js), driven as project-wizard-workflows-630.test.js.
//
// The contract assumed here:
// - each row data-testid="wizard-workflow" (feature, fix, release, ci) shows, once the profile is known, its
//   label in its own element data-testid="wizard-workflow-why" with the class "wizard-workflow-why"
//   (its text only "Why:" in English, "Por quê:" in pt-BR), the reason's text after it (inside
//   data-testid="wizard-workflow-reason", which keeps its muted style);
// - project-wizard.css gives .wizard-workflow-why the accent colour (var(--accent)) and a bold weight;
// - the reason shown is the model's reason (a key, or { key, params }) in the interface's language; the
//   selects' options read their labels in that language, their values unchanged;
// - a live language switch (InterfaceLanguage.apply, Settings › Language › Interface) draws the open
//   wizard again in the new language, the owner's picks kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@multiagent/front-analyser/test/project-page-helpers');
const I18n = require('@multiagent/shared/i18n');

const CSS = path.join(__dirname, '..', 'views', 'projects', 'project-wizard.css');
const PID = 'p-new';
const REPO = 'https://github.com/o/new.git';
const NAME = 'New one';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/new', exists: true };
// the profile picks feature / fix 'remote-e2e', release 'milestone', ci 'pr+release'
const PROFILE = { mode: 'remote', ci: 'pr+release', tests: 'unit+e2e' };
const KINDS = ['feature', 'fix', 'release', 'ci'];
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ranking: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const ANALYZING = { projectId: PID, status: 'analyzing', jobs: jobs({ clone: { status: 'done' }, facts: { status: 'running' } }), cli: CLI_OK };
const PROFILED = {
  projectId: PID, status: 'analyzing', profile: PROFILE, cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: PROFILE }, projectMap: { status: 'running' } }),
};

// today's (before #726) English texts of the model: none may show with the interface in pt-BR
const ENGLISH = [
  'Local: merge, then push main', 'Remote: pull requests', 'No CI: the local suite only', 'On releases only',
  'On pull requests and releases', 'Unit tests', 'Unit and E2E',
  'Remote PRs · E2E first', 'Remote PRs · code first', 'Local merge · E2E first', 'Local merge · code first',
  'Code + unit, then E2E · remote PR', 'Code + unit · remote PR', 'Code + unit, then E2E · local merge',
  'Code + unit · local merge', 'Milestone · tag + notes', 'Per merge · tag + notes', 'Release train · tag + notes',
  'Release candidate, then stable',
  'No project profile yet', 'the changes reach main through pull requests', 'merged on the platform',
  'the changes are merged on your machine', 'main is pushed as the last step', 'there is an E2E suite',
  'the E2E scenarios are written before the code', 'unit tests only', 'it implements first',
  'a fix reproduces the bug', 'with a unit regression test', 'the E2E suite runs after', 'Hotfix mode',
  'from the last tag, shipped as a patch', 'no CI builds releases', 'writes the notes and tags the version',
  'the CI runs on release tags', 'waits for that CI run', 'E2E is a step of the release',
  'no CI file was found', 'the runs rely on the local suite only', 'not on pull requests',
  'the release waits for that run', 'the CI runs on pull requests and on release tags',
  'a remote feature waits for the PR',
];
const englishIn = (text) => ENGLISH.filter((s) => String(text).toLowerCase().includes(s.toLowerCase()));

const clone = (x) => JSON.parse(JSON.stringify(x));

// a live switch draws every screen again: Settings' mount reads data the fake api does not give, so its
// scripts are left out of this page (as i18n-live-switch-330.test.js does)
function page() {
  return loadApp({
    only: (src) => !src.startsWith('views/settings/'),
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async (id) => (id === PID ? clone(PROFILED) : null),
      analyzeOnboarding: async (id) => ({ ...clone(ANALYZING), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      architectureEstimate: async () => ({ estimate: { usd: 0.9 } }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      pickFolder: async () => 'C:/code/shop',
    },
  });
}

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
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const classesOf = (e) => String(e?.attrs?.class || '').split(/\s+/).filter(Boolean);

function currentStep(app) {
  const el = H.findEl(wizardMarkup(app), (e) => e.attrs['data-step'] && e.attrs['aria-current'] === 'step');
  return el ? el.attrs['data-step'] : null;
}

async function press(app, testid) {
  const el = byTestId(wizardMarkup(app), testid);
  assert.ok(el, `the wizard shows data-testid="${testid}"`);
  await clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

async function fire(app, el, types) {
  const root = app.el('#project-wizard');
  for (const type of types) {
    for (const node of [el, root]) {
      const ev = { type, target: el, currentTarget: node, preventDefault() {}, stopPropagation() {} };
      if (node === el) await el[`on${type}`]?.(ev);
      for (const fn of node.listeners[type] || []) await fn(ev);
    }
  }
  await app.settle(5);
}

async function typeInto(app, sel, value) {
  const el = app.el(sel);
  el.value = value;
  el.tagName = 'INPUT';
  el.dataset.testid = sel.slice(1);
  await fire(app, el, ['input', 'change', 'blur']);
}

// picks `value` in step 3's select of `kind`, as the owner does
async function pickVariant(app, kind, value) {
  const sel = H.findEl(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow-select' && e.attrs['data-workflow-kind'] === kind);
  assert.ok(sel, `step 3 has the ${kind} select`);
  const el = app.el(sel.attrs.id ? `#${sel.attrs.id}` : `[data-test-726-select-${kind}]`);
  el.tagName = 'SELECT';
  el.dataset.testid = 'wizard-workflow-select';
  el.dataset.workflowKind = kind;
  el.value = value;
  await fire(app, el, ['change', 'input']);
}

async function emit(app, state) {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(10);
}

// the wizard at step 3, the profile job done, the interface in `lang`
async function profiled({ lang = 'en' } = {}) {
  const app = page();
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  assert.equal(typeof app.sandbox.ProjectWizard?.open, 'function', 'window.ProjectWizard.open()');
  app.sandbox.ProjectWizard.open();
  await app.settle(10);
  await press(app, 'wizard-source-import');
  await press(app, 'wizard-next');
  await typeInto(app, '#wizard-repo', REPO);
  await typeInto(app, '#wizard-name', NAME);
  await press(app, 'wizard-next');
  await emit(app, CLONING);
  await emit(app, READY);
  assert.equal(currentStep(app), 'analysis', 'the wizard went on to the analysis once the clone was ready');
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILED);
  await app.settle(10);
  return app;
}

// Settings › Language › Interface, as the app applies it (packages/ui-kit/interface-language.js)
async function switchLanguage(app, lang) {
  app.run(`InterfaceLanguage.apply({ language: { interface: ${JSON.stringify(lang)} } })`);
  await app.settle(10);
  assert.equal(app.run('I18n.getLanguage()'), lang, `the interface is now in ${lang}`);
}

const rows = (app) => H.findAll(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow');
const rowOf = (app, kind) => rows(app).find((r) => r.attrs['data-kind'] === kind) || null;
const selectOf = (row) => H.findEl(row?.outer || '', (e) => e.name === 'select' && e.attrs['data-testid'] === 'wizard-workflow-select');
const optionsOf = (row) => H.findAll(selectOf(row)?.inner || '', (e) => e.name === 'option');
const pickedOf = (row) => optionsOf(row).find((o) => 'selected' in o.attrs)?.attrs.value ?? null;
const columnText = (app) => textOf(byTestId(wizardMarkup(app), 'wizard-workflows-column'));
const profileText = (app) => textOf(byTestId(wizardMarkup(app), 'wizard-profile'));

// the model's text (a key string, { key, params }, a string of keys, an array) in a language
const KEY = /onboarding\.[A-Za-z0-9_.-]*[A-Za-z0-9_]/g;
function resolve(x, lang) {
  if (Array.isArray(x)) return x.map((y) => resolve(y, lang)).join(' · ');
  if (x && typeof x === 'object' && typeof x.key === 'string') {
    const params = Object.fromEntries(Object.entries(x.params || {}).map(([k, v]) => [k, (typeof v === 'object' && v !== null) || typeof v === 'string' ? resolve(v, lang) : v]));
    return I18n.t(x.key, params, lang);
  }
  return String(x ?? '').replace(KEY, (k) => I18n.t(k, undefined, lang));
}
const modelReasons = (app) => {
  const M = app.sandbox.OnboardingModel;
  const all = [...M.suggestWorkflows(clone(PROFILE)).suggestions, M.ciChoice(clone(PROFILE))];
  return Object.fromEntries(all.map((s) => [s.id, s.reason]));
};

// a row's "Why:" label and the reason after it
function whyOf(row) {
  const label = H.findEl(row.outer, (e) => e.attrs['data-testid'] === 'wizard-workflow-why');
  const reasonEl = H.findEl(row.outer, (e) => e.attrs['data-testid'] === 'wizard-workflow-reason');
  const labelText = norm(textOf(label));
  const full = norm(textOf(reasonEl));
  const rest = norm(labelText && full.startsWith(labelText) ? full.slice(labelText.length) : full);
  return { found: !!label, classes: classesOf(label), labelText, reason: rest, reasonClasses: classesOf(reasonEl) };
}

// ---- 1. the "Why:" label is its own element ---------------------------------------------------------

for (const [lang, word] of [['en', /^Why:?$/], ['pt-BR', /^Por quê:?$/]]) {
  test(`#726 (${lang}) each of the four rows has its own "Why" label element, the reason after it`, { timeout: 20000 }, async () => {
    const app = await profiled({ lang });
    const found = rows(app);
    assert.deepEqual(found.map((r) => r.attrs['data-kind']), KINDS, 'the four rows');
    const labels = H.findAll(wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-workflow-why');
    assert.equal(labels.length, 4, 'one data-testid="wizard-workflow-why" per row');
    for (const row of found) {
      const kind = row.attrs['data-kind'];
      const w = whyOf(row);
      assert.equal(w.found, true, `the ${kind} row has data-testid="wizard-workflow-why"`);
      assert.match(w.labelText, word, `the ${kind} row's label reads only the word: "${w.labelText}"`);
      assert.equal(w.classes.includes('wizard-workflow-why'), true, `the ${kind} row's label has the class wizard-workflow-why`);
      assert.equal(w.reason.length > 0, true, `the ${kind} row's reason follows its label`);
      assert.equal(word.test(w.reason.split(' ')[0]), false, `the ${kind} row's reason does not repeat the label: "${w.reason}"`);
    }
  });
}

test('#726 the reason keeps its muted style', { timeout: 20000 }, async () => {
  const app = await profiled();
  for (const row of rows(app)) {
    assert.equal(whyOf(row).reasonClasses.includes('muted'), true, `the ${row.attrs['data-kind']} row's wizard-workflow-reason is muted`);
  }
});

test('#726 project-wizard.css highlights the "Why" label: accent colour, bold', () => {
  const css = fs.readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.wizard-workflow-why\b/.test(m[1]));
  assert.equal(rules.length > 0, true, 'a rule for .wizard-workflow-why');
  const body = rules.map((m) => m[2]).join(';');
  assert.match(body, /(^|[;\s])color\s*:\s*var\(--accent\)/, `its colour is var(--accent): ${body}`);
  assert.match(body, /font-weight\s*:\s*(bold|bolder|[6-9]00)\b/, `its weight is bold: ${body}`);
});

// ---- 2, 6. the reasons in the interface's language ----------------------------------------------------

for (const lang of ['en', 'pt-BR']) {
  test(`#726 (${lang}) each row shows the model's reason in the interface's language`, { timeout: 20000 }, async () => {
    const app = await profiled({ lang });
    const reasons = modelReasons(app);
    for (const kind of KINDS) {
      const expected = norm(resolve(reasons[kind], lang));
      assert.equal(/onboarding\./.test(expected), false, `the ${kind} reason resolves: "${expected}"`);
      const shown = whyOf(rowOf(app, kind)).reason;
      assert.equal(shown, expected, `the ${kind} row's reason in ${lang}`);
    }
  });
}

// ---- 5. pt-BR: none of the model's English -----------------------------------------------------------

test('#726 (pt-BR) the workflows column and the profile line hold none of the model\'s English texts', { timeout: 20000 }, async () => {
  const app = await profiled({ lang: 'pt-BR' });
  const column = columnText(app);
  const profile = profileText(app);
  assert.equal(column.length > 0, true, 'the workflows column is drawn');
  assert.equal(profile.length > 0, true, 'the profile line is drawn');
  assert.deepEqual(englishIn(column), [], `the column in pt-BR: ${column}`);
  assert.deepEqual(englishIn(profile), [], `the profile line in pt-BR: ${profile}`);
  assert.equal(/onboarding\.\w/.test(column + profile), false, 'no raw i18n key shows');
});

test('#726 (pt-BR) every select option reads in pt-BR, its value unchanged', { timeout: 20000 }, async () => {
  const app = await profiled({ lang: 'pt-BR' });
  const VALUES = {
    feature: ['remote-e2e', 'remote-code', 'local-e2e', 'local-code'],
    fix: ['remote-e2e', 'remote-code', 'local-e2e', 'local-code'],
    release: ['milestone', 'per-merge', 'train', 'rc-stable'],
    ci: ['none', 'release', 'pr+release'],
  };
  for (const kind of KINDS) {
    const options = optionsOf(rowOf(app, kind));
    assert.deepEqual(options.map((o) => o.attrs.value), VALUES[kind], `the ${kind} select's values`);
    for (const o of options) {
      const text = norm(H.visibleText(o.inner));
      assert.equal(text.length > 0, true, `the ${kind} option ${o.attrs.value} has a text`);
      assert.deepEqual(englishIn(text), [], `the ${kind} option ${o.attrs.value} in pt-BR: "${text}"`);
      assert.equal(/onboarding\./.test(text), false, `the ${kind} option ${o.attrs.value} is not a raw key: "${text}"`);
    }
  }
});

test('#726 (en) the select options and the profile line still read in English', { timeout: 20000 }, async () => {
  const app = await profiled();
  const texts = KINDS.flatMap((kind) => optionsOf(rowOf(app, kind)).map((o) => norm(H.visibleText(o.inner))));
  assert.equal(texts.includes('Remote PRs · E2E first'), true, `the English options: ${texts.join(' | ')}`);
  assert.equal(texts.includes('On pull requests and releases'), true, `the English options: ${texts.join(' | ')}`);
  assert.match(profileText(app), /pull requests/i);
});

// ---- 4. a live language switch -----------------------------------------------------------------------

test('#726 switching the interface to pt-BR with the wizard open draws the column again in pt-BR, the picks kept', { timeout: 20000 }, async () => {
  const app = await profiled();
  assert.equal(pickedOf(rowOf(app, 'feature')), 'remote-e2e', 'the profile\'s feature pick');
  await pickVariant(app, 'feature', 'local-code');
  await pickVariant(app, 'release', 'train');
  const enReason = whyOf(rowOf(app, 'fix')).reason;
  assert.equal(whyOf(rowOf(app, 'fix')).labelText.replace(/:$/, ''), 'Why', 'English before the switch');

  await switchLanguage(app, 'pt-BR');

  assert.equal(currentStep(app), 'analysis', 'the wizard stays on the analysis step');
  assert.equal(pickedOf(rowOf(app, 'feature')), 'local-code', 'the owner\'s feature pick is kept');
  assert.equal(pickedOf(rowOf(app, 'release')), 'train', 'the owner\'s release pick is kept');
  assert.equal(pickedOf(rowOf(app, 'ci')), 'pr+release', 'the untouched CI pick is kept');
  const fix = whyOf(rowOf(app, 'fix'));
  assert.equal(fix.labelText.replace(/:$/, ''), 'Por quê', `the label in pt-BR: "${fix.labelText}"`);
  assert.notEqual(fix.reason, enReason, 'the fix reason is drawn again in pt-BR');
  assert.deepEqual(englishIn(columnText(app)), [], `the column after the switch: ${columnText(app)}`);
  assert.deepEqual(englishIn(profileText(app)), [], `the profile line after the switch: ${profileText(app)}`);
});

test('#726 switching back to English draws the column in English again, the picks kept', { timeout: 20000 }, async () => {
  const app = await profiled({ lang: 'pt-BR' });
  await pickVariant(app, 'fix', 'local-e2e');
  await switchLanguage(app, 'en');
  assert.equal(pickedOf(rowOf(app, 'fix')), 'local-e2e', 'the owner\'s fix pick is kept');
  assert.equal(whyOf(rowOf(app, 'ci')).labelText.replace(/:$/, ''), 'Why', 'the label in English');
  const texts = optionsOf(rowOf(app, 'fix')).map((o) => norm(H.visibleText(o.inner)));
  assert.equal(texts.includes('Code + unit, then E2E · local merge'), true, `the fix options in English: ${texts.join(' | ')}`);
});
