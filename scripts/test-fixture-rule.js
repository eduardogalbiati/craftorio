// Tests never read live documents (#695): a test file (`*.test.js` under the root test/ or a
// workspace's test/) that reads a path under docs/work/ from disk is a finding of `npm run check`.
// Those documents are edited by people and docs PRs that run no test (#660 moved the sections of
// the onboarding spec and 19 tests went red on the base): a test copies the document into
// test/fixtures/ and reads the copy. The reads come from the same static analysis as the affected-test
// selection (packages/engine/engine/test-reads.js), so a comment, a fixture key written into a temp
// folder or a path joined to a temp folder is no finding; production code is not checked.
// → [{ file, line, message }]

const fs = require('fs');
const path = require('path');
const { readsOf } = require('@multiagent/engine/engine/test-reads');
const { withoutComments } = require('@multiagent/engine/engine/source-text');
const { sourceDirs } = require('./source-tree');

const LIVE = /^docs\/work(\/|$)/;
const SKIP = new Set(['fixtures', 'node_modules']);

function testFiles(root, dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : testFiles(root, rel);
    return e.isFile() && /\.test\.js$/.test(e.name) ? [rel] : [];
  });
}

function checkTestFixtures(root) {
  const files = ['test', ...sourceDirs(root).map((d) => `${d}/test`)].flatMap((d) => testFiles(root, d)).sort();
  const out = [];
  for (const file of files) {
    const text = withoutComments(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'));
    for (const r of readsOf(file, text)) {
      if (!LIVE.test(r.path)) continue;
      const line = text.slice(0, r.index).split('\n').length;
      out.push({ file, line, message: `${file}:${line} reads a live document under docs/work/ (${r.path}): copy it into test/fixtures/ and read the copy` });
    }
  }
  return out;
}

module.exports = {
  checkTestFixtures,
};
