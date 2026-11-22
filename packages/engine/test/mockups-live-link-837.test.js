// #837 Mockups phase 4, the live link through the engine server (packages/engine/server/index.js). Written
// before the code. The contract:
// - the plan front's channel mockups:live-link ({ projectId, slug, ttlMs? }) → { token (48 hex), path:
//   '/mockups/live/<token>', expiresAt }: a read-only share link to one screen (default lifetime 24 h);
// - createServer({ …, mockupLiveLinks }) (default false): the route GET /mockups/live/<token> is BLOCKED until
//   the security review #466–#470 is done: while mockupLiveLinks is not true it answers 403 with an error
//   naming the security review. Enabled, the link is admitted by its own token (no server token or cookie,
//   like the Monitor's webhook): GET answers 200 text/html, the screen's html, with a Content-Security-Policy
//   that forbids the network (`connect-src 'none'`, no http(s) or `*` source) and no window.api / preload
//   bridge (no api-http.js); any other method is 405; an unknown or expired token is 404.
// Simulated (CRAFTORIO_SIMULATION_ONLY=1, set by makeService): no model, no run.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { makeService } = require('./service/helpers');
const { createServer } = require('../server');

const SERVER_TOKEN = 'mockups-live-link-837-server-token';
const HTML = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Orders</title>'
  + '<link rel="stylesheet" href="../../kit/tokens.css"><link rel="stylesheet" href="../../kit/components.css">'
  + '</head><body><main data-mid="m1"><h1 data-mid="m2">Orders, shared live</h1></main></body></html>\n';

// a workspace with one screen and a live link to it, and a server with the given options
async function setup(t, options = {}, linkArgs = {}) {
  const { service, api } = makeService(t);
  const { slug } = await api['mockups:create-screen']({ projectId: 'p1', title: 'Orders' });
  await api['mockups:save-turn']({ projectId: 'p1', slug, html: HTML, message: 'the shared version' });
  const link = await api['mockups:live-link']({ projectId: 'p1', slug, ...linkArgs });
  const server = createServer({ service, token: SERVER_TOKEN, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, link };
}

// a request with no server token and no cookie (the person the link was shared with)
function request(port, { method = 'GET', path: p = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, Accept: 'text/html' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('#837 mockups:live-link answers a 48-hex token and its path /mockups/live/<token>', async (t) => {
  const { link } = await setup(t, { mockupLiveLinks: true });
  assert.deepEqual([/^[0-9a-f]{48}$/.test(link.token), link.path], [true, `/mockups/live/${link.token}`]);
});

test('#837 the live link is blocked by default (security review #466–#470): 403 naming the security review', async (t) => {
  const { port, link } = await setup(t);
  const res = await request(port, { path: link.path });
  assert.deepEqual([res.status, /security review/i.test(res.text)], [403, true]);
});

test('#837 enabled, the live link serves the screen\'s html without the server token', async (t) => {
  const { port, link } = await setup(t, { mockupLiveLinks: true });
  const res = await request(port, { path: link.path });
  assert.deepEqual([res.status, /^text\/html/.test(res.headers['content-type'] || ''), res.text.includes('Orders, shared live')], [200, true, true]);
});

test('#837 the live link\'s page has a CSP with no network (connect-src \'none\', no http(s) or * source)', async (t) => {
  const { port, link } = await setup(t, { mockupLiveLinks: true });
  const csp = String((await request(port, { path: link.path })).headers['content-security-policy'] || '');
  assert.deepEqual([csp.includes("connect-src 'none'"), /https?:|\*/.test(csp)], [true, false]);
});

test('#837 the live link\'s page has no window.api bridge', async (t) => {
  const { port, link } = await setup(t, { mockupLiveLinks: true });
  const { text } = await request(port, { path: link.path });
  assert.deepEqual([text.includes('window.api'), text.includes('api-http')], [false, false]);
});

test('#837 the live link is read-only: POST and PUT are refused with 405', async (t) => {
  const { port, link } = await setup(t, { mockupLiveLinks: true });
  const statuses = [];
  for (const method of ['POST', 'PUT']) statuses.push((await request(port, { method, path: link.path })).status);
  assert.deepEqual(statuses, [405, 405]);
});

test('#837 an unknown live-link token is 404', async (t) => {
  const { port } = await setup(t, { mockupLiveLinks: true });
  assert.equal((await request(port, { path: `/mockups/live/${'f'.repeat(48)}` })).status, 404);
});

test('#837 an expired live link is 404', async (t) => {
  const { port, link } = await setup(t, { mockupLiveLinks: true }, { ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await request(port, { path: link.path })).status, 404);
});
