// #357: the Refactor tab's service channels, through makeService (simulation only, no network, no
// real CLI): every new refactor:* channel is served with schema.params/result; refactor:add stores an
// owner proposal listed by refactor:proposals; refactor:dismiss needs a reason; refactor:cadence
// defaults to off every 10 runs and refactor:setCadence refuses 2 and 51; refactor:prioritize gives
// the simulated Product Owner ranking (valid against PRIORITY_SCHEMA) saved on the proposals;
// refactor:addToRoadmap refuses a proposal with no issue. Tests first: the channels come with the change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./helpers');

const CHANNELS = [
  'refactor:add',
  'refactor:addToRoadmap',
  'refactor:cadence',
  'refactor:dismiss',
  'refactor:file',
  'refactor:prioritize',
  'refactor:setCadence',
];

async function setup(t) {
  const { service, api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor357-svc-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 }));
  fs.writeFileSync(path.join(folder, 'a.txt'), 'a\n');
  const project = await api['projects:create']({ name: 'refactor', folder });
  return { service, api, projectId: project.id };
}

async function call(api, channel, args) {
  assert.equal(typeof api[channel], 'function', `${channel} is a channel of the service`);
  return api[channel](args);
}

// a refusal by the channel itself, never the "not a channel" assertion standing in for one
async function refused(api, channel, args) {
  assert.equal(typeof api[channel], 'function', `${channel} is a channel of the service`);
  await assert.rejects(async () => api[channel](args));
}

const owner = (n) => ({ target: `src/part${n}.js`, improvement: `Split part ${n}`, evidence: `Part ${n} changes with every fix` });

test('#357 every new refactor:* channel is served and declares schema.params and schema.result', (t) => {
  const { service } = makeService(t);
  const schemaOf = new Map(service.manifest.filter((e) => e.channel).map((e) => [e.channel, e.schema]));
  assert.deepEqual(CHANNELS.filter((c) => !schemaOf.has(c)), [], 'channels not served');
  const without = CHANNELS.filter((c) => { const s = schemaOf.get(c); return !(s && s.params && s.result); });
  assert.deepEqual(without, []);
});

test('#357 refactor:add stores an owner proposal that refactor:proposals lists', async (t) => {
  const { api, projectId } = await setup(t);
  const stored = await call(api, 'refactor:add', { projectId, ...owner(1) });
  assert.equal(stored.source, 'owner');
  assert.equal(stored.target, 'src/part1.js');
  assert.equal(stored.improvement, 'Split part 1');
  assert.equal(stored.evidence, 'Part 1 changes with every fix');
  const list = await call(api, 'refactor:proposals', { projectId });
  assert.deepEqual(list.map((p) => p.id), [stored.id]);
});

test('#357 refactor:dismiss with a reason dismisses the proposal and keeps it listed', async (t) => {
  const { api, projectId } = await setup(t);
  const stored = await call(api, 'refactor:add', { projectId, ...owner(1) });
  const out = await call(api, 'refactor:dismiss', { projectId, id: stored.id, reason: 'Done elsewhere' });
  assert.equal(out.status, 'dismissed');
  assert.equal(out.dismissReason, 'Done elsewhere');
  const [listed] = await call(api, 'refactor:proposals', { projectId });
  assert.equal(listed.status, 'dismissed');
});

test('#357 refactor:dismiss without a reason is refused', async (t) => {
  const { api, projectId } = await setup(t);
  const stored = await call(api, 'refactor:add', { projectId, ...owner(1) });
  await refused(api, 'refactor:dismiss', { projectId, id: stored.id, reason: '' });
  const [listed] = await call(api, 'refactor:proposals', { projectId });
  assert.equal(listed.status, 'proposed');
});

test('#357 refactor:cadence of a new project is off, every 10 runs', async (t) => {
  const { api, projectId } = await setup(t);
  const out = await call(api, 'refactor:cadence', { projectId });
  assert.equal(out.on, false);
  assert.equal(out.every, 10);
  assert.equal(typeof out.nextIn, 'number');
});

test('#357 refactor:setCadence saves a cadence within 3..50', async (t) => {
  const { api, projectId } = await setup(t);
  const out = await call(api, 'refactor:setCadence', { projectId, on: true, every: 5 });
  assert.equal(out.on, true);
  assert.equal(out.every, 5);
  const read = await call(api, 'refactor:cadence', { projectId });
  assert.deepEqual([read.on, read.every], [true, 5]);
});

test('#357 refactor:setCadence refuses every 2 and every 51', async (t) => {
  const { api, projectId } = await setup(t);
  await refused(api, 'refactor:setCadence', { projectId, on: true, every: 2 });
  await refused(api, 'refactor:setCadence', { projectId, on: true, every: 51 });
  const read = await call(api, 'refactor:cadence', { projectId });
  assert.deepEqual([read.on, read.every], [false, 10]);
});

test('#357 refactor:prioritize in simulation gives a valid ranking and the proposals carry their ranks', async (t) => {
  const { api, projectId } = await setup(t);
  const a = await call(api, 'refactor:add', { projectId, ...owner(1) });
  const b = await call(api, 'refactor:add', { projectId, ...owner(2) });
  const out = await call(api, 'refactor:prioritize', { projectId });
  assert.equal(typeof out.at, 'string');
  assert.equal(typeof out.costUsd, 'number');
  const { PRIORITY_SCHEMA } = require('../../domains/refactor/refactor-priority');
  const { validateSchema } = require('../../domains/workspace/json-schema');
  assert.deepEqual(validateSchema({ ranking: out.ranking }, PRIORITY_SCHEMA), []);
  assert.deepEqual(out.ranking.map((r) => r.id).sort(), [a.id, b.id].sort());
  const list = await call(api, 'refactor:proposals', { projectId });
  assert.deepEqual(list.map((p) => p.rank).sort(), [1, 2]);
});

test('#357 refactor:addToRoadmap refuses a proposal that has no issue', async (t) => {
  const { api, projectId } = await setup(t);
  const stored = await call(api, 'refactor:add', { projectId, ...owner(1) });
  await refused(api, 'refactor:addToRoadmap', { projectId, id: stored.id });
});
