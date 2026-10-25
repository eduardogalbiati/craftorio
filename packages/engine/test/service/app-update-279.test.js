// Acceptance tests for #279 at the service seam: after the app restarted for an update, the new
// process reads the intent (<workspace>/oracle/app-update.json, written with packages/engine/domains/workspace/app-update.js),
// sets the paused roadmaps back to running before the start-up dispatch (trap 3 of the issue) and
// deletes the intent, so the next stage starts without any click.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createService } = require('../../service');
const roadmapModel = require('../../domains/roadmap/roadmap');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, roadmapProject, until } = require('./helpers');

const load = () => require('../../domains/workspace/app-update');

test('#279 service: after an update restart the paused roadmap starts its stage by itself and the intent is gone', async (t) => {
  const { writeIntent } = load();
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1], 'app-update-resume');

  roadmapModel.saveStages(ws.backlog, p.id, [{ items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] }], { issues: [roadmapIssue(1)] });
  roadmapModel.setState(ws.backlog, p.id, 'running', { simulated: true });
  roadmapModel.updateRoadmap(ws.backlog, p.id, (r) => ({ ...r, state: 'paused', pausedBy: null, error: 'Updating the app' }));
  writeIntent(ws.root, { from: 'febef8b', to: '5d9be33', subjects: ['fix 1'], roadmaps: [p.id], appDir: 'C:/apps/mao' }, { now: Date.now() });

  const service2 = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  try {
    service2.setWorkspace(ws);
    await until(() => service2.api['roadmap:get']({ projectId: p.id }).stages[0].items[0].status === 'running');
    assert.equal(service2.api['roadmap:get']({ projectId: p.id }).state, 'running');
    assert.equal(fs.existsSync(path.join(ws.oracle, 'app-update.json')), false);
    const notes = service2.api['notifications:list']({}).items.map((n) => `${n.title || ''} ${n.body || ''}`);
    assert.ok(notes.some((n) => /Updated/.test(n) && /resumed/i.test(n)), notes.join(' | '));
  } finally {
    // stop what either service started (as the restart test of roadmap.test.js does) and close
    // service2 before makeService's teardown removes the workspace folder
    for (const s of [service, service2]) for (const run of s.api['runs:active']()) { try { s.api['run:stop']({ runId: run.runId }); } catch { /* already ended */ } }
    await until(() => service.api['runs:active']().length === 0 && service2.api['runs:active']().length === 0);
    service2.shutdown();
  }
});
