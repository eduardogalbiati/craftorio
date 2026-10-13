// #373, the City view's states (src/renderer/views/project/project-city.js) in a mini DOM without
// WebGL: the facts still loading, not a git repository, an error with Retry, no plan (the folders,
// "Map this project" with its estimate), a stale plan (the unmatched share, "Refresh the map"), the
// plan's validation problems, the edges not read, the header's counts, and the overlay API's
// window.ProjectCity.current() / flyTo() on the city on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDom } = require('./mini-dom');
const { buildModel } = require('../src/shared/architecture-model');
const { buildCity } = require('../src/shared/city-model');

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
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'shared', f), 'utf8'), sandbox);
  }
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'project', 'project-city.js'), 'utf8'), sandbox);
  return sandbox;
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(answer, { estimate = null } = {}) {
  const w = load(answer);
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() }, estimate });
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

test('#373 City states: no plan shows the folders, "Map this project" and its estimate', async () => {
  const { city } = await open({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) }, { estimate: { usd: 0.42, basis: 3 } });
  await settle();
  const header = text(q(city.el, 'project-city-header'));
  assert.match(header, /fixture-app/);
  assert.match(header, /\b5 files\b/);
  assert.match(header, /no plan/);
  const note = q(city.el, 'project-city-no-plan');
  assert.match(text(note), /Map this project/);
  assert.match(text(note), /≈ US\$ 0\.42/);
  assert.match(text(city.el), /WebGL/, 'and no WebGL here');
});

test('#373 City states: a stale plan, its problems and the edges not read', async () => {
  const { city } = await open({ state: 'ok', ...buildCity({ plan: PLAN, facts: facts() }) });
  await settle();
  assert.match(text(q(city.el, 'project-city-stale')), /40% of the files \(2 of 5\)/);
  assert.ok(q(city.el, 'project-city-refresh-map'), 'Refresh the map');
  const problems = text(q(city.el, 'project-city-problems'));
  assert.match(problems, /District lost names an unknown zone nowhere/);
  assert.match(problems, /District lost has no file/);
  assert.match(text(q(city.el, 'project-city-edges')), /not read for/);
  assert.match(text(q(city.el, 'project-city-header')), /plan covers 60%/);
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
  city.update({ facts: same, estimate: { usd: 0.9, basis: 4 } });
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
