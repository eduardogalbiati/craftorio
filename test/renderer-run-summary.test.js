// src/renderer/views/run/run.js: the Run view's Details panel (one-line run inputs, #90) and
// src/renderer/resume-dialog.js: the Resume from step… control (#100), moved out of app.js by
// #154. It runs only inside the Electron renderer (document, window.api), so these pure helpers
// are pulled out of the source and evaluated in a sandbox, the way
// test/renderer-backlog-assign.test.js checks backlog.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const runSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'run', 'run.js'), 'utf8');
const resumeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'resume-dialog.js'), 'utf8');

function loadHelpers() {
  const esc = /const esc = \(s\) => [^\n]+/.exec(src)[0];
  const issueRe = /const ISSUE_URL_RE = [^\n]+/.exec(runSrc)[0];
  const inputText = /function inputText\(v\) \{[\s\S]*?\n\}/.exec(runSrc)[0];
  const looksLikePath = /const looksLikePath = [^\n]+/.exec(runSrc)[0];
  const inputValueCell = /function inputValueCell\(v\) \{[\s\S]*?\n\}/.exec(runSrc)[0];
  const canResume = /const canResume = [^\n]+/.exec(resumeSrc)[0];
  const hasChanges = /function hasChanges\(runId\) \{[\s\S]*?\n\}/.exec(runSrc)[0];
  const testsPlanHtml = /function testsPlanHtml\(plan\) \{[\s\S]*?\n\}/.exec(runSrc)[0];
  for (const [name, code] of Object.entries({ esc, issueRe, inputText, looksLikePath, inputValueCell, canResume, hasChanges, testsPlanHtml })) {
    assert.ok(code, `${name} not found in app.js, views/run/run.js or resume-dialog.js: the source moved`);
  }
  const sandbox = { state: { runs: new Map() } };
  vm.createContext(sandbox);
  vm.runInContext(
    `${esc}\n${issueRe}\n${inputText}\n${looksLikePath}\n${inputValueCell}\n${canResume}\n${hasChanges}\n${testsPlanHtml}\n`
    + 'this.helpers = { inputText, inputValueCell, canResume, hasChanges, testsPlanHtml };',
    sandbox,
  );
  return { ...sandbox.helpers, sandbox };
}

const { inputText, inputValueCell, canResume, hasChanges, testsPlanHtml, sandbox: runHelpersSandbox } = loadHelpers();

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

// ---- #203: testsPlanHtml (badges for the run's unit_tests / e2e_tests) --------------------------

test('testsPlanHtml: empty (or not an array) renders nothing, for workflows without the test inputs', () => {
  assert.equal(testsPlanHtml(null), '');
  assert.equal(testsPlanHtml(undefined), '');
  assert.equal(testsPlanHtml([]), '');
});

test('testsPlanHtml: one badge per entry, labelled "<label>: <value_label>"', () => {
  const html = testsPlanHtml([
    { input: 'unit_tests', label: 'Unit tests', value: 'write_and_run', value_label: 'Write and run', source: 'workflow default' },
    { input: 'e2e_tests', label: 'E2E tests', value: 'write', value_label: 'Write', source: 'chosen for this run' },
  ]);
  assert.match(html, /<span class="badge"[^>]*>Unit tests: Write and run<\/span>/);
  assert.match(html, /<span class="badge"[^>]*>E2E tests: Write<\/span>/);
  assert.doesNotMatch(html, /badge warn/);
});

test('testsPlanHtml: a value of "off" gets the warn class and a title explaining nothing of it is tested', () => {
  const html = testsPlanHtml([{ input: 'unit_tests', label: 'Unit tests', value: 'off', value_label: 'Off', source: 'workflow default' }]);
  assert.match(html, /<span class="badge warn" title="[^"]*nothing of it is tested in this run[^"]*">Unit tests: Off<\/span>/);
});

test('renderRunSummary: an empty array input is hidden entirely, not shown as a blank line', () => {
  assert.match(runSrc, /!\(Array\.isArray\(v\) && !v\.length\)/);
});

test('renderRunSummary: Review changes (#118) is shown only when hasChanges(r.id), and opens the diff viewer for this run', () => {
  assert.match(runSrc, /hasChanges\(r\.id\) \? '<button class="btn sm ghost" id="btn-run-diff"/);
  assert.match(runSrc, /\$\('#btn-run-diff'\)\.onclick = \(\) => DiffViewer\.open\(\{ runId: r\.id/);
});

test('renderRunSummary: the test writer\'s E2E scenarios (#143) are drawn via gateScenariosHtml, and mounted for their screenshots/toggles', () => {
  assert.match(runSrc, /\$\{window\.gateScenariosHtml \? window\.gateScenariosHtml\(r\.id\) : ''\}/);
  assert.match(runSrc, /if \(window\.mountGateScenarios\) window\.mountGateScenarios\(box\);/);
});

test('canResume: a finished, failed, cancelled or interrupted run offers it; an active one does not', () => {
  assert.equal(canResume({ status: 'success', current: false }), true);
  assert.equal(canResume({ status: 'failed', current: false }), true);
  assert.equal(canResume({ status: 'running', current: false }), false);
  assert.equal(canResume({ status: 'success', current: true }), false, 'the run active in this window');
  assert.equal(canResume(null), false);
});

test('hasChanges (#118): true with a worktree.ready event, or a step.finished output with files_changed; false otherwise', () => {
  const { runs } = runHelpersSandbox.state;
  runs.set('with-worktree', { events: [{ type: 'worktree.ready', dir: '/wt' }] });
  assert.equal(hasChanges('with-worktree'), true);

  runs.set('with-report', { events: [{ type: 'step.finished', output: { files_changed: ['src/a.js'] } }] });
  assert.equal(hasChanges('with-report'), true);

  runs.set('empty-report', { events: [{ type: 'step.finished', output: { files_changed: [] } }] });
  assert.equal(hasChanges('empty-report'), true, 'an empty array still counts: the developer reported no changes, which is still a report');

  runs.set('neither', { events: [{ type: 'step.finished', output: { summary: 'done' } }] });
  assert.equal(hasChanges('neither'), false);

  assert.equal(hasChanges('unknown-run'), false);
});
