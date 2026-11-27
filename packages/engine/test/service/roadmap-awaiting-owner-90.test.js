// #90 (review round 3): the roadmap:propose channel answers `awaitingOwner`, the numbers of the outside issues of
// the proposal the owner has not approved (left out of the roadmap), so the Backlog and the Roadmap can say which
// ones wait for the Approve; [] when there are none.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const backlog = require('../../domains/backlog/backlog');
const { makeService, roadmapIssue, roadmapProject } = require('./helpers');

// the project's synced backlog: 1 by the owner, 2 and 3 by people outside the project
async function project(t, api, ws) {
  const p = await roadmapProject(api, ws, t, [], 'roadmap-awaiting-owner-90');
  const issues = [
    { ...roadmapIssue(1), author: 'ana', authorAssociation: 'OWNER', outside: false },
    { ...roadmapIssue(2), author: 'eve', authorAssociation: 'NONE', outside: true },
    { ...roadmapIssue(3), author: 'bob', authorAssociation: 'CONTRIBUTOR', outside: true },
  ];
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues }));
  return p;
}
const proposal = (numbers) => ({ stages: [{ name: 'From the PO', items: numbers.map((number) => ({ workflow: 'fixture-issue.yaml', number })) }] });
const planned = (roadmap) => roadmap.stages.flatMap((s) => s.items.map((x) => x.number)).sort();

test('#90 roadmap:propose answers the unapproved outside issues it left out', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await project(t, api, ws);
  backlog.approveOutsideIssue(ws.backlog, p.id, 3, { at: '2026-11-27T10:00:00.000Z' });
  const data = await api['roadmap:propose']({ projectId: p.id, proposal: proposal([1, 2, 3]) });
  assert.deepEqual([data.awaitingOwner, planned(data.roadmap)], [[2], [1, 3]]);
});

test('#90 roadmap:propose answers an empty awaitingOwner when no outside issue waits', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await project(t, api, ws);
  const data = await api['roadmap:propose']({ projectId: p.id, proposal: proposal([1]) });
  assert.deepEqual(data.awaitingOwner, []);
});
