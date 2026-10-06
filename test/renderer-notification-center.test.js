// src/renderer/app.js: where a notification's click leads (openNotificationTarget, #76 finding 1),
// shared by the desktop notification's click and the notification center's own click
// (src/renderer/notification-center.js's openNotification delegates to it). It runs only inside the
// Electron renderer, so the pure helper is pulled out of the source and evaluated in a sandbox, the
// way test/renderer-run-gates.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

function loadOpenNotificationTarget() {
  const fn = /function openNotificationTarget\(t\) \{[\s\S]*?\n\}/.exec(src)[0];
  assert.ok(fn, 'openNotificationTarget not found in app.js: the source moved');
  const calls = { showRun: [], showView: [], focusTerminal: [], focusProject: [], openPO: [] };
  const sandbox = {
    showRun: (...a) => calls.showRun.push(a),
    showView: (...a) => calls.showView.push(a),
  };
  sandbox.window = {
    SessionsView: { focusTerminal: (...a) => calls.focusTerminal.push(a) },
    BacklogActions: { focusProject: (...a) => calls.focusProject.push(a) },
    BacklogPO: { open: (...a) => calls.openPO.push(a) },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fn}\nthis.openNotificationTarget = openNotificationTarget;`, sandbox);
  return { openNotificationTarget: sandbox.openNotificationTarget, calls };
}

test('notification-center.js and the desktop click share one target handler', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'notification-center.js'), 'utf8'), /openNotificationTarget\(n\.target \|\| \{\}\)/);
  assert.match(src, /api\.onNotificationClick\(\(target\) => openNotificationTarget\(target \|\| \{\}\)\)/);
});

test('openNotificationTarget: a session waiting focuses its terminal', () => {
  const { openNotificationTarget, calls } = loadOpenNotificationTarget();
  openNotificationTarget({ terminalId: 't1' });
  assert.deepEqual(calls.focusTerminal, [['t1']]);
  assert.deepEqual(calls.showRun, []);
  assert.deepEqual(calls.showView, []);
});

test('openNotificationTarget: a push conflict (#69) selects the project and switches to Backlog', () => {
  const { openNotificationTarget, calls } = loadOpenNotificationTarget();
  openNotificationTarget({ view: 'backlog', projectId: 'proj-1' });
  assert.deepEqual(calls.focusProject, [['proj-1']]);
  assert.deepEqual(calls.showView, [['backlog']]);
  assert.deepEqual(calls.showRun, []);
});

test('openNotificationTarget: a run notice opens that run, with its workflow', () => {
  const { openNotificationTarget, calls } = loadOpenNotificationTarget();
  openNotificationTarget({ runId: 'r1', workflow: 'software-development' });
  assert.equal(calls.showRun.length, 1);
  // a plain object built inside the vm sandbox: compare its own fields, not deepEqual across realms
  assert.deepEqual([calls.showRun[0][0], calls.showRun[0][1].workflow], ['r1', 'software-development']);
  assert.deepEqual(calls.focusTerminal, []);
  assert.deepEqual(calls.showView, []);
});

test('openNotificationTarget: a terminal id wins over a run id (a session notice never carries both, but the order is explicit)', () => {
  const { openNotificationTarget, calls } = loadOpenNotificationTarget();
  openNotificationTarget({ terminalId: 't1', runId: 'r1' });
  assert.deepEqual(calls.focusTerminal, [['t1']]);
  assert.deepEqual(calls.showRun, []);
});

test('openNotificationTarget: an empty target (none of terminalId, backlog view or runId) does nothing', () => {
  const { openNotificationTarget, calls } = loadOpenNotificationTarget();
  openNotificationTarget({});
  assert.deepEqual(calls, { showRun: [], showView: [], focusTerminal: [], focusProject: [], openPO: [] });
});

test('openNotificationTarget: a Product Owner answer (#149, openPO) selects the project, switches to Backlog and opens its drawer', () => {
  const { openNotificationTarget, calls } = loadOpenNotificationTarget();
  openNotificationTarget({ view: 'backlog', projectId: 'proj-1', openPO: true });
  assert.deepEqual(calls.focusProject, [['proj-1']]);
  assert.deepEqual(calls.showView, [['backlog']]);
  assert.deepEqual(calls.openPO, [[]]);
});

test('openNotificationTarget: a roadmap target (#254: a live roadmap refill, a budget pause) selects the project and opens the Roadmap screen', () => {
  const { openNotificationTarget, calls } = loadOpenNotificationTarget();
  openNotificationTarget({ view: 'roadmap', projectId: 'proj-1' });
  assert.deepEqual(calls.focusProject, [['proj-1']]);
  assert.deepEqual(calls.showView, [['roadmap']]);
  assert.deepEqual(calls.openPO, []);
  assert.deepEqual(calls.showRun, []);
});

test('openNotificationTarget: a plain backlog target (a push conflict, #69) never opens the Product Owner drawer', () => {
  const { openNotificationTarget, calls } = loadOpenNotificationTarget();
  openNotificationTarget({ view: 'backlog', projectId: 'proj-1' });
  assert.deepEqual(calls.openPO, []);
});
