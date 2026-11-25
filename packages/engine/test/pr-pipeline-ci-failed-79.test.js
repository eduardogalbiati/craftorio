// #79 The ci_failed gate (fragments/pr-pipeline.yaml) never prints an empty link: with a PR it names the
// PR's URL; when no PR was opened it says "no PR was opened: <reason>" instead of "CI on  did not pass".
// Renders the step's message as the engine does (engine/run/templates render(message, ctx), gates.js).
// Assumption: the reason is read from the ci step's output (e.g. failure_log / a reason field); the tests
// only require the phrase "no PR was opened".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { render } = require('../engine/run/templates');

const FRAGMENT = path.join(__dirname, '..', '..', '..', 'fragments', 'pr-pipeline.yaml');
const message = () => String(yaml.load(fs.readFileSync(FRAGMENT, 'utf8')).steps.ci_failed.message);

const ctxWith = (output) => ({ steps: { ci: { output }, develop: { output: { branch: 'feat/x' } } }, output });

test('#79 ci_failed gate: with a PR the message names its URL', () => {
  const url = 'https://github.com/acme/tool/pull/7';
  const text = render(message(), ctxWith({ pr_url: url, pr_number: 7, ci_status: 'failure', failure_log: 'lint failed' }));
  assert.equal(text.includes(url), true, text);
  assert.doesNotMatch(text, /no PR was opened/i);
});

test('#79 ci_failed gate: with no PR it says "no PR was opened" and never prints an empty link', () => {
  const text = render(message(), ctxWith({ pr_url: '', ci_status: 'none', failure_log: 'git push failed: could not read Username' }));
  assert.match(text, /no PR was opened/i);
  assert.doesNotMatch(text, /CI on\s+did/);
});

test('#79 ci_failed gate: with pr_url missing altogether it says "no PR was opened"', () => {
  const text = render(message(), ctxWith({ ci_status: 'none', failure_log: 'push rejected' }));
  assert.match(text, /no PR was opened/i);
  assert.doesNotMatch(text, /CI on\s+did/);
});
