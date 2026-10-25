// #337 (acceptance tests, written before the code): the Night watch service channel sets tonight's
// limits. The API these tests pin down (the developer implements it):
//   - channel `nightwatch:limits`, window.api method `setNightWatchLimits(limits)`: limits
//     { multiplier } (1.5, 2 or 3) or { values: { context, cost, duration, turns, budget } }; saves
//     them for the Night watch in force (src/domains/night/night-limits.js saveNightLimits, by 'the owner'), raises
//     the nightly budget for that night through the existing settings.budget.raised
//     ({ night: <watch startedAt>, nightlyUsd }: the nightly budget × multiplier, or values.budget),
//     tells every live run (run.noteLimitsRaised) and answers nightwatch:state.
//     Refused without a Night watch with an end time (Self-healing's standing watch never expands).
//   - nightwatch:state gains `limits`: { day: { context, cost, duration, budget } (the reference day
//     values the screen shows; budget: the nightly budget or null), tonight: the settings in force
//     ({ multiplier } | { values }) or null }.
// Called the way window.api calls it (the manifest's `params`), as test/service/nightwatch.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const actions = require('../../src/domains/oracle/oracle-actions');
const night = require('../../src/domains/night/night-watch');
const workspace = require('../../src/workspace');
const budget = require('../../src/budget');
const { makeService } = require('./helpers');

// The same mapping as src/host/preload.js payload(): positional arguments -> the channel's argument.
function payload(params, args) {
  if (!params) return undefined;
  if (typeof params === 'string') return args[0];
  const out = {};
  params.forEach((name, i) => {
    if (name.startsWith('...')) Object.assign(out, args[i]);
    else out[name] = args[i];
  });
  return out;
}
function windowApi(service) {
  const api = {};
  for (const e of service.manifest) {
    if (e.channel && e.method && service.api[e.channel]) api[e.method] = async (...args) => service.api[e.channel](payload(e.params, args));
  }
  return api;
}

function setup(t) {
  const { service } = makeService(t);
  const ws = service.workspace();
  const dir = ws.oracle || path.join(ws.root, 'oracle');
  return { service, ws, api: windowApi(service), dir };
}
const nightOn = (dir) => actions.setNightWatch(dir, { on: true, until: new Date(Date.now() + 8 * 3600e3).toISOString(), by: 'test' });

test('#337 window.api has setNightWatchLimits on the nightwatch:limits channel', (t) => {
  const { service } = setup(t);
  const entry = service.manifest.find((e) => e.channel === 'nightwatch:limits');
  assert.equal(entry?.method, 'setNightWatchLimits');
});

test('#337 setNightWatchLimits({ multiplier: 2 }) during a Night watch: state shows it, the night log records oracle.limits by the owner', async (t) => {
  const { api, dir } = setup(t);
  nightOn(dir);
  const out = await api.setNightWatchLimits({ multiplier: 2 });
  assert.equal(out.limits.tonight.multiplier, 2);
  assert.equal((await api.nightWatchState()).limits.tonight.multiplier, 2);
  const logged = night.readNightLog(dir).filter((e) => e.type === 'oracle.limits');
  assert.deepEqual(logged.map((e) => [e.multiplier, e.by]), [[2, 'the owner']]);
});

test('#337 setNightWatchLimits raises the nightly budget for that night only, through budget.raised', async (t) => {
  const { api, dir, ws } = setup(t);
  workspace.writeSettings(ws, { budget: { nightlyUsd: 75 } });
  const w = nightOn(dir);
  await api.setNightWatchLimits({ multiplier: 2 });
  const raised = workspace.readSettings(ws).budget.raised;
  assert.deepEqual([raised.night, raised.nightlyUsd], [w.startedAt, 150]);
  await api.setNightWatchLimits({ values: { budget: 200 } });
  assert.equal(workspace.readSettings(ws).budget.raised.nightlyUsd, 200);
});

test('#337 a custom nightly budget without a nightly budget set does not create a cap: the warning stays', async (t) => {
  const { api, dir, ws } = setup(t);
  const w = nightOn(dir);
  const out = await api.setNightWatchLimits({ values: { budget: 200 } });
  assert.equal(out.limits.day.budget, null, 'no nightly budget: the screen keeps its warning');
  const state = budget.budgetState({ settings: workspace.readSettings(ws), runs: [], night: { active: true, startedAt: w.startedAt } });
  assert.equal(state.night.limitUsd, null, 'nothing caps tonight\'s spending');
});

test('#337 nightwatch:state shows the day values and no limits tonight while the watch is off', async (t) => {
  const { api, ws } = setup(t);
  workspace.writeSettings(ws, { budget: { nightlyUsd: 75 } });
  const s = await api.nightWatchState();
  assert.equal(s.limits.tonight, null);
  assert.equal(s.limits.day.budget, 75);
  for (const k of ['context', 'cost', 'duration']) assert.equal(typeof s.limits.day[k], 'number', `day.${k}`);
});

test('#337 Self-healing does not expand limits: setNightWatchLimits is refused under the standing watch alone', async (t) => {
  const { api, dir, ws } = setup(t);
  workspace.writeSettings(ws, { oracle: { selfHealing: true } });
  actions.markSelfHealing(dir, true);
  await assert.rejects(api.setNightWatchLimits({ multiplier: 2 }), /Night watch/);
  assert.equal((await api.nightWatchState()).limits.tonight, null);
  assert.equal(night.readNightLog(dir).filter((e) => e.type === 'oracle.limits').length, 0);
});
