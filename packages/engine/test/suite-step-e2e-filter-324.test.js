// Focused E2E rounds (#324), packages/engine/engine/suite-step.js: `filteredCommand` restricts a package-manager
// script (`npm|pnpm|yarn run <script>`, e.g. `npm run test:e2e`, which reaches `playwright test`
// after `bddgen`) to the given feature files, so a release's later E2E rounds can run only the
// feature files that failed; a command it cannot filter still returns null (the whole suite runs).
// `runSuite` with `files` and such a command runs the filtered command (`scope: files`). The test
// suite's own forms (`npm test`, pytest, node --test) keep their behaviour (test/engine-suite-step.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { filteredCommand, runSuite } = require('../engine/suite-step');

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-e2e-324-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
};

test('filteredCommand passes feature files to `npm run test:e2e` after -- (#324)', () => {
  assert.equal(filteredCommand('npm run test:e2e', ['features/discovery.feature']), 'npm run test:e2e -- features/discovery.feature');
  assert.equal(filteredCommand('npm run test:e2e', ['features/a.feature', 'features/b.feature']), 'npm run test:e2e -- features/a.feature features/b.feature');
});

test('filteredCommand filters `pnpm run e2e` and `yarn e2e` to the feature files (#324)', () => {
  for (const command of ['pnpm run e2e', 'yarn e2e', 'yarn run e2e']) {
    const out = filteredCommand(command, ['features/discovery.feature']);
    assert.equal(typeof out, 'string', `${command} can be filtered`);
    assert.ok(out.startsWith(command), `${out} starts with the command`);
    assert.ok(out.endsWith(' features/discovery.feature'), `${out} ends with the feature file`);
  }
});

test('filteredCommand still quotes a feature file with a space (#324)', () => {
  assert.equal(filteredCommand('npm run test:e2e', ['features/my area.feature']), 'npm run test:e2e -- "features/my area.feature"');
});

test('filteredCommand returns null for a command it cannot filter, and with no files (#324)', () => {
  assert.equal(filteredCommand('make e2e', ['features/a.feature']), null);
  assert.equal(filteredCommand('./scripts/e2e.sh', ['features/a.feature']), null);
  assert.equal(filteredCommand('npm run test:e2e', []), null);
});

test('runSuite with feature files and `npm run test:e2e` runs only those files (scope files) (#324)', async (t) => {
  const cwd = tmp(t);
  const runDir = tmp(t);
  const seen = [];
  const run = async ({ command, logFile }) => {
    seen.push(command);
    fs.appendFileSync(logFile, 'ℹ pass 2\nℹ fail 0\n');
    return { code: 0, timedOut: false, error: null };
  };
  const files = ['features/discovery.feature', 'features/backlog.feature'];
  const selection = { mode: 'affected', files, reasons: { 'features/discovery.feature': 'failed in round 1', 'features/backlog.feature': 'failed in round 1' }, why: 'failed in round 1' };
  const out = await runSuite({ command: 'npm run test:e2e', cwd, runDir, round: 2, run, files, selection, logName: 'e2e-2' });
  assert.equal(out.scope, 'files');
  assert.deepEqual(seen, ['npm run test:e2e -- features/discovery.feature features/backlog.feature']);
  assert.equal(out.status, 'pass');
});
