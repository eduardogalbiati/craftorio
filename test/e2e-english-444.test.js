// The E2E harness pins the app under test to English (#444): since #329/#330 the interface follows
// the computer's language when none is set, so on a computer in Portuguese the scenarios that read
// English text or compare screenshots failed. The demo workspace every scenario starts from
// (features/support/app.js seedWorkspace) sets English as its interface language, so the app shows
// English whatever the computer's language; a scenario that wants Portuguese chooses it in Settings
// (features/interface-language.feature). The launch itself (Electron's --lang, the served UI's
// browser window) is checked by the @issue-444 scenarios of that feature.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const I18n = require('../src/shared/i18n');

// the harness module is loaded inside each test (it requires Playwright and the demo data)
const loadHarness = () => require('../features/support/app');

async function seeded(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-english-444-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const { seedWorkspace } = loadHarness();
  const { ws } = await seedWorkspace(path.join(dir, 'workspace'));
  return require('../src/domains/workspace/workspace').readSettings(ws);
}

test('the demo workspace of the E2E suite shows English on a computer in Portuguese (#444)', async (t) => {
  const settings = await seeded(t);
  assert.equal(I18n.resolveLanguage(settings.language?.interface, 'pt-BR'), 'en');
});

test('the demo workspace of the E2E suite chooses English itself, not "same as the computer" (#444)', async (t) => {
  const settings = await seeded(t);
  // whatever the computer's language: the same English for a computer in English, Portuguese or none
  const shown = ['en-US', 'pt-BR', 'pt-PT', ''].map((computer) => I18n.resolveLanguage(settings.language?.interface, computer));
  assert.deepEqual(shown, ['en', 'en', 'en', 'en']);
  assert.equal(typeof settings.language?.interface, 'string', 'an interface language is saved in the workspace settings');
});

test('pinning the interface language keeps the demo workspace\'s other language defaults (#444)', async (t) => {
  const settings = await seeded(t);
  // settings are merged one level deep: a language patch with only `interface` would drop these
  assert.equal(settings.language?.agents, 'interface');
  assert.equal(settings.language?.issues, 'en');
});
