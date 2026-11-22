// #782: the city says what it could not measure, and offers the view that works (fronts/analyser/views/project/
// project-city.js). Acceptance tests, written before the code, in a mini DOM without WebGL (the harness of
// project-city-states-373.test.js), with a localStorage that keeps what it is given.
//
// The contract these tests assume:
// - project-city-unmeasured (in the legend) when the Quadrant view has unmeasured files, in Quadrant and in Churn alike:
//   "<pct>% not measured: <Language> needs <tool>" per language with a tool (pt-BR: "82% não medido: Rust precisa de …").
// - the action project-city-colour-churn ("Colour by Churn") in Quadrant; project-city-colour-quadrant in Churn. They do
//   what the select does (and count as the owner's choice).
// - project-city-install-hint: names the tool, points to Settings › Agents & CLIs or a copyable command. Clicking it
//   runs nothing (no api call that installs).
// - no language with a tool (only Markdown…): no install hint.
// - all measured: no project-city-unmeasured.
// - opened in Churn by default: the line also says why (/most files/i).
// - the owner's explicit colour is remembered per project (localStorage) and wins over the default.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const I18n = require('@craftorio/shared/i18n.js');
const { buildModel } = require('@craftorio/shared/architecture-model');
const { buildCity } = require('@craftorio/shared/city-model');

const ROOT = path.join(__dirname, '..', '..', '..');
const hash = '11'.repeat(20);
const numbered = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const rust = (n) => numbered(n, (i) => `crates/core/src/f${i}.rs`);
const go = (n) => numbered(n, (i) => `cmd/f${i}.go`);
const js = (n) => numbered(n, (i) => `src/f${i}.js`);
const docs = (n) => numbered(n, (i) => `docs/d${i}.md`);

// #356's facts of `paths`, the `measured` ones read by a tool
const factsOf = (paths, measured) => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: paths.map((p) => ({ path: p, lines: 10 })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${paths.map((p) => `A\t${p}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, includeTests: true,
  complexity: { tool: 'code-health', metric: 'cyclomatic', functions: measured.map((file) => ({ file, name: 'f', line: 1, complexity: 3, length: 10 })) },
});

const MOSTLY_RUST = factsOf([...rust(8), ...js(2)], js(2)); // 80% unmeasured: opens in Churn
const SOME_RUST = factsOf([...rust(2), ...js(6)], js(6)); // 25% unmeasured: opens in Quadrant
const TWO_TOOLS = factsOf([...rust(4), ...go(2), ...js(4)], js(4));
const MOSTLY_DOCS = factsOf([...docs(6), ...js(2)], js(2)); // no language with a tool
const ALL_MEASURED = factsOf(js(3), js(3));

// `store`: the localStorage's entries, kept between two openings; `calls`: every api call but the city's read
function load(answer, { store, calls }) {
  const sandbox = {
    console, setTimeout, clearTimeout, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    api: new Proxy({ architectureCity: async () => answer }, {
      get: (known, name) => known[name] || (typeof name === 'string' && name !== 'then' ? async (...args) => { calls.push(name, ...args); return null; } : undefined),
    }),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox);
  }
  for (const f of ['project-city-modes.js', 'project-city-panels.js', 'project-city-notes.js', 'project-city-cards.js', 'project-city.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'fronts', 'analyser', 'views', 'project', f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (el, id) => el?.querySelector(`[data-testid="${id}"]`) ?? null;
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(facts, { projectId = 'p1', store = new Map(), calls = [] } = {}) {
  const w = load({ state: 'ok', ...buildCity({ plan: null, facts }) }, { store, calls });
  const city = w.ProjectCity.create({ projectId, name: 'fixture-app', onAnalyze: () => {} });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts } });
  await settle();
  return { w, city, store, calls };
}

const legend = (city) => q(city.el, 'project-city-legend');
const line = (city) => q(legend(city), 'project-city-unmeasured');
const inChurn = (city) => /\d+ commits/.test(text(legend(city)));
const inQuadrant = (city) => /Danger Zone/.test(text(legend(city)));

function pick(w, city, value) {
  const select = city.el.querySelector('[data-pc-colour]');
  select.value = value;
  select.dispatchEvent(new w.Event('change', { bubbles: true }));
}

// ---- the line -------------------------------------------------------------------------------------------

test('#782 a project mostly unmeasured opens in Churn and the legend says how much, and what each language needs', async () => {
  const { city } = await open(MOSTLY_RUST);
  assert.equal(inChurn(city), true, text(legend(city)));
  assert.match(text(line(city)), /80% not measured: Rust needs clippy or rust-code-analysis/);
  city.destroy();
});

test('#782 the line opened in Churn by default also says why', async () => {
  const { city } = await open(MOSTLY_RUST);
  assert.match(text(line(city)), /most files/i);
  city.destroy();
});

test('#782 the line shows in Quadrant too, without saying why it is in Churn', async () => {
  const { city } = await open(SOME_RUST);
  assert.equal(inQuadrant(city), true, text(legend(city)));
  assert.match(text(line(city)), /25% not measured: Rust needs clippy or rust-code-analysis/);
  assert.doesNotMatch(text(line(city)), /most files/i);
  city.destroy();
});

test('#782 the line names each language with a tool', async () => {
  const { city } = await open(TWO_TOOLS);
  assert.match(text(line(city)), /Rust needs clippy or rust-code-analysis/);
  assert.match(text(line(city)), /Go needs gocyclo/);
  city.destroy();
});

test('#782 all measured: no line and no action', async () => {
  const { city } = await open(ALL_MEASURED);
  assert.equal(inQuadrant(city), true, text(legend(city)));
  assert.equal(line(city) === null, true, 'no project-city-unmeasured');
  assert.equal(q(city.el, 'project-city-colour-churn') === null, true, 'no Colour by Churn');
  city.destroy();
});

test('#782 pt-BR: "80% não medido: Rust precisa de …"', async (t) => {
  I18n.setLanguage('pt-BR');
  t.after(() => I18n.setLanguage('en'));
  const { city } = await open(MOSTLY_RUST);
  assert.match(text(line(city)), /80% não medido: Rust precisa de clippy or rust-code-analysis/);
  city.destroy();
});

// ---- the actions ----------------------------------------------------------------------------------------

test('#782 in Quadrant the action "Colour by Churn" goes to Churn and leaves the other action', async () => {
  const { city } = await open(SOME_RUST);
  const action = q(city.el, 'project-city-colour-churn');
  assert.equal(text(action), 'Colour by Churn');
  action.click();
  assert.equal(inChurn(city), true, text(legend(city)));
  assert.equal(q(city.el, 'project-city-colour-churn') === null, true, 'it gave way');
  assert.equal(q(city.el, 'project-city-colour-quadrant') === null, false, 'to Colour by Quadrant');
  city.destroy();
});

test('#782 in Churn the action goes to Quadrant, and the line stays', async () => {
  const { city } = await open(MOSTLY_RUST);
  q(city.el, 'project-city-colour-quadrant').click();
  assert.equal(inQuadrant(city), true, text(legend(city)));
  assert.match(text(line(city)), /80% not measured/);
  assert.equal(q(city.el, 'project-city-colour-churn') === null, false, 'and offers Churn');
  city.destroy();
});

test('#782 the select follows the action', async () => {
  const { city } = await open(SOME_RUST);
  q(city.el, 'project-city-colour-churn').click();
  assert.equal(String(city.el.querySelector('[data-pc-colour]').value), 'churn');
  city.destroy();
});

test('#782 the line follows the select: Churn picked by hand shows the Quadrant action', async () => {
  const { w, city } = await open(SOME_RUST);
  pick(w, city, 'churn');
  assert.equal(q(city.el, 'project-city-colour-quadrant') === null, false);
  city.destroy();
});

// ---- the install hint -----------------------------------------------------------------------------------

test('#782 the install hint names the tool and where to get it', async () => {
  const { city } = await open(MOSTLY_RUST);
  const hint = text(q(city.el, 'project-city-install-hint'));
  assert.match(hint, /clippy/);
  assert.match(hint, /Agents & CLIs|cargo |rustup |pip /);
  city.destroy();
});

test('#782 clicking the install hint runs nothing', async () => {
  const { city, calls } = await open(MOSTLY_RUST);
  const hint = q(city.el, 'project-city-install-hint');
  hint.click();
  for (const control of hint.querySelectorAll('button, a')) control.click();
  await settle();
  assert.deepEqual(calls, [], 'no api call');
  city.destroy();
});

test('#782 with no language that has a tool there is no install hint', async () => {
  const { city } = await open(MOSTLY_DOCS);
  assert.equal(line(city) === null, false, 'the line still says how much is unmeasured');
  assert.equal(q(city.el, 'project-city-install-hint') === null, true);
  city.destroy();
});

// ---- the owner's colour ---------------------------------------------------------------------------------

test('#782 the colour picked in the select is remembered and wins over the default', async () => {
  const first = await open(MOSTLY_RUST);
  pick(first.w, first.city, 'quadrant');
  first.city.destroy();
  const { city } = await open(MOSTLY_RUST, { store: first.store });
  assert.equal(inQuadrant(city), true, text(legend(city)));
  city.destroy();
});

test('#782 the colour picked through the action counts as the owner\'s too', async () => {
  const first = await open(SOME_RUST);
  q(first.city.el, 'project-city-colour-churn').click();
  first.city.destroy();
  const { city } = await open(SOME_RUST, { store: first.store });
  assert.equal(inChurn(city), true, text(legend(city)));
  city.destroy();
});

test('#782 the owner\'s colour is per project', async () => {
  const first = await open(MOSTLY_RUST);
  pick(first.w, first.city, 'quadrant');
  first.city.destroy();
  const { city } = await open(MOSTLY_RUST, { projectId: 'p2', store: first.store });
  assert.equal(inChurn(city), true, text(legend(city)));
  city.destroy();
});

test('#782 a remembered Churn does not say the app chose it', async () => {
  const first = await open(SOME_RUST);
  pick(first.w, first.city, 'churn');
  first.city.destroy();
  const { city } = await open(SOME_RUST, { store: first.store });
  assert.match(text(line(city)), /25% not measured/);
  assert.doesNotMatch(text(line(city)), /most files/i);
  city.destroy();
});
