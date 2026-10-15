// #382: the most connected files of the project city. The pure ranking (src/shared/city-connections.js:
// rank, edgesState) and the City view's connections panel (src/renderer/views/project/
// project-city-connections.js) in a mini DOM without WebGL: the list with the two counts and a
// search, a click flies to the file and pins its connections (city.setPins), a second click unpins,
// several pins at once, "Clear pins", and the message of a language without edges.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDom } = require('./mini-dom');
const { buildModel } = require('../src/shared/architecture-model');
const { buildCity } = require('../src/shared/city-model');
const CityConnections = require('../src/shared/city-connections');

const ROOT = path.join(__dirname, '..');
const hash = '11'.repeat(20);
const FILES = ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js', 'docs/x.md'].map((p) => ({ path: p, lines: 20 }));
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});
// a requires b and c; b requires c; d requires c: c is the most connected (required by 3)
const IMPORTS = [
  { from: 'src/a.js', text: "require('./b'); require('./c');" },
  { from: 'src/b.js', text: "require('./c')" },
  { from: 'src/d.js', text: "require('./c')" },
];
const cityWithEdges = () => buildCity({ plan: null, facts: facts(), sources: { imports: IMPORTS, manifests: {} } });

// ---------- the ranking ----------

test('#382 rank: every file with an edge, its two counts, the most connected first', () => {
  const { model } = cityWithEdges();
  const rows = CityConnections.rank({ edges: model.edges });
  // at the same total, the most required first (b is required by one file, a by none)
  assert.deepEqual(rows.map((r) => r.path), ['src/c.js', 'src/b.js', 'src/a.js', 'src/d.js']);
  assert.deepEqual(rows[0], { path: 'src/c.js', requires: 0, requiredBy: 3, total: 3 });
  assert.deepEqual(rows[1], { path: 'src/b.js', requires: 1, requiredBy: 1, total: 2 });
  assert.deepEqual(rows[2], { path: 'src/a.js', requires: 2, requiredBy: 0, total: 2 });
  assert.equal(rows.some((r) => r.path === 'docs/x.md'), false, 'a file with no edge is not listed');
});

test('#382 rank: the limit and the query', () => {
  const { model } = cityWithEdges();
  assert.deepEqual(CityConnections.rank({ edges: model.edges }, { limit: 2 }).map((r) => r.path), ['src/c.js', 'src/b.js']);
  assert.deepEqual(CityConnections.rank({ edges: model.edges }, { query: 'B.JS' }).map((r) => r.path), ['src/b.js']);
  assert.equal(CityConnections.RANK_LIMIT, 30);
  assert.deepEqual(CityConnections.rank({ edges: [] }), []);
  assert.deepEqual(CityConnections.rank(null), []);
});

test('#382 edgesState: edges, none between the files, or a language whose imports are not read', () => {
  assert.deepEqual(CityConnections.edgesState(cityWithEdges().model), { ok: true });
  assert.equal(CityConnections.edgesState({ edges: [] }).ok, false);
  const notRead = CityConnections.edgesState({ edges: 'not read for Python' });
  assert.equal(notRead.ok, false);
  assert.match(notRead.reason, /Python/);
});

// ---------- the panel ----------

function load(answer) {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} },
    api: { architectureCity: async () => answer },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null; // no WebGL
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-connections.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-city-connections.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'views', 'project', f), 'utf8'), sandbox, { filename: f });
  }
  return { w: sandbox, dom };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const qa = (el, id) => [...el.querySelectorAll(`[data-testid="${id}"]`)];
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(answer) {
  const { w, dom } = load(answer);
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(city.el);
  const pins = [];
  const flown = [];
  city.setPins = (paths) => pins.push([...paths]);
  city.flyTo = (name) => { flown.push(name); return true; };
  city.update({ facts: { state: 'ok', model: facts() } });
  await settle();
  const panel = w.ProjectCityConnections.attach(city);
  const click = (el) => el.dispatchEvent(new dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
  return { w, city, panel, pins, flown, click };
}

test('#382 the panel lists the most connected files with their counts, the most connected first', async () => {
  const { city, panel } = await open({ state: 'ok', ...cityWithEdges() });
  const rows = qa(city.el, 'city-connection');
  assert.equal(rows.length, 4);
  assert.match(text(rows[0]), /c\.js.*0.*3/, 'c.js: requires 0, required by 3');
  assert.ok(q(city.el, 'city-connections-search'), 'a search box');
  assert.equal(q(city.el, 'city-connections-clear'), null, 'nothing pinned yet: no Clear pins');
  panel.destroy();
  assert.equal(q(city.el, 'city-connections'), null);
});

test('#382 a click flies to the file and pins its connections; a second click unpins; Clear pins removes them all', async () => {
  const { city, panel, pins, flown, click } = await open({ state: 'ok', ...cityWithEdges() });
  const row = (p) => qa(city.el, 'city-connection').find((b) => b.dataset.pccFile === p);
  click(row('src/c.js'));
  assert.deepEqual(flown, ['src/c.js'], 'flies to it');
  assert.deepEqual(pins.at(-1), ['src/c.js'], 'its connections pinned');
  assert.equal(row('src/c.js').getAttribute('aria-pressed'), 'true');
  click(row('src/a.js'));
  assert.deepEqual(pins.at(-1), ['src/c.js', 'src/a.js'], 'several files pinned at once');
  assert.deepEqual([...panel.pins], ['src/c.js', 'src/a.js']); // spread: the panel's array is the sandbox's
  assert.match(text(q(city.el, 'city-connections-clear')), /Clear pins \(2\)/);
  click(row('src/c.js'));
  assert.deepEqual(pins.at(-1), ['src/a.js'], 'a second click unpins');
  assert.equal(row('src/c.js').getAttribute('aria-pressed'), 'false');
  click(q(city.el, 'city-connections-clear'));
  assert.deepEqual(pins.at(-1), [], 'Clear pins');
  assert.equal(q(city.el, 'city-connections-clear'), null);
});

test('#382 the search filters the list', async () => {
  const { w, city } = await open({ state: 'ok', ...cityWithEdges() });
  const box = q(city.el, 'city-connections-search');
  box.value = 'd.js';
  box.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.deepEqual(qa(city.el, 'city-connection').map((b) => b.dataset.pccFile), ['src/d.js']);
});

test('#382 a language without edges: the panel says so instead of an empty list', async () => {
  const { city } = await open({ state: 'ok', ...buildCity({ plan: null, facts: facts(), sources: { imports: [], manifests: {} } }) });
  assert.ok(q(city.el, 'city-connections'), 'the panel is there');
  assert.equal(qa(city.el, 'city-connection').length, 0);
  assert.match(text(q(city.el, 'city-connections-empty')), /No connections to list/);
});

test('#382 a new layout drops the pins it lacks and keeps the rest', async () => {
  const { w, city, pins, click } = await open({ state: 'ok', ...cityWithEdges() });
  const row = (p) => qa(city.el, 'city-connection').find((b) => b.dataset.pccFile === p);
  click(row('src/c.js'));
  click(row('src/d.js'));
  // the city reads a model without d.js
  const fewer = buildModel({
    head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
    files: FILES.filter((f) => f.path !== 'src/d.js').map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
    ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
  });
  w.api.architectureCity = async () => ({ state: 'ok', ...buildCity({ plan: null, facts: fewer, sources: { imports: IMPORTS.slice(0, 2), manifests: {} } }) });
  city.reload();
  await settle();
  assert.deepEqual(pins.at(-1), ['src/c.js'], 'd.js is gone, c.js stays pinned');
});
