// Phone gates' rendered browser scripts: recovery is exercised in a parsed DOM, not by checking
// source strings. HTTP tests below preserve status/JSON contracts and per-request language.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDom } = require('@multiagent/ui-kit/test/mini-dom');
const I18n = require('@multiagent/shared/i18n');
const { gatesPage, gatePage } = require('../../domains/workspace/mobile-gates-page');
const { createMobileGatesServer } = require('../../domains/workspace/mobile-gates');

const GATE = { approval_id: 'a1', step_id: 'ship', message: 'Ship this change?', choices: [{ id: 'ship', label: 'Ship it', help: 'Merges the branch.', feedback_required: true }] };
const RUN = { runId: 'r1', title: 'Mobile release', gates: [GATE] };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

async function browser(html, fetch, { token = 'device-token', search = '', configure = () => {} } = {}) {
  const stored = new Map(token ? [['multiagent-phone-token', token]] : []);
  const sandbox = {
    fetch, AbortController, setTimeout, clearTimeout, URLSearchParams,
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
