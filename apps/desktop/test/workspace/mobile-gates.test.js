// #226 Answer human gates from the phone: a gates-only web page served by the running app on its own
// localhost port (never the engine server of packages/engine/server/index.js), reached by a paired device.
// Tests-first: packages/engine/domains/workspace/mobile-gates.js does not exist yet; this header is the interface it implements.
//
// const { createMobileGatesServer } = require('@craftorio/engine/domains/workspace/mobile-gates');
// const m = createMobileGatesServer({ service, secret, now = Date.now, linkTtlMs = 30 * 60e3 })
//   service    the engine service (packages/engine/service): its open gates (runs:active → gates) and the answer
//   secret     the key gate links are signed with (HMAC); a fresh random one when absent
//   now()      the clock in ms (injected: link expiry)
// m.listen(port = 0, host = '127.0.0.1') → Promise<{ port, url }>   url = `http://<host>:<port>`
// m.close() → Promise
// m.pair() → { code }                     a one-time pairing code (Settings shows it as text and QR)
// m.revoke(deviceId) → boolean            the device's token stops working at once
// m.gateLink(runId, approvalId) → string  `${url}/gates/<runId>/<approvalId>?t=<token>`: signed, for
//                                         that gate only, valid linkTtlMs from now()
//
// HTTP (the only routes; everything else is 404 or 403: no /api/*, no app UI, no terminals, no files):
//   POST /pair  JSON { code, name }  → 200 { token, device: { id, name } }; a wrong or used code → 403
//   GET  /gates.json   Authorization: Bearer <device token>
//        → 200 { gates: [{ runId, approvalId, stepId, message, url }] } (open gates only; url = gateLink)
//        no or unknown or revoked device → 401
//   GET  /gates/<runId>/<approvalId>?t=<token>  → 200 text/html: the gate's message and each answer's
//        label with its meaning (`help`); a token expired, forged or of another gate → 403
//   GET  /gates/<runId>/<approvalId>?t=<token>&answer=<id>  → 200 text/html: the confirmation, the
//        chosen answer's label and meaning, and a form to confirm. A GET never answers a gate.
//   POST /gates/<runId>/<approvalId>/answer   Authorization: Bearer <device token>
//        JSON { t, answer, confirm: true, feedback? } → 200 { ok: true }
//        no/unknown/revoked device → 401; bad, expired or other-gate t → 403; confirm !== true → 400;
//        gate not open → 409. Nothing is answered on any refusal.
//   The answer is the engine's: its `approval.resolved` event (pushed on run:event and written to the
//   run's events.jsonl) carries the choice and answered_by: 'owner', via: 'mobile', device: <device id>, ts.
//
// The gate's notification carries the link: packages/engine/domains/workspace/notifications.js runNotice(ev, run, { gateLink })
// sets `url: gateLink(ev.run_id, ev.approval_id)` on the `waiting` notice (test/notifications.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService, untilTrue } = require('@craftorio/engine/test/service/helpers');

const load = () => require('@craftorio/engine/domains/workspace/mobile-gates');
const SECRET = 'mobile-gates-test-secret-0123456789';
const MIN = 60e3;

const WORKFLOW = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-mobile
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: ship
    type: human_approval
    message: "Ship the change?"
    choices:
      - { id: ship, label: Ship it, help: "Merges the branch into main." }
      - { id: stop, label: Stop the run, help: "Cancels the run; the branch is kept." }
`;

// A service with `n` mock runs waiting at their gate, and the mobile server on a random port.
async function setup(t, n = 1, workflow = WORKFLOW) {
  const { createMobileGatesServer } = load(); // the module does not exist yet: fail before starting runs
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-mobile.yaml'), workflow);
  api['settings:set']({ concurrentRuns: { enabled: true, max: 1, perProject: null, countSimulations: false } }); // several gates open at once
  const gates = new Map(); // runId → approval.requested
  const resolved = [];
  service.events.on('run:event', (ev) => {
    if (ev.type === 'approval.requested') gates.set(ev.run_id, ev);
    if (ev.type === 'approval.resolved') resolved.push(ev);
  });
  const runIds = [];
  for (let i = 0; i < n; i++) runIds.push((await api['run:start']({ file: 'fixture-mobile.yaml', inputs: {}, mock: true })).runId);
  await untilTrue(() => runIds.every((id) => gates.has(id)));
  const clock = { t: Date.parse('2026-10-03T22:00:00Z') };
  const m = createMobileGatesServer({ service, secret: SECRET, now: () => clock.t });
  const { port, url } = await m.listen(0, '127.0.0.1');
  t.after(() => m.close());
  assert.ok(port > 0);
  return { service, api, m, base: url || `http://127.0.0.1:${port}`, clock, resolved, gates: runIds.map((id) => gates.get(id)) };
}

const isOpen = (api, g) => !!api['runs:active']().find((r) => r.runId === g.run_id)?.gates.some((x) => x.approval_id === g.approval_id);
const json = (res) => res.json();
async function pairDevice(base, m, name = 'Pixel') {
  const { code } = m.pair();
  const res = await fetch(`${base}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }) });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.ok(body.token && body.device?.id, JSON.stringify(body));
  return body;
}
const tokenOf = (link) => new URL(link).searchParams.get('t');
const gatePath = (g) => `/gates/${encodeURIComponent(g.run_id)}/${encodeURIComponent(g.approval_id)}`;
// `confirm` defaults to true; passing `confirm: undefined` sends no confirm field at all.
function answer(base, g, opts = {}) {
  const { t, device, answer: a = 'ship' } = opts;
  const confirm = 'confirm' in opts ? opts.confirm : true;
  const headers = { 'Content-Type': 'application/json', ...(device ? { Authorization: `Bearer ${device}` } : {}) };
  return fetch(`${base}${gatePath(g)}/answer`, { method: 'POST', headers, body: JSON.stringify({ t, answer: a, ...(confirm === undefined ? {} : { confirm }) }) });
}

test('#226 pairing: a one-time code gives a device token; the same code twice, or a wrong one, is refused', async (t) => {
  const { m, base } = await setup(t);
  const { code } = m.pair();
  const post = (body) => fetch(`${base}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ code: `${code}x`, name: 'Pixel' })).status, 403);
  const ok = await post({ code, name: 'Pixel' });
  assert.equal(ok.status, 200);
  const body = await json(ok);
  assert.ok(typeof body.token === 'string' && body.token.length >= 16);
  assert.equal(body.device.name, 'Pixel');
  assert.equal((await post({ code, name: 'Other phone' })).status, 403);
});

test('#226 the gates page lists only the open gates, and only for a paired device', async (t) => {
  const { api, m, base, gates } = await setup(t, 2);
  const { token } = await pairDevice(base, m);
  assert.equal((await fetch(`${base}/gates.json`)).status, 401);
  assert.equal((await fetch(`${base}/gates.json`, { headers: { Authorization: 'Bearer not-a-device-token-000' } })).status, 401);

  // the first run's gate is answered on the desktop: it leaves the page
  assert.equal(api['approval:resolve']({ runId: gates[0].run_id, id: gates[0].approval_id, answer: 'stop' }), true);
  const res = await fetch(`${base}/gates.json`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const list = (await json(res)).gates;
  assert.deepEqual(list.map((g) => `${g.runId}/${g.approvalId}`), [`${gates[1].run_id}/${gates[1].approval_id}`]);
  assert.equal(list[0].message, 'Ship the change?');
  assert.ok(list[0].url.includes(`${gatePath(gates[1])}?t=`), list[0].url);
});

test('#226 a gate link opens that gate\'s page only; on another gate, or forged, it is refused', async (t) => {
  const { m, base, gates } = await setup(t, 2);
  const [a, b] = gates;
  const link = m.gateLink(a.run_id, a.approval_id);
  assert.ok(link.startsWith(`${base}${gatePath(a)}?t=`), link);

  const page = await fetch(link);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
  const html = await page.text();
  assert.match(html, /Ship the change\?/);
  for (const s of ['Ship it', 'Merges the branch into main.', 'Stop the run', 'Cancels the run; the branch is kept.']) assert.ok(html.includes(s), `the gate page does not show "${s}"`);

  const t0 = tokenOf(link);
  assert.equal((await fetch(`${base}${gatePath(b)}?t=${encodeURIComponent(t0)}`)).status, 403);
  const forged = t0.slice(0, -2) + (t0.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await fetch(`${base}${gatePath(a)}?t=${encodeURIComponent(forged)}`)).status, 403);
  assert.equal((await fetch(`${base}${gatePath(a)}`)).status, 403);
});

test('#320 the gate page says what Continue will re-read for each agent with an open session', async (t) => {
  const { m, gates } = await setup(t, 1, WORKFLOW.replace('session: ephemeral', 'session: persistent'));
  const html = await (await fetch(m.gateLink(gates[0].run_id, gates[0].approval_id))).text();
  const line = /Continue:[^<]*/.exec(html)?.[0] || '';
  assert.ok(line, 'the gate page has a Continue line');
  assert.match(line, /resumes warm|every agent starts fresh or warm/, `the persistent agent's session was used just now: ${line}`);
  assert.doesNotMatch(line, /cold/);
});

test('#226 a gate link expires after about 30 minutes: page and answer refused', async (t) => {
  const { api, m, base, clock, gates } = await setup(t);
  const [g] = gates;
  const { token } = await pairDevice(base, m);
  const link = m.gateLink(g.run_id, g.approval_id);
  clock.t += 29 * MIN;
  assert.equal((await fetch(link)).status, 200);
  clock.t += 2 * MIN; // 31 min after the link was made
  assert.equal((await fetch(link)).status, 403);
  assert.equal((await answer(base, g, { t: tokenOf(link), device: token })).status, 403);
  assert.equal(isOpen(api, g), true);
});

test('#226 the confirmation shows what the chosen button does, and a GET never answers', async (t) => {
  const { api, m, base, gates, resolved } = await setup(t);
  const [g] = gates;
  const link = m.gateLink(g.run_id, g.approval_id);
  const res = await fetch(`${link}&answer=stop`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Stop the run') && html.includes('Cancels the run; the branch is kept.'), 'the confirmation does not show the answer and its meaning');
  assert.match(html, /confirm/i);
  assert.equal(isOpen(api, g), true);
  assert.equal(resolved.length, 0);
});

test('#226 an answer without a paired device is refused (none, unknown, revoked) and the gate stays open', async (t) => {
  const { api, m, base, gates } = await setup(t);
  const [g] = gates;
  const tk = tokenOf(m.gateLink(g.run_id, g.approval_id));
  assert.equal((await answer(base, g, { t: tk })).status, 401);
  assert.equal((await answer(base, g, { t: tk, device: 'not-a-device-token-000' })).status, 401);
  const { token, device } = await pairDevice(base, m);
  assert.equal(m.revoke(device.id), true);
  assert.equal((await answer(base, g, { t: tk, device: token })).status, 401);
  assert.equal(isOpen(api, g), true);
});

test('#226 an answer needs the explicit confirmation field', async (t) => {
  const { api, m, base, gates, resolved } = await setup(t);
  const [g] = gates;
  const { token } = await pairDevice(base, m);
  const tk = tokenOf(m.gateLink(g.run_id, g.approval_id));
  assert.equal((await answer(base, g, { t: tk, device: token, confirm: undefined })).status, 400);
  assert.equal((await answer(base, g, { t: tk, device: token, confirm: 'yes' })).status, 400);
  assert.equal(isOpen(api, g), true);
  assert.equal(resolved.length, 0);
});

test('#226 a confirmed answer from a paired device resolves the gate, recorded as the owner via mobile with the device and time', async (t) => {
  const { service, api, m, base, gates, resolved } = await setup(t);
  const [g] = gates;
  const { token, device } = await pairDevice(base, m, 'Pixel 9');
  const tk = tokenOf(m.gateLink(g.run_id, g.approval_id));
  const res = await answer(base, g, { t: tk, device: token, answer: 'ship' });
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true });
  await untilTrue(() => resolved.length === 1);
  const ev = resolved[0];
  assert.equal(ev.approval_id, g.approval_id);
  assert.equal(ev.choice, 'ship');
  assert.equal(ev.answered_by, 'owner');
  assert.equal(ev.via, 'mobile');
  assert.equal(ev.device, device.id);
  assert.ok(Number.isFinite(Date.parse(ev.ts)));
  assert.equal(isOpen(api, g), false);
  // the same record in the run's events.jsonl
  const file = path.join(service.workspace().runs, g.run_id, 'events.jsonl');
  await untilTrue(() => fs.readFileSync(file, 'utf8').includes('"via":"mobile"'));
  // answering again: the gate is no longer open
  assert.equal((await answer(base, g, { t: tk, device: token })).status, 409);
});

const YES_NO_WORKFLOW = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-mobile
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: merge
    type: human_approval
    message: "Tests failed. Merge anyway?"
    approve_label: Merge anyway
    reject_label: Send back
    transitions:
      - when: "approved"
        goto: end
      - when: "rejected"
        goto: rework
  - id: rework
    agent: a
    prompt: "redo the work"
`;

test('#226 Reject on an Approve / Reject gate from the phone records approved false and takes the reject route', async (t) => {
  const { service, m, base, gates, resolved } = await setup(t, 1, YES_NO_WORKFLOW);
  const [g] = gates;
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'step.started' && ev.run_id === g.run_id) started.push(ev.step_id); });
  const { token } = await pairDevice(base, m);
  const tk = tokenOf(m.gateLink(g.run_id, g.approval_id));
  const res = await answer(base, g, { t: tk, device: token, answer: 'reject' });
  assert.equal(res.status, 200);
  await untilTrue(() => resolved.length === 1);
  assert.equal(resolved[0].approved, false);
  assert.equal(resolved[0].via, 'mobile');
  await untilTrue(() => started.includes('rework'));
  const file = path.join(service.workspace().runs, g.run_id, 'events.jsonl');
  await untilTrue(() => fs.readFileSync(file, 'utf8').split('\n').some((l) => l.includes('"approval.resolved"') && l.includes('"approved":false') && l.includes('"via":"mobile"')));
});

test('#226 nothing but the gates is served on the mobile port (no API, no app UI, no terminals, no files)', async (t) => {
  const { m, base } = await setup(t);
  const { token } = await pairDevice(base, m);
  const auth = { Authorization: `Bearer ${token}` };
  const probes = [
    ['GET', '/api/manifest'], ['POST', '/api/runs:active'], ['GET', '/api/runs'], ['POST', '/api/term:open'],
    ['GET', '/index.html'], ['GET', '/apps/web/renderer/index.html'], ['GET', '/packages/ui-kit/app.js'], ['GET', '/ws'],
    ['GET', '/terminals'], ['GET', '/files/package.json'], ['GET', '/package.json'], ['GET', '/%2e%2e/package.json'],
    ['GET', '/node_modules/marked/lib/marked.umd.js'], ['GET', '/runs'],
  ];
  for (const [method, p] of probes) {
    const res = await fetch(`${base}${p}`, { method, headers: { ...auth, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.ok([403, 404].includes(res.status), `${method} ${p} answered ${res.status}`);
  }
});
