// #491 the Roadmap's light state (acceptance tests written before the code). The screen's live
// reloads read a light channel instead of the whole Backlog:
//   backlog:state { projectId } → { projectId, roadmap: { state, updatedAt, scope, pausedBy, error,
//     stages: [{ id, items: [{ id, status, runId, runs, startedAt, elapsed, waiting }] }] }, queue, refresh }
// (window.api.getBacklogState(projectId)): what changes while runs go, no issue bodies, small however
// long the roadmap and its issues are.
// Seam: the service's api (test/service/helpers.js makeService), the project and its synced issues
// written as roadmapProject writes them, the roadmap saved with roadmap:save.
// Assumptions: the channel is `backlog:state`; the item list is per stage (`stages[].items[]`), the
// test reads every object with an `id` anywhere in the roadmap part so a flat list passes too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject } = require('./helpers');

const STAGES = 135;
const BODY = 20 * 1024;

async function bigRoadmap(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const numbers = Array.from({ length: STAGES }, (_, i) => i + 1);
  const p = await roadmapProject(api, ws, t, [1], 'state491');
  const issues = numbers.map((n) => ({ ...roadmapIssue(n), body: `Body of ${n} `.padEnd(BODY, 'x') }));
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues }));
  await api['roadmap:save']({ projectId: p.id, stages: numbers.map((n) => ({ items: [{ workflow: 'fixture-issue.yaml', number: n, mock: true }] })) });
  return { api, p };
}

// every object with an id in a value (the roadmap part of the light state)
function ids(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) ids(v, out);
  else if (value && typeof value === 'object') {
    if (typeof value.id === 'string') out.add(value.id);
    for (const v of Object.values(value)) ids(v, out);
  }
  return out;
}
const hasKey = (value, key) => (Array.isArray(value) ? value.some((v) => hasKey(v, key))
  : value && typeof value === 'object' ? Object.keys(value).includes(key) || Object.values(value).some((v) => hasKey(v, key)) : false);

test('#491 backlog:state: the roadmap\'s state and updatedAt, every item\'s id and status, the queue and the refresh, and no issue body', async (t) => {
  const { api, p } = await bigRoadmap(t);
  const full = api['backlog:get']({ projectId: p.id });
  assert.equal(full.roadmap.stages.length, STAGES, 'fixture check: the roadmap was saved');
  const light = await api['backlog:state']({ projectId: p.id });
  assert.ok(light && typeof light === 'object', 'an answer');
  assert.equal(light.roadmap?.state, full.roadmap.state);
  assert.equal(light.roadmap?.updatedAt, full.roadmap.updatedAt);
  const itemIds = full.roadmap.stages.flatMap((s) => s.items.map((x) => x.id));
  const got = ids(light.roadmap);
  assert.deepEqual(itemIds.filter((id) => !got.has(id)), [], 'every item is in the light state');
  const statuses = JSON.stringify(light.roadmap).match(/"status":/g) || [];
  assert.ok(statuses.length >= itemIds.length, 'with its status');
  assert.ok('queue' in light, 'the queue');
  assert.ok('refresh' in light, 'the refresh flag (the Backlog Refresh banner\'s state)');
  assert.equal(hasKey(light, 'body'), false, 'no issue body anywhere');
});

test('#491 backlog:state stays small: 135 stages whose issues have 20 KB bodies answer under 100 KB', async (t) => {
  const { api, p } = await bigRoadmap(t);
  const fullSize = JSON.stringify(api['backlog:get']({ projectId: p.id })).length;
  assert.ok(fullSize > 2 * 1024 * 1024, `fixture check: the whole Backlog is large (${fullSize} bytes)`);
  const size = JSON.stringify(await api['backlog:state']({ projectId: p.id })).length;
  assert.ok(size < 100 * 1024, `the light state is ${size} bytes`);
});
