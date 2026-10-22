// #438 and #439, the release view on the City view (src/renderer/views/project/project-city-release.js
// with project-city.js, project-city-notes.js and the modes), in a mini DOM without WebGL, the app's
// api faked at its boundary (architectureCity: today's city, architectureRelease: the release with
// its base city and the base's validation of today's plan). The same loading as
// test/project-city-release-show-376.test.js.
// #438, the legend and the chips:
// - the "changed" chip (data-testid="city-release-count-changed") shows the ramp itself: exactly the
//   four CHANGE_RAMP shades, and every colour the map gives a changed file is among them;
// - the legend (data-testid="project-city-legend") states the ramp's cut points: the changed row (or
//   rows) carry line counts (at least three numbers other than the status counts) and the word "line";
// - a renamed file carries a sign on the map: the 'release' layer names the renamed file outside its
//   highlight colours (a marker, an outline), a changed file of the same lines does not; the renamed
//   chip and the legend's renamed row show no orange (#f2a541) dot;
// - unchanged: the added chip is green, the removed chip the ghost grey.
// #439, the base's validation of today's plan:
// - landmark and port files the base commit lacks and districts with no file are not problems: no
//   visible data-testid="project-city-problems", at most one muted line naming the base tag and the
//   counts ("At 1.1.1, 2 files and 1 district of today's plan did not exist yet"), the list behind a
//   <details>;
// - a schema error, an unknown zone or a duplicate id are still shown as problems on the release view;
// - Close brings back today's validation and notes; today's city lists its missing files as problems.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox');
const { createDom } = require('./mini-dom');
const { buildModel } = require('../src/shared/architecture-model');
const { buildCity } = require('../src/shared/city-model');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'src', 'renderer', 'views', 'project');
const RAMP = ['#f6d58e', '#f2a541', '#e8743b', '#d9480f'];
const ORANGE = '#f2a541';
const hash = '43'.repeat(20);
const FILES = [
  { path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/gates.js', lines: 30 }, { path: 'src/engine/jobs.js', lines: 20 },
  { path: 'docs/a.md', lines: 5 },
];
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

// today's plan: two landmarks and a district the base commit (and the fixture's files) lack
const PLAN = {
  version: 1, project: 'fixture-app',
  zones: [{ id: 'core', name: 'Core', kind: 'industrial' }, { id: 'books', name: 'Books', kind: 'civic' }],
  districts: [
    { id: 'engine', name: 'Engine', zone: 'core', include: ['src/engine/**'] },
    { id: 'docs', name: 'Docs', zone: 'books', include: ['docs/**'] },
    { id: 'later', name: 'Later', zone: 'core', include: ['src/later/**'] },
  ],
  landmarks: [{ path: 'src/later/start.js', label: 'Start' }, { path: 'src/engine/server.js', label: 'Server' }],
};
const MISSING = ['src/engine/server.js', 'src/later/start.js'];
const city = () => buildCity({ plan: PLAN, facts: facts() });

// 1.1.1 → 1.1.2: one added, two changed (12 and 300 lines), one renamed (12 lines, like run.js), one removed
const RELEASE = (base = city()) => ({
  state: 'ok', from: '1.1.1', to: '1.1.2', tags: ['1.1.2', '1.1.1'], plan: PLAN, base,
  changes: [
    { status: 'added', path: 'src/engine/new.js', lines: 5 },
    { status: 'changed', path: 'src/engine/run.js', lines: 12 },
    { status: 'changed', path: 'src/engine/gates.js', lines: 300 },
    { status: 'renamed', from: 'src/engine/queue.js', path: 'src/engine/work.js', lines: 12 },
    { status: 'removed', path: 'docs/a.md', lines: 5 },
  ],
  commits: [],
});
const COUNTS = [1, 2]; // the release's status counts (1 added, 2 changed, 1 renamed, 1 removed)

function load({ release = async () => RELEASE(), today = async () => ({ state: 'ok', ...city() }) } = {}) {
  const calls = { release: 0, city: 0, overlay: [] };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} },
    state: { projects: [{ id: 'p1', name: 'fixture-app' }] },
    api: {
      architectureCity: async () => { calls.city++; return JSON.parse(JSON.stringify(await today())); },
      architectureRelease: async () => { calls.release++; return JSON.parse(JSON.stringify(await release())); },
      captureWindow: async () => null,
    },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-agents.js', 'city-impact.js', 'city-release.js', 'roadmap-model.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'select.js'), 'utf8'), sandbox, { filename: 'select.js' });
  const optional = ['project-city-modes.js', 'project-city-panels.js'].filter((f) => fs.existsSync(path.join(DIR, f)));
  for (const f of [...optional, 'project-city-notes.js', 'project-city-cards.js', 'project-city.js']) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
  }
  const overlay = sandbox.ProjectCity.overlay;
  sandbox.ProjectCity.overlay = (name, spec) => { calls.overlay.push({ name: String(name), spec: spec ? JSON.parse(JSON.stringify(spec)) : null }); return overlay(name, spec); };
  vm.runInContext(fs.readFileSync(path.join(DIR, 'project-city-release.js'), 'utf8'), sandbox, { filename: 'project-city-release.js' });
  return { w: sandbox, calls };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const coloursIn = (html) => [...new Set((String(html || '').match(/#[0-9a-f]{6}\b/gi) || []).map((c) => c.toLowerCase()))].sort();
const lastLayer = (calls) => calls.overlay.filter((c) => c.name === 'release').at(-1)?.spec || null;
// shown: no ancestor (or itself) hidden by the modes' `hidden` or the `.hidden` class
const visible = (el) => !!el && el.closest('[hidden], .hidden') === null;
const visibleProblems = (root) => [...root.querySelectorAll('[data-testid="project-city-problems"]')].filter(visible);
// the innermost elements whose text matches `re`
const innermost = (root, re) => {
  const all = [...root.getElementsByTagName('*')].filter((e) => re.test(text(e)));
  return all.filter((e) => !all.some((o) => o !== e && e.contains?.(o)) && ![...e.getElementsByTagName('*')].some((o) => re.test(text(o))));
};
const legendRows = (root, re) => [...(q(root, 'project-city-legend')?.querySelectorAll('li') || [])].filter((li) => re.test(text(li)));

async function open(t, opts) {
  const { w, calls } = load(opts);
  const c = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(c.el);
  c.update({ facts: { state: 'ok', model: facts() }, estimate: null });
  await settle();
  const handle = w.ProjectCityRelease.attach(c, { projectId: 'p1' });
  t.after(() => { handle.destroy(); c.destroy(); });
  return { w, calls, city: c, handle };
}

async function shown(t, opts) {
  const o = await open(t, opts);
  await o.handle.show({ to: '1.1.2' });
  await settle();
  return o;
}

// ---------- #438 the changed chip and the legend show the ramp ----------

test('#438 the changed chip shows exactly the four ramp shades, not a single dot', async (t) => {
  const { city } = await shown(t);
  const chip = q(city.el, 'city-release-count-changed');
  assert.ok(chip, 'city-release-count-changed');
  assert.deepEqual(coloursIn(chip.innerHTML), [...RAMP].sort());
});

test('#438 every colour the map gives a changed file is shown on the changed chip', async (t) => {
  const { city, calls } = await shown(t);
  const chip = coloursIn(q(city.el, 'city-release-count-changed')?.innerHTML);
  const layer = lastLayer(calls);
  assert.ok(layer && layer.highlight, 'the release layer');
  for (const p of ['src/engine/run.js', 'src/engine/gates.js']) {
    const colour = String(layer.highlight[p] || '').toLowerCase();
    assert.ok(chip.includes(colour), `${p}: ${colour} is on the chip (${chip.join(', ')})`);
  }
});

test('#438 the legend\'s changed row shows only the four ramp shades', async (t) => {
  const { city } = await shown(t);
  const rows = legendRows(city.el, /chang/i);
  assert.ok(rows.length >= 1, 'a changed row in the legend');
  assert.deepEqual(coloursIn(rows.map((r) => r.outerHTML).join('')), [...RAMP].sort());
});

test('#438 the legend states the line counts each shade of the ramp stands for', async (t) => {
  const { city } = await shown(t);
  const legend = q(city.el, 'project-city-legend');
  assert.ok(legend, 'project-city-legend');
  const s = text(legend);
  assert.match(s, /line/i);
  const numbers = [...new Set((s.match(/\d[\d,.]*/g) || []).map((n) => Number(n.replace(/[,.]/g, ''))))].filter((n) => !COUNTS.includes(n));
  assert.ok(numbers.length >= 3, `the cut points in the legend: "${s}"`);
});

// ---------- #438 renamed told apart ----------

test('#438 a renamed file carries a sign on the map that a changed file of the same lines does not', async (t) => {
  const { calls } = await shown(t);
  const layer = lastLayer(calls);
  assert.ok(layer, 'the release layer');
  const { highlight, ...rest } = layer;
  const s = JSON.stringify(rest);
  assert.ok(s.includes('src/engine/queue.js') || s.includes('src/engine/work.js'), `the rename is marked: ${s}`);
  assert.equal(s.includes('src/engine/run.js'), false, `the changed file of the same lines is not: ${s}`);
});

test('#438 the renamed chip shows no orange dot', async (t) => {
  const { city } = await shown(t);
  const chip = q(city.el, 'city-release-count-renamed');
  assert.ok(chip, 'city-release-count-renamed');
  assert.match(text(chip), /1 renamed/);
  assert.equal(coloursIn(chip.innerHTML).includes(ORANGE), false, chip.innerHTML);
});

test('#438 the legend names the rename sign, with no orange dot', async (t) => {
  const { city } = await shown(t);
  const rows = legendRows(city.el, /renam/i);
  assert.ok(rows.length >= 1, 'a renamed row in the legend');
  assert.equal(coloursIn(rows.map((r) => r.outerHTML).join('')).includes(ORANGE), false, rows.map((r) => r.outerHTML).join(''));
});

// ---------- #438 unchanged ----------

test('#438 unchanged: the added chip is green and the removed chip ghost grey, the counts as before', async (t) => {
  const { w, city } = await shown(t);
  const added = q(city.el, 'city-release-count-added');
  const removed = q(city.el, 'city-release-count-removed');
  assert.deepEqual(coloursIn(added?.innerHTML), [String(w.CityRelease.ADDED_COLOUR).toLowerCase()]);
  assert.deepEqual(coloursIn(removed?.innerHTML), ['#9aa3b2']);
  const header = text(q(city.el, 'city-release-header'));
  for (const part of ['1 added', '2 changed', '1 renamed', '1 removed']) assert.ok(header.includes(part), `"${header}" has ${part}`);
});

// ---------- #439 the base's validation of today's plan ----------

test('#439 files and districts of today\'s plan the base lacks are not problems on the release view', async (t) => {
  const { city } = await shown(t);
  assert.equal(visibleProblems(city.el).length, 0, 'no plan problems shown');
  assert.doesNotMatch(text(city.el), /is not in the repository at this commit/);
});

test('#439 the release view says in one muted line how many files and districts did not exist yet at the base', async (t) => {
  const { city } = await shown(t);
  const lines = innermost(city.el, /did not exist yet/i).filter(visible);
  assert.equal(lines.length, 1, `one line: ${text(city.el)}`);
  const s = text(lines[0]);
  assert.match(s, /1\.1\.1/);
  assert.match(s, /\b2 files?\b/);
  assert.match(s, /\b1 districts?\b/);
});

test('#439 the files and districts that did not exist yet are listed behind a disclosure', async (t) => {
  const { city } = await shown(t);
  const details = [...city.el.querySelectorAll('details')].filter((d) => MISSING.every((p) => text(d).includes(p)));
  assert.equal(details.length, 1, 'one <details> with the missing files');
  assert.match(text(details[0]), /\blater\b/i, 'the district with no file');
  assert.equal(details[0].open, false, 'closed by default');
});

const REAL = [
  ['a schema error', { schemaErrors: ['plan.zones[1].kind must be one of industrial, civic'] }, /must be one of/],
  ['an unknown zone', { unknownZones: [{ district: 'later', zone: 'nowhere' }] }, /nowhere/],
  ['a duplicate id', { duplicateIds: ['engine'] }, /engine/],
];
for (const [name, extra, shows] of REAL) {
  test(`#439 ${name} in the base's validation is still a problem on the release view`, async (t) => {
    const base = city();
    Object.assign(base.validation, extra);
    const { city: c } = await shown(t, { release: async () => RELEASE(base) });
    const problems = visibleProblems(c.el);
    assert.equal(problems.length, 1, 'the problems note is shown');
    assert.match(text(problems[0]), /problem/i);
    assert.match(text(problems[0]), shows);
    assert.doesNotMatch(text(problems[0]), /is not in the repository at this commit/, 'missing files are not problems');
  });
}

test('#439 Close brings back today\'s problems and drops the not-yet line', async (t) => {
  const { city: c } = await shown(t);
  c.el.querySelector('[data-testid="city-release-close"]').click();
  await settle();
  const problems = visibleProblems(c.el);
  assert.equal(problems.length, 1, 'today\'s problems note');
  for (const p of MISSING) assert.ok(text(problems[0]).includes(p), `${p} listed: ${text(problems[0])}`);
  assert.equal(innermost(c.el, /did not exist yet/i).filter(visible).length, 0, 'no not-yet line on today\'s city');
});

// mini-dom has no capture phase: the <details> toggle is dispatched bubbling to reach the card's listener
const toggle = (w, d, open) => { d.open = open; d.dispatchEvent(new w.Event('toggle', { bubbles: true })); };
const missing = (root) => root.querySelector('[data-testid="city-release-missing"]');
const summaryExpanded = (root) => String(missing(root)?.querySelector('[data-testid="city-release-missing-toggle"]')?.getAttribute('aria-expanded'));

test('#439 opening the list of what did not exist yet sets aria-expanded, and the list stays open when the card is redrawn', async (t) => {
  const withIssues = () => ({ ...RELEASE(), commits: [{ commit: 'c'.repeat(40), subject: 'Edit run (#12)', issues: [12], files: ['src/engine/run.js'] }] });
  const { w, city: c } = await shown(t, { release: async () => withIssues() });
  assert.equal(summaryExpanded(c.el), 'false', 'closed at first');
  toggle(w, missing(c.el), true);
  assert.equal(summaryExpanded(c.el), 'true', 'aria-expanded follows the opened list');
  const issue = q(c.el, 'city-release-issue');
  assert.ok(issue, 'the issue filter');
  issue.value = '12';
  issue.dispatchEvent(new w.Event('change', { bubbles: true }));
  await settle();
  assert.equal(missing(c.el)?.open, true, 'still open after the issue filter redrew the card');
  assert.equal(summaryExpanded(c.el), 'true');
  toggle(w, missing(c.el), false);
  assert.equal(summaryExpanded(c.el), 'false', 'aria-expanded follows the closed list');
});

test('#439 today\'s city still lists its missing files and empty districts as problems', async (t) => {
  const { city: c } = await open(t);
  const problems = visibleProblems(c.el);
  assert.equal(problems.length, 1, 'today\'s problems note');
  const s = text(problems[0]);
  for (const p of MISSING) assert.ok(s.includes(`${p} is not in the repository at this commit`), s);
  assert.match(s, /District later has no file/);
});
