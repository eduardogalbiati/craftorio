// #223 internals: the `issue_numbers` template filter (the e2e step's --grep tags) and the
// `screenshots: false` capability (the E2E healer's command guide names no screenshot folder).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadWorkflow, render } = require('../src/engine/workflow');
const { parseFailures } = require('../src/engine/suite-step');
const capabilities = require('../src/engine/capabilities');

const grep = '{% for n in inputs | issue_numbers %}@issue-{{ n }}|{% endfor %}@smoke';

test('issue_numbers: the numbers of issue and issues, without duplicates; none gives only @smoke', () => {
  assert.equal(render(grep, { inputs: { issue: 'https://github.com/a/b/issues/223', issues: ['https://github.com/a/b/issues/223', 'https://github.com/a/b/issues/7/'] } }), '@issue-223|@issue-7|@smoke');
  assert.equal(render(grep, { inputs: { issue: '', issues: [] } }), '@smoke');
  assert.equal(render(grep, { inputs: {} }), '@smoke');
});

test('parseFailures: a Playwright failure prefixed with its project ("[chromium] › ") is still read', () => {
  const out = [
    '  1) [chromium] › .features-gen/features/backlog.feature.spec.js:7:7 › Backlog › Kanban board @issue-223 ',
    '',
    '    Error: expect(locator).toBeVisible() failed',
    '',
    '  2) [chromium] › .features-gen/features/smoke.feature.spec.js:5:7 › Smoke › App opens @smoke ',
    '    Error: timeout',
    '',
    '  2 failed',
  ].join('\n');
  const failures = parseFailures(out);
  assert.equal(failures.length, 2);
  assert.equal(failures[0].file, 'features/backlog.feature');
  assert.match(failures[0].error, /toBeVisible/);
  assert.doesNotMatch(failures[0].error, /Smoke/, 'the next failure ends the block');
});

test('ai-development: a product fix from the healer runs the unit suite again unless it is off', () => {
  const wf = loadWorkflow(path.join(__dirname, '..', 'workflows', 'ai-development-local-hero.yaml'));
  const app = wf.steps.find((s) => s.id === 'heal').transitions.filter((x) => /'app'/.test(x.when));
  assert.deepEqual(app.map((x) => x.goto), ['suite', 'e2e']);
  assert.match(app[0].when, /unit_tests != 'off'/);
  assert.equal(app[0].delegate.prompt, app[1].delegate.prompt);
});

test('ai-development: a run without an issue number writes no E2E scenario', () => {
  const wf = loadWorkflow(path.join(__dirname, '..', 'workflows', 'ai-development-local-hero.yaml'));
  const prompt = wf.steps.find((s) => s.id === 'acceptance_tests').prompt;
  const withIssue = render(prompt, { inputs: { e2e_tests: 'write_and_run', issue: 'https://github.com/a/b/issues/223' }, steps: {} });
  assert.match(withIssue, /tagged `@issue-223`/);
  const noIssue = render(prompt, { inputs: { e2e_tests: 'write_and_run', task: 'x' }, steps: {} });
  assert.match(noIssue, /no issue number[\s\S]*e2e_scope: none/);
  assert.doesNotMatch(noIssue, /@issue-<n>`? plus|sub-agents started together/);
});

test('capabilities: screenshots false drops the screenshot folder from the command guide, and must be a boolean', () => {
  const caps = { tools: ['read', 'bash:npm'] };
  assert.match(capabilities.commandGuide(caps, '/run'), /\.png/);
  assert.doesNotMatch(capabilities.commandGuide({ ...caps, screenshots: false }, '/run'), /screenshots to|\.png/);
  assert.doesNotThrow(() => capabilities.validate({ ...caps, screenshots: false }, 'agent x'));
  assert.throws(() => capabilities.validate({ ...caps, screenshots: 'no' }, 'agent x'), /screenshots must be true or false/);
});
