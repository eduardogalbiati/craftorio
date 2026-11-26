// #781: the wizard's step 4 says what it reads and what it found (fronts/build/views/projects/project-wizard.js,
// project-wizard-workflows.js kindField). Acceptance tests, written before the code, on the real page, driven as
// project-wizard-review-642.test.js.
//
// The contract these tests assume:
// Backlog card (wizard-review-backlog):
// - api.backlogProgress(projectId) → { source: 'github' | 'gitlab' | ..., what: 'issues', read, total } | null.
// - while pending: ActivityLine wizard-review-backlog-activity data-state="running": /Reading issues from GitHub/ and
//   "40 of 120" (total unknown: "40"; null answer: the generic text, still running). Read when the review opens and
//   every second while the read lasts (the harness's setInterval never fires: here, the read at the opening).
// - done: the same testid data-state="done" with a summary counting the issues (/1 issue/); the list stays.
// - empty: done, says the catalog's onboarding.review_backlog_empty ("No open issues.").
// Languages (wizard-review-languages wrapper in the project card .wizard-review-project):
// - from facts.model.languages [{ language, lines, files }], the Health tab's markup: architecture-languages-bar,
//   architecture-language-segment, architecture-language-legend, architecture-language-entry; the order (share, Other
//   last), colours and percentages of languageShares (packages/shared/architecture-facts-view.js). Under 0.5% folds
//   into Other. The joined pill is gone. No code counted → no bar, no crash.
// Project type (kindField, wizard-kind-select):
// - detected kind = profile.kind (cur().onboarding?.profile or jobs.profile.profile).
// - known: the select shows that kind, the "Detect from the files" option is gone, wizard-kind-detected says
//   /Detected: backend/i (the kind's label).
// - not yet known: the select keeps onboarding.kind_detect as today, no wizard-kind-detected.
// - the owner changes it: their value wins and stays through re-renders; wizard-kind-detected goes.
// - Finish with the owner's change sends it (`kind`); Finish with no change sends no kind, as today (#735: the
//   engine reads the kind itself).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { clickRendered, existing } = require('@craftorio/front-analyser/test/project-page-helpers');

const PID = 'p-new';
const REPO = 'https://github.com/o/new.git';
const NAME = 'New one';
const PROJECT = { id: PID, name: NAME, repo: REPO, folder: 'C:/ws/repos/new', exists: true };
const jobs = (over = {}) => ({
  clone: { status: 'running' }, facts: { status: 'waiting' }, profile: { status: 'waiting' },
  projectMap: { status: 'waiting' }, ...over,
});
const CLI_OK = { provider: 'github', status: 'ok' };
const CLONING = { projectId: PID, status: 'cloning', jobs: jobs(), cli: CLI_OK };
const READY = { projectId: PID, status: 'ready', jobs: jobs({ clone: { status: 'done' } }), cli: CLI_OK };
const analyzed = (profile) => ({
  projectId: PID, status: 'analyzed', cli: CLI_OK,
  jobs: jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'done', ...(profile ? { profile } : {}) }, projectMap: { status: 'done' } }),
});
const ANALYZED = analyzed(null);
const DETECTED = analyzed({ mode: 'remote', ci: 'release', tests: 'unit', kind: 'backend' });

// lines: 1000 in all, so the shares read at once; YAML and TOML (0.3% together) fold into Other
const LANGUAGES = [
  { language: 'Rust', lines: 823, files: 40 }, { language: 'Markdown', lines: 114, files: 9 }, { language: 'Shell', lines: 60, files: 3 },
  { language: 'YAML', lines: 2, files: 1 }, { language: 'TOML', lines: 1, files: 1 },
];
const facts = (languages) => ({
  state: 'ok',
  exclude: [],
  model: {
    files: [{ file: 'src/main.rs', lines: 823, commits: 40, language: 'rust' }, { file: 'README.md', lines: 114, commits: 2, language: 'markdown' }],
    languages,
    danger_zone: [],
    complexity: { metric: 'cyclomatic', tool: 'test' },
  },
});
const CITY = { state: 'ok', model: { grouping: 'folders', districts: [{ id: 'src', name: 'src', buildings: [{ file: 'src/main.rs' }] }] }, validation: null, refresh: { suggested: false, unmatchedShare: 0, newFolders: [] }, mapRun: null };
const REPORT_VIEW = { report: { id: 'r1', date: '2026-10-20T10:00:00Z', head: null, simulated: true, report: { summary: 'A tool.', areas: [], findings: [] } }, previousId: null, gone: [], runsSince: 0, findings: [] };
const BACKLOG = { issues: [{ number: 12, title: 'Login fails on Safari', state: 'open', labels: [] }] };

const clone = (x) => JSON.parse(JSON.stringify(x));
const never = () => new Promise(() => {});

function page({ state = ANALYZED, api = {} } = {}) {
  return loadApp({
    api: {
      listProjects: async () => [clone(PROJECT)],
      startOnboarding: async () => clone(CLONING),
      onboardingStatus: async () => clone(state),
      analyzeOnboarding: async (id) => ({ ...clone(state), projectId: id }),
      retryOnboarding: async (id) => ({ ...clone(CLONING), projectId: id }),
      architectureEstimate: async () => ({ estimate: null }),
      architectureCity: async () => clone(CITY),
      architectureFacts: async () => clone(facts(LANGUAGES)),
      architectureReport: async () => clone(REPORT_VIEW),
      refactorProposals: async () => [],
      getBacklog: async () => clone(BACKLOG),
      ...api,
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
const allByTestId = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id);
const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const section = (app, id) => byTestId(wizardMarkup(app), id);
const classesOf = (e) => String(e.attrs.class || '').split(/\s+/).filter(Boolean);

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

// Fires `types` on a fake element (its own handlers, then the wizard root's delegated ones)
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

async function emit(app, state) {
  for (const fn of app.apiHandlers.onOnboardingChanged || []) fn(clone(state));
  await app.settle(10);
}

// The review with every analysis done (state: the onboarding it ends in)
async function atReview(opts = {}) {
  const app = page(opts);
  await app.boot();
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
  await emit(app, opts.state || ANALYZED);
  await press(app, 'wizard-next');
  assert.equal(currentStep(app), 'review');
  await app.settle(20);
  return app;
}

async function finish(app) {
  await Promise.race([press(app, 'wizard-finish'), app.settle(60)]);
  await app.settle(20);
}

// ---- the backlog card -----------------------------------------------------------------------------------

const activity = (app) => byTestId(section(app, 'wizard-review-backlog')?.outer || '', 'wizard-review-backlog-activity');
const reading = (progress) => ({ api: { getBacklog: never, backlogProgress: async () => clone(progress) } });

test('#781 while the backlog is read, its line runs and says how far: "Reading issues from GitHub", "40 of 120"', { timeout: 20000 }, async () => {
  const app = await atReview(reading({ source: 'github', what: 'issues', read: 40, total: 120 }));
  const line = activity(app);
  assert.equal(line?.attrs['data-state'], 'running');
  assert.match(textOf(line), /Reading issues from GitHub/);
  assert.equal(textOf(line).includes('40 of 120'), true, textOf(line));
});

test('#781 with the total unknown, the line says only how many were read', { timeout: 20000 }, async () => {
  const app = await atReview(reading({ source: 'github', what: 'issues', read: 40, total: null }));
  const meta = H.findEl(activity(app)?.outer || '', (e) => classesOf(e).includes('activity-line-meta'));
  assert.equal(textOf(meta), '40');
});

test('#781 with no progress known, the line keeps running on its generic text', { timeout: 20000 }, async () => {
  const app = await atReview(reading(null));
  const line = activity(app);
  assert.equal(line?.attrs['data-state'], 'running');
  assert.equal(textOf(line).length > 0, true, 'words, never blank');
});

test('#781 the progress is read, with the project, when the review opens', { timeout: 20000 }, async () => {
  const app = await atReview(reading(null));
  assert.equal(String(app.callsTo('backlogProgress')[0]?.[0]), PID);
});

test('#781 the backlog read: the line is done with a summary counting the issues, and the list stays', { timeout: 20000 }, async () => {
  const app = await atReview({ api: { backlogProgress: async () => null } });
  const line = activity(app);
  assert.equal(line?.attrs['data-state'], 'done');
  assert.match(textOf(line), /1 open issue/); // #37: the count says it counts the open issues
  assert.equal(textOf(section(app, 'wizard-review-backlog')).includes('Login fails on Safari'), true, 'the issue\'s row');
});

test('#781 an empty backlog: the line is done and says "No open issues."', { timeout: 20000 }, async () => {
  const app = await atReview({ api: { getBacklog: async () => ({ issues: [] }), backlogProgress: async () => null } });
  const line = activity(app);
  assert.equal(line?.attrs['data-state'], 'done');
  assert.equal(textOf(line).includes('No open issues.'), true, textOf(line));
});

// ---- the languages --------------------------------------------------------------------------------------

const projectCard = (app) => H.findEl(wizardMarkup(app), (e) => classesOf(e).includes('wizard-review-project'));
const languagesOf = (app) => byTestId(projectCard(app)?.outer || '', 'wizard-review-languages');
const segments = (app) => allByTestId(languagesOf(app)?.outer || '', 'architecture-language-segment');

test('#781 the project card shows the Health tab\'s languages bar and legend', { timeout: 20000 }, async () => {
  const app = await atReview();
  const box = languagesOf(app);
  assert.equal(box === null, false, 'data-testid="wizard-review-languages" in the project card');
  assert.equal(byTestId(box.outer, 'architecture-languages-bar') === null, false, 'the bar');
  assert.equal(byTestId(box.outer, 'architecture-language-legend') === null, false, 'the legend');
});

test('#781 the legend reads each language\'s share, largest first, Other last with what is under 0.5%', { timeout: 20000 }, async () => {
  const app = await atReview();
  const entries = allByTestId(languagesOf(app)?.outer || '', 'architecture-language-entry').map(textOf);
  assert.deepEqual(entries, ['Rust 82.3%', 'Markdown 11.4%', 'Shell 6%', 'Other 0.3%']);
});

test('#781 each segment has its share as its width', { timeout: 20000 }, async () => {
  const app = await atReview();
  const widths = segments(app).map((s) => /width:\s*([\d.]+)%/.exec(s.attrs.style || '')?.[1] ?? null);
  assert.deepEqual(widths, ['82.3', '11.4', '6', '0.3']);
});

test('#781 each segment has the language\'s colour, Other the neutral one', { timeout: 20000 }, async () => {
  const app = await atReview();
  const colours = segments(app).map((s) => /(#[0-9a-f]{6})/i.exec(s.attrs.style || '')?.[1]?.toLowerCase() ?? null);
  assert.deepEqual(colours, ['#dea584', '#083fa1', '#89e051', '#8b949e']);
});

test('#781 the joined languages pill is gone', { timeout: 20000 }, async () => {
  const app = await atReview();
  const chips = H.findAll(projectCard(app)?.outer || '', (e) => classesOf(e).includes('wizard-chip')).map(textOf);
  assert.equal(chips.includes('rust, markdown'), false, chips.join(' | '));
});

test('#781 no code counted: no bar, and the review still draws', { timeout: 20000 }, async () => {
  for (const languages of [[], [{ language: 'Rust', lines: 0, files: 1 }]]) {
    const app = await atReview({ api: { architectureFacts: async () => clone(facts(languages)) } });
    assert.equal(section(app, 'wizard-review') === null, false, 'the review');
    assert.equal(section(app, 'architecture-languages-bar'), null, 'no bar');
  }
});

// ---- the project type -----------------------------------------------------------------------------------

const kindSelect = (app) => byTestId(wizardMarkup(app), 'wizard-kind-select');
const kindOptions = (app) => H.findAll(kindSelect(app)?.outer || '', (e) => e.name === 'option');
const pickedKind = (app) => kindOptions(app).find((o) => 'selected' in o.attrs)?.attrs.value ?? null;

async function chooseKind(app, value) {
  const el = app.el('[data-testid="wizard-kind-select"]');
  el.value = value;
  el.dataset.testid = 'wizard-kind-select';
  await fire(app, el, ['input', 'change']);
}

test('#781 a kind the analysis detected shows in the select, with no "Detect from the files"', { timeout: 20000 }, async () => {
  const app = await atReview({ state: DETECTED });
  assert.equal(pickedKind(app), 'backend');
  assert.equal(kindOptions(app).map(textOf).includes('Detect from the files'), false, kindOptions(app).map(textOf).join(' | '));
});

test('#781 a detected kind says so: "Detected: Backend"', { timeout: 20000 }, async () => {
  const app = await atReview({ state: DETECTED });
  assert.match(textOf(section(app, 'wizard-kind-detected')), /Detected: backend/i);
});

test('#781 a kind not known yet keeps "Detect from the files", and says nothing detected', { timeout: 20000 }, async () => {
  const app = await atReview({ state: ANALYZED });
  assert.equal(kindOptions(app).map(textOf).includes('Detect from the files'), true, kindOptions(app).map(textOf).join(' | '));
  assert.equal(section(app, 'wizard-kind-detected'), null);
});

test('#781 the owner\'s kind wins over the detected one, and "Detected" goes', { timeout: 20000 }, async () => {
  const app = await atReview({ state: DETECTED });
  await chooseKind(app, 'frontend');
  assert.equal(pickedKind(app), 'frontend');
  assert.equal(section(app, 'wizard-kind-detected'), null);
});

test('#781 the owner\'s kind stays through a re-render', { timeout: 20000 }, async () => {
  const app = await atReview({ state: DETECTED });
  await chooseKind(app, 'frontend');
  await emit(app, DETECTED);
  assert.equal(pickedKind(app), 'frontend');
  assert.equal(section(app, 'wizard-kind-detected'), null);
});

test('#781 Finish sends the owner\'s kind', { timeout: 20000 }, async () => {
  const app = await atReview({ state: DETECTED });
  await chooseKind(app, 'frontend');
  await finish(app);
  assert.equal(app.callsTo('updateProject')[0]?.[1]?.kind, 'frontend');
});

test('#781 Finish with no change sends no kind: the engine reads it itself (#735)', { timeout: 20000 }, async () => {
  const app = await atReview({ state: DETECTED });
  await finish(app);
  const saved = app.callsTo('updateProject');
  assert.equal(saved.length, 1, 'the project saved');
  assert.equal(saved[0][1]?.kind == null, true, `the kind sent: ${saved[0][1]?.kind}`);
});
