// Nothing changes on the wire (#348): the command and arguments built for every provider ×
// capability set × session mode (test/provider-args-cases.js) are the ones recorded before the
// provider registry, at commit 4651ac0 (test/fixtures/provider-args-348.json). Green before the
// change on purpose: it guards the refactor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildCases } = require('./provider-args-cases');

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'provider-args-348.json'), 'utf8'));

test('the snapshot covers every provider, capability set and session mode', () => {
  const keys = Object.keys(snapshot);
  for (const p of ['claude', 'codex', 'grok', 'mock']) assert.ok(keys.some((k) => k.startsWith(`${p}|`)), p);
  for (const m of ['new', 'effort', 'resume', 'resume-effort', 'images']) assert.ok(keys.some((k) => k.endsWith(`|${m}`)), m);
});

// Two changes on purpose since the snapshot: an isolated Claude agent loads no checkout settings
// (#468: the --setting-sources value, checked here to name neither project nor local) and printenv is
// no longer a read utility (#470). Everything else stays as recorded.
function intended(c, key, live) {
  if (!Array.isArray(c?.args)) return c;
  const args = c.args.map((a, i) => {
    if (c.args[i - 1] !== '--setting-sources') return typeof a === 'string' ? a.replace(/ Bash\(printenv:\*\)/g, '') : a;
    if (live) assert.ok(!/\b(project|local)\b/.test(a), `${key}: --setting-sources ${a}`);
    return '<sources>';
  });
  return { ...c, args };
}

test('every command line equals the one recorded before the registry', () => {
  const now = buildCases();
  assert.deepEqual(Object.keys(now).sort(), Object.keys(snapshot).sort());
  for (const key of Object.keys(snapshot)) assert.deepEqual(intended(now[key], key, true), intended(snapshot[key], key, false), key);
});
