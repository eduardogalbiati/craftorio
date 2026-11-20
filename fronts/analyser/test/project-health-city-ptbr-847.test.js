// #847 acceptance, written before the code: the Health tab (fronts/analyser/views/project/project-health.js
// with packages/shared/architecture-facts-view.js) and the City's "Mais conectados" panel
// (fronts/analyser/views/project/project-city-connections.js with packages/shared/city-connections.js) fully
// in pt-BR. Mini DOMs loaded as project-health-730.test.js and city-connections-382.test.js load them.
//
// The contract assumed here (the keys live in packages/shared/i18n/en.json and pt-BR.json):
// - with nothing excluded the exclusions line reads in Portuguese: no "nothing";
// - the complexity note (data-testid="architecture-complexity") reads in Portuguese: no "Complexity",
//   "measured for", "not measured";
// - the quality gate chips (data-testid="architecture-gate-chip") of a gate with nothing configured carry
//   no English state nor name ("missing", "Complexity", "Coverage", "Duplication");
// - the connections panel's empty text (data-testid="city-connections-empty") of a city without file edges
//   has no English reason ("import between the drawn files was found").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@multiagent/shared/i18n.js');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('@multiagent/ui-kit/test/mini-dom');
const { pageScripts, scriptFile } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { buildModel } = require('@multiagent/shared/architecture-model');
const { buildCity } = require('@multiagent/shared/city-model');

const ROOT = path.join(__dirname, '..', '..', '..');
const hash = '47'.repeat(20);
const day = '2026-11-01T00:00:00Z';

// a JavaScript file measured, a Python file not (no lizard), nothing excluded
const file = (f, language, complexity) => ({
  file: f, lines: 100, language, commits: 5, last_change: day, hotspot: 500, rank: 1, co_change: null,
  complexity, worst: complexity == null ? null : 3, functions: complexity == null ? null : 4,
  quadrant: complexity == null ? null : 'Healthy Closure', score: complexity == null ? null : 0.2,
});
const healthModel = () => ({
  branch: 'main', commits: 26, head: { commit: hash, date: day }, window: { since: null, until: null }, shallow: false,
  include_mass: true, mass_changes: [], pairs: [], frames: [], danger_zone: [],
  complexity: { status: 'measured', tool: 'code-health', metric: 'cyclomatic', functions: 4, check: null, unmeasured: ['Python'], needed: ['lizard'], reason: null, install: 'pip install lizard' },
  excluded: { build: 0, generated: 0, lock: 0, project: 0, tests: 0, vendored: 0 },
  files: [file('src/app.js', 'JavaScript', 7), file('src/tool.py', 'Python', null)],
  languages: [{ language: 'JavaScript', lines: 100, files: 1 }, { language: 'Python', lines: 100, files: 1 }],
});

const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r)); };
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function inLanguage(t, lang) {
  const was = I18n.getLanguage();
  I18n.setLanguage(lang);
  t.after(() => I18n.setLanguage(was));
}

// ---- Health ------------------------------------------------------------------------------------------

const SHARED = /\/packages\/shared\/(globs|json-schema|architecture-[\w-]+|city-[\w-]+|findings-model|code-complexity)\.js$/;
const projectScripts = () => pageScripts().filter((name) => SHARED.test(name) || name === 'date-range.js' || (name.startsWith('views/project/') && name !== 'views/project/project.js'));

async function openHealth(t, lang) {
  inLanguage(t, lang);
  const api = {
    architectureFacts: async () => ({ state: 'ok', model: healthModel(), exclude: [], gate: [] }),
    architectureReport: async () => ({ report: null, previousId: null, gone: [], runsSince: 0, running: null, findings: [] }),
    listArchitectureReports: async () => [],
    architectureEstimate: async () => ({ estimate: { usd: 0.5, basis: 2 } }),
    architectureCity: async () => ({ state: 'not-git', model: null, validation: null }),
    chainEstimate: async () => null,
    refactorProposals: async () => [],
    listProjects: async () => [{ id: 'p1', name: 'fixture', folder: 'C:/fixture', exists: true }],
    onEvent: () => () => {},
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (h) => clearTimeout(h),
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
    api, state: { projects: [{ id: 'p1', name: 'fixture', folder: 'C:/fixture', exists: true }], simulationOnly: true, pv: { id: 'p1', project: { id: 'p1', folder: 'C:/fixture' } } },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), fmtNum: (n) => String(n), fmtUsd: (n) => `US$ ${n}`, showToast: () => {}, openProjectView: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const name of projectScripts()) vm.runInContext(fs.readFileSync(scriptFile(name), 'utf8'), sandbox, { filename: path.basename(name) });
  const box = dom.document.createElement('div');
  dom.document.body.appendChild(box);
  sandbox.ProjectHealth.show('p1', box);
  await settle();
  return box;
}

test('#847 Health in pt-BR, nothing excluded: the exclusions line has no English "nothing"', async (t) => {
  const box = await openHealth(t, 'pt-BR');
  const line = text(box.querySelector('.arch-excluded'));
  assert.ok(line, 'the exclusions line is shown');
  assert.doesNotMatch(line, /\bnothing\b/i, line);
});

test('#847 Health in pt-BR: the complexity note is in Portuguese', async (t) => {
  const box = await openHealth(t, 'pt-BR');
  const line = text(box.querySelector('[data-testid="architecture-complexity"]'));
  assert.ok(line, 'the complexity note is shown');
  for (const english of ['Complexity', 'measured for', 'not measured']) assert.equal(line.includes(english), false, `"${english}" in "${line}"`);
});

test('#847 Health in pt-BR: the quality gate chips carry no English name or state', async (t) => {
  const box = await openHealth(t, 'pt-BR');
  const chips = Array.from(box.querySelectorAll('[data-testid="architecture-gate-chip"]')).map((el) => text(el));
  assert.equal(chips.length, 3, `the gate's chips: ${JSON.stringify(chips)}`);
  const english = chips.filter((c) => /missing|pending|Complexity|Coverage|Duplication/.test(c));
  assert.deepEqual(english, [], 'chips with English text');
});

// ---- City: Mais conectados -----------------------------------------------------------------------------

// JavaScript files whose imports are read, none importing another: no file edge
const FILES = ['src/a.js', 'src/b.js', 'docs/x.md'].map((p) => ({ path: p, lines: 20 }));
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

async function openCity(answer) {
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
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-connections.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-city-connections.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'fronts', 'analyser', 'views', 'project', f), 'utf8'), sandbox, { filename: f });
  }
  const city = sandbox.ProjectCity.create({ projectId: 'p1', name: 'fixture' });
  sandbox.document.body.appendChild(city.el);
  city.setPins = () => {};
  city.flyTo = () => true;
  city.update({ facts: { state: 'ok', model: facts() } });
  await settle();
  sandbox.ProjectCityConnections.attach(city);
  return city;
}

test('#847 City in pt-BR, no file edges: "Mais conectados" says so with no English reason', async (t) => {
  inLanguage(t, 'pt-BR');
  const city = await openCity({ state: 'ok', ...buildCity({ plan: null, facts: facts(), sources: { imports: [], manifests: {} } }) });
  const empty = text(city.el.querySelector('[data-testid="city-connections-empty"]'));
  assert.ok(empty, 'the empty text is shown');
  assert.equal(empty.includes('import between the drawn files was found'), false, empty);
});
