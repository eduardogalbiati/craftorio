// src/renderer/app.js: the remembered Chat / Details run view (#80) and the friendly error for a
// channel the running main process doesn't have (#83). It runs only inside the Electron renderer
// (document, window.api), so these pure helpers are pulled out of the source and evaluated in a
// sandbox, the way test/renderer-run-summary.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

function loadHelpers({ runs = new Map(), runView = 'details' } = {}) {
  const runViewKey = /const RUN_VIEW_KEY = [^\n]+;/.exec(src)[0];
  const needsRestart = /const NEEDS_RESTART = [^\n]+;/.exec(src)[0];
  const missingChannel = /const missingChannel = [^\n]+;/.exec(src)[0];
  const errMsg = /const errMsg = \(e\) => \{[\s\S]*?\n\};/.exec(src)[0];
  const isRunLive = /const isRunLive = [^\n]+;/.exec(src)[0];
  const selectRun = /function selectRun\(runId, \{ open = true \} = \{\}\) \{[\s\S]*?\n\}/.exec(src)[0];
  const setRunView = /function setRunView\(view\) \{[\s\S]*?\n\}/.exec(src)[0];
  const showRun = /function showRun\(runId, \{ workflow, running \} = \{\}\) \{[\s\S]*?\n\}/.exec(src)[0];
  for (const [name, code] of Object.entries({ runViewKey, needsRestart, missingChannel, errMsg, isRunLive, selectRun, setRunView, showRun })) {
    assert.ok(code, `${name} not found in app.js: the source moved`);
  }

  const calls = { showView: [], showRunInList: [], openRunChat: [], openPastRun: [], showCodeBanner: 0 };
  const storage = new Map();
  const sandbox = {
    state: { runs, runId: null, runView },
    localStorage: {
      setItem: (k, v) => storage.set(k, v),
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    },
    showView: (v) => calls.showView.push(v),
    showRunInList: (id) => calls.showRunInList.push(id),
    openPastRun: (id) => calls.openPastRun.push(id),
    scheduleRender: () => {},
  };
  sandbox.window = sandbox;
  sandbox.window.openRunChat = (arg) => calls.openRunChat.push(arg);
  sandbox.window.showCodeBanner = () => { calls.showCodeBanner += 1; };
  vm.createContext(sandbox);
  vm.runInContext(
    `${runViewKey}\n${needsRestart}\n${missingChannel}\n${errMsg}\n${isRunLive}\n${selectRun}\n${setRunView}\n${showRun}\n`
    + 'this.helpers = { NEEDS_RESTART, missingChannel, errMsg, selectRun, setRunView, showRun };',
    sandbox,
  );
  return { helpers: sandbox.helpers, calls, state: sandbox.state, storage };
}

test('missingChannel: recognizes the IPC, HTTP and undefined-method shapes of "this channel does not exist"', () => {
  const { helpers } = loadHelpers();
  assert.equal(helpers.missingChannel("No handler registered for 'app:codeVersion'"), true);
  assert.equal(helpers.missingChannel('Unknown channel: app:codeVersion'), true);
  assert.equal(helpers.missingChannel('api.codeVersion is not a function'), true);
  assert.equal(helpers.missingChannel('Workflow file not found'), false);
});

test('errMsg: a missing channel becomes the friendly restart message and shows the code banner', () => {
  const { helpers, calls } = loadHelpers();
  const msg = helpers.errMsg(new Error("Error invoking remote method 'run:start': Error: No handler registered for 'run:start'"));
  assert.equal(msg, helpers.NEEDS_RESTART);
  assert.equal(calls.showCodeBanner, 1);
});

test('errMsg: an ordinary error drops the IPC "Error invoking remote method" wrapper, and never shows the banner', () => {
  const { helpers, calls } = loadHelpers();
  const msg = helpers.errMsg(new Error("Error invoking remote method 'run:start': Error: Workflow file not found"));
  assert.equal(msg, 'Workflow file not found');
  assert.equal(calls.showCodeBanner, 0);
});

test('setRunView: remembers the choice on state and in localStorage; an invalid value falls back to details', () => {
  const { helpers, state, storage } = loadHelpers();
  helpers.setRunView('chat');
  assert.equal(state.runView, 'chat');
  assert.equal(storage.get('multiagent.runView'), 'chat');
  helpers.setRunView('nonsense');
  assert.equal(state.runView, 'details');
});

test('showRun: with Details remembered, a run the window is following opens the Run screen', () => {
  const runs = new Map([['r1', { run: { status: 'success', workflow: 'w' } }]]);
  const { helpers, calls, state } = loadHelpers({ runs, runView: 'details' });
  helpers.showRun('r1');
  assert.deepEqual(calls.showView, ['run']);
  assert.equal(state.runId, 'r1');
});

test('showRun: with Chat remembered, it opens the run chat instead of the Run screen', () => {
  const runs = new Map([['r1', { run: { status: 'running', workflow: 'sd' } }]]);
  const { helpers, calls } = loadHelpers({ runs, runView: 'chat' });
  helpers.showRun('r1', { workflow: 'override' });
  assert.deepEqual(calls.showView, []);
  assert.equal(calls.openRunChat.length, 1);
  // spread into a plain object: the sandbox's Object is a different realm than assert's
  assert.deepEqual({ ...calls.openRunChat[0] }, { runId: 'r1', workflow: 'override', running: true });
});

test('showRun: a past run this window is not tracking opens in Details, rebuilt from its recorded events (openPastRun)', () => {
  const { helpers, calls } = loadHelpers({ runs: new Map(), runView: 'details' });
  helpers.showRun('old-run');
  assert.deepEqual(calls.openPastRun, ['old-run']);
  assert.deepEqual(calls.showRunInList, []);
  assert.deepEqual(calls.showView, []);
});

test('selectRun: opening honours the remembered view; not opening only updates the top bar', () => {
  const runs = new Map([['r1', { run: { status: 'running', workflow: 'w' } }]]);
  const { helpers, calls, state } = loadHelpers({ runs, runView: 'chat' });
  helpers.selectRun('r1', { open: false });
  assert.equal(state.runId, 'r1');
  assert.deepEqual(calls.openRunChat, []);
  helpers.selectRun('r1');
  assert.equal(calls.openRunChat.length, 1);
  assert.deepEqual({ ...calls.openRunChat[0] }, { runId: 'r1', workflow: 'w', running: true });
});
