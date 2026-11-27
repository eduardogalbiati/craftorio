// #23 acceptance, written before the code: the wizard's Review (step 4, fronts/build/views/projects/project-wizard.js)
// in pt-BR shows no English word: the languages bar's "Other" reads "Outras", a finding's severity "low" is
// translated ("baixa"), and the City card counts its districts with the City tab's word and a plural:
// "1 bairro", "2 bairros", never "1 zonas". Driven on the real page as project-wizard-review-loading-852.test.js.
// #100: the analysed review is reached with step 3's card Analyze with AI, then Next (a done profile job carries its profile).
//
// The contract assumed here:
// - onboarding.review_city is a plural (one / other) in en.json and pt-BR.json, its form picked by the district count;
// - the "Other" language share (packages/shared/architecture-facts-view.js languageShares) is shown in the interface
//   language; the finding's severity badge (data-testid="wizard-review-finding" > .badge) too.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const W = require('./project-wizard-helpers');

const PROJECT = { id: W.PID, name: W.NAME, repo: W.REPO, folder: 'C:/ws/repos/new', exists: true };
const DONE = {
  projectId: W.PID, status: 'analyzed', cli: W.CLI_OK,
  jobs: W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', profile: { mode: 'remote', ci: 'release', tests: 'unit' } }, projectMap: { status: 'done' } }),
};
// Shell is under 0.5% of the lines: it goes into the "Other" share
const LANGUAGES = [{ language: 'Rust', lines: 9990, files: 40 }, { language: 'Shell', lines: 10, files: 1 }];
const FACTS = { state: 'ok', exclude: [], model: { files: [{ file: 'src/main.rs', lines: 9990, commits: 40, language: 'rust' }], languages: LANGUAGES, danger_zone: [], complexity: { metric: 'cyclomatic', tool: 'test' } } };
const district = (id, files) => ({ id, name: id, buildings: files.map((file) => ({ file })) });
const cityOf = (districts) => ({ state: 'ok', model: { grouping: 'folders', districts }, validation: null, refresh: { suggested: false, unmatchedShare: 0, newFolders: [] }, mapRun: null });
const ONE_DISTRICT = cityOf([district('src', ['src/main.rs', 'src/lib.rs'])]);
const TWO_DISTRICTS = cityOf([district('src', ['src/main.rs', 'src/lib.rs']), district('docs', ['docs/a.md'])]);
const REPORT = {
  report: { id: 'r1', date: '2026-10-20T10:00:00Z', head: null, simulated: true, report: { summary: 'A tool.', areas: [], findings: [] } },
  previousId: null, gone: [], runsSince: 0,
  findings: [{ severity: 'low', title: 'Dead helper', kind: 'dead-code', files: [{ path: 'src/lib.rs' }] }],
};

async function atReview({ lang = 'pt-BR', city = ONE_DISTRICT } = {}) {
  const app = loadApp({
    api: {
      listProjects: async () => [W.clone(PROJECT)],
      startOnboarding: async () => W.clone(W.CLONING),
      onboardingStatus: async () => W.clone(DONE),
      analyzeOnboarding: async (id) => ({ ...W.clone(DONE), projectId: id }),
      retryOnboarding: async (id) => ({ ...W.clone(W.CLONING), projectId: id }),
      architectureEstimate: async () => ({ estimate: null }),
      architectureCity: async () => W.clone(city),
      architectureFacts: async () => W.clone(FACTS),
      architectureReport: async () => W.clone(REPORT),
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      backlogProgress: async () => null,
    },
  });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  W.wizard(app).open();
  await app.settle(10);
  await W.toRepository(app);
  await W.typeInto(app, '#wizard-repo', W.REPO);
  await W.typeInto(app, '#wizard-name', W.NAME);
  await W.press(app, 'wizard-next');
  await W.emit(app, W.CLONING);
  await W.emit(app, W.READY);
  await W.defineWorkflows(app, 'analyze');
  await W.emit(app, DONE);
  await W.toReview(app, 'analyze');
  await app.settle(20);
  return app;
}

const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const section = (app, id) => W.byTestId(W.wizardMarkup(app), id);
const allByTestId = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id);

test('#23 Review in pt-BR: the languages bar\'s small share reads "Outras", never "Other"', { timeout: 30000 }, async () => {
  const app = await atReview();
  const entries = allByTestId(W.wizardMarkup(app), 'architecture-language-entry').map(textOf);
  assert.equal(entries.length, 2, `two entries: ${JSON.stringify(entries)}`);
  assert.equal(entries.some((e) => /\bOther\b/.test(e)), false, JSON.stringify(entries));
  assert.equal(entries[1].startsWith('Outras'), true, JSON.stringify(entries));
});

test('#23 guard: Review in English, the small share still reads "Other"', { timeout: 30000 }, async () => {
  const app = await atReview({ lang: 'en' });
  const entries = allByTestId(W.wizardMarkup(app), 'architecture-language-entry').map(textOf);
  assert.equal(entries[1]?.startsWith('Other'), true, JSON.stringify(entries));
});

test('#23 Review in pt-BR: a finding\'s severity "low" reads "baixa"', { timeout: 30000 }, async () => {
  const app = await atReview();
  const row = W.byTestId(W.wizardMarkup(app), 'wizard-review-finding');
  assert.ok(row, 'the finding is shown');
  const badge = textOf(H.findEl(row.outer, (e) => W.classesOf(e).includes('badge')));
  assert.notEqual(badge, 'low');
  assert.equal(badge.toLowerCase(), 'baixa');
});

test('#23 Review in pt-BR, one district: the City card says "1 bairro", never "zonas"', { timeout: 30000 }, async () => {
  const app = await atReview({ city: ONE_DISTRICT });
  const said = textOf(section(app, 'wizard-review-city'));
  assert.match(said, /\b1 bairro\b/, said);
  assert.equal(said.includes('bairros'), false, said);
  assert.equal(/zonas?\b/i.test(said), false, said);
});

test('#23 Review in pt-BR, two districts: the City card says "2 bairros"', { timeout: 30000 }, async () => {
  const app = await atReview({ city: TWO_DISTRICTS });
  const said = textOf(section(app, 'wizard-review-city'));
  assert.match(said, /\b2 bairros\b/, said);
  assert.equal(/zonas?\b/i.test(said), false, said);
});
