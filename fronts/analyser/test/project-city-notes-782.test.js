// #782: the city's notes say when the project was analyzed, and ask for a new analysis only when it matters
// (fronts/analyser/views/project/project-city-notes.js through project-city.js). Acceptance tests, written before the
// code, in a mini DOM without WebGL (the harness of project-city-states-373.test.js).
//
// The contract these tests assume: architecture:city's answer has analysed: { date, commit, commitsSince } | null;
// ProjectCityNotes.html({ ..., analysed }), project-city.js passes the answer's `analysed`.
// - current (plan, coverage >= 0.9, no commit since): project-city-plan says "Analyzed on <date> · <commit>", and the
//   button project-city-analyze is SECONDARY (no class r3d-primary), label "Analyze again", with the estimate. It still
//   has data-pc-analyze.
// - moved (plan, coverage ok, commitsSince > 0): project-city-moved, primary "Analyze this project" and the reason
//   /12 commits since the last analysis/ (1: "1 commit since…").
// - stale: project-city-stale primary, as today. no plan: project-city-no-plan primary, as today.
// - analysed null with a current plan: project-city-plan with the secondary button, no date (never "undefined").
// - running and error states as today.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDom } = require('@multiagent/ui-kit/test/mini-dom');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { buildModel } = require('@multiagent/shared/architecture-model');
const { buildCity } = require('@multiagent/shared/city-model');

const ROOT = path.join(__dirname, '..', '..', '..');
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
const planOf = (...include) => ({
  version: 1, project: 'fixture', zones: [{ id: 'core', name: 'Core', kind: 'industrial' }],
  districts: include.map((glob, i) => ({ id: `d${i}`, name: `D${i}`, zone: 'core', include: [glob] })),
});
const FULL_PLAN = planOf('src/**', 'docs/**', 'tools/**'); // covers every file
const OLD_PLAN = planOf('src/engine/**'); // 60%: stale

const analysedAt = (commitsSince) => ({ date: '2026-10-20T10:00:00.000Z', commit: 'abc1234', commitsSince });
const IDLE = { running: false, step: null, error: null, estimate: '≈ US$ 0.42', estimateTitle: 'the map and the analysis' };

function load(answer) {
  const sandbox = {
    console, setTimeout, clearTimeout, Promise,
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

async function notes({ plan = FULL_PLAN, analysed = null, analysis = IDLE } = {}) {
  const w = load({ state: 'ok', ...buildCity({ plan, facts: facts() }), analysed });
  const city = w.ProjectCity.create({ projectId: 'p1', name: 'fixture-app', onAnalyze: () => {} });
  w.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() }, analysis });
  await settle();
  return city;
}

const button = (city) => q(city.el, 'project-city-analyze');
const isPrimary = (city) => button(city).classList.contains('r3d-primary');

// ---- current --------------------------------------------------------------------------------------------

test('#782 a current plan says when it was analyzed, at which commit', async () => {
  const city = await notes({ analysed: analysedAt(0) });
  assert.match(text(q(city.el, 'project-city-plan')), /Analyzed on .*\d.* · abc1234/);
  city.destroy();
});

test('#782 a current plan offers "Analyze again" as a secondary action', async () => {
  const city = await notes({ analysed: analysedAt(0) });
  assert.equal(text(button(city)), 'Analyze again');
  assert.equal(isPrimary(city), false, 'no class r3d-primary');
  assert.equal(button(city).hasAttribute('data-pc-analyze'), true, 'it still starts the analysis');
  city.destroy();
});

test('#782 a current plan keeps the estimate beside its action', async () => {
  const city = await notes({ analysed: analysedAt(0) });
  assert.match(text(q(city.el, 'project-city-plan')), /≈ US\$ 0\.42/);
  city.destroy();
});

test('#782 a current plan has no "moved" note', async () => {
  const city = await notes({ analysed: analysedAt(0) });
  assert.equal(q(city.el, 'project-city-moved') === null, true);
  city.destroy();
});

test('#782 a current plan with no analysis known keeps the secondary action and shows no date', async () => {
  const city = await notes({ analysed: null });
  const note = text(q(city.el, 'project-city-plan'));
  assert.equal(note === '', false, 'project-city-plan');
  assert.doesNotMatch(note, /undefined|Analyzed on/);
  assert.equal(text(button(city)), 'Analyze again');
  assert.equal(isPrimary(city), false, 'no class r3d-primary');
  city.destroy();
});

// ---- moved ----------------------------------------------------------------------------------------------

test('#782 commits after the analysis: the moved note says how many, with the primary action', async () => {
  const city = await notes({ analysed: analysedAt(12) });
  assert.match(text(q(city.el, 'project-city-moved')), /12 commits since the last analysis/);
  assert.equal(text(button(city)), 'Analyze this project');
  assert.equal(isPrimary(city), true, 'class r3d-primary');
  city.destroy();
});

test('#782 one commit after the analysis reads in the singular', async () => {
  const city = await notes({ analysed: analysedAt(1) });
  assert.match(text(q(city.el, 'project-city-moved')), /\b1 commit since the last analysis/);
  city.destroy();
});

// ---- stale, no plan -------------------------------------------------------------------------------------

test('#782 a stale plan stays stale, primary, whatever came after the analysis', async () => {
  const city = await notes({ plan: OLD_PLAN, analysed: analysedAt(12) });
  assert.equal(q(city.el, 'project-city-stale') === null, false, 'project-city-stale');
  assert.equal(q(city.el, 'project-city-moved') === null, true, 'no moved note');
  assert.equal(isPrimary(city), true, 'class r3d-primary');
  city.destroy();
});

test('#782 no plan stays as today, primary', async () => {
  const city = await notes({ plan: null, analysed: null });
  assert.equal(q(city.el, 'project-city-no-plan') === null, false, 'project-city-no-plan');
  assert.equal(text(button(city)), 'Analyze this project');
  assert.equal(isPrimary(city), true, 'class r3d-primary');
  city.destroy();
});

// ---- running, error -------------------------------------------------------------------------------------

test('#782 while an analysis runs there is no action, moved or not', async () => {
  const city = await notes({ analysed: analysedAt(12), analysis: { ...IDLE, running: true, step: 'the cartographer writes the city plan' } });
  assert.match(text(q(city.el, 'project-city-analyzing')), /cartographer writes the city plan/);
  assert.equal(button(city) === null, true, 'no second start while it runs');
  city.destroy();
});

test('#782 a failed analysis says why, as today', async () => {
  const city = await notes({ analysed: analysedAt(0), analysis: { ...IDLE, error: 'the Oracle refused: daily budget' } });
  assert.match(text(q(city.el, 'project-city-analysis-error')), /daily budget/);
  city.destroy();
});
