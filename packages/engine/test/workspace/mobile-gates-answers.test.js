// Phone gates (#226), review round: an Approve / Reject gate answers true / false with its #213
// labels; a choice with feedback_required needs a note (400, not 409); the link key is kept in the
// workspace (linkSecret), so a link survives a restart of the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMobileGatesServer, linkSecret } = require('../../domains/workspace/mobile-gates');

function setup(t, gate, secret = 'answers-test-secret-0123456789abcdef') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-gates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const service = {
    api: { 'runs:active': () => [{ runId: 'r1', title: 'Run', gates: [gate] }] },
    workspace: () => ({ root }),
    answerPhoneGate: (...args) => { calls.push(args); return true; },
  };
  const m = createMobileGatesServer({ service, secret });
  return { m, calls, root, service };
}

async function start(t, m) {
  const { url } = await m.listen(0, '127.0.0.1');
  t.after(() => m.close());
  const { code } = m.pair();
  const res = await fetch(`${url}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: 'Pixel' }) });
  return { base: url, token: (await res.json()).token };
}

const post = (base, token, body) => fetch(`${base}/gates/r1/a1/answer`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});

const YES_NO = { approval_id: 'a1', step_id: 'ship', message: 'Tests failed', approve: { label: 'Merge anyway', help: 'Merges the branch.' }, reject: { label: 'Stop the run', help: '' } };

test('an Approve / Reject gate shows its labels and answers true / false', async (t) => {
  const { m, calls } = setup(t, YES_NO);
  const { base, token } = await start(t, m);
  const t1 = new URL(m.gateLink('r1', 'a1')).searchParams.get('t');
  const html = await (await fetch(`${base}/gates/r1/a1?t=${encodeURIComponent(t1)}&answer=approve`)).text();
  assert.match(html, /Confirm: Merge anyway/);
  assert.match(html, /Merges the branch\./);
  assert.equal((await post(base, token, { t: t1, answer: 'reject', confirm: true })).status, 200);
  assert.equal((await post(base, token, { t: t1, answer: 'approve', confirm: true })).status, 200);
  assert.deepEqual(calls.map((c) => c[2]), [false, true]);
});

test('a choice with feedback_required and no note is refused with 400 before the engine', async (t) => {
  const gate = { approval_id: 'a1', step_id: 'ship', message: 'Ship?', choices: [{ id: 'redo', label: 'Redo', feedback_required: true }] };
  const { m, calls } = setup(t, gate);
  const { base, token } = await start(t, m);
  const t1 = new URL(m.gateLink('r1', 'a1')).searchParams.get('t');
  const html = await (await fetch(`${base}/gates/r1/a1?t=${encodeURIComponent(t1)}&answer=redo`)).text();
  assert.match(html, /id="fb"[^>]*required/);
  const res = await post(base, token, { t: t1, answer: 'redo', confirm: true, feedback: '  ' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /needs a note/);
  assert.equal(calls.length, 0);
  assert.equal((await post(base, token, { t: t1, answer: 'redo', confirm: true, feedback: 'add a test' })).status, 200);
  assert.equal(calls[0][3], 'add a test');
});

test('linkSecret is created once per workspace, so a link signed before a restart still opens', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-gates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = linkSecret({ root });
  assert.equal(linkSecret({ root }), key);
  const first = setup(t, YES_NO, key);
  await first.m.listen(0, '127.0.0.1');
  const link = first.m.gateLink('r1', 'a1');
  await first.m.close();
  const second = setup(t, YES_NO, linkSecret({ root }));
  const { url } = await second.m.listen(0, '127.0.0.1');
  t.after(() => second.m.close());
  const u = new URL(link);
  assert.equal((await fetch(`${url}${u.pathname}${u.search}`)).status, 200);
});
