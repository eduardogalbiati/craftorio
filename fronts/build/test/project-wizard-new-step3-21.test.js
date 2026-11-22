// #21 acceptance, written before the code: step 3 of a new project (source 'new') speaks of the new project, not
// of an analysis of a repository. On the real page (packages/ui-kit/test/renderer-app-harness.js), driven as
// project-wizard-new-project-850.test.js.
//
// The contract assumed here:
// - a new project's step 3 never says onboarding.analyze_title ("Analyze <name>") nor onboarding.read_only;
// - its "Suggested workflows" column (data-testid="wizard-workflows-column") line under the title (its first <p>)
//   is not onboarding.workflows_line; it is a catalog text present in en and pt-BR (a key of its own, any name),
//   rendered in the interface's language, and it names the answers (/answer/i in English, /respost/i in pt-BR);
// - the left column's job rows (wizard-cost's li.wizard-job): none is left pending without a word. A row's state is
//   its status indicator's job-<status> class; a row is pending when that is job-waiting and it does not carry
//   a "left for later / not needed" explanation, data-testid="wizard-job-later-<id>" (the #850 convention);
// - an import's step 3 is unchanged: analyze_title as its heading, read_only, and workflows_line once the rows show.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const W = require('./project-wizard-helpers');

const I18N = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8'));
const fill = (s, params) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m));

const NAME = 'Field Notes';
const NEW_PID = 'field-notes';
const GH_IN = { provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'eduardo' };
const CREATED = {
  projectId: NEW_PID, name: NAME, status: 'ready', cli: null,
  jobs: {
    clone: { status: 'skipped' }, facts: { status: 'waiting' }, projectMap: { status: 'waiting' },
    profile: { status: 'done', profile: { mode: 'local', ci: 'release', release: 'milestone', tests: null, testCommand: null } },
  },
};

function newPage() {
  return loadApp({
    api: {
      listProjects: async () => [],
      onboardingAccounts: async () => [W.clone(GH_IN)],
      onboardingRepos: async () => [],
      createOnboarding: async () => W.clone(CREATED),
      onboardingStatus: async () => W.clone(CREATED),
      architectureEstimate: async () => null,
      getBacklog: async () => ({ issues: [] }),
    },
  });
}

async function newAtAnalysis({ lang = 'en' } = {}) {
  const app = newPage();
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  W.wizard(app).open();
  await app.settle(20);
  await W.press(app, 'wizard-source-new');
  await W.press(app, 'wizard-next');
  await W.typeInto(app, '#wizard-new-name', NAME);
  await W.press(app, 'wizard-next');
  await app.settle(20);
  assert.equal(W.currentStep(app), 'analysis', 'the new project is on step 3');
  return app;
}

async function importAtAnalysis({ lang = 'en' } = {}) {
  const app = await W.opened({});
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  await W.toRepository(app);
  await W.typeInto(app, '#wizard-repo', W.REPO);
  await W.typeInto(app, '#wizard-name', W.NAME);
  await W.press(app, 'wizard-next');
  await W.emit(app, W.CLONING);
  await W.emit(app, W.READY);
  if (W.currentStep(app) !== 'analysis') await W.press(app, 'wizard-next');
  assert.equal(W.currentStep(app), 'analysis', 'the import is on step 3');
  return app;
}

const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const bodyText = (app) => H.visibleText(W.wizardMarkup(app));
const heading = (app) => textOf(H.findEl(W.wizardMarkup(app), (e) => e.attrs.id === 'project-wizard-title'));
const column = (app) => W.byTestId(W.wizardMarkup(app), 'wizard-workflows-column');
const columnLine = (app) => textOf(H.findEl(column(app)?.outer || '', (e) => e.name === 'p'));

// the catalog keys whose text (its {params} any text) is exactly `line`, its own words at least half the line (a
// text that is mostly {params}, as "{a} of {b}", says nothing of its own)
function keysSaying(cat, line) {
  const quote = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Object.keys(cat).filter((k) => {
    if (typeof cat[k] !== 'string' || !cat[k].trim()) return false;
    const words = cat[k].split(/\{\w+\}/);
    if (words.join('').trim().length * 2 < line.length) return false;
    const re = new RegExp(`^${words.map(quote).join('.+')}$`);
    return re.test(line);
  });
}

// ---- a) the heading and the read-only line -----------------------------------------------------------------

for (const lang of ['en', 'pt-BR']) {
  test(`#21 new project step 3 (${lang}): no "${fill(catalog(lang)['onboarding.analyze_title'], { name: NAME })}" heading`, { timeout: 30000 }, async () => {
    const app = await newAtAnalysis({ lang });
    const old = fill(catalog(lang)['onboarding.analyze_title'], { name: NAME });
    assert.notEqual(heading(app), old, 'the step\'s heading');
    assert.equal(bodyText(app).includes(old), false, bodyText(app));
  });

  test(`#21 new project step 3 (${lang}): no read-only line (onboarding.read_only)`, { timeout: 30000 }, async () => {
    const app = await newAtAnalysis({ lang });
    const old = catalog(lang)['onboarding.read_only'];
    assert.equal(bodyText(app).includes(old), false, bodyText(app));
  });
}

// ---- b) the workflows line names the answers -------------------------------------------------------------------

test('#21 new project step 3 (en): the workflows line is not onboarding.workflows_line and names the answers', { timeout: 30000 }, async () => {
  const app = await newAtAnalysis();
  const line = columnLine(app);
  assert.ok(line, 'a line under the Suggested workflows title');
  assert.notEqual(line, fill(catalog('en')['onboarding.workflows_line'], { name: NAME }));
  assert.equal(bodyText(app).includes(fill(catalog('en')['onboarding.workflows_line'], { name: NAME })), false, bodyText(app));
  assert.match(line, /answer/i);
});

test('#21 new project step 3 (pt-BR): the workflows line is not onboarding.workflows_line and names the answers', { timeout: 30000 }, async () => {
  const app = await newAtAnalysis({ lang: 'pt-BR' });
  const line = columnLine(app);
  assert.ok(line, 'a line under the Suggested workflows title');
  assert.notEqual(line, fill(catalog('pt-BR')['onboarding.workflows_line'], { name: NAME }));
  assert.equal(bodyText(app).includes(fill(catalog('pt-BR')['onboarding.workflows_line'], { name: NAME })), false, bodyText(app));
  assert.match(line, /respost/i);
});

test('#21 new project step 3: the workflows line is a catalog text of its own, in en and pt-BR, shown in each language', { timeout: 30000 }, async () => {
  const en = catalog('en');
  const pt = catalog('pt-BR');
  const enLine = columnLine(await newAtAnalysis());
  const ptLine = columnLine(await newAtAnalysis({ lang: 'pt-BR' }));
  const old = [en['onboarding.workflows_line'], en['onboarding.workflows_choose_line']];
  const keys = keysSaying(en, enLine).filter((k) => !old.includes(en[k]));
  assert.equal(keys.length > 0, true, `an en catalog key says "${enLine}"`);
  const both = keys.filter((k) => typeof pt[k] === 'string' && keysSaying({ [k]: pt[k] }, ptLine).length === 1);
  assert.equal(both.length > 0, true, `the same key (${keys.join(', ')}) in pt-BR says "${ptLine}"`);
});

// ---- c) no row left pending without a word ----------------------------------------------------------------------

function jobRows(app) {
  const cost = W.byTestId(W.wizardMarkup(app), 'wizard-cost');
  return H.findAll(cost?.outer || '', (e) => e.name === 'li' && W.classesOf(e).includes('wizard-job'));
}
function rowState(row) {
  const dot = H.findEl(row.outer, (e) => e.outer !== row.outer && W.classesOf(e).some((c) => /^job-/.test(c)));
  const cls = dot ? W.classesOf(dot).find((c) => /^job-/.test(c)) : null;
  return cls ? cls.slice(4) : null;
}
const explained = (row) => !!H.findEl(row.outer, (e) => /^wizard-job-later-/.test(String(e.attrs['data-testid'] || '')));

test('#21 new project step 3: no job row is left pending (waiting) without saying it is not needed', { timeout: 30000 }, async () => {
  const app = await newAtAnalysis();
  const rows = jobRows(app);
  assert.equal(rows.length > 0, true, 'the job rows of step 3');
  const pending = rows.filter((r) => (rowState(r) === 'waiting' || rowState(r) === null) && !explained(r)).map(textOf);
  assert.deepEqual(pending, [], `rows pending without a word: ${pending.join(' | ')}`);
});

// ---- d) the import's step 3 is unchanged ------------------------------------------------------------------------

for (const lang of ['en', 'pt-BR']) {
  test(`#21 guard: an import's step 3 (${lang}) keeps "Analyze <name>", the read-only line and onboarding.workflows_line`, { timeout: 30000 }, async () => {
    const app = await importAtAnalysis({ lang });
    const cat = catalog(lang);
    assert.equal(heading(app), fill(cat['onboarding.analyze_title'], { name: W.NAME }));
    assert.equal(bodyText(app).includes(cat['onboarding.read_only']), true, bodyText(app));
    await W.press(app, 'wizard-workflows-choice-manual');
    assert.equal(columnLine(app), fill(cat['onboarding.workflows_line'], { name: W.NAME }));
  });
}
