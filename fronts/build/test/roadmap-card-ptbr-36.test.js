// #36 acceptance, written before the code: the Roadmap card (fronts/build/views/backlog/backlog-roadmap.js) in the
// pt-BR interface. #28 left English on it: the meters (COST / TIME, "no estimate yet", "of ≈ …", " so far"), the mode
// chips (Automatic / Validated) and the mode's note ("The change goes straight from the developer to review and
// tests", "locked while it runs"), the run's status line ("Waiting for you", "Failed at …", "Done"), the pipeline's
// station names (the workflow YAML's groups and step displays) and the Live roadmap's "Off. Turning it on starts the
// roadmap first.". English stays as it is.
//
// Harness of renderer-roadmap-card-282.test.js (roadmap-status-helpers.js loadRoadmap, fixed clock, the shared I18n
// switched with I18n.setLanguage); the workflows are the real files as api.listWorkflows gives them, with the origin
// the service lists them with: `default` for a bundled copy (workflows/*.yaml), `repository` for the repository's own
// (.craftorio/workflows/*.yaml). Assertions on the rendered markup's visible text only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const H = require('./roadmap-status-helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const FEATURE = 'feature.yaml';
const REFACTOR = 'refactor.yaml';
const HERO = 'ai-development-local-hero.yaml';

test.afterEach(() => I18n.setLanguage('en'));

// a workflow as api.listWorkflows gives it (packages/engine/service/areas/workflows.js), with its groups
function wfEntry(file, dir = 'workflows', origin = 'default') {
  const { loadWorkflow } = require('@craftorio/engine/engine/workflow');
  const wf = loadWorkflow(path.join(ROOT, dir, file));
  return {
    file,
    origin,
    name: wf.metadata?.name || file,
    description: wf.metadata?.description,
    inputs: wf.inputs || {},
    outputs: wf.outputs || {},
    groups: wf.groups || [],
    agents: Object.fromEntries(Object.entries(wf.agents || {}).map(([k, a]) => [k, { provider: a.provider, model: a.model, ...(a.display ? { display: a.display } : {}) }])),
    steps: wf.steps.map((s) => ({
      ...s,
      type: s.type || 'agent',
      agent: s.agents ? s.agents.join(' · ') : s.agent || null,
      next: [...new Set((s.transitions || []).map((x) => x.goto).filter(Boolean))],
    })),
  };
}
const WORKFLOWS = () => [wfEntry(FEATURE), wfEntry(REFACTOR), wfEntry(HERO, path.join('.craftorio', 'workflows'), 'repository')];

const view = { showAll: true, since: 'total' };
const ESTIMATE = { usd: 5, minutes: 60, runs: 12, complexity: 9, estimated: false, basis: 'Median of the last 12 successful runs', timeBasis: 'From 12 past runs' };
const card = (extra = {}) => ({
  id: 'a', status: 'planned', workflow: FEATURE, workflowName: 'feature', inputs: {}, mock: false,
  issues: [H.ref(101, 'Login page')], origin: H.iso(H.NOW - H.HOUR), runId: null, runs: [], error: null, ...extra,
});
const one = (x, roadmap = {}) => ({ roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [x] }], ...roadmap }, issues: [] });
const dev = () => [{ agent: 'developer', provider: 'claude', model: 'claude-sonnet-5', cost: 0.1, durationMs: 1000 }];
const step = (id, status, at, extra = {}) => ({ step: id, status, ts: H.iso(at), agents: dev(), ...(status === 'running' || status === 'waiting' ? {} : { durationMs: 5 * H.MIN }), ...extra });

// the roadmap module in `lang`, its workflows loaded (the first draw asks api.listWorkflows)
async function ready(lang) {
  I18n.setLanguage(lang);
  const loaded = H.loadRoadmap({ listWorkflows: async () => WORKFLOWS(), runTitle: (r) => r.workflow });
  loaded.R.html(H.roadmapOf([]), () => {});
  await H.settle();
  await H.settle();
  return loaded;
}
const draw = (R, d) => R.html(d, () => {}, view);
const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
function part(html, testid, itemId = 'a') {
  const el = byTestId(H.itemEl(html, itemId).outer, testid);
  assert.ok(el, `item ${itemId} has a [data-testid="${testid}"]`);
  return el;
}
const text = (el) => H.visibleText(el.inner);
const itemText = (html) => H.visibleText(H.itemEl(html, 'a').inner);
const meterLabel = (html, testid) => {
  const label = H.findEl(part(html, testid).outer, (e) => /\brm-meter-label\b/.test(e.attrs.class || ''));
  return label ? text(label).toUpperCase() : null;
};
// the names the lane's stations show, in order: the heads of their columns, once over the rows of the item's group
// (the lanes of 2026-11-27); each station's glyph is named after its column
function stationNames(html) {
  const group = H.findAll(html, (e) => e.attrs['data-testid'] === 'roadmap-workflow').find((g) => !!H.findEl(g.outer, (e) => e.attrs['data-item'] === 'a'));
  assert.ok(group, 'item a is in a workflow group');
  const cols = H.findEl(group.outer, (e) => /\brm-cols\b/.test(e.attrs.class || ''));
  const names = H.findAll(H.findEl(cols.outer, (e) => /\brm-lane\b/.test(e.attrs.class || '')).inner, (e) => e.name === 'span').map((e) => text(e));
  const glyphs = H.findAll(part(html, 'roadmap-pipeline').outer, (e) => e.attrs['data-testid'] === 'roadmap-station')
    .map((st) => H.findEl(st.inner, (e) => 'aria-label' in e.attrs)?.attrs['aria-label'] || '');
  assert.deepEqual(glyphs.map((label, k) => label.includes(names[k])), names.map(() => true), `the glyphs ${JSON.stringify(glyphs)} are named after their columns ${JSON.stringify(names)}`);
  return names;
}

function waitingCard() {
  const start = H.NOW - 15 * H.MIN;
  const progress = [step('develop', 'done', start, { durationMs: 10 * H.MIN }), step('developer_check', 'waiting', start + 10 * H.MIN, { type: 'human_approval', agents: [] })];
  return card({ status: 'running', waiting: true, runId: 'run-9', runs: ['run-9'], inputs: { validation: 'validated' }, run: H.run({ status: 'running', waiting: true, gate: 'Try the change', workflow: FEATURE, startedAt: H.iso(start), progress, groups: wfEntry(FEATURE).groups }) });
}
function failedCard() {
  const start = H.NOW - 30 * H.MIN;
  return card({ status: 'failed', runId: 'run-f', runs: ['run-f'], error: 'Run run-f failed: tests failed', run: H.run({ status: 'failed', workflow: FEATURE, startedAt: H.iso(start), finishedAt: H.iso(start + 20 * H.MIN), progress: [step('develop', 'failed', start)], groups: wfEntry(FEATURE).groups }) });
}
function doneCard() {
  const start = H.NOW - 4 * H.HOUR;
  return card({ status: 'done', runId: 'run-d', runs: ['run-d'], estimate: ESTIMATE, actualUsd: 4, actualMinutes: 50, run: H.run({ status: 'success', workflow: FEATURE, startedAt: H.iso(start), finishedAt: H.iso(start + 50 * H.MIN), progress: [step('develop', 'done', start, { durationMs: 50 * H.MIN })], groups: wfEntry(FEATURE).groups }) });
}
function runningCard(extra = {}) {
  const start = H.NOW - 20 * H.MIN;
  return card({ status: 'running', runId: 'run-9', runs: ['run-9'], actualUsd: 0.4, run: H.run({ status: 'running', workflow: FEATURE, startedAt: H.iso(start), progress: [step('develop', 'running', start)], groups: wfEntry(FEATURE).groups }), ...extra });
}

// ---- 1. the meters ------------------------------------------------------------------------------------

test('#36 pt-BR: the meters are labelled CUSTO and TEMPO, not COST and TIME', async () => {
  const { R } = await ready('pt-BR');
  const html = draw(R, one(card()));
  assert.deepEqual([meterLabel(html, 'roadmap-meter-cost'), meterLabel(html, 'roadmap-meter-time')], ['CUSTO', 'TEMPO']);
});

test('#36 pt-BR: an item without history does not say "no estimate yet"', async () => {
  const { R } = await ready('pt-BR');
  assert.equal(itemText(draw(R, one(card()))).includes('no estimate yet'), false);
});

test('#36 English unchanged: an item without history says "no estimate yet" under COST and TIME', async () => {
  const { R } = await ready('en');
  const html = draw(R, one(card()));
  assert.equal(itemText(html).includes('no estimate yet'), true);
  assert.deepEqual([meterLabel(html, 'roadmap-meter-cost'), meterLabel(html, 'roadmap-meter-time')], ['COST', 'TIME']);
});

test('#36 pt-BR: a done item\'s meters do not say "of ≈" against the estimate', async () => {
  const { R } = await ready('pt-BR');
  const html = draw(R, one(doneCard(), { state: 'done' }));
  assert.equal(text(part(html, 'roadmap-meter-cost')).includes('of ≈'), false);
  assert.equal(text(part(html, 'roadmap-meter-time')).includes('of ≈'), false);
});

test('#36 pt-BR: a running item\'s cost without an estimate does not say "so far"', async () => {
  const { R } = await ready('pt-BR');
  const html = draw(R, one(runningCard(), { state: 'running' }));
  assert.equal(text(part(html, 'roadmap-meter-cost')).includes('so far'), false);
});

// ---- 1. the mode toggle and its note ------------------------------------------------------------------

test('#36 pt-BR: a planned feature item\'s mode chips read Automático and Validado', async () => {
  const { R } = await ready('pt-BR');
  const seg = part(draw(R, one(card())), 'roadmap-mode');
  assert.deepEqual(H.findAll(seg.outer, (e) => e.name === 'button').map((b) => text(b)), ['Automático', 'Validado']);
});

test('#36 pt-BR: the Automatic mode\'s note is not "The change goes straight from the developer to review and tests"', async () => {
  const { R } = await ready('pt-BR');
  assert.equal(/The change goes straight from the developer to review and tests/i.test(itemText(draw(R, one(card())))), false);
});

test('#36 pt-BR: a running item\'s mode note does not say "locked while it runs"', async () => {
  const { R } = await ready('pt-BR');
  assert.equal(itemText(draw(R, one(runningCard(), { state: 'running' }))).includes('locked while it runs'), false);
});

test('#36 English unchanged: a running item\'s mode note says "locked while it runs"', async () => {
  const { R } = await ready('en');
  assert.equal(itemText(draw(R, one(runningCard(), { state: 'running' }))).includes('locked while it runs'), true);
});

// ---- 1. the run's status line -------------------------------------------------------------------------

test('#36 pt-BR: an item waiting at a gate never says "Waiting for you" (status line, summary, ring)', async () => {
  const { R } = await ready('pt-BR');
  const html = draw(R, one(waitingCard(), { state: 'running' }));
  assert.equal(H.itemEl(html, 'a').outer.includes('Waiting for you'), false);
});

test('#36 pt-BR: a failed item does not say "Failed at …"', async () => {
  const { R } = await ready('pt-BR');
  const html = draw(R, one(failedCard(), { state: 'paused', pausedBy: 'a' }));
  assert.equal(H.itemEl(html, 'a').outer.includes('Failed at'), false);
});

test('#36 pt-BR: a done item\'s status block does not say "Done"', async () => {
  const { R } = await ready('pt-BR');
  const html = draw(R, one(doneCard(), { state: 'done' }));
  assert.equal(/\bDone\b/.test(H.itemEl(html, 'a').outer), false);
});

// ---- 2. the stations' names ---------------------------------------------------------------------------

test('#36 pt-BR: a feature item\'s stations read Desenvolver, Revisão, Validar and Merge, and Tests is translated', async () => {
  const { R } = await ready('pt-BR');
  const names = stationNames(draw(R, one(card({ inputs: { test_order: 'e2e_first' } }))));
  assert.deepEqual(names.slice(1), ['Desenvolver', 'Revisão', 'Validar', 'Merge']);
  assert.notEqual(names[0], 'Tests');
});

test('#36 pt-BR: a refactor item\'s stations Pin and Gates are translated and Review reads Revisão', async () => {
  const { R } = await ready('pt-BR');
  const names = stationNames(draw(R, one(card({ workflow: REFACTOR, workflowName: 'refactor' }))));
  assert.ok(names.length >= 4, `the refactor pipeline has its stations: ${names.join(' › ')}`);
  assert.deepEqual(names.filter((n) => ['Pin', 'Gates', 'Review'].includes(n)), []);
  assert.equal(names.includes('Revisão'), true);
});

test('#36 pt-BR: the repository\'s hero workflow stations read "Escrever testes (E2E)", Desenvolver, Revisão, Validar; none is the file\'s English', async () => {
  const { R } = await ready('pt-BR');
  const names = stationNames(draw(R, one(card({ workflow: HERO, workflowName: 'ai-development-local-hero' }))));
  const ENGLISH = ['Write tests (E2E)', 'Red check (TDD)', 'Develop', 'Rule checks', 'Docs check', 'Review', 'Validate'];
  assert.deepEqual(names.filter((n) => ENGLISH.includes(n)), []);
  for (const pt of ['Escrever testes (E2E)', 'Desenvolver', 'Revisão', 'Validar']) assert.equal(names.includes(pt), true, `${pt} in ${names.join(' › ')}`);
});

test('#36 English unchanged: the hero workflow\'s stations keep the file\'s names', async () => {
  const { R } = await ready('en');
  const names = stationNames(draw(R, one(card({ workflow: HERO, workflowName: 'ai-development-local-hero' }))));
  for (const en of ['Write tests (E2E)', 'Develop', 'Review', 'Validate', 'Merge']) assert.equal(names.includes(en), true, `${en} in ${names.join(' › ')}`);
});

// ---- 1. a stopped run and the "at {where}" step (review of #36) ----------------------------------------

function stoppedCard() {
  const start = H.NOW - 30 * H.MIN;
  return card({ status: 'failed', runId: 'run-s', runs: ['run-s'], error: 'Run run-s was stopped', run: H.run({ status: 'cancelled', workflow: FEATURE, startedAt: H.iso(start), finishedAt: H.iso(start + 20 * H.MIN), progress: [step('develop', 'failed', start)], groups: wfEntry(FEATURE).groups }) });
}

test('#36 pt-BR: a stopped item reads "Parou em …", never "Stopped at"', async () => {
  const { R } = await ready('pt-BR');
  const outer = H.itemEl(draw(R, one(stoppedCard(), { state: 'paused', pausedBy: 'a' })), 'a').outer;
  assert.equal(outer.includes('Stopped at'), false);
  assert.equal(outer.includes('Parou em'), true);
});

test('#36 English unchanged: a stopped item reads "Stopped at …"', async () => {
  const { R } = await ready('en');
  assert.equal(H.itemEl(draw(R, one(stoppedCard(), { state: 'paused', pausedBy: 'a' })), 'a').outer.includes('Stopped at'), true);
});

test('#36 pt-BR: a failed item reads "Falhou em Desenvolver" and its step line "em Desenvolver", not "at Develop"', async () => {
  const { R } = await ready('pt-BR');
  const outer = H.itemEl(draw(R, one(failedCard(), { state: 'paused', pausedBy: 'a' })), 'a').outer;
  assert.equal(outer.includes('Falhou em Desenvolver'), true);
  assert.equal(/\bat Develop\b/.test(outer), false);
});

// ---- 2. a hero item with a run: its stations named from run.stepNames (review of #36) -----------------

function heroRunCard() {
  const start = H.NOW - 20 * H.MIN;
  const hero = wfEntry(HERO, path.join('.craftorio', 'workflows'), 'repository');
  // the run's display names come from the file at run start (run.started's display.steps): English
  const stepNames = Object.fromEntries(hero.steps.filter((s) => s.display).map((s) => [s.id, s.display]));
  const progress = [step('acceptance_tests', 'done', start), step('red_check', 'done', start + 5 * H.MIN), step('develop', 'running', start + 10 * H.MIN)];
  return card({ status: 'running', workflow: HERO, workflowName: 'ai-development-local-hero', runId: 'run-h', runs: ['run-h'], run: H.run({ status: 'running', workflow: HERO, startedAt: H.iso(start), progress, groups: hero.groups, stepNames }) });
}

test('#36 pt-BR: a running hero item\'s stations are not the run\'s English step names', async () => {
  const { R } = await ready('pt-BR');
  const names = stationNames(draw(R, one(heroRunCard(), { state: 'running' })));
  const ENGLISH = ['Write tests (E2E)', 'Red check (TDD)', 'Develop', 'Rule checks', 'Docs check', 'Review', 'Validate'];
  assert.deepEqual(names.filter((n) => ENGLISH.includes(n)), []);
  for (const pt of ['Escrever testes (E2E)', 'Desenvolver']) assert.equal(names.includes(pt), true, `${pt} in ${names.join(' › ')}`);
});

test('#36 English unchanged: a running hero item\'s stations keep the run\'s step names', async () => {
  const { R } = await ready('en');
  const names = stationNames(draw(R, one(heroRunCard(), { state: 'running' })));
  for (const en of ['Write tests (E2E)', 'Develop']) assert.equal(names.includes(en), true, `${en} in ${names.join(' › ')}`);
});

// ---- 3. the Live roadmap ------------------------------------------------------------------------------

test('#36 pt-BR: the Live roadmap switched off does not say "Off. Turning it on starts the roadmap first."', async () => {
  const { R } = await ready('pt-BR');
  assert.equal(draw(R, one(card(), { live: false })).includes('Turning it on starts the roadmap first'), false);
});

test('#36 English unchanged: the Live roadmap switched off says "Off. Turning it on starts the roadmap first."', async () => {
  const { R } = await ready('en');
  assert.equal(draw(R, one(card(), { live: false })).includes('Off. Turning it on starts the roadmap first.'), true);
});

// ---- #41: a release block waiting at its Ship gate (backlog-roadmap.js RELEASE_BLOCK) ---------------------------

// the release block of 1.1.0, waiting at its Ship gate: its visible text and accessible name
async function waitingRelease(lang) {
  const { R } = await ready(lang);
  const d = one(card({ status: 'done', runId: 'r1', runs: ['r1'] }), { state: 'done' });
  d.releases = { releases: [{ version: '1.1.0', status: 'waiting', runId: 'rel-110', runs: ['r1'] }] };
  const block = H.findAll(draw(R, d), (e) => e.attrs['data-testid'] === 'roadmap-release-block').find((e) => H.visibleText(e.inner).includes('1.1.0'));
  assert.ok(block, 'the roadmap shows the 1.1.0 release block');
  return `${H.visibleText(block.inner)} ${block.attrs['aria-label'] || ''}`;
}

test('#41 English unchanged: a release block waiting at its Ship gate says "Waiting for you"', async () => {
  assert.match(await waitingRelease('en'), /Waiting for you/);
});

test('#41 pt-BR: a release block waiting at its Ship gate does not say "Waiting for you"', async () => {
  assert.doesNotMatch(await waitingRelease('pt-BR'), /Waiting for you/);
});
