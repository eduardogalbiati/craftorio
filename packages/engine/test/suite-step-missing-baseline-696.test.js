// Acceptance tests for #696 (written before the code): in the E2E step (packages/engine/engine/suite-step.js
// runSuite, with a stubbed `run` so no process is spawned), a missing baseline is told apart from a
// visual difference. Playwright fails a scenario whose `toHaveScreenshot` has no baseline yet with
// "A snapshot doesn't exist at <path>, writing actual." and writes it: that is not a test failure,
// the round passes and lists the generated baseline (`new_baselines`) as evidence for the UI review
// against the issue's mockups. A real difference with an existing baseline ("Screenshot comparison
// failed", "N pixels (ratio …) are different") still fails the round (the healer, the test_failed
// gate). An existing baseline is never overwritten.
//
// The interface these tests fix: runSuite's output gets `new_baselines: [{ test, file, baseline }]`
// (file: the feature, as in `failures`; baseline: repository-relative, forward slashes); suiteMessage
// names each one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSuite, suiteMessage } = require('../engine/suite-step');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-baseline-696-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const MISSING_TITLE = 'Documents › The documents list looks like its baseline @issue-671 @visual';
const DIFF_TITLE = 'Backlog › The board looks like its baseline in the light theme @visual';

const missingBlock = (n, at) => `  ${n}) .features-gen\\features\\docs.feature.spec.js:7:7 › ${MISSING_TITLE}

    Error: A snapshot doesn't exist at ${at}, writing actual.

       at features\\steps\\docs.steps.js:12:3

`;

const diffBlock = (n, cwd) => `  ${n}) .features-gen\\features\\visual.feature.spec.js:9:7 › ${DIFF_TITLE}

    Error: Screenshot comparison failed:

      1234 pixels (ratio 0.03 of all image pixels) are different.

    Expected: ${path.join(cwd, 'features', '__screenshots__', 'backlog-board-light-win32.png')}
    Received: ${path.join(cwd, '.test-output', 'e2e', 'artifacts', 'visual-board-light', 'backlog-board-light-actual.png')}
        Diff: ${path.join(cwd, '.test-output', 'e2e', 'artifacts', 'visual-board-light', 'backlog-board-light-diff.png')}

       at features\\steps\\backlog.steps.js:74:3

`;

const playwrightLog = ({ blocks, failed, passed }) => `Running ${failed + passed} tests using 1 worker

  ✓  1 .features-gen\\features\\app.feature.spec.js:6:7 › App › The app opens on the dashboard @smoke (2.1s)

${blocks.join('')}  ${failed} failed
  ${passed} passed (15.4s)
`;

// a stubbed run writing the log Playwright prints, exit 1 (Playwright fails both cases)
const runWith = (text, seen = []) => async ({ command, logFile }) => {
  seen.push(command);
  fs.appendFileSync(logFile, text);
  return { code: 1, timedOut: false, error: null };
};

test('#696 runSuite: a round whose only failure is "A snapshot doesn\'t exist at …, writing actual" passes, with the generated baseline listed', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const at = path.join(cwd, 'features', '__screenshots__', '671-documents-win32.png');
  const run = runWith(playwrightLog({ blocks: [missingBlock(1, at)], failed: 1, passed: 1 }));
  const out = await runSuite({ command: 'npm run test:e2e -- --grep "@issue-671(?![0-9])|@smoke"', cwd, runDir, round: 1, run });
  assert.equal(out.status, 'pass', out.message);
  assert.deepEqual(out.failures, []);
  assert.deepEqual((out.new_baselines || []).map((b) => b.baseline), ['features/__screenshots__/671-documents-win32.png']);
  assert.match(out.new_baselines[0].test, /The documents list looks like its baseline/);
  assert.equal(out.new_baselines[0].file, 'features/docs.feature');
});

test('#696 runSuite: the missing snapshot\'s path printed relative to the project is read the same way', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const run = runWith(playwrightLog({ blocks: [missingBlock(1, 'features/__screenshots__/671-documents-win32.png')], failed: 1, passed: 1 }));
  const out = await runSuite({ command: 'npm run test:e2e', cwd, runDir, round: 1, run });
  assert.equal(out.status, 'pass', out.message);
  assert.deepEqual((out.new_baselines || []).map((b) => b.baseline), ['features/__screenshots__/671-documents-win32.png']);
});

test('#696 runSuite: a pixel difference with an existing baseline still fails the round (control)', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const run = runWith(playwrightLog({ blocks: [diffBlock(1, cwd)], failed: 1, passed: 1 }));
  const out = await runSuite({ command: 'npm run test:e2e', cwd, runDir, round: 1, run });
  assert.equal(out.status, 'fail');
  assert.equal(out.failures.length, 1, JSON.stringify(out.failures));
  assert.match(out.failures[0].test, /The board looks like its baseline in the light theme/);
  assert.match(out.failures[0].error, /Screenshot comparison failed|pixels .* are different/);
  assert.deepEqual(out.new_baselines || [], []);
});

test('#696 runSuite: a missing baseline and a pixel difference: the round fails on the difference only, the missing one is listed as generated', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const at = path.join(cwd, 'features', '__screenshots__', '671-documents-win32.png');
  const run = runWith(playwrightLog({ blocks: [missingBlock(1, at), diffBlock(2, cwd)], failed: 2, passed: 1 }));
  const out = await runSuite({ command: 'npm run test:e2e', cwd, runDir, round: 1, run });
  assert.equal(out.status, 'fail');
  assert.equal(out.failures.length, 1, JSON.stringify(out.failures.map((f) => f.test)));
  assert.match(out.failures[0].test, /The board looks like its baseline in the light theme/);
  assert.deepEqual((out.new_baselines || []).map((b) => b.baseline), ['features/__screenshots__/671-documents-win32.png']);
});

test('#696 suiteMessage: a passing round names the baseline it generated (evidence for the UI review)', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const at = path.join(cwd, 'features', '__screenshots__', '671-documents-win32.png');
  const run = runWith(playwrightLog({ blocks: [missingBlock(1, at)], failed: 1, passed: 1 }));
  const out = await runSuite({ command: 'npm run test:e2e', cwd, runDir, round: 1, run });
  assert.match(suiteMessage(out), /features\/__screenshots__\/671-documents-win32\.png/);
});

// Playwright's own count still says "1 failed": the passing round's message says it was a generated
// baseline, not counted (as for pre-existing failures), so the count is not read as a red test.
test('#696 runSuite: a round green only because of generated baselines says the missing one was not counted, and lists no pre-existing failure', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const at = path.join(cwd, 'features', '__screenshots__', '671-documents-win32.png');
  const run = runWith(playwrightLog({ blocks: [missingBlock(1, at)], failed: 1, passed: 1 }));
  const out = await runSuite({ command: 'npm run test:e2e', cwd, runDir, round: 1, run });
  assert.equal(out.status, 'pass', out.message);
  assert.match(out.message, /passed in round 1/);
  assert.match(out.message, /1 missing baseline generated, not counted/);
  assert.deepEqual(out.preexisting_failures, []);
  assert.deepEqual(out.preexisting, []);
});

test('#696 runSuite: an existing baseline is never overwritten (its bytes unchanged, no update command run)', async (t) => {
  const runDir = tmp(t);
  const cwd = tmp(t);
  const existing = path.join(cwd, 'features', '__screenshots__', 'backlog-board-light-win32.png');
  fs.mkdirSync(path.dirname(existing), { recursive: true });
  fs.writeFileSync(existing, Buffer.from('89504e470d0a1a0a6f6c64', 'hex'));
  const at = path.join(cwd, 'features', '__screenshots__', '671-documents-win32.png');
  const seen = [];
  const run = runWith(playwrightLog({ blocks: [missingBlock(1, at), diffBlock(2, cwd)], failed: 2, passed: 1 }), seen);
  await runSuite({ command: 'npm run test:e2e', cwd, runDir, round: 1, run });
  assert.equal(fs.readFileSync(existing).toString('hex'), '89504e470d0a1a0a6f6c64');
  for (const command of seen) {
    assert.doesNotMatch(command, /--update-snapshots(?!=missing\b)|(?:^|\s)-u(?:\s|$)|test:e2e:update/, `no command that rewrites existing baselines (got ${command})`);
  }
});
