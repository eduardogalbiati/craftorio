// #429, the issue's `## Expected files` section on the City view's impact preview
// (src/renderer/views/project/project-city-impact.js), in the mini DOM of the #375 tests with the app's
// api faked at its boundary:
//   - before a run, the city legend gets a row in CityImpact.SOURCE_COLOURS.expected when the issue body
//     has the section, and no such row without it;
//   - after a run, the record sent to architecture:impact carries withSection (true / false);
//   - after a run, the card has data-testid="city-impact-by-source" naming which source predicted each
//     hit and miss.
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
const hash = '42'.repeat(20);
const FILES = [
  { path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/gates.js', lines: 30 }, { path: 'docs/a.md', lines: 5 },
];
const facts = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

// gates.js is only in the Expected files section; run.js only cited in the context
const WITH_SECTION = 'Change src/engine/run.js.\n\n## Expected files\n\n- `src/engine/gates.js`: the gate check\n- `src/engine/fresh.js` (new): the new module\n\n## Tasks\n\n- [ ] Do it\n';
const WITHOUT_SECTION = 'Change src/engine/run.js and src/engine/gates.js.\n\n## Tasks\n\n- [ ] Do it\n';
const RUNS = [{ runId: 'run-1', status: 'done', mock: false }];
const CHANGED = ['src/engine/run.js', 'docs/a.md'];

function load() {
  const calls = { impact: [] };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} },
    api: {
      architectureCity: async () => ({ state: 'ok', ...buildCity({ plan: null, facts: facts() }) }),
      architectureImpact: async (arg) => {
        calls.impact.push(JSON.parse(JSON.stringify(arg)));
        return { plan: null, history: {}, error: null };
      },
      productOwnerHistory: async () => [],
      getBacklog: async () => ({ issues: [] }),
      runDiff: async () => ({ files: CHANGED.map((file) => ({ file })) }),
    },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    showRun: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js', 'city-agents.js', 'city-impact.js', 'roadmap-model.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-city-impact.js']) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
  }
  return { w: sandbox, calls };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const records = (calls) => calls.impact.filter((a) => a.record).map((a) => a.record);

async function open(t) {
  const { w, calls } = load();
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() }, estimate: null });
  await settle();
  const handle = w.ProjectCityImpact.attach(city, { projectId: 'p1' });
  t.after(() => { handle.destroy(); city.destroy(); });
  return { w, calls, city, handle };
}

// the impact rows of the city legend, as one string of markup (the dots carry their colour)
const legendMarkup = (city) => {
  const box = q(city.el, 'project-city-legend');
  const rows = box && box.querySelector('[data-pci-legend]');
  return String(rows ? rows.innerHTML : '');
};
const expectedColour = (w) => {
  const c = w.CityImpact.SOURCE_COLOURS.expected;
  assert.equal(typeof c, 'string', 'CityImpact.SOURCE_COLOURS.expected is a colour');
  return String(c);
};

test('#429 legend: an issue with an Expected files section gets a row in the expected colour', async (t) => {
  const { w, city, handle } = await open(t);
  await handle.show({ issue: { number: 429, title: 'Expected files', body: WITH_SECTION, runs: [] } });
  await settle();
  const colour = expectedColour(w);
  assert.equal(Boolean(q(city.el, 'project-city-legend')), true, 'the city legend is drawn');
  assert.equal(legendMarkup(city).includes(`--c:${colour}`), true, 'a legend row has the expected colour');
});

test('#429 legend: an issue without the section has no row in the expected colour', async (t) => {
  const { w, city, handle } = await open(t);
  await handle.show({ issue: { number: 429, title: 'No section', body: WITHOUT_SECTION, runs: [] } });
  await settle();
  const markup = legendMarkup(city);
  assert.equal(markup.includes(`--c:${w.CityImpact.SOURCE_COLOURS.cited}`), true, 'the cited row is in the legend');
  const colour = expectedColour(w);
  assert.equal(markup.includes(`--c:${colour}`), false);
});

test('#429 the hit rate recorded after a run says the issue had an Expected files section', async (t) => {
  const { calls, handle } = await open(t);
  await handle.show({ issue: { number: 429, title: 'Expected files', body: WITH_SECTION, runs: RUNS } });
  await settle();
  const recs = records(calls);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].withSection, true);
});

test('#429 the hit rate recorded after a run says the issue had no Expected files section', async (t) => {
  const { calls, handle } = await open(t);
  await handle.show({ issue: { number: 429, title: 'No section', body: WITHOUT_SECTION, runs: RUNS } });
  await settle();
  const recs = records(calls);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].withSection, false);
});

test('#429 after a run the card names which source predicted each hit and miss', async (t) => {
  const { city, handle } = await open(t);
  await handle.show({ issue: { number: 429, title: 'Expected files', body: WITH_SECTION, runs: RUNS } });
  await settle();
  const el = q(city.el, 'city-impact-by-source');
  assert.equal(el !== null, true, 'data-testid="city-impact-by-source" is on the card');
  assert.equal(text(el).length > 0, true, 'it is not empty');
  assert.equal(q(city.el, 'city-impact').contains(el), true, 'it is inside the impact card');
});
