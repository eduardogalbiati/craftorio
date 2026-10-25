// #373, the City view's states (src/renderer/views/project/project-city.js) in a mini DOM without
// WebGL: the facts still loading, not a git repository, an error with Retry, no plan (the folders,
// "Map this project" with its estimate), a stale plan (the unmatched share, "Refresh the map"), the
// plan's validation problems, no Arcs note for the edges not read (#428), the header's counts, and the overlay API's
// window.ProjectCity.current() / flyTo() on the city on screen.
// #440/#441 (the contract in test/project-city-modes-440.test.js and test/project-city-panels-441.test.js):
// a city on its own is in Explore (data-city-mode="explore", data-testid="city-mode-title" the project,
// no data-testid="city-mode-close"); the legend closes (city-legend-close) and a "Legend" button
// (city-legend-open) brings it back with the same rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDom } = require('./mini-dom');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { buildModel } = require('@multiagent/shared/architecture-model');
const { buildCity } = require('@multiagent/shared/city-model');

const ROOT = path.join(__dirname, '..');
const hash = '11'.repeat(20);
const FILES = [
  { path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/gates.js', lines: 30 }, { path: 'docs/a.md', lines: 5 }, { path: 'tools/x.py', lines: 9 },
];
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});
const PLAN = {
  version: 1, project: 'fixture', zones: [{ id: 'core', name: 'Core', kind: 'industrial' }, { id: 'ghost', name: 'Ghost', kind: 'civic' }],
  districts: [{ id: 'engine', name: 'Engine', zone: 'core', include: ['src/engine/**'] }, { id: 'lost', name: 'Lost', zone: 'nowhere', include: ['nothing/**'] }],
};

function load(answer) {
  const sandbox = {
    console, setTimeout, clearTimeout, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} },
    api: { architectureCity: typeof answer === 'function' ? answer : async () => answer },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox); // #330: the view reads its text from the catalog (English here)
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox);
  }
  // the view and its two helper modules (#381/#382: the notes and the cards have their own files)
  // #440/#441: the modes' and the panels' helpers, when they have their own files
  for (const f of [...OPTIONAL, 'project-city-notes.js', 'project-city-cards.js', 'project-city.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'project', f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}
const OPTIONAL = ['project-city-modes.js', 'project-city-panels.js'].filter((f) => fs.existsSync(path.join(ROOT, 'src', 'renderer', 'views', 'project', f)));

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(answer, { estimate = null, analysis = null } = {}) {
  const w = load(answer);
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app', onAnalyze: () => {} });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() }, estimate, analysis });
  return { w, city };
}

test('#373 City states: the facts still loading show a progress state', async () => {
  const { city } = await open(() => new Promise(() => {}));
  assert.ok(q(city.el, 'project-city-loading'), 'a loading state');
});

test('#373 City states: not a git repository, and an error with Retry', async () => {
  const notGit = (await open({ state: 'not-git', model: null, validation: null })).city;
  await settle();
  assert.match(text(q(notGit.el, 'project-city-not-git')), /Not a git repository/);
  const failed = (await open(async () => { throw new Error('boom'); })).city;
  await settle();
  assert.match(text(q(failed.el, 'project-city-error')), /boom/);
  assert.ok(failed.el.querySelector('[data-pc-retry]'), 'a Retry button');
});

test('#373 City states: no plan shows the folders and the tab\'s one action, "Analyze this project", with its estimate (#381)', async () => {
  const { city } = await open({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) }, { estimate: { usd: 0.42, basis: 3 }, analysis: { running: false, step: null, error: null, estimate: '≈ US$ 0.42', estimateTitle: 'the Oracle\'s analysis' } });
  await settle();
  const header = text(q(city.el, 'project-city-header'));
  assert.match(header, /fixture-app/);
  assert.match(header, /\b5 files\b/);
  assert.match(header, /no plan/);
  const note = q(city.el, 'project-city-no-plan');
  assert.match(text(note), /Analyze this project/);
  assert.match(text(note), /≈ US\$ 0\.42/);
  assert.equal(q(city.el, 'project-city-analyze').disabled, false, 'the action works (onAnalyze given)');
  assert.match(text(city.el), /WebGL/, 'and no WebGL here');
});

test('#381 City states: the action follows the run (running with its step, then its error), and the city reads the saved plan again', async () => {
  const { city, w } = await open({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) }, { analysis: { running: true, step: 'the cartographer writes the city plan', error: null, estimate: 'no estimate yet' } });
  await settle();
  assert.match(text(q(city.el, 'project-city-analyzing')), /Analyzing this project.*cartographer writes the city plan/);
  assert.equal(q(city.el, 'project-city-analyze'), null, 'no second start while it runs');
  city.update({ analysis: { running: false, step: null, error: 'the Oracle refused: daily budget', estimate: 'no estimate yet' } });
  assert.match(text(q(city.el, 'project-city-analysis-error')), /daily budget/);
  assert.ok(q(city.el, 'project-city-analyze'), 'Analyze again');
  // a run that saved a plan: reload reads architecture:city again (the plan's districts, not the folders)
  w.api.architectureCity = async () => ({ state: 'ok', ...buildCity({ plan: { ...PLAN, districts: [PLAN.districts[0]], zones: [PLAN.zones[0]] }, facts: facts() }) });
  city.reload();
  await settle();
  assert.equal(q(city.el, 'project-city-no-plan'), null, 'no "No city plan yet" once the plan is saved');
  assert.match(text(q(city.el, 'project-city-header')), /plan covers/);
});

test('#373 City states: a stale plan and its problems', async () => {
  const { city } = await open({ state: 'ok', ...buildCity({ plan: PLAN, facts: facts() }) });
  await settle();
  assert.match(text(q(city.el, 'project-city-stale')), /40% of the files \(2 of 5\)/);
  assert.ok(q(city.el, 'project-city-analyze'), 'Analyze this project (a refresh of the map)');
  const problems = text(q(city.el, 'project-city-problems'));
  assert.match(problems, /District lost names an unknown zone nowhere/);
  assert.match(problems, /District lost has no file/);
  assert.match(text(q(city.el, 'project-city-header')), /plan covers 60%/);
});

// #428: the Arcs note (the edges not read) is gone from the notes
test('#428 City states: no Arcs note when the edges were not read', async () => {
  const { city } = await open({ state: 'ok', ...buildCity({ plan: PLAN, facts: facts() }) });
  await settle();
  assert.equal(q(city.el, 'project-city-edges') === null, true, 'no data-testid="project-city-edges"');
  assert.doesNotMatch(text(city.el.querySelector('.pc-notes')), /\bArcs\b|draws no arc/);
});

test('#373 City: an update with the same facts and estimate keeps the HUD, a new estimate redraws the note', async () => {
  const w = load({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) });
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(city.el);
  const same = { state: 'ok', model: facts() };
  const estimate = { usd: 0.42, basis: 3 };
  city.update({ facts: same, estimate });
  await settle();
  const search = q(city.el, 'project-city-search');
  assert.equal(search === null, false, 'a search box');
  search.value = 'src/engine';
  city.update({ facts: same, estimate });
  city.update({ facts: same, estimate });
  assert.equal(q(city.el, 'project-city-search') === search, true, 'the same search box (the HUD was not redrawn)');
  assert.equal(q(city.el, 'project-city-search').value, 'src/engine', 'the typed text survives the poll');
  // #381: the action's estimate is the tab's combined one (the map and the Oracle's turn)
  city.update({ facts: same, estimate, analysis: { running: false, step: null, error: null, estimate: '≈ US$ 0.90', estimateTitle: 'the map and the analysis' } });
  assert.match(text(q(city.el, 'project-city-no-plan')), /≈ US\$ 0\.90/);
  city.destroy();
});

test('#373 City: the overlay API reaches the city on screen, and Colour by changes the legend', async () => {
  const { w, city } = await open({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) });
  await settle();
  assert.equal(w.ProjectCity.current().projectId, 'p1');
  assert.equal(w.ProjectCity.flyTo('src/engine/run.js'), true);
  assert.equal(w.ProjectCity.flyTo('no/such.js'), false);
  const legend = () => text(q(city.el, 'project-city-legend'));
  assert.match(legend(), /src/, 'zones by default (complexity not measured)');
  const select = city.el.querySelector('[data-pc-colour]');
  select.value = 'churn';
  select.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match(legend(), /commits/);
  city.destroy();
  assert.equal(w.ProjectCity.current(), null);
});

test('#440 City states: a city on its own is in Explore, titled with the project, without a Close', async () => {
  const { city } = await open({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) });
  await settle();
  assert.equal(String(city.el.getAttribute('data-city-mode') ?? ''), 'explore');
  assert.equal(text(q(city.el, 'city-mode-title')), 'fixture-app');
  assert.equal(q(city.el, 'city-mode-close') === null || q(city.el, 'city-mode-close').hidden === true, true, 'no Close in Explore');
  city.destroy();
});

test('#441 City states: the legend closes and a small "Legend" button brings it back with the same rows', async () => {
  const { city } = await open({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) });
  await settle();
  const legend = () => q(city.el, 'project-city-legend');
  const hidden = (el) => !el || el.hidden === true || el.classList.contains('hidden');
  const rows = text(legend());
  const x = q(city.el, 'city-legend-close');
  assert.equal(x === null, false, 'a close button on the legend');
  assert.equal(x.localName, 'button');
  x.click();
  assert.equal(hidden(legend()), true, 'the legend is closed');
  const reopen = q(city.el, 'city-legend-open');
  assert.equal(reopen === null || hidden(reopen), false, 'the "Legend" button');
  assert.equal(text(reopen), 'Legend');
  reopen.click();
  assert.equal(hidden(legend()), false, 'the legend is back');
  assert.equal(text(legend()), rows, 'with the same rows');
  assert.equal(hidden(q(city.el, 'city-legend-open')), true, 'the "Legend" button gives way');
  city.destroy();
});
