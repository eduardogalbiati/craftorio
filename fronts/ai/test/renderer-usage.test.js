// fronts/ai/views/usage/usage.js: providerCard's and actionsCard's install/scope hint (#147),
// each with a play button next to it (commandHint, packages/ui-kit/command-hint.js) when there is a
// command to run. Pulled out of the source and run in a vm sandbox against stand-ins for the
// app-wide helpers it is not about (esc, fmtTok/fmtUsd, meterHtml, STATUS_TEXT, orchestratorSplit,
// planBlock), the way test/renderer-kept-work-dialog.test.js checks app.js's dialogs; commandHint
// itself is stubbed with a marker so a test can tell whether it was called, and with what.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const usageSrc = fs.readFileSync(pageFileOf('views/usage/usage.js'), 'utf8');

function loadUsageMarkup() {
  const sandbox = {
    esc: (s) => String(s ?? ''),
    fmtTok: () => '',
    fmtUsd: () => '',
    meterHtml: () => '',
    STATUS_TEXT: {},
    commandHint: (cmd) => `<PLAY:${cmd}>`,
    state: {},
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  const providerCard = /function providerCard\(p, u\) \{[\s\S]*?\n\}/.exec(usageSrc)[0];
  const actionsCard = /function actionsCard\(\) \{[\s\S]*?\n\}/.exec(usageSrc)[0];
  for (const [name, code] of Object.entries({ providerCard, actionsCard })) {
    assert.ok(code, `${name} not found in usage.js: the source moved`);
  }
  // orchestratorSplit/planBlock are providerCard's own neighbours, irrelevant to the install hint
  const stubs = 'function orchestratorSplit() { return ""; }\nfunction planBlock() { return ""; }';
  vm.runInContext(`${stubs}\n${providerCard}\n${actionsCard}\nthis.providerCard = providerCard; this.actionsCard = actionsCard;`, sandbox);
  return { providerCard: sandbox.providerCard, actionsCard: sandbox.actionsCard, sandbox };
}

const baseProvider = (extra) => ({ id: 'claude', name: 'Claude Code', month: {}, today: {}, budget: {}, ...extra });

test('providerCard: a not-installed provider with an install command shows "Install with" plus the play button', () => {
  const { providerCard } = loadUsageMarkup();
  const html = providerCard(baseProvider({ installed: false, installCommand: 'curl -fsSL https://claude.ai/install.sh | bash', installNote: 'then run `claude` once to log in' }), {});
  assert.match(html, /Install with/);
  assert.match(html, /<PLAY:curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash>/);
  assert.match(html, /then run `claude` once to log in/);
});

test('providerCard: a not-installed provider without an install command (Grok) shows the plain hint, no play button', () => {
  const { providerCard } = loadUsageMarkup();
  const html = providerCard(baseProvider({ id: 'grok', name: 'Grok Build', installed: false, installCommand: null, installHint: 'install Grok Build from x.ai (then `grok login`)' }), {});
  assert.doesNotMatch(html, /<PLAY:/);
  assert.match(html, /install Grok Build from x\.ai/);
});

test('providerCard: an installed provider shows no install hint at all', () => {
  const { providerCard } = loadUsageMarkup();
  const html = providerCard(baseProvider({ installed: true, installCommand: 'curl -fsSL https://claude.ai/install.sh | bash' }), {});
  assert.doesNotMatch(html, /Install with/);
  assert.doesNotMatch(html, /<PLAY:/);
});

test('actionsCard: a billing-usage error with a scope hint shows the play button for gh auth refresh', () => {
  const { actionsCard, sandbox } = loadUsageMarkup();
  sandbox.state = { actionsUsage: { error: 'GitHub billing usage needs the gh "user" scope', hint: 'gh auth refresh -s user' } };
  const html = actionsCard();
  assert.match(html, /<PLAY:gh auth refresh -s user>/);
  assert.match(html, /Actions minutes unavailable/);
});

test('actionsCard: an error without a hint shows no play button', () => {
  const { actionsCard, sandbox } = loadUsageMarkup();
  sandbox.state = { actionsUsage: { error: 'network error' } };
  const html = actionsCard();
  assert.doesNotMatch(html, /<PLAY:/);
  assert.match(html, /network error/);
});
