// #71 What the screens say of a run on a project with no tests, and of a gate the supervisor answered.
// Acceptance tests written before the code.
//
// Seams: the whole page in its harness (packages/ui-kit/test/renderer-app-harness.js), the run's
// events fired as the preload does, and the roadmap's markup (roadmap-status-helpers loadRoadmap, as
// renderer-roadmap-header-750.test.js loads it), in English and pt-BR with the real catalogs.
//
// Contract chosen here: the run's `tested` is "no tests" (summary.json and the run's row), a roadmap
// item carries `tested: "no tests"`, the base check's state is `no_tests`.
// The words: en "no tests" (the project has no tests), pt-BR "não tem testes".
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadApp, text } = require('@craftorio/ui-kit/test/renderer-app-harness');
const H = require('./roadmap-status-helpers');

const ts = (s) => `2026-11-25T10:00:${String(s).padStart(2, '0')}.000Z`;
const WORDS = { en: /no tests/i, 'pt-BR': /não tem testes/i };
const NEVER = /Testes não passaram|Not tested green/i;

async function openPage(t, lang = 'en') {
  const page = loadApp({ api: { listActiveRuns: async () => [] } });
  await page.boot();
  page.run(`I18n.setLanguage(${JSON.stringify(lang)})`);
  t.after(() => page.run("I18n.setLanguage('en')"));
  return page;
}
const fire = (page, ev) => { for (const fn of page.apiHandlers.onEvent || []) fn(ev); };
const start = { seq: 1, run_id: 'r1', ts: ts(0), type: 'workflow.started', workflow: 'feature', version: '1', mock: true, inputs: { task: 'x' }, steps: [{ id: 'suite' }, { id: 'test_failed' }, { id: 'build' }], groups: [] };
const logLines = (page) => JSON.parse(page.run("JSON.stringify((state.runs.get('r1')?.orchLog || []).map((l) => l.text))"));

for (const lang of ['en', 'pt-BR']) {
  test(`#71 run: the pill of a run with no tests says the project has no tests, never that tests failed (${lang})`, async (t) => {
    const page = await openPage(t, lang);
    const pill = text(String(page.run("testedPillHtml({ tested: 'no tests', testedFailures: [] })")));
    assert.match(pill, WORDS[lang]);
    assert.doesNotMatch(pill, NEVER);
  });

  test(`#71 run: a gate the supervisor answered says so on the Run screen, with its answer (${lang})`, async (t) => {
    const page = await openPage(t, lang);
    fire(page, start);
    const before = logLines(page).length;
    fire(page, { seq: 2, run_id: 'r1', ts: ts(1), type: 'supervisor.decision', step_id: 'test_failed', kind: 'escalation', action: 'route', route: 'continue', explanation: 'The change is a README.' });
    const line = logLines(page).slice(before).join('\n');
    assert.match(line, lang === 'en' ? /supervisor answered/i : /supervisor respondeu/i);
    assert.match(line, /test_failed/);
    assert.match(line, /continue/i);
  });

  test(`#71 roadmap: the base check of a project with no tests says so (${lang})`, (t) => {
    const out = roadmap(t, lang);
    const html = render(out, { baseCheck: { status: 'no_tests', commit: 'abcdef1234567890', startedAt: ts(0), endedAt: new Date().toISOString(), failures: null, error: null } });
    const card = html.match(/<div class="rm-base-check[\s\S]*?<\/div>/)?.[0] || '';
    assert.match(text(card), WORDS[lang]);
    assert.doesNotMatch(text(card), /não rodou|could not run|no test command/i);
  });

  test(`#71 roadmap: the item of a run with no tests says the project has no tests (${lang})`, (t) => {
    const out = roadmap(t, lang);
    const html = render(out, {}, [H.item('i1', 'done', 1, 'Issue 1', { tested: 'no tests' })]);
    assert.match(text(html), WORDS[lang]);
    assert.doesNotMatch(text(html), NEVER);
  });
}

// ---- the roadmap's markup ----

function roadmap(t, lang) {
  const out = H.loadRoadmap();
  out.sandbox.navigator = { platform: 'linux' };
  out.sandbox.api.platform = 'linux';
  out.sandbox.devMode = () => false;
  vm.runInContext(H.read('term-dock.js'), out.sandbox);
  vm.runInContext(H.read('views', 'backlog', 'backlog-live.js'), out.sandbox);
  const summary = ['..', '..', '..', 'packages', 'shared', 'roadmap-summary.js'];
  if (H.exists(...summary)) vm.runInContext(H.read(...summary), out.sandbox);
  out.sandbox.I18n.setLanguage(lang);
  t.after(() => out.sandbox.I18n.setLanguage('en'));
  return out;
}
const render = (out, extra, items = [H.item('i1', 'done', 1, 'Issue 1', {})]) => out.R.html(
  { roadmap: { state: 'running', stages: [{ id: 'st1', name: '', note: '', items }] }, ...extra },
  () => {}, { showAll: true, since: '24h' },
);
