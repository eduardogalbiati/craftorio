// fronts/build/views/backlog/backlog.js refreshAlert (#161, #784): the Backlog Refresh banner's title. With
// a past refresh it says how long ago; with none and a baseline (the project's add time, `since`) it says
// "not refreshed since the project was added" with the merges since; with neither, "never refreshed".
// `ago` and `refreshAlert` are pulled out of the source and run in a vm sandbox with the real catalog;
// the rest of the screen is not loaded. Assertions compare strings only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@multiagent/shared/i18n.js');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const src = fs.readFileSync(pageFileOf('views/backlog/backlog.js'), 'utf8');
const pick = (re) => {
  const m = re.exec(src);
  assert.ok(m, `${re} not found in backlog.js: the source moved`);
  return m[0];
};

// the alerts refreshAlert returns for `refresh` (the service's data.refresh), as plain { level, title, text, actions }
function alertsFor(refresh) {
  const sandbox = withI18n({ window: {}, REFRESH: refresh });
  vm.createContext(sandbox);
  vm.runInContext(
    `const bl = { projectId: 'p1', data: { refresh: REFRESH } };
     const project = () => ({ id: 'p1', repo: 'https://github.com/example/p1' });
     const openRun = () => {}; const refreshNow = () => {}; const setData = () => {}; const render = () => {};
     const errMsg = (e) => String(e); const api = {};
     const dateOf = (iso) => String(iso).slice(0, 10);
     ${pick(/const ago = \(h\) => [^\n]*\n/)}
     ${pick(/function refreshAlert\(\) \{[\s\S]*?\n  \}\n/)}
     this.out = JSON.stringify(refreshAlert().map((a) => ({ level: a.level, title: a.title, text: a.text, actions: a.actions.map((x) => x.label) })));`,
    sandbox,
  );
  return JSON.parse(sandbox.out);
}

const due = (extra) => ({ interval: 24, running: null, dismissed: false, due: true, ...extra });

test.afterEach(() => I18n.setLanguage('en'));

test('#784 no refresh run, a baseline and merges since: the title says not refreshed since the project was added, with the merges', () => {
  const [alert, ...rest] = alertsFor(due({ lastRun: null, since: '2026-11-10T08:00:00.000Z', hoursAgo: 52, merges: 12 }));
  assert.equal(rest.length, 0);
  assert.equal(alert.level, 'warning');
  assert.equal(alert.title, 'Backlog not refreshed since the project was added · 12 merges since');
  assert.equal(/never refreshed/i.test(alert.title), false);
  assert.deepEqual(alert.actions, ['Refresh now', 'Dismiss for today']);
});

test('#784 the same banner in Português (Brasil) reads "desde que o projeto entrou" with the merges since', () => {
  I18n.setLanguage('pt-BR');
  const [alert] = alertsFor(due({ lastRun: null, since: '2026-11-10T08:00:00.000Z', hoursAgo: 52, merges: 1 }));
  assert.equal(alert.title, 'Backlog não atualizado desde que o projeto entrou · 1 merge desde então');
  assert.equal(/nunca atualizado/i.test(alert.title), false);
});

test('#784 no refresh run and no baseline: the title keeps "never refreshed"', () => {
  const [alert] = alertsFor(due({ lastRun: null, since: null, hoursAgo: null, merges: null }));
  assert.equal(alert.title, 'Backlog never refreshed');
});

test('#784 a past refresh run: the title keeps "refreshed <ago>" with the merges since', () => {
  const [alert] = alertsFor(due({ lastRun: { runId: 'r1', startedAt: '2026-11-10T08:00:00.000Z', mock: false }, since: '2026-11-10T08:00:00.000Z', hoursAgo: 30, merges: 2 }));
  assert.equal(alert.title.startsWith('Backlog refreshed '), true, alert.title);
  assert.equal(alert.title.includes('30'), true, alert.title);
  assert.equal(alert.title.endsWith(' · 2 merges since'), true, alert.title);
  assert.equal(alert.text.includes('r1'), true, 'the last run is named');
});

test('#784 nothing due (a just-onboarded project): no banner', () => {
  assert.equal(alertsFor({ interval: 24, running: null, lastRun: null, since: '2026-11-13T11:00:00.000Z', hoursAgo: 1, merges: 0, due: false }).length, 0);
});
