// #263: a link to a screen of the app clicked in the Agents window (a run, an issue, a file, a
// request, the settings) opens in the main window: on the window's page AgentsWindow.toMainWindow
// sends the target (api.navigateMainWindow, channel agents-window:navigate) and answers true; in the
// main window it answers false and the view opens the screen itself; the main window subscribes to
// main-window:navigate (api.onMainWindowNavigate, the relay of src/host/main.js) and runs the handler the
// view registered (AgentsWindow.onNavigate). The
// Oracle and the Product Owner register their run links (window.showRun). Developer's tests through
// the page harness (test/agent-chat-page-harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('./agent-chat-page-harness');

function agentsWindow(page) {
  const aw = page.sandbox.AgentsWindow;
  assert.equal(typeof aw?.toMainWindow, 'function', 'window.AgentsWindow.toMainWindow');
  assert.equal(typeof aw?.onNavigate, 'function', 'window.AgentsWindow.onNavigate');
  return aw;
}

test('#263 in the main window toMainWindow answers false and sends nothing: the view opens the screen itself', async () => {
  const page = await loadPage({});
  const aw = agentsWindow(page);
  assert.equal(aw.toMainWindow('oracle:follow', { kind: 'run', runId: 'r1' }), false);
  await settle();
  assert.equal(page.callsTo('navigateMainWindow').length, 0);
});

test('#263 on the window\'s page toMainWindow sends the name and the target to the main window and answers true', async () => {
  const page = await loadPage({});
  const aw = agentsWindow(page);
  page.sandbox.location.search = '?window=agents&agent=oracle';
  assert.equal(aw.isWindowPage(), true);
  assert.equal(aw.toMainWindow('oracle:follow', { kind: 'issue', number: 12 }), true);
  await settle();
  const calls = page.callsTo('navigateMainWindow');
  assert.equal(calls.length, 1);
  // the payload is built in the page's realm: compared by value
  assert.equal(JSON.stringify(calls[0][0]), JSON.stringify({ name: 'oracle:follow', target: { kind: 'issue', number: 12 } }));
});

test('#263 the main window subscribes to the forwarded links and runs the handler registered under the name', async () => {
  const page = await loadPage({});
  const aw = agentsWindow(page);
  const subs = page.handlers.onMainWindowNavigate || [];
  assert.equal(subs.length, 1, 'the main window listens to main-window:navigate once');
  const seen = [];
  aw.onNavigate('test:open', (target) => seen.push(target));
  subs[0]({ name: 'test:open', target: { a: 1 } });
  subs[0]({ name: 'nobody:registered', target: 2 });
  assert.deepEqual(seen, [{ a: 1 }]);
});

test('#263 the Oracle\'s and the Product Owner\'s run links forwarded from the window open the run in the main window', async () => {
  const page = await loadPage({});
  agentsWindow(page);
  const [sub] = page.handlers.onMainWindowNavigate || [];
  assert.ok(sub, 'the subscription');
  const shown = [];
  page.sandbox.showRun = (id) => shown.push(id);
  sub({ name: 'oracle:run', target: '20261005-131037-fb49f1b7' });
  sub({ name: 'product-owner:run', target: '20261006-090000-aaaaaaaa' });
  await settle();
  assert.deepEqual(shown, ['20261005-131037-fb49f1b7', '20261006-090000-aaaaaaaa']);
});
