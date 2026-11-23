// #23 acceptance, written before the code: the Health tab (fronts/analyser/views/project/project-health.js) and its
// Seeds (project-seeds.js) in pt-BR show no English: the quadrants of the files table ("Fertile Ground",
// "Cowboy Code", "Healthy Closure"), the findings' filters ("High", "Medium", "Low", "New", "Kept"), and the bundled
// seeds' description and cost ("Hotspots where files change often…", "Custo: one Oracle turn").
// Mini DOMs loaded as project-health-city-ptbr-847.test.js (Health) and project-seeds-360.test.js (Seeds); the seeds'
// rows are the bundled seeds as packages/engine/domains/seed/seeds.js listSeeds reads them (seeds/).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n.js');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');
const { pageScripts, scriptFile } = require('@craftorio/ui-kit/test/renderer-app-harness');

const ROOT = path.join(__dirname, '..', '..', '..');
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(ROOT, rel);
const hash = '23'.repeat(20);
const day = '2026-11-01T00:00:00Z';

const file = (f, quadrant, complexity, commits) => ({
  file: f, lines: 100, language: 'JavaScript', commits, last_change: day, hotspot: 100 * commits, rank: 1, co_change: null,
  complexity, worst: 3, functions: 4, quadrant, score: 0.2,
});
const healthModel = () => ({
  branch: 'main', commits: 26, head: { commit: hash, date: day }, window: { since: null, until: null }, shallow: false,
  include_mass: true, mass_changes: [], pairs: [], frames: [], danger_zone: [],
  complexity: { status: 'measured', tool: 'code-health', metric: 'cyclomatic', functions: 12, check: null, unmeasured: [], needed: [], reason: null, install: null },
  excluded: { build: 0, generated: 0, lock: 0, project: 0, tests: 0, vendored: 0 },
  files: [file('src/a.js', 'Fertile Ground', 2, 9), file('src/b.js', 'Cowboy Code', 12, 1), file('src/c.js', 'Healthy Closure', 2, 1)],
  languages: [{ language: 'JavaScript', lines: 300, files: 3 }],
});
const FINDINGS = [
  { kind: 'god-file', title: 'The run loop does too much.', severity: 'high', status: 'new', files: [{ path: 'src/a.js' }], evidence: 'It changes in every commit.', refactor: 'Split the loop.' },
  { kind: 'duplicated-rule', title: 'The queue repeats the rule.', severity: 'medium', status: 'kept', files: [{ path: 'src/b.js' }], evidence: 'Two copies.', refactor: 'Keep one.' },
  { kind: 'naming', title: 'The names are unclear.', severity: 'low', status: 'new', files: [{ path: 'src/c.js' }], evidence: 'm1, m2.', refactor: 'Name them.' },
];
const reportView = () => ({
  report: { id: 'r1', date: '2026-10-20T10:00:00Z', head: { commit: hash }, simulated: true, report: { summary: 'A tool.', areas: [], findings: FINDINGS.map(({ status, ...f }) => f) } },
  previousId: 'r0', gone: [], runsSince: 0, running: null,
  findings: FINDINGS.map((f) => ({ ...f, filed: null, sent: false, sentTo: null })),
});

const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r)); };
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function inLanguage(t, lang) {
  const was = I18n.getLanguage();
  I18n.setLanguage(lang);
  t.after(() => I18n.setLanguage(was));
}

const SHARED = /\/packages\/shared\/(globs|json-schema|architecture-[\w-]+|city-[\w-]+|findings-model|code-complexity)\.js$/;
const projectScripts = () => pageScripts().filter((name) => SHARED.test(name) || name === 'date-range.js' || (name.startsWith('views/project/') && name !== 'views/project/project.js'));

async function openHealth(t, lang) {
  inLanguage(t, lang);
  const api = {
    architectureFacts: async () => ({ state: 'ok', model: healthModel(), exclude: [], gate: [] }),
    architectureReport: async () => reportView(),
    listArchitectureReports: async () => [{ id: 'r1', date: '2026-10-20T10:00:00Z', findings: 3, simulated: true }],
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

const QUADRANTS = ['Fertile Ground', 'Cowboy Code', 'Healthy Closure'];
const FILTER_WORDS = /^(High|Medium|Low|New|Kept)\b/;
const filterLabels = (box) => Array.from(box.querySelectorAll('[data-arch-filter]')).map(text);

test('#23 Health in pt-BR: the files table shows no English quadrant name', async (t) => {
  const box = await openHealth(t, 'pt-BR');
  const said = text(box);
  assert.ok(said, 'the Health tab is drawn');
  const english = QUADRANTS.filter((q) => said.includes(q));
  assert.deepEqual(english, [], 'English quadrant names on the Health tab');
});

test('#23 Health in pt-BR: the findings\' filters read in Portuguese (no High, Medium, Low, New, Kept)', async (t) => {
  const box = await openHealth(t, 'pt-BR');
  const labels = filterLabels(box);
  assert.equal(labels.length, 6, `all + 3 severities + new / kept: ${JSON.stringify(labels)}`);
  assert.deepEqual(labels.filter((l) => FILTER_WORDS.test(l)), [], `English filters: ${JSON.stringify(labels)}`);
});

test('#23 guard: Health in English keeps its quadrant names and filters', async (t) => {
  const box = await openHealth(t, 'en');
  const said = text(box);
  assert.deepEqual(QUADRANTS.filter((q) => said.includes(q)), QUADRANTS);
  assert.deepEqual(filterLabels(box).filter((l) => FILTER_WORDS.test(l)).map((l) => l.split(' ')[0]), ['High', 'Medium', 'Low', 'New', 'Kept']);
});

// ---- Seeds ---------------------------------------------------------------------------------------------

const bundledRows = () => require('@craftorio/engine/domains/seed/seeds').listSeeds(path.join(ROOT, 'seeds'))
  .map((s) => ({ ...s, lastRun: null, tool: null, commitsSince: null, running: false, error: null }));

async function openSeeds(t, lang) {
  inLanguage(t, lang);
  const api = {
    listSeeds: async () => bundledRows(),
    seedEstimate: async () => ({ costUsd: 0.1, free: false }),
    seedHistory: async () => [],
    onEvent: () => () => {},
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
    confirm: () => true,
    api, state: { projects: [{ id: 'p1', name: 'fixture', folder: 'C:/fixture' }], simulationOnly: true },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), fmtNum: (n) => String(n), fmtUsd: (n) => `US$ ${n}`, showToast: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'json-schema.js'), 'utf8'), sandbox, { filename: 'json-schema.js' });
  vm.runInContext(fs.readFileSync(pageFileOf('views/project/project-seeds.js'), 'utf8'), sandbox, { filename: 'project-seeds.js' });
  const box = dom.document.createElement('div');
  dom.document.body.appendChild(box);
  await sandbox.ProjectSeeds.show('p1', box);
  await settle();
  return text(box.querySelector('[data-testid="seed-churn-complexity"]'));
}

test('#23 Seeds in pt-BR: the churn-complexity seed\'s description is not the English one', async (t) => {
  const row = await openSeeds(t, 'pt-BR');
  assert.ok(row, 'the churn-complexity seed is listed');
  assert.equal(row.includes('Hotspots where files change often'), false, row);
});

test('#23 Seeds in pt-BR: the cost reads in Portuguese ("Custo: one Oracle turn" gone)', async (t) => {
  const row = await openSeeds(t, 'pt-BR');
  assert.ok(row, 'the churn-complexity seed is listed');
  assert.equal(row.includes('one Oracle turn'), false, row);
  assert.equal(row.includes('reads git history and the top files'), false, row);
});

test('#23 guard: Seeds in English keep the seed\'s own description and cost', async (t) => {
  const row = await openSeeds(t, 'en');
  assert.equal(row.includes('Hotspots where files change often'), true, row);
  assert.equal(row.includes('one Oracle turn'), true, row);
});
