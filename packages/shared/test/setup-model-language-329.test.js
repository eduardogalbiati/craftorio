// #329 acceptance tests (written before the code): the first-run Setup's labels
// (packages/shared/setup-model.js, #319) come from the catalog in the interface language. The API is
// unchanged: the functions read the current language (packages/shared/i18n.js setLanguage); the badge
// states ('checking', 'missing', 'signed-out', 'ready') are not text and never change. English stays
// what #319 shows today.
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert/strict');

const i18n = () => require('../i18n.js');
const load = () => require('../setup-model');

const TOOLS = {
  checking: { id: 'claude', path: null, connected: false, checking: true },
  missing: { id: 'claude', path: null, connected: false },
  signedOut: { id: 'codex', path: 'C:/bin/codex.cmd', connected: false },
  ready: { id: 'gh', path: '/usr/bin/gh', connected: true },
};
const ENGLISH = { checking: 'Checking…', missing: 'Not installed', signedOut: 'Not signed in', ready: 'Ready' };
const STATES = { checking: 'checking', missing: 'missing', signedOut: 'signed-out', ready: 'ready' };

afterEach(() => {
  try { i18n().setLanguage('en'); } catch { /* the module does not exist yet */ }
});

test('#329 statusBadge in pt-BR: Portuguese labels, the same states', () => {
  i18n().setLanguage('pt-BR');
  const { statusBadge } = load();
  for (const [k, tool] of Object.entries(TOOLS)) {
    const b = statusBadge(tool);
    assert.equal(b.state, STATES[k], k);
    assert.equal(typeof b.label, 'string');
    assert.ok(b.label.length > 0, k);
    assert.notEqual(b.label, ENGLISH[k], `${k}: "${b.label}" is the English label`);
  }
});

test('#329 statusBadge in English after pt-BR: the labels #319 shows', () => {
  i18n().setLanguage('pt-BR');
  i18n().setLanguage('en');
  const { statusBadge } = load();
  for (const [k, tool] of Object.entries(TOOLS)) assert.equal(statusBadge(tool).label, ENGLISH[k], k);
});

test('#329 toolRequirement, requirementBadges and missingLabel in pt-BR are not the English texts', () => {
  i18n().setLanguage('pt-BR');
  const { toolRequirement, requirementBadges, missingLabel } = load();
  assert.notEqual(toolRequirement('claude'), 'Required');
  assert.notEqual(toolRequirement('codex'), 'Optional: multi-model workflows');
  const badges = requirementBadges({ clis: ['claude', 'codex', 'git'], forge: true });
  assert.equal(badges.length, 2);
  assert.ok(!badges.includes('Needs Codex') && !badges.includes('Needs GitHub or GitLab CLI'), badges.join(' | '));
  assert.ok(badges[0].includes('Codex'), 'the CLI name stays');
  const missing = missingLabel(['codex']);
  assert.ok(missing.includes('Codex CLI') && !missing.startsWith('Missing'), missing);
});
