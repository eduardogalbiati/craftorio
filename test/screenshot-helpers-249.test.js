// #249: the shared helpers of the screenshot seeds (scripts/screenshot/helpers.js) and the options a
// seed module declares for its view. Plain Node: no Electron window is opened here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeEvents } = require('../scripts/screenshot/helpers');
const { parseArgs, VIEWS } = require('../scripts/screenshot');

test('writeEvents stamps every event with the run id and its seq, unless the event carries its own', (t) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seed-events-')), 'run-1');
  t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));
  writeEvents(dir, 'run-1', [{ type: 'workflow.started' }, { type: 'step.started', seq: 7 }, { type: 'workflow.finished', run_id: 'other' }]);
  const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => [e.seq, e.run_id, e.type]), [[1, 'run-1', 'workflow.started'], [7, 'run-1', 'step.started'], [3, 'other', 'workflow.finished']]);
});

test('a seed module\'s options apply to its view only, with the values it lists', () => {
  assert.deepEqual(Object.keys(VIEWS.backlog.options).sort(), ['issues', 'live', 'po', 'project', 'refresh', 'roadmap']);
  assert.equal(parseArgs(['--view', 'roadmap', '--live', 'on']).live, 'on', 'the Roadmap screen is the Backlog');
  assert.throws(() => parseArgs(['--view', 'workflows', '--live', 'on']), /--live applies to --view backlog/);
  assert.throws(() => parseArgs(['--view', 'backlog', '--roadmap', 'nope']), /--roadmap takes (\w+ \| )*states\b/);
});

// #784 #830: --refresh (the Backlog's banner with the project's add time as the baseline) is a
// Backlog-only option the command line accepts, with the values the seed lists
test('--refresh is accepted on the Backlog with fresh or onboarded, refused elsewhere or with another value', () => {
  assert.equal(parseArgs(['--view', 'backlog', '--refresh', 'fresh']).refresh, 'fresh');
  assert.equal(parseArgs(['--view', 'backlog', '--refresh', 'onboarded']).refresh, 'onboarded');
  assert.throws(() => parseArgs(['--view', 'workflows', '--refresh', 'fresh']), /--refresh applies to --view backlog/);
  assert.throws(() => parseArgs(['--view', 'backlog', '--refresh', 'nope']), /--refresh takes fresh \| onboarded/);
  assert.throws(() => parseArgs(['--view', 'backlog', '--refresh']), /--refresh needs a value/);
});
