// Every window.api call in src/renderer against the channel manifest (src/service/manifest.js,
// merged from src/service/channels/*.js): window.api maps a method's positional arguments to the
// channel's names (`params`, src/host/preload.js), so for a channel whose params are exactly ['x'] a call
// `api.method({ x: ... })` sends { x: { x: ... } } (#239: the Night watch's Save sent
// { allowed: { allowed } } and the service saved "nothing allowed"). No such call site may exist.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createService } = require('../src/service');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return jsFiles(p);
    return d.name.endsWith('.js') ? [p] : [];
  });
}

test('no renderer call wraps the only parameter of a channel in an object named after it (api.m({ x: … }) with params [\'x\'])', (t) => {
  const service = createService({ host: { trashItem: async () => {}, appVersion: '0.0.0', isPackaged: false } });
  t.after(() => service.shutdown());
  const single = new Map(); // method -> its only param name
  for (const e of service.manifest) {
    if (e.method && Array.isArray(e.params) && e.params.length === 1 && !e.params[0].startsWith('...')) single.set(e.method, e.params[0]);
  }
  assert.ok(single.get('saveNightWatchPermissions') || service.manifest.some((e) => e.method === 'saveNightWatchPermissions'), 'the manifest has no saveNightWatchPermissions');

  const found = [];
  // api.method({ name: …  /  api.method?.({ name, …  /  api.method({ name })
  const CALL = /\bapi\.([A-Za-z_$][\w$]*)(?:\?\.)?\(\s*\{\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g;
  for (const file of jsFiles(RENDERER)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(CALL)) {
      if (single.get(m[1]) === m[2]) {
        const line = text.slice(0, m.index).split('\n').length;
        found.push(`${path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/')}:${line} api.${m[1]}({ ${m[2]}: … }) but the channel's params are ['${m[2]}']: pass the value itself`);
      }
    }
  }
  assert.deepEqual(found, []);
});
