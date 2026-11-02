// #754 #755: a Gherkin file (features/settings.feature, fronts/build/features/run.feature) that
// failed in an earlier round (an E2E suite step) joined the next `scope: affected` round of the unit
// suite, whose `npm test -- <files>` handed it to `node --test`: "SyntaxError: Unexpected identifier",
// red on the base too, then filed as a pre-existing failure. The affected selection only takes
// earlier failures the unit runner can run: never a `.feature` file.
// Seam: packages/engine/engine/machine-actions.js's real().affectedTests({ root, base, failed }).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const load = () => require('../engine/machine-actions');

// a git repo with one source file, its test and two feature files on `main`, the source changed
function repoWithFeatures(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-754-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const sh = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, stdio: 'ignore', windowsHide: true });
  const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), s); };
  write('src/a.js', 'module.exports = 1;\n');
  write('src/b.js', 'module.exports = 2;\n');
  write('test/a.test.js', "require('../src/a');\n");
  write('test/b.test.js', "require('../src/b');\n");
  write('features/settings.feature', 'Feature: Settings\n  Scenario: save the settings\n    Given the app is open\n');
  write('fronts/build/features/run.feature', 'Feature: Run\n  Scenario: start and stop a run\n    Given the app is open\n');
  sh('init', '-q', '-b', 'main');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'base');
  write('src/a.js', 'module.exports = 3;\n');
  return repo;
}

test('#754 #755 a feature file that failed in an earlier round does not join the unit suite\'s affected selection', (t) => {
  const repo = repoWithFeatures(t);
  const sel = load().real().affectedTests({
    root: repo,
    base: 'main',
    failed: ['features/settings.feature', 'fronts/build/features/run.feature'],
  });
  assert.equal(sel.mode, 'affected');
  assert.deepEqual(sel.files, ['test/a.test.js']);
  assert.equal(sel.files.some((f) => f.endsWith('.feature')), false);
  assert.equal(Object.keys(sel.reasons).some((f) => f.endsWith('.feature')), false);
});

test('#754 #755 an earlier failing JS test still joins the selection next to the skipped feature files', (t) => {
  const repo = repoWithFeatures(t);
  const sel = load().real().affectedTests({
    root: repo,
    base: 'main',
    failed: ['features/settings.feature', 'test/b.test.js', 'fronts/build/features/run.feature'],
  });
  assert.equal(sel.mode, 'affected');
  assert.deepEqual(sel.files, ['test/a.test.js', 'test/b.test.js']);
  assert.equal(sel.reasons['test/b.test.js'], 'failed in an earlier round');
});
