// Phone gates' language is resolved from this workspace and the engine host on each request.
// This area-level fixture serves only an empty gates list; no workflow or model is started.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const phoneGatesArea = require('../../service/areas/phone-gates');

async function area(t, locale) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-language-'));
  const ws = { root, settings: path.join(root, 'settings.json') };
  const write = (language) => fs.writeFileSync(ws.settings, JSON.stringify({ phoneGates: { enabled: true, port: 0 }, language }));
  write({});
  const phone = phoneGatesArea({ ws, host: { locale }, activeRuns: () => [], active: new Map() });
  t.after(async () => { await phone.stopPhoneGates(); fs.rmSync(root, { recursive: true, force: true }); });
  const { state } = await phone.pairPhone();
  return { write, html: async () => (await fetch(state.url)).text() };
}

test('an unset Phone gates interface language follows the engine host', async (t) => {
  const f = await area(t, 'pt-BR');
  assert.match(await f.html(), /lang="pt-BR"/);
  f.write({ interface: 'en', agents: 'pt-BR', issues: 'pt-BR' });
  assert.match(await f.html(), /lang="en"/);
  f.write({ interface: 'pt-BR', agents: 'en', issues: 'en' });
  assert.match(await f.html(), /lang="pt-BR"/);
});

test('an unsupported host locale falls back to English', async (t) => {
  const f = await area(t, 'zz-ZZ');
  assert.match(await f.html(), /lang="en"/);
});
