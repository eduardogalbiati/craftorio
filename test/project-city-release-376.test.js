// #376, a release on the project city in the UI:
// - src/renderer/views/project/project-city-release.js, a classic script (window.ProjectCityRelease)
//   built on #373's overlay API and packages/shared/city-release.js, loaded here in a mini DOM without
//   WebGL next to the city's own scripts. ProjectCityRelease.headerMarkup(view) → an HTML string,
//   view = { project, from, to, header (CityRelease.releaseHeader's output), tags: [tag], issues: [n],
//   issue }:
//   - one root data-testid="city-release-header" whose text has the non-zero counts ('2 added');
//   - one data-testid="city-release-district" per header district and "city-release-zone" per zone,
//     each text the name and the count;
//   - selects data-testid="city-release-from" and "city-release-to" listing the tags, from and to
//     selected (the two-tag picker);
//   - a select data-testid="city-release-issue": an "All issues" option, then one option per issue
//     ("#12"), `issue` selected;
//   - a button data-testid="city-release-save-image" reading "Save image";
//   - the project name escaped (markup in it shows as text).
// - The city's main module, project-city.js, does not grow: at most 423 lines.
// - The Releases screen (src/renderer/views/releases/releases.js): each release with a tag offers a
//   button "Show on the map", data-testid="release-show-map", data-tag="<tag>"; a release without a
//   tag offers none.
// - Screenshot: `--view project --tab architecture --mode city-release`.
// - docs/screens/releases.md mentions "Show on the map".
// The overlay module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('./mini-dom');
const { loadApp } = require('./renderer-app-harness');

const ROOT = path.join(__dirname, '..');
const SHARED = path.join(ROOT, 'packages', 'shared');
const DIR = path.join(ROOT, 'src', 'renderer', 'views', 'project');
const CITY = path.join(DIR, 'project-city.js');
const RELEASE = path.join(DIR, 'project-city-release.js');

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
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-agents.js', 'city-impact.js', 'city-release.js']) {
    vm.runInContext(fs.readFileSync(path.join(SHARED, f), 'utf8'), sandbox, { filename: f });
  }
  // The app's select builder, so the pickers are built as in the app (#383).
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'select.js'), 'utf8'), sandbox, { filename: 'select.js' });
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-city-release.js']) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

function render(view) {
  const w = load();
  assert.equal(typeof w.ProjectCityRelease?.headerMarkup, 'function', 'ProjectCityRelease.headerMarkup');
  const html = w.ProjectCityRelease.headerMarkup(JSON.parse(JSON.stringify(view)));
  assert.equal(typeof html, 'string');
  const box = w.document.createElement('div');
  box.innerHTML = html;
  return box;
}
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const qa = (el, id) => [...el.querySelectorAll(`[data-testid="${id}"]`)];
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const optionTexts = (sel) => Array.from(sel.querySelectorAll('option')).map((o) => text(o));
const selectedText = (sel) => {
  const v = String(sel.value);
  const o = Array.from(sel.querySelectorAll('option')).find((x) => String(x.value) === v);
  return text(o);
};

const VIEW = {
  project: 'shop-api',
  from: '1.1.1',
  to: '1.1.2',
  header: {
    counts: { added: 2, changed: 3, removed: 1, renamed: 1 },
    districts: [{ id: 'engine', name: 'Engine', count: 4 }, { id: 'docs', name: 'Docs', count: 1 }],
    zones: [{ id: 'core', name: 'Core', count: 4 }, { id: 'books', name: 'Books', count: 1 }],
  },
  tags: ['1.1.2', '1.1.1', '1.1.0'],
  issues: [12, 13],
  issue: 12,
};

// ---------- the city's header for a release ----------

test('#376 the City\'s main module does not grow, and the release overlay has its own file', () => {
  const lines = fs.readFileSync(CITY, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/).length;
  assert.ok(lines <= 423, `project-city.js has ${lines} lines`);
  assert.equal(fs.existsSync(RELEASE), true, 'src/renderer/views/project/project-city-release.js exists');
});

test('#376 headerMarkup shows the release\'s counts', () => {
  const box = render(VIEW);
  const header = q(box, 'city-release-header');
  assert.equal(!!header, true, 'data-testid="city-release-header"');
  for (const part of ['2 added', '3 changed', '1 removed', '1 renamed']) assert.ok(text(header).includes(part), `"${text(header)}" has ${part}`);
});

test('#376 headerMarkup counts the changes by district and by zone', () => {
  const box = render(VIEW);
  const districts = qa(box, 'city-release-district').map(text);
  assert.equal(districts.length, 2, districts.join(' | '));
  assert.match(districts[0], /Engine/);
  assert.match(districts[0], /\b4\b/);
  assert.match(districts[1], /Docs/);
  assert.match(districts[1], /\b1\b/);
  const zones = qa(box, 'city-release-zone').map(text);
  assert.equal(zones.length, 2, zones.join(' | '));
  assert.match(zones[0], /Core/);
  assert.match(zones[0], /\b4\b/);
  assert.match(zones[1], /Books/);
});

test('#376 headerMarkup: a two-tag picker, the release\'s tags selected', () => {
  const box = render(VIEW);
  const from = q(box, 'city-release-from');
  const to = q(box, 'city-release-to');
  assert.equal(!!from && !!to, true, 'city-release-from and city-release-to');
  assert.deepEqual(optionTexts(from), ['1.1.2', '1.1.1', '1.1.0']);
  assert.deepEqual(optionTexts(to), ['1.1.2', '1.1.1', '1.1.0']);
  assert.equal(selectedText(from), '1.1.1');
  assert.equal(selectedText(to), '1.1.2');
});

test('#376 headerMarkup: a filter by issue, "All issues" first, the chosen issue selected', () => {
  const box = render(VIEW);
  const sel = q(box, 'city-release-issue');
  assert.equal(!!sel, true, 'city-release-issue');
  assert.deepEqual(optionTexts(sel), ['All issues', '#12', '#13']);
  assert.equal(selectedText(sel), '#12');
  assert.equal(selectedText(q(render({ ...VIEW, issue: null }), 'city-release-issue')), 'All issues');
});

test('#376 headerMarkup offers "Save image"', () => {
  const button = q(render(VIEW), 'city-release-save-image');
  assert.equal(!!button, true, 'city-release-save-image');
  assert.equal(button.localName, 'button');
  assert.equal(text(button), 'Save image');
});

test('#376 headerMarkup escapes the project name', () => {
  const box = render({ ...VIEW, project: 'shop <b>api</b>' });
  const header = q(box, 'city-release-header');
  assert.equal(header.querySelector('b'), null, 'no markup from the project name');
  assert.ok(text(box).includes('shop <b>api</b>'), 'the name shows as text');
});

// ---------- the Releases screen ----------

const RELEASES = {
  releases: [
    { version: '1.1.2', tag: '1.1.2', date: '2026-10-01T10:00:00Z', issues: [{ number: 12, title: 'Add a module' }], runs: 2, cost: 1.5, tests: {}, notes: '', status: 'shipped' },
    { version: '1.1.3', date: '2026-10-10T10:00:00Z', issues: [{ number: 14, title: 'Not shipped yet' }], runs: 1, cost: 0.5, tests: {}, notes: '' },
  ],
  next: { issues: [{ number: 15, title: 'Refund a failed payment' }], commits: 4, runs: 2, notes: '' },
};

function pageMarkup(app) {
  const parts = [];
  for (const def of app.defs.values()) parts.push(String(def.markup || ''));
  for (const el of [...app.elements.values(), ...app.created]) {
    parts.push(String(el.innerHTML || ''));
    for (const [, html] of el.inserted || []) parts.push(String(html || ''));
  }
  return parts.join('\n');
}

async function showMapButtons() {
  const app = loadApp({ api: { listReleases: async () => RELEASES } });
  await app.boot();
  app.run("showView('releases')");
  await app.settle(20);
  assert.equal(app.state().view, 'releases');
  const html = pageMarkup(app);
  const found = new Map();
  for (const m of html.matchAll(/<button\b[^>]*data-testid="release-show-map"[^>]*>([\s\S]*?)<\/button>/g)) {
    const tag = /data-tag="([^"]*)"/.exec(m[0]);
    found.set(tag ? tag[1] : null, m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return found;
}

test('#376 the Releases screen offers "Show on the map" on a tagged release', async () => {
  const buttons = await showMapButtons();
  assert.deepEqual(Array.from(buttons.keys()), ['1.1.2'], 'one button, for the tagged release');
  assert.equal(buttons.get('1.1.2'), 'Show on the map');
});

// ---------- screenshot, docs ----------

const screenshot = () => require('../scripts/screenshot');

test('#376 the project view offers a city-release mode for its Architecture tab', () => {
  const { VIEWS } = screenshot();
  assert.ok(VIEWS.project.tabs.includes('architecture'), 'the architecture tab');
  assert.ok(VIEWS.project.modes.includes('city-release'), `project modes: ${VIEWS.project.modes.join(', ')}`);
});

test('#376 --view project --tab architecture --mode city-release is accepted and named project-architecture-city-release', () => {
  const args = screenshot().parseArgs(['--view', 'project', '--tab', 'architecture', '--mode', 'city-release']);
  assert.equal(args.view, 'project');
  assert.equal(args.tab, 'architecture');
  assert.equal(args.mode, 'city-release');
  assert.equal(args.name, 'project-architecture-city-release');
});

test('#376 the usage text names the city-release mode', () => {
  assert.match(screenshot().usage(), /\bcity-release\b/);
});

test('#376 the Releases screen doc mentions "Show on the map"', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'docs', 'screens', 'releases.md'), 'utf8'), /Show on the map/);
});
