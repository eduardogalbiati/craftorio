// #285 Remove "Update the app after this". Acceptance tests written before the code.
//
// What these tests expect:
// - src/app-update.js: one trigger (a roadmap stage that ended, test/app-update-279.test.js); the
//   `WHEN_MODES` export is gone (or no longer offers 'marked').
// - src/roadmap.js: `updateAfter` is never written: an item saved, proposed (the Product Owner's
//   append goes through propose) or read from an older file with it loses the field at the next save;
//   an older file that has it still reads without error.
// - The roadmap card (src/renderer/views/backlog/backlog-roadmap.js) never draws the switch, even
//   when api.appUpdateState says the update applies.
// - The Oracle's tool descriptions (src/oracle-tools.js) and skills/oracle/SKILL.md no longer mention
//   updateAfter or "Update the app after this".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appupd-285-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const issues = (...numbers) => numbers.map((n) => ({ number: n, title: `Issue ${n}`, state: 'open', url: `https://github.com/o/r/issues/${n}`, body: '' }));

// ---- src/app-update.js ------------------------------------------------------------------------------

test('#285 app-update: WHEN_MODES is gone, or no longer offers "marked"', () => {
  const appUpdate = require('../src/app-update');
  const modes = appUpdate.WHEN_MODES;
  assert.equal(Array.isArray(modes) && modes.includes('marked'), false);
});

// ---- the roadmap file ---------------------------------------------------------------------------------

test('#285 roadmap: a file written with updateAfter reads without error and loses the field at the next save', (t) => {
  const roadmaps = require('../src/roadmap');
  const dir = tmp(t);
  const item = { id: 'item-1', workflow: 'w.yaml', workflowName: 'w', inputs: {}, mock: true, number: 1, url: 'https://github.com/o/r/issues/1', title: 'Issue 1', body: '', issues: [{ number: 1, url: 'https://github.com/o/r/issues/1', title: 'Issue 1' }], status: 'planned', runId: null, runs: [], error: null, updateAfter: true };
  fs.writeFileSync(path.join(dir, 'p1.roadmap.json'), JSON.stringify({ state: 'planned', simulated: false, error: null, pausedBy: null, scope: null, updatedAt: null, stages: [{ id: 's1', name: '', note: '', items: [item] }] }));
  const read = roadmaps.readRoadmap(dir, 'p1');
  assert.deepEqual(read.stages[0].items.map((x) => x.id), ['item-1']);
  roadmaps.saveStages(dir, 'p1', read.stages, { issues: issues(1) });
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'p1.roadmap.json'), 'utf8'));
  assert.equal('updateAfter' in raw.stages[0].items[0], false);
});

test('#285 roadmap: a proposal (the Product Owner\'s append) with updateAfter: true is stored without the field', (t) => {
  const roadmaps = require('../src/roadmap');
  const dir = tmp(t);
  roadmaps.propose(dir, 'p1', [{ items: [{ workflow: 'w.yaml', issues: [1], updateAfter: true }] }], { issues: issues(1) });
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'p1.roadmap.json'), 'utf8'));
  assert.equal('updateAfter' in raw.stages[0].items[0], false);
});

// ---- the roadmap card -------------------------------------------------------------------------------------

test('#285 roadmap card: never draws "Update the app after this", even when the update applies', async () => {
  const H = require('./roadmap-status-helpers');
  const { R, sandbox } = H.loadRoadmap();
  sandbox.api.appUpdateState = async () => ({ applies: true, project: { id: 'p1', name: 'multiagent-orchestrator' }, short: '5d9be33', behind: 3 });
  const data = () => H.roadmapOf([
    { id: 'st1', name: '', note: '', items: [H.item('i1', 'planned', 1, 'Planned one'), H.item('i2', 'planned', 2, 'Marked two', { updateAfter: true })] },
  ], { state: 'planned' });
  R.html(data(), () => {}, { showAll: true, since: 'total' });
  await H.settle();
  await H.settle();
  const html = R.html(data(), () => {}, { showAll: true, since: 'total' });
  assert.deepEqual([/Update the app after this/.test(html), /data-testid="roadmap-update-after"/.test(html)], [false, false]);
});

// ---- the Oracle ------------------------------------------------------------------------------------------------

test('#285 Oracle tools: no tool description mentions updateAfter', () => {
  const { oracleTools } = require('../src/oracle-tools');
  const text = oracleTools({}).map((x) => `${x.description || ''} ${JSON.stringify(x.inputSchema || {})}`).join('\n');
  assert.equal(/updateAfter/.test(text), false);
});

test('#285 skills/oracle/SKILL.md mentions neither updateAfter nor "Update the app after this"', () => {
  const md = fs.readFileSync(path.join(ROOT, 'skills', 'oracle', 'SKILL.md'), 'utf8');
  assert.deepEqual([/updateAfter/.test(md), /Update the app after this/i.test(md)], [false, false]);
});
