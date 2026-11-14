// #702 on the public page's reader (site/assets/reader.js): a `built` plan advances the item from Build
// to Test; test.md's `collecting` and `in review` statuses read as work in progress on the Test stage;
// a `passed` test moves on to Deploy.
// reader.js is a browser script: it is run whole in a vm sandbox with the few globals its top level
// touches (window.matchMedia, localStorage, document.documentElement).
// The interface these tests assume: window.SdlcReader also exposes its pure stage rules,
// currentStage(stages) → the index of the stage being worked on (stages: [{ f, meta: { status } }] in the
// order intent, spec, plan, test, deploy, maintain) and statusCls(status) → 'ok' | 'wait' | 'bad' | 'none'.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'site', 'assets', 'reader.js');

function loadReader() {
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { documentElement: { lang: '', setAttribute: () => {}, style: { setProperty: () => {}, removeProperty: () => {} } } },
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });
  const R = sandbox.SdlcReader || {};
  assert.equal(typeof R.currentStage, 'function', 'SdlcReader.currentStage is exposed');
  assert.equal(typeof R.statusCls, 'function', 'SdlcReader.statusCls is exposed');
  return R;
}

const FILES = ['intent', 'spec', 'plan', 'test', 'deploy', 'maintain'];
const NOT_STARTED = { intent: 'accepted', spec: 'signed off' };
const stages = (statuses) => FILES.map((f) => ({ f, meta: { status: { ...NOT_STARTED, ...statuses }[f] || 'not started' } }));
const TEST = 3;
const DEPLOY = 4;

test('#702 reader: a `built` plan advances the item from Build to Test', () => {
  const R = loadReader();
  assert.deepEqual([R.currentStage(stages({ plan: 'built' })), R.statusCls('built')], [TEST, 'ok']);
});

test('#702 reader: test.md `collecting` and `in review` show the Test stage in progress', () => {
  const R = loadReader();
  for (const status of ['collecting', 'in review']) {
    assert.deepEqual([R.currentStage(stages({ plan: 'built', test: status })), R.statusCls(status)], [TEST, 'wait'], status);
  }
});

test('#702 reader: a `passed` test moves the item on to Deploy', () => {
  const R = loadReader();
  assert.equal(R.currentStage(stages({ plan: 'built', test: 'passed' })), DEPLOY);
});
