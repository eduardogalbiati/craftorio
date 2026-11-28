// #792 The roadmap card says how a run ends. Acceptance tests written before the code.
//
// The contract (shared with the BDD agent):
// - the card's badge `data-testid="roadmap-item-ending"`, `data-ending="pr" | "local" | "fork"`: its text
//   the translated label, its `title` #195's explanation when the item ends differently from the default;
// - a run ending in a PR has "Abrir PR", "Open PR" or "Pull request" as last station (the developer
//   picks; nothing here fixes how the YAML says it): in the card and in the run's progress.
//
// Everything real here: the workflows are what the service answers (workflows:list over the bundled
// files and the repository's ai-development-remote-hero.yaml, copied into the workspace), so a field the
// change adds to that summary reaches the screen as it will in the app; DefaultWorkflow is the real
// module, its default the header project's (state.projects, CurrentProject). The run's progress reads a
// run record the service started (mock), with the trail placed at its last steps.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('@craftorio/shared/i18n.js');
const en = require('@craftorio/shared/i18n/en.json');
const ptBR = require('@craftorio/shared/i18n/pt-BR.json');
const { makeService, until } = require('@craftorio/engine/test/service/helpers');
const H = require('../roadmap-status-helpers');

const HERO = 'ai-development-remote-hero.yaml';
const HERO_FILE = path.join(__dirname, '..', '..', '..', '..', '.craftorio', 'workflows', HERO);
const FEATURE = 'feature.yaml';
const FIX = 'fix.yaml';
const PR_STATION = /^(Abrir PR|Open PR|Pull request)$/;
const COMMIT = 'abc1234def567890abc1234def567890abc12345';

const REMOTE_DEFAULT = { id: 'p1', defaultWorkflow: 'ai-development-remote-hero' };
const LOCAL_DEFAULT = { id: 'p1', defaultWorkflow: 'feature' };

const addHero = (service) => fs.copyFileSync(HERO_FILE, path.join(service.workspace().workflows, HERO));
// the summaries the screen receives, read once (plain values: they outlive the first test's service)
let summaries = null;
async function workflowList(t) {
  if (summaries) return summaries;
  const { service, api } = makeService(t);
  addHero(service);
  summaries = H.clone(await api['workflows:list']());
  return summaries;
}

// the Roadmap with the workflows loaded, under `project`'s default
async function screen(t, project) {
  const list = await workflowList(t);
  const loaded = H.loadRoadmap({ listWorkflows: async () => list });
  Object.assign(loaded.sandbox.state, { workflows: list, projects: [project] });
  loaded.sandbox.CurrentProject = { get: () => project.id };
  loaded.R.html(H.roadmapOf([]), () => {});
  await H.settle();
  await H.settle();
  return loaded;
}

const card = (workflow, inputs = {}, extra = {}) => ({
  id: 'a', status: 'planned', workflow, workflowName: workflow.replace(/\.yaml$/, ''), inputs, mock: false,
  issues: [H.ref(1, 'Login page')], runId: null, runs: [], error: null, ...extra,
});
const one = (x, roadmap = {}) => ({ roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items: [x] }], ...roadmap }, issues: [] });
const draw = (R, d) => R.html(d, () => {}, { showAll: true, since: 'total' });

function ending(R, workflow, inputs) {
  const el = H.findEl(H.itemEl(draw(R, one(card(workflow, inputs))), 'a').outer, (e) => e.attrs['data-testid'] === 'roadmap-item-ending');
  return el ? { kind: el.attrs['data-ending'], text: H.visibleText(el.inner), title: el.attrs.title || '' } : null;
}
function badge(R, workflow, inputs) {
  const seen = ending(R, workflow, inputs);
  assert.ok(seen, `${workflow} ${JSON.stringify(inputs)} has its ending badge`);
  return seen;
}
// each row's badge under a remote and under a local default
async function kinds(t, rows) {
  const kindsUnder = async (project) => {
    const { R } = await screen(t, project);
    return rows.map(([file, inputs]) => ending(R, file, inputs)?.kind ?? null);
  };
  return { remote: await kindsUnder(REMOTE_DEFAULT), local: await kindsUnder(LOCAL_DEFAULT) };
}
const explains = ({ title }) => /default/i.test(title);

function stationsOf(html) {
  const pipe = H.findEl(H.itemEl(html, 'a').outer, (e) => e.attrs['data-testid'] === 'roadmap-pipeline');
  assert.ok(pipe, 'the card draws its pipeline');
  return H.findAll(pipe.outer, (e) => e.attrs['data-testid'] === 'roadmap-station');
}
const hasClass = (e, name) => String(e.attrs.class || '').split(/\s+/).includes(name);
// a station's glyph is named "<station>: <state>" (the lanes of 2026-11-27: its name shows once, over its column)
const glyphName = (st) => H.findEl(st.inner, (e) => 'aria-label' in e.attrs)?.attrs['aria-label'] || '';
const stationName = (st) => glyphName(st).replace(/: [^:]*$/, '');
const lastStationName = (R, file, inputs) => stationName(stationsOf(draw(R, one(card(file, inputs)))).at(-1));

// ---- criterion 1: every item that merges or opens a PR has a badge, whatever the default ---------------

test('#792 an item ending in a PR shows the "pr" badge under any default: the remote hero (its mode is the validation), feature and fix in remote mode, an item saved under the old remote name', async (t) => {
  const rows = [[HERO, {}], [HERO, { mode: 'validated' }], [FEATURE, { mode: 'remote' }], [FIX, { mode: 'remote' }], ['software-development.yaml', {}]];
  assert.deepEqual(await kinds(t, rows), { remote: ['pr', 'pr', 'pr', 'pr', 'pr'], local: ['pr', 'pr', 'pr', 'pr', 'pr'] });
});

test('#792 an item ending in a local merge shows the "local" badge under any default: feature and fix in local mode, feature without a mode or with an old validation mode, refactor', async (t) => {
  const rows = [[FEATURE, { mode: 'local' }], [FIX, { mode: 'local' }], [FEATURE, {}], [FEATURE, { mode: 'auto' }], ['refactor.yaml', {}]];
  assert.deepEqual(await kinds(t, rows), { remote: ['local', 'local', 'local', 'local', 'local'], local: ['local', 'local', 'local', 'local', 'local'] });
});

test('#792 an item in fork mode shows the "fork" badge under any default: feature and fix', async (t) => {
  const rows = [[FEATURE, { mode: 'fork' }], [FIX, { mode: 'fork' }]];
  assert.deepEqual(await kinds(t, rows), { remote: ['fork', 'fork'], local: ['fork', 'fork'] });
});

test('#792 a workflow that neither merges nor opens a PR has no badge, under any default', async (t) => {
  const rows = [['issue.yaml', {}], ['backlog-refresh.yaml', {}]];
  assert.deepEqual(await kinds(t, rows), { remote: [null, null], local: [null, null] });
});

test('#792 the badge reads Abre um PR/MR, Merge local and Fork + PR in Portuguese', async (t) => {
  t.after(() => I18n.setLanguage('en'));
  I18n.setLanguage('pt-BR');
  const { R } = await screen(t, LOCAL_DEFAULT);
  const label = (mode) => badge(R, FEATURE, { mode }).text.replace(/^[^\p{L}]+/u, ''); // an icon may lead it
  assert.deepEqual(['remote', 'local', 'fork'].map(label), ['Abre um PR/MR', 'Merge local', 'Fork + PR']);
});

// ---- criterion 2: #195's explanation, only on an item that ends differently from the default ------------

test('#792 a PR item under a local default keeps #195\'s explanation: what it does and the default\'s file', async (t) => {
  const { R } = await screen(t, LOCAL_DEFAULT);
  const { title } = badge(R, HERO, {});
  assert.match(title, /PR/);
  assert.match(title, /feature\.yaml/);
});

test('#792 a local item under a remote default gets the explanation too: what it does and the default\'s file', async (t) => {
  const { R } = await screen(t, REMOTE_DEFAULT);
  const { title } = badge(R, FEATURE, { mode: 'local' });
  assert.match(title, /local/i);
  assert.match(title, /ai-development-remote-hero\.yaml/);
});

test('#792 an item on the default\'s very workflow that ends differently by its mode gets the explanation', async (t) => {
  const { R } = await screen(t, LOCAL_DEFAULT);
  const { title } = badge(R, FEATURE, { mode: 'remote' });
  assert.match(title, /PR/);
  assert.match(title, /feature\.yaml/);
});

test('#792 an item ending like the default has no such explanation, on the default\'s workflow or on another', async (t) => {
  const remote = await screen(t, REMOTE_DEFAULT);
  const local = await screen(t, LOCAL_DEFAULT);
  assert.deepEqual([
    badge(remote.R, HERO, {}), badge(remote.R, FEATURE, { mode: 'remote' }), badge(local.R, FEATURE, {}), badge(local.R, 'refactor.yaml', {}),
  ].map(explains), [false, false, false, false]);
});

test('#792 a default of feature that the project runs in remote mode ends in a PR: its PR items need no explanation, its local ones do', async (t) => {
  const { R } = await screen(t, { id: 'p1', defaultWorkflow: 'feature', workflows: [{ name: 'feature', variant: 'remote-code' }] });
  assert.deepEqual([explains(badge(R, FEATURE, { mode: 'remote' })), explains(badge(R, FEATURE, { mode: 'local' }))], [false, true]);
});

// ---- criterion 2: the Roadmap's warning about mixed items (#195, checkPushes) ---------------------------

async function clickStart(t, project, items) {
  const { R, sandbox } = await screen(t, project);
  const asked = [];
  let started = 0;
  sandbox.choiceDialog = async (title, message, options) => { asked.push({ message: String(message), ids: Array.from(options, (o) => o.id) }); return null; };
  sandbox.api.startRoadmap = async () => { started += 1; return { roadmap: { state: 'running', stages: [] }, issues: [] }; };
  const d = { roadmap: { state: 'planned', stages: [{ id: 'st1', name: '', note: '', items }] }, issues: [] };
  await R.onClick(H.clickOn(draw(R, d), (e) => e.attrs['data-rm'] === 'start'), H.makeCtx().ctx, d);
  return { asked, started };
}

test('#792 the warning still lists an item that pushes under a local default, and cancelling it starts nothing', async (t) => {
  const { asked, started } = await clickStart(t, LOCAL_DEFAULT, [card(HERO), card(FEATURE, {}, { id: 'b', issues: [H.ref(2, 'Logout')] })]);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].ids, ['switch', 'anyway']);
  assert.match(asked[0].message, /#1\b/);
  assert.doesNotMatch(asked[0].message, /#2\b/);
  assert.equal(started, 0);
});

test('#792 the warning stays away under a remote default: the roadmap starts at once', async (t) => {
  const { asked, started } = await clickStart(t, REMOTE_DEFAULT, [card(HERO), card(FEATURE, { mode: 'remote' }, { id: 'b', issues: [H.ref(2, 'Logout')] })]);
  assert.deepEqual([asked.length, started], [0, 1]);
});

// ---- criterion 3: the last station says how the run ends -----------------------------------------------

test('#792 the remote hero\'s card ends in a PR station', async (t) => {
  const { R } = await screen(t, REMOTE_DEFAULT);
  assert.match(lastStationName(R, HERO, {}), PR_STATION);
});

test('#792 feature and fix in remote or fork mode end in a PR station on the card', async (t) => {
  const { R } = await screen(t, REMOTE_DEFAULT);
  const names = [[FEATURE, 'remote'], [FEATURE, 'fork'], [FIX, 'remote'], [FIX, 'fork']].map(([file, mode]) => lastStationName(R, file, { mode }));
  assert.deepEqual(names.map((n) => PR_STATION.test(n)), [true, true, true, true], names.join(' | '));
});

test('#792 feature and fix in local mode, or without a mode, keep Merge as last station on the card', async (t) => {
  const { R } = await screen(t, REMOTE_DEFAULT);
  assert.deepEqual([lastStationName(R, FEATURE, { mode: 'local' }), lastStationName(R, FIX, { mode: 'local' }), lastStationName(R, FEATURE, {})], ['Merge', 'Merge', 'Merge']);
});

// the run record the service keeps for a run of `file` (mock), the way the runs list reads it
async function runRecord(t, file, inputs) {
  const { service, api } = makeService(t);
  addHero(service);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ending-792-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { runId } = await api['run:start']({ file, inputs: { task: 'Add login', repo_path: repo, ...inputs }, mock: true });
  await until(() => api['runs:active']().some((r) => r.runId === runId));
  const { runs } = await api['runs:list']();
  return H.clone(runs.find((r) => r.runId === runId));
}
// the name of the last chip of the run's progress with the run at `step`
function progressName(record, step) {
  const trail = [{ step: 'develop', status: 'done', agents: [] }, { step, status: 'running', agents: [] }];
  const html = H.loadRunList().runProgressStrip({ ...record, current: false, status: 'running', progress: trail });
  return H.visibleText(H.findAll(html, (e) => hasClass(e, 'rp-name')).at(-1).inner);
}

test('#792 the remote hero\'s run shows the PR name in its progress', async (t) => {
  assert.match(progressName(await runRecord(t, HERO, {}), 'pr_open'), PR_STATION);
});

test('#792 a feature run in remote mode shows the PR name in its progress', async (t) => {
  assert.match(progressName(await runRecord(t, FEATURE, { mode: 'remote' }), 'ci'), PR_STATION);
});

test('#792 a feature run in local mode keeps Merge in its progress', async (t) => {
  assert.equal(progressName(await runRecord(t, FEATURE, { mode: 'local' }), 'push_main'), 'Merge');
});

// ---- criterion 4: a run whose work merged shows its last station done with the commit --------------------

const trailStep = (step) => ({ step, status: 'done', ts: H.iso(H.NOW - H.HOUR), durationMs: 5 * H.MIN, agents: [{ agent: 'developer', provider: 'claude', model: 'm', cost: 0.1, durationMs: 1000 }] });
function ranCard(list, file, inputs, status, mergedCommit) {
  const groups = list.find((w) => w.file === file).groups;
  const run = H.run({ status: 'success', workflow: file, startedAt: H.iso(H.NOW - 2 * H.HOUR), finishedAt: H.iso(H.NOW - H.HOUR), progress: [trailStep('develop'), trailStep('code_review')], groups, mergedCommit });
  return card(file, inputs, { status, runId: 'run-m', runs: ['run-m'], run });
}

test('#792 a merged run ending in a PR shows its last station done, naming the commit: the remote hero and feature in remote mode', async (t) => {
  const { R } = await screen(t, REMOTE_DEFAULT);
  const list = await workflowList(t);
  const last = (file, inputs) => stationsOf(draw(R, one(ranCard(list, file, inputs, 'done', COMMIT), { state: 'done' }))).at(-1);
  const seen = [last(HERO, {}), last(FEATURE, { mode: 'remote' })].map((st) => [st.attrs['data-state'], /abc1234/.test(glyphName(st))]);
  assert.deepEqual(seen, [['done', true], ['done', true]]);
});

test('#792 a PR not merged yet is not shown as merged: the last station is not done and names no commit', async (t) => {
  const { R } = await screen(t, REMOTE_DEFAULT);
  const list = await workflowList(t);
  const st = stationsOf(draw(R, one(ranCard(list, HERO, {}, 'waiting_merge', null), { state: 'running' }))).at(-1);
  assert.deepEqual([st.attrs['data-state'] === 'done', /merged|commit/i.test(`${st.attrs.title || ''} ${glyphName(st)}`)], [false, false]);
});

// ---- criterion 5: the catalogs carry the new texts ---------------------------------------------------------

test('#792 pt-BR carries Abre um PR/MR, Merge local and Abrir PR, and en a text for each of those keys', () => {
  const keyOf = (value) => Object.keys(ptBR).find((k) => ptBR[k] === value);
  const keys = ['Abre um PR/MR', 'Merge local', 'Abrir PR'].map(keyOf);
  assert.deepEqual(keys.map((k) => typeof k), ['string', 'string', 'string'], `keys: ${keys.join(', ')}`);
  assert.deepEqual(keys.map((k) => typeof en[k] === 'string' && en[k].length > 0), [true, true, true]);
});
