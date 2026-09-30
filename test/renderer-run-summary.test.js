// src/renderer/app.js: the Run view's Details panel (one-line run inputs, #90) and the Resume from
// step… control (#100). It runs only inside the Electron renderer (document, window.api), so these
// pure helpers are pulled out of the source and evaluated in a sandbox, the way
// test/renderer-backlog-assign.test.js checks backlog.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

function loadHelpers() {
  const esc = /const esc = \(s\) => [^\n]+/.exec(src)[0];
  const issueRe = /const ISSUE_URL_RE = [^\n]+/.exec(src)[0];
  const inputText = /function inputText\(v\) \{[\s\S]*?\n\}/.exec(src)[0];
  const looksLikePath = /const looksLikePath = [^\n]+/.exec(src)[0];
  const inputValueCell = /function inputValueCell\(v\) \{[\s\S]*?\n\}/.exec(src)[0];
  const canResume = /const canResume = [^\n]+/.exec(src)[0];
  for (const [name, code] of Object.entries({ esc, issueRe, inputText, looksLikePath, inputValueCell, canResume })) {
    assert.ok(code, `${name} not found in app.js: the source moved`);
  }
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${esc}\n${issueRe}\n${inputText}\n${looksLikePath}\n${inputValueCell}\n${canResume}\n`
    + 'this.helpers = { inputText, inputValueCell, canResume };',
    sandbox,
  );
  return sandbox.helpers;
}

const { inputText, inputValueCell, canResume } = loadHelpers();

test('inputText: an array of issue/PR URLs reads as "#65, #61, #53"; other arrays join with ", "', () => {
  const issues = ['https://github.com/o/r/issues/65', 'https://github.com/o/r/pull/61', 'https://gitlab.com/o/r/-/issues/53'];
  assert.equal(inputText(issues).line, '#65, #61, #53');
  assert.equal(inputText(['a', 'b']).line, 'a, b');
});

test('inputText: an object reads as JSON, never "[object Object]"', () => {
  const { line, full } = inputText({ a: 1, b: 'x' });
  assert.doesNotMatch(line, /\[object Object\]/);
  assert.equal(line, '{"a":1,"b":"x"}');
  assert.match(full, /"a": 1/); // pretty-printed in the full text
});

test('inputText: a multi-line string keeps its breaks in the full text, shown as ⏎ on the one-line cut', () => {
  const { line, full } = inputText('first\nsecond');
  assert.equal(line, 'first ⏎ second');
  assert.equal(full, 'first\nsecond');
});

test('inputValueCell: a value over 200 characters gets a hover popover (data-full); a short one a title', () => {
  const short = inputValueCell('short value');
  assert.match(short, /title="short value"/);
  assert.doesNotMatch(short, /data-full/);
  const long = inputValueCell('x'.repeat(250));
  assert.match(long, /data-full="x+"/);
  assert.doesNotMatch(long, /title=/);
});

test('inputValueCell: a Windows path gets the start-ellipsis class, keeping its end (the folder name) readable', () => {
  const cell = inputValueCell('C:\\Users\\Eduardo\\multiagent-workspace\\worktrees\\20260930-082114-65af9824');
  assert.match(cell, /class="kv-path"/);
  assert.match(cell, /<bdi>/);
});

test('renderRunSummary: an empty array input is hidden entirely, not shown as a blank line', () => {
  assert.match(src, /!\(Array\.isArray\(v\) && !v\.length\)/);
});

test('canResume: a finished, failed, cancelled or interrupted run offers it; an active one does not', () => {
  assert.equal(canResume({ status: 'success', current: false }), true);
  assert.equal(canResume({ status: 'failed', current: false }), true);
  assert.equal(canResume({ status: 'running', current: false }), false);
  assert.equal(canResume({ status: 'success', current: true }), false, 'the run active in this window');
  assert.equal(canResume(null), false);
});
