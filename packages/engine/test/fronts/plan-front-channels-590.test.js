// #590 (phase 4 of docs/reorganisation-study-2026-10.md): the plan front's engine side. Its
// channel files (packages/engine/fronts/plan/channels/) load with a stand-in ctx, every entry carries a
// schema (#338's rule, per package: a new channel of this front cannot be added without one), and
// no entry repeats a channel or a method. The front's engine code requires the engine kernel and
// shared only (scripts/layers.js checks the rule over the whole tree; here the front's own files).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ENGINE_SIDE = path.join(__dirname, '..', '..', 'fronts', 'plan');
const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'ws' ? null : stub) });
const files = (sub) => (fs.existsSync(path.join(ENGINE_SIDE, sub)) ? fs.readdirSync(path.join(ENGINE_SIDE, sub)).filter((f) => f.endsWith('.js')).sort() : []);

test('#590 every channel of the plan front has a schema, and no channel or method is declared twice', () => {
  const seen = new Set();
  let count = 0;
  for (const f of files('channels')) {
    for (const e of require(path.join(ENGINE_SIDE, 'channels', f))(ctx)) {
      if (!e.channel && !e.send) continue;
      count++;
      assert.ok(e.schema && typeof e.schema === 'object', `${f}: ${e.channel || e.send} has no schema`);
      for (const key of [e.channel || e.send, e.method && `method ${e.method}`].filter(Boolean)) {
        assert.ok(!seen.has(key), `${key} declared twice`);
        seen.add(key);
      }
    }
  }
  assert.ok(count > 0, 'the front declares channels');
});

test('#590 the plan front\'s engine files require the engine kernel and shared, never another front or the UI', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(ENGINE_SIDE).filter((f) => f.endsWith('.js'))) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1];
      if (spec.startsWith('.')) {
        assert.ok(path.resolve(path.dirname(file), spec).startsWith(ENGINE_SIDE), `${path.relative(ENGINE_SIDE, file)} requires ${spec}: a relative require stays inside engine/`);
      } else if (spec.startsWith('@craftorio/')) {
        assert.match(spec, /^@craftorio\/(engine|shared)\//, `${path.relative(ENGINE_SIDE, file)} requires ${spec}`);
      }
    }
  }
});
