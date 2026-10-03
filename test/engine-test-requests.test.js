// src/engine/workflow.js parseTestRequest (#212): the ```run-tests block at the end of an agent's answer,
// which the orchestrator runs instead of the agent (the files go on a command line, so unsafe ones are dropped).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTestRequest } = require('../src/engine/workflow');

const block = (...lines) => `Done.\n\`\`\`run-tests\n${lines.join('\n')}\n\`\`\``;

test('parseTestRequest: a run-tests block lists the test files to run', () => {
  assert.deepEqual(parseTestRequest(block('test/a.test.js', 'test/b.test.js')), { affected: false, files: ['test/a.test.js', 'test/b.test.js'] });
});

test('parseTestRequest: the word affected asks for the affected tests', () => {
  assert.deepEqual(parseTestRequest(block('affected')), { affected: true, files: [] });
});

test('parseTestRequest: bullets, backticks and backslashes are read as the plain path', () => {
  assert.deepEqual(parseTestRequest(block('- `test/a.test.js`', '* test\\b.test.js')), { affected: false, files: ['test/a.test.js', 'test/b.test.js'] });
});

test('parseTestRequest: a path with .. is dropped', () => {
  assert.equal(parseTestRequest(block('test/../secret.test.js')), null);
  assert.deepEqual(parseTestRequest(block('test/../secret.test.js', 'test/a.test.js')), { affected: false, files: ['test/a.test.js'] });
});

test('parseTestRequest: an absolute path, a drive path or shell characters are dropped', () => {
  assert.deepEqual(parseTestRequest(block('/etc/x.test.js', 'C:/x.test.js', 'test/a.test.js; rm -rf .', 'test/$(x).test.js', 'test/a.test.js')), { affected: false, files: ['test/a.test.js'] });
});

test('parseTestRequest: a repeated file is kept once', () => {
  assert.deepEqual(parseTestRequest(block('test/a.test.js', 'test/a.test.js')), { affected: false, files: ['test/a.test.js'] });
});

test('parseTestRequest: the last run-tests block of an answer wins', () => {
  const text = `${block('test/a.test.js')}\nAnd again:\n${block('affected')}`;
  assert.deepEqual(parseTestRequest(text), { affected: true, files: [] });
});

test('parseTestRequest: an answer without a usable run-tests block gives null', () => {
  assert.equal(parseTestRequest('All good, no tests needed.'), null);
  assert.equal(parseTestRequest(block('')), null);
  assert.equal(parseTestRequest(null), null);
});
