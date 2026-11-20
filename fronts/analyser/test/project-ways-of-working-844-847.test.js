// #844 / #847 acceptance, written before the code: the Ways of working drawer
// (fronts/analyser/views/project/project-ways-of-working.js) shows the saved project's choices, a "no
// tests" state instead of unit tests, an open question as open, and in pt-BR no English label (the
// engine's open questions carry ids / i18n keys, the drawer reads their labels from i18n).
// Same mini DOM and fake window.api as project-ways-of-working-733.test.js.
//
// The contract assumed here:
// - the drawer is opened with the saved project (its workflows: feature / fix variant local-code, release
//   variant milestone, as the wizard's Finish saves them, #729; runDefaults.mode local, #735) and shows
//   those choices in its profile (data-testid="ways-of-working-profile") over a stale analysis that said
//   remote / train;
// - a profile with no test command and its tests unset (or 'none') reads "no tests" (English text holding
//   "no test"), never "Unit tests" / "testes unitários";
// - the questions are packages/engine/domains/workflow/workflow-compose.js openQuestions as the engine
//   answers them; in pt-BR none of today's English strings shows, nor a raw i18n key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const I18n = require('@multiagent/shared/i18n.js');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('@multiagent/ui-kit/test/mini-dom');

const FILE = pageFileOf('views/project/project-ways-of-working.js');
const loadCompose = () => require('@multiagent/engine/domains/workflow/workflow-compose');

const clone = (x) => JSON.parse(JSON.stringify(x));
const proposal = () => ({ workflows: [{ name: 'feature', category: 'feature', path: '.multiagent/workflows/feature.yaml', yaml: '' }], manifest: { path: '.multiagent/project.yaml', yaml: '' } });
const IDLE = { running: null, error: null };

// the imported repository of #844, as the fixed engine reads it: no test command, no CI
const NO_TESTS = { mode: 'local', release: null, testCommand: null, checkCommand: null, e2eCommand: null, ci: 'none', tests: null, languages: ['python'] };
const EVIDENCE = { team: { numbers: { authors: 3, identities: 5, commits: 26 }, commits: ['a1b2c3d4'] } };
const lastOf = (profile, questions = []) => ({ profile, evidence: EVIDENCE, questions, simulated: true, date: '2026-11-20T10:00:00.000Z', costUsd: 0 });

// the project as the wizard saved it (#729 workflows with their variant; #735 run defaults)
const SAVED = {
  id: 'p1', name: 'shop',
  workflows: [
    { name: 'feature', origin: 'bundled', category: 'build', variant: 'local-code' },
    { name: 'fix', origin: 'bundled', category: 'build', variant: 'local-code' },
    { name: 'release', origin: 'bundled', category: 'build', variant: 'milestone', ci: 'none' },
  ],
  runDefaults: { mode: 'local' },
};

const ENGLISH = [
  'Validate every round', 'Approve every change before it lands', 'The most one issue may spend on models',
  'Capture the screens a change touches', 'Trust auto', 'How hard the code review is', 'Light: one round',
  'Remote: pull requests', 'Unit tests',
];

function loadDrawer(last) {
  const api = {
    seedEstimate: async () => ({ costUsd: 0, free: true }),
    workflowInterview: async () => clone(last),
    workflowInterviewLast: async () => clone(last),
    workflowInterviewState: async () => clone(IDLE),
    workflowCompose: async () => proposal(),
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise, Date,
    api,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), showToast: () => {},
    fmtUsd: (n) => `$${Number(n).toFixed(2)}`,
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'project-ways-of-working.js' });
  const doc = dom.document;
  const q = (id) => doc.querySelector(`[data-testid="${id}"]`);
  const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const options = () => Array.from(doc.querySelectorAll('[data-testid="ways-of-working-drawer"] option')).map((o) => text(o));
  return { WOW: sandbox.ProjectWaysOfWorking, q, text, options };
}

const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r)); };

async function opened(t, last, { project = SAVED, lang = 'en' } = {}) {
  const was = I18n.getLanguage();
  I18n.setLanguage(lang);
  const w = loadDrawer(last);
  t.after(() => { w.WOW.close(); I18n.setLanguage(was); });
  await w.WOW.open(clone(project));
  await settle();
  return { ...w, profile: w.text(w.q('ways-of-working-profile')), drawer: w.text(w.q('ways-of-working-drawer')) };
}

test('#844 the profile shows the saved project\'s release (milestone), not a stale analysis\' train', async (t) => {
  const w = await opened(t, lastOf({ ...NO_TESTS, mode: 'remote', release: 'train' }));
  assert.ok(w.profile, 'the profile is shown');
  assert.match(w.profile, /milestone/i, `the profile: ${w.profile}`);
  assert.doesNotMatch(w.profile, /\btrain\b/i, `the profile: ${w.profile}`);
});

test('#844 the profile shows the saved project\'s local mode, not "Remote: pull requests"', async (t) => {
  const w = await opened(t, lastOf({ ...NO_TESTS, mode: 'remote', release: 'train' }));
  assert.equal(w.profile.includes(I18n.t('ways_of_working.merge_pr', undefined, 'en')), false, `the profile: ${w.profile}`);
  assert.equal(w.profile.includes(I18n.t('ways_of_working.merge_local', undefined, 'en')), true, `the profile: ${w.profile}`);
});

test('#844 no test command: the profile reads "no tests", never unit tests (tests unset or none)', async (t) => {
  for (const tests of [null, 'none']) {
    const w = await opened(t, lastOf({ ...NO_TESTS, tests }));
    assert.doesNotMatch(w.profile, /unit tests/i, `tests ${tests}: ${w.profile}`);
    assert.match(w.profile, /no tests?\b/i, `tests ${tests}: a "no tests" state in ${w.profile}`);
  }
});

test('#844 no test command, in pt-BR: the profile never says "testes unitários"', async (t) => {
  const w = await opened(t, lastOf(NO_TESTS), { lang: 'pt-BR' });
  assert.ok(w.profile, 'the profile is shown');
  assert.doesNotMatch(w.profile, /testes unitários/i, w.profile);
});

test('#844 a mode left open (an open question without a default) reads as open in the profile', async (t) => {
  const mode = { id: 'mode', label: 'ways_of_working.q_mode', question: 'ways_of_working.q_mode', type: 'choice', options: [{ value: 'local', label: 'ways_of_working.merge_local' }, { value: 'remote', label: 'ways_of_working.merge_pr' }], default: null };
  const w = await opened(t, lastOf({ ...NO_TESTS, mode: null }, [mode]), { project: { id: 'p1', name: 'shop' } });
  const line = `${I18n.t('ways_of_working.q_mode', undefined, 'en')}: ${I18n.t('ways_of_working.open', undefined, 'en')}`;
  assert.equal(w.profile.includes(line), true, `"${line}" in ${w.profile}`);
});

test('#847 in pt-BR the open questions show no English label, option or hint', async (t) => {
  const questions = loadCompose().openQuestions(NO_TESTS);
  const w = await opened(t, lastOf(NO_TESTS, questions), { lang: 'pt-BR' });
  assert.ok(w.drawer, 'the drawer is shown');
  const found = ENGLISH.filter((s) => w.drawer.includes(s));
  assert.deepEqual(found, [], 'English text in the drawer');
  const englishOptions = w.options().filter((o) => ['On', 'Off', 'Trust auto', 'Validate every round'].includes(o));
  assert.deepEqual(englishOptions, [], 'English options in the drawer\'s selects');
});

test('#847 in pt-BR no raw i18n key leaks into the drawer', async (t) => {
  const questions = loadCompose().openQuestions(NO_TESTS);
  const w = await opened(t, lastOf(NO_TESTS, questions), { lang: 'pt-BR' });
  const keys = w.drawer.match(/\b(?:ways_of_working|onboarding|workflow_compose)\.[A-Za-z0-9_.-]*[A-Za-z0-9_]/g) || [];
  assert.deepEqual(keys, [], 'raw keys in the drawer');
});
