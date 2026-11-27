// #110 acceptance, written before the code: the engine connection page (apps/desktop/renderer/connection/connection.js,
// opened by Settings › Execution › Engine › Change…) in pt-BR shows the connection test's refusal in English: the
// main process's testConnection (apps/desktop/host/engine-connection.js) answers { ok: false, reason, message } with
// an English message ("my-pc:7300 refused the connection: …", "… refused the token: …") and the page shows it as it came.
// The page runs in a vm with a tiny fake DOM; window.connection.test answers what testConnection answers for a
// refused connection and a refused token (an injected fetch, no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const conn = require('../../host/engine-connection');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'connection', 'connection.js'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

const refused = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
const badToken = async () => ({ status: 401, ok: false, json: async () => ({}) });

function element() {
  return {
    textContent: '', value: '', checked: false, disabled: false, hidden: false, placeholder: '', title: '', dataset: {}, listeners: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    focus() {}, select() {},
  };
}

// the page in `lang`, its Test connection pressed with an address and a token → the result line's text
async function testResult(lang, fetchImpl) {
  const I18n = require('@craftorio/shared/i18n');
  const els = new Map();
  const el = (sel) => { if (!els.has(sel)) els.set(sel, element()); return els.get(sel); };
  const answer = (address, token) => conn.testConnection({ address, token, fetch: fetchImpl, timeoutMs: 1000 });
  const sandbox = {
    console, URLSearchParams,
    location: { search: `?lang=${lang}` },
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, documentElement: {}, title: '' },
    I18n,
    t: (...a) => I18n.t(...a),
    connection: {
      state: async () => ({ mode: 'local', saved: { mode: 'local', address: '', hasToken: false }, app: '1.0.0', failure: null, alone: false }),
      check: async () => ({ insecure: false }),
      test: async (address, token) => answer(address, token),
      save: async () => ({ saved: false }),
      retry: async () => ({ ok: true }),
      close: async () => true,
      onChanged() {},
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  for (let i = 0; i < 5; i++) await tick();
  el('#cn-address').value = 'my-pc';
  el('#cn-token').value = 'secret-token';
  for (const fn of el('#cn-test').listeners.click || []) await fn({ type: 'click' });
  for (let i = 0; i < 5; i++) await tick();
  return String(el('#cn-result').textContent || '');
}

test.afterEach(() => require('@craftorio/shared/i18n').setLanguage('en'));

test('#110 connection page in pt-BR: a refused connection reads in Portuguese, naming the engine\'s address', async () => {
  const shown = await testResult('pt-BR', refused);
  assert.notEqual(shown, '', 'the result is shown');
  assert.equal(/refused the connection|nothing listens|Start the engine/.test(shown), false, shown);
  assert.equal(shown.includes('my-pc'), true, shown);
});

test('#110 connection page in pt-BR: a refused token reads in Portuguese', async () => {
  const shown = await testResult('pt-BR', badToken);
  assert.notEqual(shown, '', 'the result is shown');
  assert.equal(/refused the token|copy CRAFTORIO_SERVER_TOKEN from/.test(shown), false, shown);
});

test('#110 guard: in English the refusal reads as the engine connection says it', async () => {
  const shown = await testResult('en', refused);
  assert.match(shown, /my-pc:7300 refused the connection/);
});
