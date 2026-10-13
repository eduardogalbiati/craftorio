// #250: WorkflowRun split by area. src/engine/workflow.js keeps the run loop and delegates to one
// module per area in src/engine/run/ (transitions, gates, sessions, costs with limits and budgets,
// outputs with validation, resume), each documented by its header comment in the code map, with a
// size cap per file; the public API of src/engine/workflow.js does not change.
// Seams: the files on disk, scripts/docs.js's codeMap (the code map) and the module's exports.
// The events of a mock run, before and after, are compared in test/slow/engine-run-split-250.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { codeMap } = require('../scripts/docs.js');

const root = path.join(__dirname, '..');
const RUN_DIR = path.join(root, 'src', 'engine', 'run');
const lineCount = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
const runModules = () => (fs.existsSync(RUN_DIR) ? fs.readdirSync(RUN_DIR).filter((f) => f.endsWith('.js')).sort() : []);
// the code map's rows for src/engine/run/*.js: { file, header }
const runRows = () => codeMap(root).split('\n')
  .map((l) => /^\| `src\/engine\/run\/([^`/]+\.js)` \| (.*) \|$/.exec(l))
  .filter(Boolean)
  .map((m) => ({ file: m[1], header: m[2] }));

// Each area of the issue, as a module name or the words its header uses for it.
const AREAS = {
  transitions: /transition/i,
  gates: /\bgates?\b|human_approval/i,
  sessions: /session/i,
  'costs, limits and budgets': /\bcosts?\b|budget/i,
  'outputs and validation': /\boutputs?\b.*valid|valid.*\boutputs?\b/i,
  resume: /resum/i,
};

// src/engine/workflow.js's 1,000-line cap is the rule of every source file (#334, file-size-ratchet-334.test.js).

test('#250 the area modules live in src/engine/run/, none over 800 lines', () => {
  const files = runModules();
  assert.ok(files.length >= 6, `src/engine/run/ holds one module per area (found: ${files.join(', ') || 'none'})`);
  const big = files.map((f) => [f, lineCount(path.join(RUN_DIR, f))]).filter(([, n]) => n > 800);
  assert.deepEqual(big, [], 'modules over 800 lines');
});

test('#250 the code map lists every src/engine/run/ module with its header comment', () => {
  const rows = runRows();
  assert.deepEqual(rows.map((r) => r.file), runModules());
  assert.ok(rows.length > 0, 'the code map has src/engine/run/ rows');
  const empty = rows.filter((r) => r.header === '(no header comment)' || !r.header.trim()).map((r) => r.file);
  assert.deepEqual(empty, [], 'modules without a header comment');
});

test('#250 the code map names the module that owns each area: transitions, gates, sessions, costs, outputs, resume', () => {
  const rows = runRows();
  const missing = Object.entries(AREAS)
    .filter(([, re]) => !rows.some((r) => re.test(r.file.replace(/[-_.]/g, ' ')) || re.test(r.header)))
    .map(([area]) => area);
  assert.deepEqual(missing, [], 'areas no src/engine/run/ module owns in the code map');
});

test('#250 src/engine/workflow.js delegates to the src/engine/run/ modules', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'engine', 'workflow.js'), 'utf8');
  const required = new Set([...src.matchAll(/require\(\s*['"]\.\/run\/([^'"]+?)(?:\.js)?['"]\s*\)/g)].map((m) => `${m[1]}.js`));
  const unused = runModules().filter((f) => !required.has(f));
  assert.ok(required.size > 0, 'workflow.js requires modules from ./run/');
  // every area module is reached from the run loop (directly, or through another run/ module)
  const reached = new Set(required);
  for (const f of runModules()) {
    const text = fs.readFileSync(path.join(RUN_DIR, f), 'utf8');
    for (const m of text.matchAll(/require\(\s*['"]\.\/([^'"/]+?)(?:\.js)?['"]\s*\)/g)) reached.add(`${m[1]}.js`);
  }
  assert.deepEqual(unused.filter((f) => !reached.has(f)), [], 'run/ modules nothing requires');
});

test('#250 the public API of src/engine/workflow.js is unchanged', () => {
  const api = require('../src/engine/workflow');
  assert.deepEqual(Object.keys(api).sort(), [
    'WorkflowRun', 'answeredKey', 'attemptSummary', 'childRunCost', 'evalExpr', 'extractJson',
    'loadWorkflow', 'parseTestRequest', 'parseTokens', 'render', 'repeatKey', 'takeHandoff', 'validateSchema',
  ].sort());
  assert.equal(typeof api.WorkflowRun, 'function');
  assert.equal(typeof api.WorkflowRun.prototype.on, 'function', 'WorkflowRun still emits events');
  assert.equal(typeof api.WorkflowRun.prototype.start, 'function');
  assert.equal(typeof api.WorkflowRun.prototype.resolveApproval, 'function');
  assert.equal(api.evalExpr('1 + 1 == 2', {}), true);
});
