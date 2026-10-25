// #367 machine profile, details the acceptance tests leave out: the settings migration and the
// manual rule of settings:set (packages/engine/domains/workspace/workspace.js), the settings:machineProfile channel and its memory
// guard events (packages/engine/service/channels/app.js), and the suite command's workers (suite-step.js withWorkers).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');
const { withWorkers } = require('../../engine/suite-step');

test('a maximum raised by hand before the profile existed reads as manual, the default one as auto', (t) => {
  const { service, api } = makeService(t);
  const file = service.workspace().settings;
  fs.writeFileSync(file, JSON.stringify({ concurrentRuns: { enabled: true, max: 10 } }));
  assert.deepEqual(api['settings:get']().machineProfile, { mode: 'manual', concurrentRuns: 10 });
  fs.writeFileSync(file, JSON.stringify({ concurrentRuns: { enabled: true, max: 2 } }));
  assert.deepEqual(api['settings:get']().machineProfile, { mode: 'auto' });
});

test('settings:set: a maximum without the profile is the owner\'s (manual); with it, the profile given is kept', (t) => {
  const { api } = makeService(t);
  assert.deepEqual(api['settings:set']({ concurrentRuns: { enabled: true, max: 3 } }).machineProfile, { mode: 'manual', concurrentRuns: 3 });
  assert.deepEqual(api['settings:set']({ concurrentRuns: { enabled: true, max: 5 }, machineProfile: { mode: 'auto' } }).machineProfile, { mode: 'auto' });
  // another setting leaves the mode alone
  assert.deepEqual(api['settings:set']({ keepAwake: true }).machineProfile, { mode: 'auto' });
});

test('settings:machineProfile: the values, the line, and the memory guard\'s suggestion from the runs\' events', (t) => {
  const { service, api } = makeService(t);
  const plain = api['settings:machineProfile']();
  assert.match(plain.state, /^(auto|unknown)$/);
  assert.equal(typeof plain.line, 'string');
  assert.equal(plain.suggestion, null);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 4 } });
  const runs = service.workspace().runs;
  const write = (id, events) => {
    fs.mkdirSync(path.join(runs, id), { recursive: true });
    fs.writeFileSync(path.join(runs, id, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n{"cut`);
  };
  const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
  write('run-a', [{ type: 'log', ts: ago(1) }, { type: 'memory.hold', ts: ago(1), run_id: 'run-a' }]);
  write('run-b', [{ type: 'process.killed', ts: ago(3) }]); // no run_id: the folder's
  const out = api['settings:machineProfile']();
  assert.equal(out.state, 'manual');
  assert.equal(out.concurrentRuns, 4);
  assert.equal(out.suggestion?.concurrentRuns, 3);
  assert.deepEqual(out.suggestion?.runs, ['run-a', 'run-b']);
  assert.equal(out.suggestion?.days.length, 2);
  // read-only: nothing was changed by the suggestion
  assert.equal(api['settings:get']().machineProfile.concurrentRuns, 4);
});

test('withWorkers: playwright and jest commands get the workers unless they set them; others are left as they are', () => {
  assert.equal(withWorkers('npx playwright test', 2), 'npx playwright test --workers=2');
  assert.equal(withWorkers('npx playwright test --workers=4', 2), 'npx playwright test --workers=4');
  assert.equal(withWorkers('npx jest', 3), 'npx jest --maxWorkers=3');
  assert.equal(withWorkers('npx jest --runInBand', 3), 'npx jest --runInBand');
  assert.equal(withWorkers('npm test', 3), 'npm test');
  assert.equal(withWorkers('npx jest && npm run lint', 3), 'npx jest && npm run lint');
  assert.equal(withWorkers('npx jest', null), 'npx jest');
});

test('withWorkers: a command filtered to some test files still gets the workers at the end; -j / -w set by hand are kept', () => {
  assert.equal(withWorkers('npx playwright test a.spec.js b.spec.js', 2), 'npx playwright test a.spec.js b.spec.js --workers=2');
  assert.equal(withWorkers('npx jest test/a.test.js', 4), 'npx jest test/a.test.js --maxWorkers=4');
  assert.equal(withWorkers('npx playwright test -j 4', 2), 'npx playwright test -j 4');
  assert.equal(withWorkers('npx jest -w 2 test/a.test.js', 4), 'npx jest -w 2 test/a.test.js');
});
