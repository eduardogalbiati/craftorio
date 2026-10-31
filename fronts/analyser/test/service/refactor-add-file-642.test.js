// #642: refactor:addToRoadmap with `file` (the onboarding's review) files a proposal without an issue
// first, as Send to Refactor does (ctx.planRefactor), then plans it in the waiting stage; without
// `file` it still refuses one, and with `file` but no synced backlog it says to sync first.
// Through makeService (simulation only): the host's fileIssue stands in for gh/glab.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const roadmaps = require('@multiagent/engine/domains/roadmap/roadmap');
const { makeService, gitRepo, roadmapIssue } = require('@multiagent/engine/test/service/helpers');

async function setup(t, { synced = true } = {}) {
  const drafts = [];
  const fileIssue = async (draft) => {
    drafts.push(draft);
    return { number: 77, url: 'https://github.com/o/r/issues/77' };
  };
  const { service, api } = makeService(t, { fileIssue });
  const ws = service.workspace();
  const { dir } = gitRepo(t);
  const p = await api['projects:create']({ name: 'demo', folder: dir });
  if (synced) {
    fs.mkdirSync(ws.backlog, { recursive: true });
    fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [5, 77].map(roadmapIssue) }));
  }
  const proposal = await api['refactor:add']({ projectId: p.id, target: 'a.txt', improvement: 'Split a.txt' });
  return { api, ws, projectId: p.id, proposal, drafts };
}

const numbers = (r) => r.stages.flatMap((s) => s.items.flatMap((x) => (x.issues || []).map((i) => Number(i.number))));

test('#642 refactor:addToRoadmap with file files the issue first and plans it, waiting', async (t) => {
  const w = await setup(t);
  const out = await w.api['refactor:addToRoadmap']({ projectId: w.projectId, id: w.proposal.id, file: true });
  assert.equal(w.drafts.length, 1, 'one issue filed');
  assert.equal(out.proposal.issue, 77);
  assert.equal(out.waiting, true, 'planned in the waiting stage: nothing starts');
  assert.deepEqual(numbers(roadmaps.readRoadmap(w.ws.backlog, w.projectId)), [77]);
});

test('#642 refactor:addToRoadmap without file still refuses a proposal with no issue', async (t) => {
  const w = await setup(t);
  await assert.rejects(async () => w.api['refactor:addToRoadmap']({ projectId: w.projectId, id: w.proposal.id }), /File the proposal/);
  assert.equal(w.drafts.length, 0);
});

test('#642 refactor:addToRoadmap with file and no synced backlog asks to sync it first', async (t) => {
  const w = await setup(t, { synced: false });
  await assert.rejects(async () => w.api['refactor:addToRoadmap']({ projectId: w.projectId, id: w.proposal.id, file: true }), /Sync the backlog/);
  assert.equal(w.drafts.length, 0);
});
