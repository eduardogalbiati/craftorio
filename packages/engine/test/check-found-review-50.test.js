// #50, internal details of the review round: mypy's target comes from its own section only (check-tools.js),
// the start log names only what the run's check_command lets run (run/checkout.js logRepoCommands), one rule for
// `off` (@craftorio/shared/run-inputs) and the steps shared by feature, fix and refactor (fragments/check-pipeline.yaml).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checksOff } = require('@craftorio/shared/run-inputs');
const { foundChecks } = require('../engine/check-tools');
const { methods } = require('../engine/run/checkout');
const { evalExpr, render } = require('../engine/run/templates');
const { loadWorkflow } = require('../engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');

function tmp(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-review-50-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text, { mode: 0o755 });
  return dir;
}

for (const [what, file, text, wholeFolder] of [
  ['setuptools\' packages', 'setup.cfg', '[options]\npackages = find:\n\n[mypy]\nstrict = True\n', true],
  ['poetry\'s packages', 'pyproject.toml', '[tool.mypy]\nstrict = true\n\n[tool.poetry]\npackages = [\n  { include = "svc" },\n]\n', true],
  ['its own files', 'setup.cfg', '[options]\npackages = find:\n\n[mypy]\nfiles = src\n', false],
  ['its own packages', 'pyproject.toml', '[project]\nname = "svc"\n\n[tool.mypy]\npackages = ["svc"]\n', false],
  ['an ini without its section', 'mypy.ini', '[mypy-lib.*]\nignore_missing_imports = True\n', true],
]) {
  test(`#50 mypy's target with ${what} (${file}): ${wholeFolder ? 'the whole folder' : 'the configuration\'s'}`, (t) => {
    const bin = tmp(t, { mypy: '#!/bin/sh\n', 'mypy.cmd': '' });
    const { checks } = foundChecks(tmp(t, { [file]: text }), { env: { PATH: bin, PATHEXT: '.CMD' } });
    assert.equal(checks.length, 1);
    assert.equal(checks[0].command.endsWith(' .'), wholeFolder, checks[0].command);
  });
}

function startLog(dir, check_command) {
  const messages = [];
  methods.logRepoCommands.call({ ctx: { inputs: { check_command } }, suiteCommand: () => null, emitEvent: (type, e) => messages.push(e.message) }, dir);
  return messages.join('\n');
}

test('#50 the start log names the given check_command alone, with no notice of a command it does not run', (t) => {
  const dir = tmp(t, { 'package.json': JSON.stringify({ scripts: { lint: 'eslint . --fix', typecheck: 'tsc' } }) });
  const given = startLog(dir, 'make lint');
  assert.match(given, /check `make lint`/);
  assert.doesNotMatch(given, /npm run|rewrites files/);
  assert.doesNotMatch(startLog(dir, 'off'), /npm run|rewrites files/);
  assert.match(startLog(dir, ''), /`npm run lint` is not run: it rewrites files[\s\S]*check `npm run typecheck`/);
});

test('#50 one rule says the checks are off, in the engine, the screens and the templates', () => {
  for (const [value, off] of [['off', true], [' OFF ', true], ['', false], [null, false], ['offline-lint', false]]) {
    assert.equal(checksOff(value), off, String(value));
    assert.equal(!!evalExpr('v | checks_off', { v: value }), off, String(value));
  }
});

test('#50 feature, fix and refactor share the gate check_environment and the body of check_failed', () => {
  const steps = ['feature', 'fix', 'refactor'].map((name) => {
    const wf = loadWorkflow(path.join(ROOT, 'workflows', `${name}.yaml`));
    return (id) => wf.steps.find((s) => s.id === id);
  });
  const [first, ...others] = steps;
  for (const of of others) {
    assert.deepEqual(of('check_environment'), first('check_environment'));
    for (const key of ['type', 'summary', 'message']) assert.equal(of('check_failed')[key], first('check_failed')[key]);
  }
  const scope = (id) => ({ vars: {}, steps: { rule_check: { output: { cause: 'c', message: 'm' } }, [id]: { output: { branch: 'b-50' } } } });
  for (const id of ['develop', 'refactor']) assert.match(render(first('check_failed').message, scope(id)), /branch `b-50`/);
});
