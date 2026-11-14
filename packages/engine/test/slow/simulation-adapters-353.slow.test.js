// #353: moving simulation into injected adapters keeps a simulated run's behaviour: a mock run of
// software-development emits the same events, with the fields simulation decides (see
// test/simulated-run-events-353.js), as before the change. The baseline
// test/fixtures/events-software-development-353.json was recorded on the base commit (dd2012a);
// two runs there gave the same 593 events. #465 adds the suite step's two step.log events (the
// focused round, then the whole suite): 595. #472 adds the run's first log event naming the
// repository commands it is about to run: 596. #696 adds the suite output's `new_baselines` ([]).
// #630 removed software-development.yaml (now feature.yaml in remote mode, tests first, the merge
// left to the team on the platform): re-recorded from feature.yaml (#723), two runs gave 443 events.
// #725: the E2E steps use new wizard test ids, so the testid_check step's message lists 151 (was 146).
// #724 #739 #743: the onboarding E2E steps use the wizard's new test ids: 156.
// #726: the "Why" label's test id wizard-workflow-why: 157.
// #731: the onboarding E2E steps check the project's City and Architecture tab test ids: 160.
// #723: that list follows this checkout's features and renderer, not simulation: the snapshot now
// keeps the test-id check's status and shape and replaces its `message` and `missing` list
// (test/simulated-run-events-353.js), so a new test id no longer turns this test red.
// #723: the baseline was recorded on Windows with Node v24.19.0; paths under a replaced folder now
// use '/' and this process's Node version reads <node-version>, so it holds on any machine.
// #809 replaced feature.yaml's pr_review gate with the pr_monitor step (pending, waiting, ready,
// merged): re-recorded (#723), two runs gave 447 events.
// #758: the warm_up step's schema has an optional `reuse` list, so its simulated answer carries one.
// #756: the developer loads developer-self-review and code-review pulls reuse-pass through `uses`:
// one more "skill loaded" log in develop and one in code_review: 449.
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
