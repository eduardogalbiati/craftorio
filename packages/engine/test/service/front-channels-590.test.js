// #590 (phase 4 of docs/reorganisation-study-2026-10.md): every installed front's engine side, one
// check for all of them (the per-package ratchet of #338): its channel files
// (fronts/<id>/engine/channels/) load with a stand-in ctx, every entry carries a schema (a new channel
// of a front cannot be added without one, no exemption list), no entry repeats a channel or a method,
// and its engine files (channels, areas, domains) require the engine kernel and shared only, never
// another front or the UI (scripts/layers.js checks the same rule over the whole tree). A front
// without an engine side has nothing to check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { installedFronts } = require('../../service/fronts');

const stub = new Proxy(function stub() {}, { get: () => stub, apply: () => undefined });
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'ws' ? null : stub) });
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);

for (const front of installedFronts().filter((f) => f.engine)) {
  test(`#590 every channel of the ${front.id} front has a schema, and no channel or method is declared twice`, () => {
    const seen = new Set();
    let count = 0;
    const dir = path.join(front.engine, 'channels');
    for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((x) => x.endsWith('.js')).sort()) {
      for (const e of require(path.join(dir, f))(ctx)) {
        if (!e.channel && !e.send) continue;
        count++;
        assert.ok(e.schema && typeof e.schema === 'object', `${f}: ${e.channel || e.send} has no schema`);
        for (const key of [e.channel || e.send, e.method && `method ${e.method}`].filter(Boolean)) {
          assert.ok(!seen.has(key), `${key} declared twice`);
          seen.add(key);
        }
      }
    }
    assert.ok(count > 0, `${front.id} declares channels`);
  });

  test(`#590 the ${front.id} front's engine files require the engine kernel and shared, never another front or the UI`, () => {
    for (const file of walk(front.engine).filter((f) => f.endsWith('.js'))) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1];
        const where = path.relative(front.engine, file);
        if (spec.startsWith('.')) assert.ok(path.resolve(path.dirname(file), spec).startsWith(front.engine), `${where} requires ${spec}: a relative require stays inside engine/`);
        else if (spec.startsWith('@craftorio/')) assert.match(spec, /^@craftorio\/(engine|shared)\//, `${where} requires ${spec}`);
      }
    }
  });
}

test('#590 the front checks above run for each installed front that has an engine side', () => {
  assert.ok(Array.isArray(installedFronts()));
});
