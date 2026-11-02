// #726: the onboarding model's texts follow the interface language. packages/shared/onboarding-model.js
// gives i18n keys (with their params), never English text: the reasons of suggestWorkflows (the no-profile
// case and the optional E2E / hotfix parts too) and of ciChoice, the choices' labels (CHOICES, through each
// suggestion's and the CI row's `choices`), PROFILE_LABELS and profileLine. The stored values (remote-code,
// milestone, pr+release...) do not change. Acceptance tests, written before the code.
//
// The shape assumed here (left open on purpose): a text is either an i18n key string ("onboarding.<...>"),
// or { key, params } (params' values may themselves be { key, params }), or a string holding keys (a
// profileLine joining several keys), or an array of those (joined with " · "). Each is resolved here with
// packages/shared/i18n.js t(key, params, lang); every key it holds must be in both en.json and pt-BR.json.
// The model is read inside each test: before the code exists each test fails on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const load = () => require('../onboarding-model');
const I18n = require('../i18n');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${lang}.json`), 'utf8'));
const EN = catalog('en');
const PT = catalog('pt-BR');

// today's (before #726) English texts of the model: none may show once resolved in pt-BR
const ENGLISH = [
  // PROFILE_LABELS
  'Local: merge, then push main', 'Remote: pull requests', 'No CI: the local suite only', 'On releases only',
  'On pull requests and releases', 'Unit tests', 'Unit and E2E',
  // CHOICES
  'Remote PRs · E2E first', 'Remote PRs · code first', 'Local merge · E2E first', 'Local merge · code first',
  'Code + unit, then E2E · remote PR', 'Code + unit · remote PR', 'Code + unit, then E2E · local merge',
  'Code + unit · local merge', 'Milestone · tag + notes', 'Per merge · tag + notes', 'Release train · tag + notes',
  'Release candidate, then stable',
  // suggestWorkflows' reasons and their parts
  'No project profile yet', 'the changes reach main through pull requests', 'merged on the platform',
  'the changes are merged on your machine', 'main is pushed as the last step', 'there is an E2E suite',
  'the E2E scenarios are written before the code', 'unit tests only', 'it implements first',
  'a fix reproduces the bug', 'with a unit regression test', 'the E2E suite runs after', 'Hotfix mode',
  'from the last tag, shipped as a patch', 'no CI builds releases', 'writes the notes and tags the version',
  'the CI runs on release tags', 'waits for that CI run', 'E2E is a step of the release',
  // ciChoice's reasons
  'no CI file was found', 'the runs rely on the local suite only', 'not on pull requests',
  'the release waits for that run', 'the CI runs on pull requests and on release tags',
  'a remote feature waits for the PR',
];

const KEY = /onboarding\.[A-Za-z0-9_.-]*[A-Za-z0-9_]/g;

// every i18n key a model text holds (a key string, { key, params }, a string of keys, an array)
function keysOf(x, out = []) {
  if (Array.isArray(x)) for (const y of x) keysOf(y, out);
  else if (x && typeof x === 'object') {
    if (typeof x.key === 'string') out.push(x.key);
    for (const v of Object.values(x.params || {})) keysOf(v, out);
  } else if (typeof x === 'string') out.push(...(x.match(KEY) || []));
  return out;
}

// a model text in a language
function resolve(x, lang) {
  if (Array.isArray(x)) return x.map((y) => resolve(y, lang)).join(' · ');
  if (x && typeof x === 'object' && typeof x.key === 'string') {
    const params = Object.fromEntries(Object.entries(x.params || {}).map(([k, v]) => [k, (typeof v === 'object' && v !== null) || typeof v === 'string' ? resolve(v, lang) : v]));
    return I18n.t(x.key, params, lang);
  }
  return String(x ?? '').replace(KEY, (k) => I18n.t(k, undefined, lang));
}

// a model text is translated: it holds at least one key, each in both catalogs; its pt-BR text differs
// from its English text and holds none of today's English texts
function assertTranslated(x, what) {
  const keys = keysOf(x);
  assert.equal(keys.length > 0, true, `${what} is an i18n key (or { key, params }), not English text: ${JSON.stringify(x)}`);
  for (const k of keys) {
    assert.equal(k in EN, true, `${what}: the key ${k} is in en.json`);
    assert.equal(k in PT, true, `${what}: the key ${k} is in pt-BR.json`);
  }
  const en = resolve(x, 'en');
  const pt = resolve(x, 'pt-BR');
  assert.equal(en.trim().length > 0, true, `${what} has an English text`);
  assert.equal(/\{\w+\}/.test(en) || /\{\w+\}/.test(pt), false, `${what}: every {param} is filled (en "${en}", pt-BR "${pt}")`);
  assert.equal(keysOf(en).length + keysOf(pt).length, 0, `${what}: no raw key shows (en "${en}", pt-BR "${pt}")`);
  assert.notEqual(pt, en, `${what}: the pt-BR text differs from the English one ("${en}")`);
  const leaked = ENGLISH.filter((s) => pt.toLowerCase().includes(s.toLowerCase()));
  assert.deepEqual(leaked, [], `${what}: the pt-BR text "${pt}" holds no English text of the model`);
  return { en, pt };
}

const PROFILES = [];
for (const mode of ['local', 'remote']) {
  for (const ci of ['none', 'release', 'pr+release']) {
    for (const tests of ['unit', 'unit+e2e']) PROFILES.push({ mode, ci, tests });
  }
}
const suggestion = (profile, id) => load().suggestWorkflows(profile).suggestions.find((s) => s.id === id);

// ---- 2. the reasons --------------------------------------------------------------------------------

test('#726 suggestWorkflows: every reason of every profile is an i18n key with its params, translated in pt-BR', () => {
  for (const p of PROFILES) {
    for (const id of ['feature', 'fix', 'release']) {
      const s = suggestion(p, id);
      assert.ok(s, `${id} is suggested for ${JSON.stringify(p)}`);
      assertTranslated(s.reason, `${id}'s reason for ${JSON.stringify(p)}`);
    }
  }
});

test('#726 suggestWorkflows: with no profile (defaulted) the reasons are keys too, the "no profile yet" part translated', () => {
  for (const profile of [null, undefined, {}, { mode: 'x', ci: 'none', tests: 'unit' }]) {
    const r = load().suggestWorkflows(profile);
    assert.equal(r.defaulted, true, `${JSON.stringify(profile)} is defaulted`);
    for (const s of r.suggestions) assertTranslated(s.reason, `${s.id}'s defaulted reason for ${JSON.stringify(profile)}`);
  }
});

test('#726 suggestWorkflows: the defaulted reason still says there is no profile yet, in each language', () => {
  const valid = resolve(suggestion({ mode: 'local', ci: 'none', tests: 'unit' }, 'feature').reason, 'en');
  const defaulted = resolve(suggestion(null, 'feature').reason, 'en');
  assert.notEqual(defaulted, valid, 'the defaulted reason differs from the default profile\'s own');
  assert.match(defaulted, /no project profile/i, `the English defaulted reason: "${defaulted}"`);
  const ptValid = resolve(suggestion({ mode: 'local', ci: 'none', tests: 'unit' }, 'feature').reason, 'pt-BR');
  const ptDefaulted = resolve(suggestion(null, 'feature').reason, 'pt-BR');
  assert.notEqual(ptDefaulted, ptValid, 'the pt-BR defaulted reason differs from the default profile\'s own');
});

test('#726 the optional parts: an E2E suite changes feature\'s, fix\'s and release\'s reasons, translated', () => {
  const unit = { mode: 'remote', ci: 'release', tests: 'unit' };
  const e2e = { mode: 'remote', ci: 'release', tests: 'unit+e2e' };
  for (const id of ['feature', 'fix', 'release']) {
    const a = assertTranslated(suggestion(unit, id).reason, `${id} (unit)`);
    const b = assertTranslated(suggestion(e2e, id).reason, `${id} (unit+e2e)`);
    assert.match(b.en, /e2e/i, `${id}'s English reason with an E2E suite names it: "${b.en}"`);
    assert.notEqual(b.pt, a.pt, `${id}'s pt-BR reason changes with an E2E suite`);
    assert.match(b.pt, /e2e/i, `${id}'s pt-BR reason with an E2E suite names it: "${b.pt}"`);
  }
});

test('#726 the optional parts: fix\'s hotfix part is translated in pt-BR', () => {
  for (const p of PROFILES) {
    const { en } = assertTranslated(suggestion(p, 'fix').reason, `fix's reason for ${JSON.stringify(p)}`);
    assert.match(en, /hotfix/i, `the English fix reason keeps its hotfix part: "${en}"`);
  }
});

test('#726 the release reason in pt-BR follows the CI: none differs from release and pr+release', () => {
  const ptOf = (ci) => resolve(suggestion({ mode: 'local', ci, tests: 'unit' }, 'release').reason, 'pt-BR');
  assert.notEqual(ptOf('none'), ptOf('release'), 'no CI and a release CI give two pt-BR reasons');
});

test('#726 ciChoice: the reason of each CI is an i18n key translated in pt-BR, distinct per CI', () => {
  const pts = new Set();
  for (const ci of ['none', 'release', 'pr+release']) {
    const c = load().ciChoice({ mode: 'local', ci, tests: 'unit' });
    assert.equal(c.value, ci, `ciChoice keeps the value ${ci}`);
    pts.add(assertTranslated(c.reason, `ciChoice's reason for ${ci}`).pt);
  }
  assert.equal(pts.size, 3, 'three distinct pt-BR reasons');
  assertTranslated(load().ciChoice(null).reason, 'ciChoice\'s reason with no profile');
});

// ---- 3. the choices and the profile's labels ---------------------------------------------------------

test('#726 every choice label (feature, fix, release, CI) is an i18n key translated in pt-BR', () => {
  const p = { mode: 'remote', ci: 'pr+release', tests: 'unit+e2e' };
  const rows = [...load().suggestWorkflows(p).suggestions, load().ciChoice(p)];
  assert.deepEqual(rows.map((r) => r.id), ['feature', 'fix', 'release', 'ci']);
  for (const r of rows) {
    assert.equal(r.choices.length >= 2, true, `${r.id} has choices`);
    const pts = new Set();
    for (const c of r.choices) pts.add(assertTranslated(c.label, `the ${r.id} choice ${c.value}'s label`).pt);
    assert.equal(pts.size, r.choices.length, `the ${r.id} choices read distinct in pt-BR`);
  }
});

test('#726 PROFILE_LABELS: every mode / ci / tests label is an i18n key translated in pt-BR', () => {
  const { PROFILE, PROFILE_LABELS } = load();
  for (const field of Object.keys(PROFILE)) {
    for (const value of PROFILE[field]) {
      assertTranslated(PROFILE_LABELS[field]?.[value], `PROFILE_LABELS.${field}['${value}']`);
    }
  }
});

test('#726 profileLine: the profile in one line is made of keys, translated in pt-BR', () => {
  for (const p of PROFILES) {
    const line = load().profileLine(p);
    const { pt } = assertTranslated(line, `profileLine(${JSON.stringify(p)})`);
    assert.equal(pt.trim().length > 0, true, 'a non-empty pt-BR line');
  }
});

// ---- guards: what does not change ------------------------------------------------------------------

test('#726 the stored values stay: the choices\' values, the profile\'s values and the picks', () => {
  const M = load();
  const values = (rows) => rows.map((c) => c.value);
  const p = { mode: 'remote', ci: 'pr+release', tests: 'unit+e2e' };
  const byId = Object.fromEntries(M.suggestWorkflows(p).suggestions.map((s) => [s.id, s]));
  assert.deepEqual(values(byId.feature.choices), ['remote-e2e', 'remote-code', 'local-e2e', 'local-code']);
  assert.deepEqual(values(byId.fix.choices), ['remote-e2e', 'remote-code', 'local-e2e', 'local-code']);
  assert.deepEqual(values(byId.release.choices), ['milestone', 'per-merge', 'train', 'rc-stable']);
  assert.deepEqual(values(M.ciChoice(p).choices), ['none', 'release', 'pr+release']);
  assert.equal(byId.feature.value, 'remote-e2e');
  assert.equal(byId.release.value, 'milestone');
  assert.equal(M.ciChoice(p).value, 'pr+release');
  assert.deepEqual(M.PROFILE, { mode: ['local', 'remote'], ci: ['none', 'release', 'pr+release'], tests: ['unit', 'unit+e2e'] });
  assert.deepEqual(Object.keys(M.PROFILE_LABELS.ci), ['none', 'release', 'pr+release']);
  assert.deepEqual(M.CREATE_ANSWERS.release, ['milestone', 'per-merge', 'train', 'rc-stable']);
});

test('#726 profileLine of no valid profile is still empty', () => {
  for (const p of [null, undefined, {}]) assert.equal(load().profileLine(p), '', JSON.stringify(p));
});

// ---- 5. key parity ---------------------------------------------------------------------------------

test('#726 en.json and pt-BR.json hold the same onboarding.* keys', () => {
  const onboarding = (c) => Object.keys(c).filter((k) => k.startsWith('onboarding.')).sort();
  const en = onboarding(EN);
  const pt = onboarding(PT);
  assert.deepEqual(en.filter((k) => !pt.includes(k)), [], 'every English onboarding key has its pt-BR text');
  assert.deepEqual(pt.filter((k) => !en.includes(k)), [], 'every pt-BR onboarding key has its English text');
});
