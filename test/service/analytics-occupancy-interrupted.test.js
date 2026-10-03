// #188: a run that died with the app (no workflow.finished, no live owner) ends at its last event in
// the 24/7 meter, instead of counting as active until now.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');

const H = 36e5;

test('analytics:occupancy: an interrupted run counts as active only until its last event', async (t) => {
  const { service, api } = makeService(t);
  const now = Date.now();
  const dir = path.join(service.workspace().runs, '20261001-000000-deadbeef');
  fs.mkdirSync(dir, { recursive: true });
  const events = [
    { ts: new Date(now - 5 * H).toISOString(), type: 'workflow.started', project_id: 'p', issues: [] },
    { ts: new Date(now - 4 * H).toISOString(), type: 'step.started', step: 'develop' },
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const out = await api['analytics:occupancy']({ summary: true });
  assert.equal(out.empty, false);
  assert.ok(Math.abs(out.activeHours - 1) < 0.05, `active ${out.activeHours} h, expected 1 h`);
  assert.ok(!out.running, 'the interrupted run is not shown as running');
});
