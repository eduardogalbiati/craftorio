// #737: the testing topic (docs/agents/testing/) documents the two tiers (unit and integration, the
// `*.slow.test.js` files being the integration tests), the integration tier's per-file budget
// (~30 s), the template repository the integration tests start from, the fail-fast stall helper and
// the timings file a run can compare with.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'agents', 'testing');
const topic = () => fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');

test('#737 the testing topic names the integration tier and says the *.slow.test.js files are its tests', () => {
  const doc = topic();
  assert.match(doc, /#737/);
  assert.match(doc, /integration tier|integration tests/i);
  assert.match(doc, /unit tier|unit tests/i);
  const line = doc.split(/\r?\n/).find((l) => /integration/i.test(l) && /\.slow\.test\.js/.test(l));
  assert.ok(line, 'one line ties the integration tests to the *.slow.test.js files');
});

test('#737 the testing topic gives the integration tier its per-file budget of about 30 s', () => {
  const line = topic().split(/\r?\n/).find((l) => /integration/i.test(l) && /\b30\s*s\b/.test(l));
  assert.ok(line, 'a line about the integration tier names its ~30 s per-file budget');
});

test('#737 the testing topic documents the template repository, the stall helper and the timings file', () => {
  const doc = topic();
  assert.match(doc, /helpers\/git-fixture\.js/);
  assert.match(doc, /repoFromTemplate/);
  assert.match(doc, /helpers\/run-watch\.js/);
  assert.match(doc, /runUntilStall/);
  assert.match(doc, /CRAFTORIO_TEST_TIMINGS_FILE/);
});

test('#737 the integration helpers exist where the docs point', () => {
  for (const f of ['git-fixture.js', 'run-watch.js']) {
    assert.equal(fs.existsSync(path.join(ROOT, 'packages', 'engine', 'test', 'helpers', f)), true, `packages/engine/test/helpers/${f}`);
  }
});
