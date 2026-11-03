// #634: the Monitor's webhook through the engine server (after the security review #466–#470).
// monitor:webhook { projectId, enable } turns it on with a new key (in the keychain, its URL path shown
// once) or off; POST /hooks/monitor/<project>?key=… (outside the server token) ingests a Sentry
// webhook or plain events like a poll. A wrong key, an unknown project or a webhook turned off: 401.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService, gitRepo } = require('./helpers');
const { createServer } = require('../../server');
const { webhookEvents } = require('../../domains/monitor/connectors');

const SERVER_TOKEN = 'monitor-webhook-634-server-token';

async function setup(t) {
  const { service, api } = makeService(t);
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'shop', folder: repo.dir });
  const server = createServer({ service, token: SERVER_TOKEN });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const push = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { api, projectId: project.id, push };
}

const SENTRY = {
  action: 'created',
  data: { event: { event_id: 'abc123', title: "TypeError: cannot read 'total' of undefined", datetime: '2026-11-02T10:00:00Z', request: { method: 'POST', url: 'https://shop.example/api/checkout' } } },
};

test('#634 webhookEvents: a Sentry webhook, one event, a list; an event without id gets one from its content', () => {
  const [s] = webhookEvents(SENTRY, 'webhook');
  assert.deepEqual([s.id, s.at, s.status, s.method, s.path, s.source], ['abc123', '2026-11-02T10:00:00.000Z', 500, 'POST', '/api/checkout', 'webhook']);
  const plain = { status: 500, message: 'boom', at: '2026-11-02T10:00:00Z' };
  const [a] = webhookEvents(plain, 'webhook');
  const [b] = webhookEvents(plain, 'webhook');
  assert.equal(a.id, b.id, 'the same payload twice has the same id');
  assert.equal(webhookEvents([plain, { ...plain, message: 'other' }, 'not an event'], 'webhook').length, 2);
  assert.deepEqual(webhookEvents(null, 'webhook'), []);
});

test('#634 the webhook: off by default (401), on gives a URL once, a push becomes a group, a new key stops the old URL, off refuses', async (t) => {
  const s = await setup(t);
  assert.deepEqual((await s.api['monitor:state']({ projectId: s.projectId })).webhook, { enabled: false });
  assert.equal((await s.push(`/hooks/monitor/${s.projectId}?key=anything`, SENTRY)).status, 401);

  const on = await s.api['monitor:webhook']({ projectId: s.projectId, enable: true });
  assert.equal(on.enabled, true);
  assert.match(on.path, new RegExp(`^/hooks/monitor/${s.projectId}\\?key=[0-9a-f]{48}$`));
  const state = await s.api['monitor:state']({ projectId: s.projectId });
  assert.deepEqual(state.webhook, { enabled: true });
  assert.equal(JSON.stringify(state).includes(on.path.split('key=')[1]), false, 'monitor:state returned the key');

  assert.equal((await s.push(`/hooks/monitor/${s.projectId}?key=wrong`, SENTRY)).status, 401);
  assert.equal((await s.push('/hooks/monitor/other-project?key=wrong', SENTRY)).status, 401);
  assert.equal((await s.push(on.path, {})).status, 400, 'a body without an event is refused');
  const res = await s.push(on.path, SENTRY);
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { ok: true, received: 1 });
  await s.push(on.path, SENTRY);
  const groups = (await s.api['monitor:state']({ projectId: s.projectId })).groups;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 1, 'the same Sentry event pushed twice counts once');
  assert.equal(groups[0].state, 'new');

  const again = await s.api['monitor:webhook']({ projectId: s.projectId, enable: true });
  assert.notEqual(again.path, on.path);
  assert.equal((await s.push(on.path, SENTRY)).status, 401, 'the old key stops working');
  await s.api['monitor:webhook']({ projectId: s.projectId, enable: false });
  assert.equal((await s.push(again.path, SENTRY)).status, 401);
  assert.deepEqual((await s.api['monitor:state']({ projectId: s.projectId })).webhook, { enabled: false });
});

test('#634 the webhook with diagnose On: a pushed 500 becomes an Inbox intent at once', async (t) => {
  const s = await setup(t);
  await s.api['monitor:automation']({ projectId: s.projectId, diagnose: 'on', fix: 'off', dailyCap: 5 });
  const { path } = await s.api['monitor:webhook']({ projectId: s.projectId, enable: true });
  assert.equal((await s.push(path, [{ status: 500, method: 'GET', path: '/api/orders/7', message: 'timeout after 30s' }])).status, 202);
  const [g] = (await s.api['monitor:state']({ projectId: s.projectId })).groups;
  assert.equal(g.state, 'intent');
  assert.ok(g.cardId);
});
