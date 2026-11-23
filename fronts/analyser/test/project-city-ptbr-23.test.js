// #23 acceptance, written before the code: the City tab (fronts/analyser/views/project/project-city.js, the legend
// built by packages/shared/city-layout.js colourBy) in pt-BR: the "Colorir por" options are Portuguese (no
// "Quadrant", "Zone"), the legend's rows too ("No commit" gone; "4 commits" may stay, "commits" is accepted in
// pt-BR), and the "Colorir por Quadrant" button text of the notes is gone. Mini DOM loaded as
// project-health-city-ptbr-847.test.js loads the City; the colour picked through the owner's remembered choice
// (localStorage cityColour, project-city-notes.js openingColour).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n.js');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');
const { buildModel } = require('@craftorio/shared/architecture-model');
const { buildCity } = require('@craftorio/shared/city-model');

const ROOT = path.join(__dirname, '..', '..', '..');
const hash = '23'.repeat(20);
const FILES = ['src/a.js', 'src/b.js', 'docs/x.md'].map((p) => ({ path: p, lines: 20 }));
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r)); };
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function inLanguage(t, lang) {
  const was = I18n.getLanguage();
  I18n.setLanguage(lang);
  t.after(() => I18n.setLanguage(was));
}

async function openCity(colour) {
  const answer = { state: 'ok', ...buildCity({ plan: null, facts: facts(), sources: { imports: [], manifests: {} } }) };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: (k) => (k === 'cityColour' ? JSON.stringify({ p1: colour }) : null), setItem: () => {} },
    api: { architectureCity: async () => answer },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-connections.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city-panels.js', 'project-city.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'fronts', 'analyser', 'views', 'project', f), 'utf8'), sandbox, { filename: f });
  }
  const city = sandbox.ProjectCity.create({ projectId: 'p1', name: 'fixture' });
  sandbox.document.body.appendChild(city.el);
  city.setPins = () => {};
  city.flyTo = () => true;
  city.update({ facts: { state: 'ok', model: facts() } });
  await settle();
  const el = city.el;
  return {
    options: Array.from(el.querySelectorAll('[data-testid="project-city-colour"] option')).map(text),
    legend: text(el.querySelector('[data-testid="project-city-legend"]')),
  };
}

test('#23 City in pt-BR: the "Colorir por" options are Portuguese (no Quadrant, Zone)', async (t) => {
  inLanguage(t, 'pt-BR');
  const c = await openCity('churn');
  assert.equal(c.options.length, 3, JSON.stringify(c.options));
  const english = c.options.filter((o) => /^(Quadrant|Zone|Churn)$/.test(o));
  assert.deepEqual(english, [], `English options: ${JSON.stringify(c.options)}`);
  assert.equal(c.options.some((o) => /\bQuadrant\b|\bZone\b/.test(o)), false, JSON.stringify(c.options));
});

test('#23 City in pt-BR, coloured by churn: the legend has no "No commit"', async (t) => {
  inLanguage(t, 'pt-BR');
  const c = await openCity('churn');
  assert.ok(c.legend, 'the legend is shown');
  assert.equal(c.legend.includes('No commit'), false, c.legend);
});

test('#23 City in pt-BR, coloured by zone: the legend\'s title is not "Zone"', async (t) => {
  inLanguage(t, 'pt-BR');
  const c = await openCity('zone');
  assert.ok(c.legend, 'the legend is shown');
  assert.equal(/\bZone\b/.test(c.legend), false, c.legend);
});

test('#23 City in pt-BR, coloured by quadrant: no English quadrant name nor "Quadrant" in the legend', async (t) => {
  inLanguage(t, 'pt-BR');
  const c = await openCity('quadrant');
  assert.ok(c.legend, 'the legend is shown');
  const english = ['Quadrant', 'Fertile Ground', 'Cowboy Code', 'Healthy Closure', 'Not measured'].filter((s) => new RegExp(`\\b${s}\\b`).test(c.legend));
  assert.deepEqual(english, [], c.legend);
});

test('#23 the City\'s churn legend through CityLayout.colourBy in pt-BR: no "No commit" row', (t) => {
  inLanguage(t, 'pt-BR');
  const CityLayout = require('@craftorio/shared/city-layout');
  const model = buildCity({ plan: null, facts: facts(), sources: { imports: [], manifests: {} } }).model;
  const layout = CityLayout.layoutCity(model, {});
  const labels = CityLayout.colourBy(layout, 'churn').legend.map((l) => l.label);
  assert.equal(labels.length, 3, JSON.stringify(labels));
  assert.equal(labels.includes('No commit'), false, JSON.stringify(labels));
});

test('#23 the City\'s quadrant legend through CityLayout.colourBy in pt-BR: no English quadrant name', (t) => {
  inLanguage(t, 'pt-BR');
  const CityLayout = require('@craftorio/shared/city-layout');
  const model = buildCity({ plan: null, facts: facts(), sources: { imports: [], manifests: {} } }).model;
  const labels = CityLayout.colourBy(CityLayout.layoutCity(model, {}), 'quadrant').legend.map((l) => l.label);
  assert.equal(labels.length > 0, true, 'the legend has rows');
  const english = labels.filter((l) => ['Fertile Ground', 'Cowboy Code', 'Healthy Closure', 'Not measured'].includes(l));
  assert.deepEqual(english, [], JSON.stringify(labels));
});

test('#23 pt-BR: the notes\' "Colorir por …" buttons name no English mode (no "Colorir por Quadrant")', () => {
  const pt = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', 'pt-BR.json'), 'utf8'));
  for (const key of ['project_city.colour_by_quadrant', 'project_city.colour_by_churn']) {
    assert.equal(typeof pt[key], 'string', key);
    assert.doesNotMatch(pt[key], /\bQuadrant\b|\bZone\b/, `${key}: ${pt[key]}`);
  }
  assert.notEqual(pt['project_city.colour_by_quadrant'], 'Colorir por Quadrant');
});

test('#23 guard: City in English keeps "Quadrant", "Zone", "Churn" and "No commit"', async (t) => {
  inLanguage(t, 'en');
  const c = await openCity('churn');
  assert.deepEqual(c.options, ['Quadrant', 'Zone', 'Churn']);
  assert.equal(c.legend.includes('No commit'), true, c.legend);
});
