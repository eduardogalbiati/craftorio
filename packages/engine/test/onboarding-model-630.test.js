// #630 (spec R6, R8): the onboarding's suggested workflows (packages/shared/onboarding-model.js
// suggestWorkflows) are the new set. Acceptance tests, written before the code.
//
// Spec (the interface these tests assume): for every valid profile { mode, ci, tests } the suggestions are
// feature, fix and release (never the old ids), each with a reason; the reasons follow the profile:
// unit+e2e -> feature's names E2E, a CI -> release's names CI, remote -> feature's names the pull request.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('@multiagent/shared/onboarding-model');

const NEW = ['feature', 'fix', 'release'];
const PROFILES = [];
for (const mode of ['local', 'remote']) {
  for (const ci of ['none', 'release', 'pr+release']) {
    for (const tests of ['unit', 'unit+e2e']) PROFILES.push({ mode, ci, tests });
  }
}
const I18n = require('@multiagent/shared/i18n');

// #726: a reason is a key or { key, params }: its English text
const english = (x) => (x && typeof x === 'object'
  ? I18n.t(x.key, Object.fromEntries(Object.entries(x.params || {}).map(([k, v]) => [k, english(v)])), 'en')
  : I18n.t(String(x ?? ''), undefined, 'en'));
const reasonOf = (profile, id) => english(load().suggestWorkflows(profile).suggestions.find((s) => s.id === id)?.reason ?? '');

test('#630 every suggestion is feature, fix or release, never an old workflow', () => {
  for (const p of PROFILES) {
    const ids = load().suggestWorkflows(p).suggestions.map((s) => s.id);
    assert.deepEqual(ids.filter((id) => !NEW.includes(id)), [], `${JSON.stringify(p)}: ${JSON.stringify(ids)}`);
  }
});

test('#630 feature, fix and release are always suggested, each with a reason', () => {
  for (const p of PROFILES) {
    const { suggestions } = load().suggestWorkflows(p);
    for (const id of NEW) {
      const s = suggestions.find((x) => x.id === id);
      assert.equal(Boolean(s), true, `${id} suggested for ${JSON.stringify(p)}`);
      assert.equal(english(s.reason).trim().length > 0, true, `${id}'s reason for ${JSON.stringify(p)}`);
    }
  }
});

test('#630 with unit+e2e tests, feature\'s reason mentions E2E', () => {
  const reason = reasonOf({ mode: 'local', ci: 'none', tests: 'unit+e2e' }, 'feature');
  assert.match(reason, /e2e/i);
});

test('#630 with a release CI, release\'s reason mentions CI', () => {
  const reason = reasonOf({ mode: 'local', ci: 'release', tests: 'unit' }, 'release');
  assert.match(reason, /\bci\b/i);
});

test('#630 in remote mode, feature\'s reason mentions the pull request', () => {
  const reason = reasonOf({ mode: 'remote', ci: 'none', tests: 'unit' }, 'feature');
  assert.match(reason, /pull request|\bPR\b/i);
});
