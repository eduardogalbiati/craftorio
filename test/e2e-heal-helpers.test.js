// #223 internals: the `issue_numbers` template filter (the e2e step's --grep tags) and the
// `screenshots: false` capability (the E2E healer's command guide names no screenshot folder).
const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/engine/workflow');
const capabilities = require('../src/engine/capabilities');

const grep = '{% for n in inputs | issue_numbers %}@issue-{{ n }}|{% endfor %}@smoke';

test('issue_numbers: the numbers of issue and issues, without duplicates; none gives only @smoke', () => {
  assert.equal(render(grep, { inputs: { issue: 'https://github.com/a/b/issues/223', issues: ['https://github.com/a/b/issues/223', 'https://github.com/a/b/issues/7/'] } }), '@issue-223|@issue-7|@smoke');
  assert.equal(render(grep, { inputs: { issue: '', issues: [] } }), '@smoke');
  assert.equal(render(grep, { inputs: {} }), '@smoke');
});

test('capabilities: screenshots false drops the screenshot folder from the command guide, and must be a boolean', () => {
  const caps = { tools: ['read', 'bash:npm'] };
  assert.match(capabilities.commandGuide(caps, '/run'), /\.png/);
  assert.doesNotMatch(capabilities.commandGuide({ ...caps, screenshots: false }, '/run'), /screenshots to|\.png/);
  assert.doesNotThrow(() => capabilities.validate({ ...caps, screenshots: false }, 'agent x'));
  assert.throws(() => capabilities.validate({ ...caps, screenshots: 'no' }, 'agent x'), /screenshots must be true or false/);
});
