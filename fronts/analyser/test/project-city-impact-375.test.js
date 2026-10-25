// #375, the impact overlay of the City view: fronts/analyser/views/project/project-city-impact.js, a
// classic script (window.ProjectCityImpact) built on #373's overlay API and packages/shared/city-impact.js,
// loaded here in a mini DOM without WebGL next to the city's own scripts. The contract tested:
//   ProjectCityImpact.headerMarkup(preview) → an HTML string, preview = { issue: { number, title },
//     files, newFiles (expectedFiles' lists), header (impactHeader's output), comparison?
//     (predictedVsActual's output) }:
//     - one root element data-testid="city-impact-header" whose text has "#<number>" and the title
//       (escaped: markup in a title shows as text);
//     - one data-testid="city-impact-district" per header district, its text the district's name and
//       count; one data-testid="city-impact-zone" per header zone, likewise;
//     - data-testid="city-impact-danger": the Danger Zone share as a whole percent ("25%");
//     - one data-testid="city-impact-new-file" per new file, its text the path and its note;
//     - with a comparison: data-testid="city-impact-comparison" holding data-testid="city-impact-hit",
//       "city-impact-missed" and "city-impact-unexpected" (each text has its count) and the hit rate as
//       a whole percent; without one, no city-impact-comparison element.
// The city's main module, project-city.js, does not grow: at most 423 lines.
// The overlay module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('@multiagent/ui-kit/test/mini-dom');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIR = pageFileOf('views/project');
const CITY = path.join(DIR, 'project-city.js');
const IMPACT = path.join(DIR, 'project-city-impact.js');

function load() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} },
    api: {},
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    showRun: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-agents.js', 'city-impact.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-city-impact.js']) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

// the markup parsed into the mini DOM
function render(preview) {
  const w = load();
  assert.equal(typeof w.ProjectCityImpact?.headerMarkup, 'function', 'ProjectCityImpact.headerMarkup');
  const html = w.ProjectCityImpact.headerMarkup(JSON.parse(JSON.stringify(preview)));
  assert.equal(typeof html, 'string');
  const box = w.document.createElement('div');
  box.innerHTML = html;
  return box;
}
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const qa = (el, id) => [...el.querySelectorAll(`[data-testid="${id}"]`)];
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const PREVIEW = {
  issue: { number: 375, title: 'City: an <b>impact</b> preview' },
  files: [
    { path: 'packages/engine/engine/big.js', sources: ['cited', 'po'] },
    { path: 'packages/engine/engine/small.js', sources: ['cited'] },
    { path: 'packages/ui-kit/app.js', sources: ['po'] },
    { path: 'docs/a.md', sources: ['cited'] },
  ],
  newFiles: [{ path: 'apps/desktop/renderer/views/fresh.js', sources: ['cited'], district: 'views', note: 'new file, expected in Views' }],
  header: {
    total: 4,
    districts: [{ id: 'engine', name: 'Engine', count: 2 }, { id: 'docs', name: 'Docs', count: 1 }, { id: 'renderer', name: 'Renderer', count: 1 }],
    zones: [{ id: 'core', name: 'Core', count: 2 }, { id: 'books', name: 'Books', count: 1 }, { id: 'ui', name: 'UI', count: 1 }],
    dangerShare: 0.25,
  },
};

test('#375 the City\'s main module does not grow, and the impact overlay has its own file', () => {
  const lines = fs.readFileSync(CITY, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/).length;
  assert.ok(lines <= 423, `project-city.js has ${lines} lines`);
  assert.equal(fs.existsSync(IMPACT), true, 'fronts/analyser/views/project/project-city-impact.js exists');
});

test('#375 headerMarkup names the issue, its title escaped', () => {
  const box = render(PREVIEW);
  const header = q(box, 'city-impact-header');
  assert.equal(!!header, true, 'data-testid="city-impact-header"');
  assert.match(text(header), /#375/);
  assert.match(text(header), /City: an <b>impact<\/b> preview/, 'the title shows as text');
  assert.equal(header.querySelector('b'), null, 'no markup from the title');
});

test('#375 headerMarkup counts the expected files by district and by zone', () => {
  const box = render(PREVIEW);
  const districts = qa(box, 'city-impact-district').map(text);
  assert.equal(districts.length, 3, districts.join(' | '));
  assert.match(districts[0], /Engine/);
  assert.match(districts[0], /\b2\b/);
  assert.match(districts[1], /Docs/);
  assert.match(districts[1], /\b1\b/);
  assert.match(districts[2], /Renderer/);
  const zones = qa(box, 'city-impact-zone').map(text);
  assert.equal(zones.length, 3, zones.join(' | '));
  assert.match(zones[0], /Core/);
  assert.match(zones[0], /\b2\b/);
});

test('#375 headerMarkup shows the Danger Zone share as a percent', () => {
  const box = render(PREVIEW);
  assert.match(text(q(box, 'city-impact-danger')), /\b25%/);
});

test('#375 headerMarkup lists the new files with their note', () => {
  const box = render(PREVIEW);
  const rows = qa(box, 'city-impact-new-file').map(text);
  assert.equal(rows.length, 1);
  assert.match(rows[0], /apps\/desktop\/renderer\/views\/fresh\.js/);
  assert.match(rows[0], /new file, expected in Views/);
});

test('#375 headerMarkup: predicted vs actual, the three sets\' counts and the hit rate, only after a run', () => {
  assert.equal(q(render(PREVIEW), 'city-impact-comparison'), null, 'no comparison before a run');
  const box = render({
    ...PREVIEW,
    comparison: { hit: ['packages/engine/engine/big.js', 'packages/engine/engine/small.js'], missed: ['docs/a.md', 'packages/ui-kit/app.js'], unexpected: ['packages/engine/engine/gates.js'], hitRate: 0.5 },
  });
  const cmp = q(box, 'city-impact-comparison');
  assert.equal(!!cmp, true, 'data-testid="city-impact-comparison"');
  assert.match(text(q(cmp, 'city-impact-hit')), /\b2\b/);
  assert.match(text(q(cmp, 'city-impact-missed')), /\b2\b/);
  assert.match(text(q(cmp, 'city-impact-unexpected')), /\b1\b/);
  assert.match(text(cmp), /\b50%/);
});
