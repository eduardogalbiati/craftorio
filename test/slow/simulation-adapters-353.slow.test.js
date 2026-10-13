// #353: moving simulation into injected adapters keeps a simulated run's behaviour: a mock run of
// software-development emits the same events, with the fields simulation decides (see
// test/simulated-run-events-353.js), as before the change. The baseline
// test/fixtures/events-software-development-353.json was recorded on the base commit (dd2012a);
// two runs there gave the same 593 events.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { simulatedSoftwareDevelopmentEvents } = require('../simulated-run-events-353');

const BASELINE = path.join(__dirname, '..', 'fixtures', 'events-software-development-353.json');

test('#353 a simulated run of software-development emits the same events as before the adapters', { timeout: 120000 }, async () => {
  const actual = await simulatedSoftwareDevelopmentEvents();
  const expected = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  assert.equal(actual.status, 'success');
  assert.equal(actual.events.length, expected.events.length, 'number of events');
  // the first differing event, compared as text so a failure prints one short line per side
  const i = actual.events.findIndex((e, n) => JSON.stringify(e) !== JSON.stringify(expected.events[n]));
  assert.equal(i === -1 ? '' : `event ${i}: ${JSON.stringify(actual.events[i])}`, i === -1 ? '' : `event ${i}: ${JSON.stringify(expected.events[i])}`);
});
