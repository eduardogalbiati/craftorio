// Phone gates' rendered browser scripts: recovery is exercised in a parsed DOM, not by checking
// source strings. HTTP tests below preserve status/JSON contracts and per-request language.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');
const I18n = require('@craftorio/shared/i18n');
const { gatesPage, gatePage } = require('../../domains/workspace/mobile-gates-page');
const { createMobileGatesServer } = require('../../domains/workspace/mobile-gates');

const GATE = { approval_id: 'a1', step_id: 'ship', message: 'Ship this change?', choices: [{ id: 'ship', label: 'Ship it', help: 'Merges the branch.', feedback_required: true }] };
const RUN = { runId: 'r1', title: 'Mobile release', gates: [GATE] };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

async function browser(html, fetch, { token = 'device-token', search = '', configure = () => {} } = {}) {
  const stored = new Map(token ? [['multiagent-phone-token', token]] : []);
  const sandbox = {
    fetch, AbortController, setTimeout, clearTimeout, URLSearchParams, setInterval: () => 0, clearInterval() {},
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'Test phone' }, location: { search }, history: { replaceState() {} },
    localStorage: { getItem: (k) => stored.get(k) || null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) },
  };
  const dom = createDom({ window: sandbox });
  sandbox.document = dom.document;
  configure(sandbox);
  dom.loadBody(html);
  vm.runInNewContext(/<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)[1], sandbox);
  await settle();
  return { ...dom, sandbox, stored, get: (id) => dom.document.getElementById(id), message: () => dom.document.getElementById('msg').textContent };
}

const confirmHtml = (lang = 'en') => gatePage({ run: RUN, gate: GATE }, 'signed-token', GATE.choices[0], lang, GATE.choices).html;
const submit = (b) => b.get('confirm').onsubmit({ preventDefault() {} });

test('Phone gates follow an explicit language without changing the shared global language', async () => {
  const before = I18n.getLanguage();
  const html = gatesPage('pt-BR').html;
  assert.match(html, /lang="pt-BR"/);
  assert.match(html, /Gates aguardando você/);
  assert.match(gatesPage('not-a-language').html, /lang="en"/);
  assert.equal(I18n.getLanguage(), before);
  assert.match(confirmHtml('pt-BR'), /Confirmar: Ship it/);
  assert.match(confirmHtml('pt-BR'), /Ship this change\?/);
  const nextTurns = [{ agent: 'developer', turn: { kind: 'cold', tokens: 140000, cost_usd: 0.7 } }];
  const translated = gatePage({ run: { ...RUN, nextTurns }, gate: GATE }, 't', null, 'pt-BR', GATE.choices).html;
  assert.match(translated, /Continuar: Developer retoma com cache expirado ~140K/);
  assert.doesNotMatch(translated, /resumes cold/);
});

test('a list read failure keeps the token and offers a successful explicit retry', async () => {
  let calls = 0;
  const b = await browser(gatesPage('en').html, async () => {
    if (++calls === 1) throw new Error('offline');
    return reply({ gates: [] });
  });
  assert.match(b.message(), /Could not read/);
  assert.equal(b.get('retry').hidden, false);
  assert.equal(b.stored.get('multiagent-phone-token'), 'device-token');
  await b.get('retry').onclick();
  assert.match(b.message(), /No gate/);
  assert.equal(calls, 2);
});

for (const bad of [() => reply({}, 503), () => new Response('not json'), () => reply({ gates: null })]) {
  test('an unreadable list is an error, never an empty success', async () => {
    const b = await browser(gatesPage('en').html, async () => bad());
    assert.match(b.message(), /Could not read/);
    assert.equal(b.get('retry').disabled, false);
    assert.equal(b.stored.size, 1);
  });
}

test('a revoked token explains the lost pairing and shows a labelled form', async () => {
  const b = await browser(gatesPage('pt-BR').html, async () => reply({}, 401));
  assert.match(b.message(), /não é mais válido/);
  assert.equal(b.get('pairing').hidden, false);
  assert.equal(b.stored.size, 0);
  assert.equal(b.document.querySelector('label[for="pc"]').textContent, 'Código de pareamento');
});

for (const [code, text] of [[403, /wrong, expired or already used/], [429, /Too many pairing attempts/], [503, /Could not pair/]]) {
  test(`QR pairing preserves its ${code} error instead of replacing it with the list`, async () => {
    let calls = 0;
    const b = await browser(gatesPage('en').html, async () => { calls++; return reply({}, code); }, { token: null, search: '?pair=INVALID' });
    assert.match(b.message(), text);
    assert.equal(b.get('pairing').hidden, false);
    assert.equal(calls, 1);
  });
}

test('manual pairing stores the token and reads the gates, with markup treated as text', async () => {
  const b = await browser(gatesPage('en').html, async (url) => url === '/pair'
    ? reply({ token: 'new-token' })
    : reply({ gates: [{ runId: 'r1', stepId: 'ship', title: '<img src=x>', message: '<script>bad()</script>', url: '/gates/r1/a1?t=t' }] }), { token: null });
  b.get('pc').value = 'CODE';
  b.get('pf').onsubmit({ preventDefault() {} });
  await settle();
  assert.equal(b.stored.get('multiagent-phone-token'), 'new-token');
  assert.equal(b.get('pairing').hidden, true);
  assert.equal(b.get('gates').querySelector('img'), null);
  assert.equal(b.get('gates').querySelector('h2').textContent, '<img src=x>');
});

test('a browser that refuses pairing storage gets recovery instructions', async () => {
  const b = await browser(gatesPage('en').html, async () => reply({ token: 'new-token' }), {
    token: null, search: '?pair=CODE',
    configure: (sandbox) => { sandbox.localStorage.setItem = () => { throw new Error('storage denied'); }; },
  });
  assert.match(b.message(), /Allow site storage/);
  assert.equal(b.get('pair-submit').disabled, false);
});

test('a request timeout aborts the read and leaves an explicit retry', async () => {
  const b = await browser(gatesPage('en').html, async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('timeout')));
  }), { configure: (sandbox) => { sandbox.setTimeout = (fn) => { queueMicrotask(fn); return 0; }; } });
  assert.match(b.message(), /Could not read/);
  assert.equal(b.get('retry').hidden, false);
});

test('a lost answer remains unknown, keeps the note, and cannot send another POST', async () => {
  let calls = 0;
  const b = await browser(confirmHtml(), async () => { calls++; throw new Error('lost response'); });
  b.get('fb').value = 'Keep my note';
  await submit(b);
  assert.match(b.message(), /may have been received/);
  assert.equal(b.get('answer-submit').disabled, true);
  assert.equal(b.get('fb').value, 'Keep my note');
  assert.equal(b.get('recover').hidden, false);
  assert.doesNotMatch(b.get('recover').getAttribute('href'), /answer=/);
  await submit(b);
  assert.equal(calls, 1);
});

test('only one answer can be in flight and a confirmed success removes the form', async () => {
  let finish;
  let calls = 0;
  let sent;
  const b = await browser(confirmHtml(), async (_url, options) => {
    calls++;
    sent = JSON.parse(options.body);
    return new Promise((resolve) => { finish = resolve; });
  });
  const first = submit(b);
  await submit(b);
  assert.equal(calls, 1);
  assert.equal(sent.confirm, true);
  finish(reply({ ok: true }));
  await first;
  assert.equal(b.get('confirm'), null);
  assert.match(b.message(), /Answered/);
});

for (const [code, expected] of [[400, /required note/], [401, /pairing is no longer valid/], [403, /invalid or expired/], [409, /no longer waiting/], [500, /may have been received/]]) {
  test(`answer status ${code} has an actionable state without rendering server HTML`, async () => {
    const b = await browser(confirmHtml(), async () => reply({ error: '<img src=x onerror=bad()>' }, code));
    b.get('fb').value = 'Preserved';
    await submit(b);
    assert.match(b.message(), expected);
    assert.equal(b.get('msg').querySelector('img'), null);
    assert.equal(b.get('answer-submit').disabled, code !== 400);
    assert.equal(b.get('fb').value, 'Preserved');
    assert.equal(b.document.activeElement.id, 'msg');
  });
}

test('an invalid success body is unknown, never claimed as answered', async () => {
  const b = await browser(confirmHtml(), async () => reply({}));
  await submit(b);
  assert.match(b.message(), /may have been received/);
  assert.notEqual(b.get('confirm'), null);
});

test('HTTP navigation errors are localized HTML while API errors remain English JSON', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-page-'));
  let lang = 'pt-BR';
  const m = createMobileGatesServer({
    service: { workspace: () => ({ root }), api: { 'runs:active': () => [RUN] }, answerPhoneGate: () => assert.fail('A GET must never answer') },
    language: () => lang,
  });
  const { url } = await m.listen();
  t.after(async () => { await m.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const bad = await fetch(url + '/gates/r1/a1?t=invalid');
  assert.equal(bad.status, 403);
  assert.match(bad.headers.get('content-type'), /text\/html/);
  assert.match(bad.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(bad.headers.get('cache-control'), 'no-store');
  assert.match(await bad.text(), /Este link é inválido/);
  const api = await fetch(url + '/gates.json');
  assert.equal(api.status, 401);
  assert.equal((await api.json()).error, 'This phone is not paired.');
  lang = 'en';
  assert.match(await (await fetch(url)).text(), /lang="en"/);
  assert.match(await (await fetch(m.gateLink('r1', 'gone'))).text(), /This gate is no longer waiting/);
});

test('the real engine brief keeps reasons, body, options and owner actions without object strings', () => {
  const { gateBrief } = require('../../engine/gate-summary');
  for (const recommend of ['ship: Review this check.', 'A free-text recommendation.']) {
    const brief = gateBrief({ message: GATE.message, summary: 'Check the release.\nOne check failed.', recommend, answers: GATE.choices,
      diagnosis: { options: ['Inspect the log'], user_action: 'Verify the configuration' } });
    const html = gatePage({ run: RUN, gate: { ...GATE, brief } }, 't', null, 'en', GATE.choices).html;
    for (const text of [brief.recommendation.reason, brief.body, brief.options[0], brief.user_action]) assert.ok(html.includes(text));
    assert.ok(!html.includes('[object Object]'));
  }
});

test('blocked storage is reported before any list read or answer request', async () => {
  for (const confirmation of [false, true]) {
    let calls = 0;
    const b = await browser(confirmation ? confirmHtml() : gatesPage('en').html, async () => { calls++; return reply({}); }, {
      configure: (s) => { s.localStorage.getItem = () => { throw new Error('SecurityError'); }; },
    });
    if (confirmation) await submit(b);
    assert.match(b.message(), /cannot access the pairing storage/);
    assert.doesNotMatch(b.message(), /may have been received|Check the connection/);
    assert.equal(calls, 0);
    if (confirmation) assert.equal(b.get('answer-submit').disabled, false);
  }
});

test('long gate reports stay in collapsed details with a short headline and document title', () => {
  const full = 'The check needs review.\n' + 'Full report detail.\n'.repeat(200);
  const gate = { ...GATE, message: full, brief: { headline: 'Review one failed check.' } };
  const html = gatePage({ run: RUN, gate }, 't', null, 'en', GATE.choices).html;
  const dom = createDom(); dom.loadBody(html);
  assert.equal(dom.document.querySelector('h1').textContent, gate.brief.headline);
  assert.ok(dom.document.querySelector('details').textContent.includes(full));
  assert.equal(dom.document.querySelector('details').hasAttribute('open'), false);
  assert.match(html, /<title>Mobile release<\/title>/);
});

test('confirmation retains brief and evidence and highlights a contrary choice without another dialog', () => {
  const { gateBrief } = require('../../engine/gate-summary');
  const choices = [...GATE.choices, { id: 'stop', label: 'Stop now' }];
  const brief = { ...gateBrief({ summary: 'The check failed.', recommend: 'stop: Do not ship.', answers: choices }),
    evidence: [{ label: 'Failing check', url: 'https://example.test/check' }] };
  const gate = { ...GATE, brief };
  const html = gatePage({ run: RUN, gate }, 't', choices[0], 'en', choices).html;
  for (const text of ['The check failed.', 'Do not ship.', 'https://example.test/check', 'The recommendation is Stop now. You are choosing Ship it.']) assert.ok(html.includes(text));
  assert.match(html, /id="confirm"/);
  assert.ok(!gatePage({ run: RUN, gate }, 't', choices[1], 'en', choices).html.includes('class="decision-warning"'));
});

test('tab drafts restore only this gate note and clear after a confirmed success', async () => {
  const saved = new Map();
  const configure = (s) => { s.sessionStorage = { getItem: (k) => saved.get(k) || null, setItem: (k, v) => saved.set(k, v), removeItem: (k) => saved.delete(k) }; };
  const first = await browser(confirmHtml(), async () => reply({ ok: true }), { configure });
  first.type(first.get('fb'), 'Line one\nLine two');
  assert.match(first.get('note-count').textContent, /17 \/ 2000/);
  const record = JSON.parse([...saved.values()][0]);
  assert.deepEqual(Object.keys(record).sort(), ['at', 'note']);
  const restored = await browser(confirmHtml(), async () => reply({ ok: true }), { configure });
  assert.equal(restored.get('fb').value, 'Line one\nLine two');
  assert.match(restored.get('draft-status').textContent, /Draft restored/);
  const other = gatePage({ run: RUN, gate: { ...GATE, approval_id: 'a2' } }, 't', GATE.choices[0], 'en', GATE.choices).html;
  const isolated = await browser(other, async () => reply({}), { configure });
  assert.equal(isolated.get('fb').value, '');
  await submit(restored);
  assert.equal(saved.size, 0);
});

test('expired drafts and blocked optional storage never queue or send an answer', async () => {
  let calls = 0;
  const b = await browser(confirmHtml(), async () => { calls++; return reply({}); }, {
    configure: (s) => { s.sessionStorage = { getItem: () => JSON.stringify({ note: 'Old', at: Date.now() - 25 * 3600000 }), removeItem() {}, setItem() { throw Error('denied'); } }; },
  });
  assert.equal(b.get('fb').value, '');
  b.type(b.get('fb'), 'Manual note');
  assert.match(b.get('draft-status').textContent, /unavailable/);
  assert.equal(b.get('answer-submit').disabled, false);
  assert.equal(calls, 0);
});

test('a failed refresh keeps the known list and returning to the visible tab refreshes it', async () => {
  let fail = false; let calls = 0;
  const gates = [{ runId: 'r1', approvalId: 'a1', projectId: 'project-one', issues: [{ number: 42 }], requestedAt: new Date(0).toISOString(), serverNow: 600000, title: 'Title', message: 'Review', stepId: 'ship', url: '/gates/r1/a1?t=t' }];
  const b = await browser(gatesPage('en').html, async () => { calls++; if (fail) throw Error('offline'); return reply({ gates }); });
  assert.match(b.get('gates').textContent, /project-one · #42 · ship · Waiting 10 min/);
  const link = b.get('gates').querySelector('a'); link.focus();
  fail = true;
  await b.get('retry').onclick();
  assert.equal(b.get('gates').querySelector('a'), link);
  assert.match(b.get('list-updated').textContent, /Outdated list/);
  fail = false;
  link.focus();
  b.document.dispatchEvent(new b.classes.Event('visibilitychange'));
  await settle();
  assert.equal(calls, 3);
  assert.equal(b.document.activeElement === link, true);
  assert.equal(b.get('gates').querySelector('a'), link);
  assert.match(b.get('list-updated').textContent, /Last updated/);
});

test('server-relative expiry blocks a stale confirmation without losing the note or sending a POST', async () => {
  let tick; let clock = 100000; let calls = 0;
  const html = gatePage({ run: RUN, gate: GATE }, 't', GATE.choices[0], 'en', GATE.choices, { expiresAt: 2000, serverNow: 1000 }).html;
  const b = await browser(html, async () => { calls++; return reply({}); }, {
    configure: (s) => { s.Date = class extends Date { static now() { return clock; } }; s.setInterval = (fn) => { tick = fn; }; },
  });
  b.type(b.get('fb'), 'Still here');
  assert.match(b.get('gate-expiry').textContent, /expires in 1 min/);
  clock += 2000; tick();
  assert.equal(b.get('answer-submit').disabled, true);
  assert.equal(b.get('fresh-link').hidden, false);
  await submit(b);
  assert.equal(calls, 0);
  assert.equal(b.get('fb').value, 'Still here');
});

test('an ended gate clears only its own tab draft', async () => {
  const { noticePage } = require('../../domains/workspace/mobile-gates-page');
  const saved = new Map([['gate-one', 'note'], ['gate-two', 'other note']]);
  await browser(noticePage('ended', 'en', 200, { ended: true, draftKey: 'gate-one' }).html, async () => assert.fail('No request on an ended gate'), {
    configure: (s) => { s.sessionStorage = { removeItem: (k) => saved.delete(k) }; },
  });
  assert.equal(saved.has('gate-one'), false);
  assert.equal(saved.get('gate-two'), 'other note');
});

// #819: one gate, two choices; the confirmation page for each choice shares the tab's storage.
const CHOICES = [{ id: 'approve', label: 'Approve' }, { id: 'changes', label: 'Request changes', feedback_required: true }];
const TWO = { ...GATE, choices: CHOICES };
const choicePage = (choice) => gatePage({ run: RUN, gate: TWO }, 't', choice, 'en', CHOICES).html;
const tabStorage = () => {
  const saved = new Map();
  return { saved, configure: (s) => { s.sessionStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)), removeItem: (k) => saved.delete(k) }; } };
};

test('#819 a note written for Request changes is not pre-filled after Back and choosing Approve', async () => {
  const { configure } = tabStorage();
  const changes = await browser(choicePage(CHOICES[1]), async () => reply({}), { configure });
  changes.type(changes.get('fb'), 'Please split the migration');
  const approve = await browser(choicePage(CHOICES[0]), async () => reply({}), { configure });
  assert.equal(approve.get('fb').value, '');
  assert.doesNotMatch(approve.get('draft-status').textContent, /Draft restored/);
});

test('#819 a note for Request changes is restored on reload and after visiting Approve and coming back', async () => {
  const { configure } = tabStorage();
  const changes = await browser(choicePage(CHOICES[1]), async () => reply({}), { configure });
  changes.type(changes.get('fb'), 'Please split the migration');
  const reloaded = await browser(choicePage(CHOICES[1]), async () => reply({}), { configure });
  assert.equal(reloaded.get('fb').value, 'Please split the migration');
  await browser(choicePage(CHOICES[0]), async () => reply({}), { configure });
  const back = await browser(choicePage(CHOICES[1]), async () => reply({}), { configure });
  assert.equal(back.get('fb').value, 'Please split the migration');
  assert.match(back.get('draft-status').textContent, /Draft restored/);
});

test('#819 an ended gate clears the note written for any of its choices', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-ended-'));
  const runs = [{ ...RUN, gates: [TWO] }];
  const m = createMobileGatesServer({ service: { workspace: () => ({ root }), api: { 'runs:active': () => runs }, answerPhoneGate: () => assert.fail('No answer') }, language: () => 'en' });
  await m.listen();
  t.after(async () => { await m.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const { configure } = tabStorage();
  const changes = await browser(choicePage(CHOICES[1]), async () => reply({}), { configure });
  changes.type(changes.get('fb'), 'Please split the migration');
  runs[0] = { ...RUN, gates: [] };
  const ended = await (await fetch(m.gateLink('r1', 'a1'))).text();
  await browser(ended, async () => assert.fail('No request on an ended gate'), { configure });
  const again = await browser(choicePage(CHOICES[1]), async () => reply({}), { configure });
  assert.equal(again.get('fb').value, '');
});

test('#819 a note draft left in the gate-wide format of #815 is not restored and the page still saves and clears notes', async () => {
  const { saved, configure } = tabStorage();
  saved.set('phone-note:r1/a1', JSON.stringify({ note: 'Old gate-wide note', at: Date.now() }));
  const changes = await browser(choicePage(CHOICES[1]), async () => reply({ ok: true }), { configure });
  assert.equal(changes.get('fb').value, '');
  assert.doesNotMatch(changes.get('draft-status').textContent, /Draft restored|unavailable/);
  changes.type(changes.get('fb'), 'Please split the migration');
  assert.match(changes.get('draft-status').textContent, /Draft saved/);
  const reloaded = await browser(choicePage(CHOICES[1]), async () => reply({ ok: true }), { configure });
  assert.equal(reloaded.get('fb').value, 'Please split the migration');
  await submit(reloaded);
  assert.equal(saved.size, 0);
});

test('#819 a revoked device token keeps its explanation when the tab becomes visible again', async () => {
  let calls = 0;
  const b = await browser(gatesPage('en').html, async () => { calls++; return reply({}, 401); });
  assert.match(b.message(), /no longer valid/);
  assert.equal(b.stored.size, 0);
  b.document.dispatchEvent(new b.classes.Event('visibilitychange'));
  await settle();
  assert.match(b.message(), /no longer valid/);
  assert.equal(b.get('pairing').hidden, false);
  assert.equal(calls, 1);
});

test('#819 a refused QR pairing keeps its message when the tab becomes visible again without a token', async () => {
  const b = await browser(gatesPage('en').html, async () => reply({}, 403), { token: null, search: '?pair=INVALID' });
  assert.match(b.message(), /wrong, expired or already used/);
  b.document.dispatchEvent(new b.classes.Event('visibilitychange'));
  await settle();
  assert.match(b.message(), /wrong, expired or already used/);
  assert.equal(b.get('pairing').hidden, false);
});

test('#819 a rate-limited QR pairing keeps its message when the connection comes back without a token', async () => {
  const b = await browser(gatesPage('en').html, async () => reply({}, 429), { token: null, search: '?pair=INVALID' });
  assert.match(b.message(), /Too many pairing attempts/);
  b.sandbox.dispatchEvent(new b.classes.Event('online'));
  await settle();
  assert.match(b.message(), /Too many pairing attempts/);
  assert.equal(b.get('pairing').hidden, false);
});

test('#819 with a stored device token, returning to the tab after a refused pairing reads the gates', async () => {
  const gates = [{ runId: 'r1', approvalId: 'a1', title: 'Listed gate', message: 'Review', stepId: 'ship', url: '/gates/r1/a1?t=t' }];
  const b = await browser(gatesPage('en').html, async (url) => (url === '/pair' ? reply({}, 403) : reply({ gates })), { search: '?pair=INVALID' });
  assert.match(b.message(), /wrong, expired or already used/);
  b.document.dispatchEvent(new b.classes.Event('visibilitychange'));
  await settle();
  assert.equal(b.get('gates').querySelector('h2').textContent, 'Listed gate');
  assert.equal(b.get('pairing').hidden, true);
});

test('the authenticated queue includes gate context and HTML uses the actual signed expiry and server clock', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-context-'));
  const time = 1000000;
  const service = { workspace: () => ({ root }), api: { 'runs:active': () => [{ ...RUN, projectId: 'project-one', issues: [{ number: 42, body: 'Not part of the phone contract' }], gates: [{ ...GATE, requested_at: new Date(time - 60000).toISOString() }] }] }, answerPhoneGate: () => assert.fail('Reads never answer') };
  const m = createMobileGatesServer({ service, now: () => time, linkTtlMs: 120000 });
  const { url } = await m.listen();
  t.after(async () => { await m.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const paired = await (await fetch(url + '/pair', { method: 'POST', body: JSON.stringify({ code: m.pair().code }) })).json();
  const list = await (await fetch(url + '/gates.json', { headers: { Authorization: 'Bearer ' + paired.token } })).json();
  assert.equal(list.gates[0].projectId, 'project-one');
  assert.deepEqual(list.gates[0].issues, [{ number: 42 }]);
  assert.equal(list.gates[0].serverNow, time);
  assert.equal(list.gates[0].requestedAt, new Date(time - 60000).toISOString());
  const html = await (await fetch(list.gates[0].url)).text();
  assert.ok(html.includes('"expiresAt":1120000,"serverNow":1000000'));
});
