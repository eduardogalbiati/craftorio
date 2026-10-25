// #590 (phase 4 of docs/reorganisation-study-2026-10.md): the ctx helpers across the kernel and the
// fronts' engine sides. Every area (the kernel's and each installed front's) is loaded with a recording
// ctx to learn which helper each one defines; then every engine-side source (the kernel's service,
// engine and domains, each front's engine/) is read for its `ctx.<name>` uses. The rules
// (docs/agents/fronts.md): a kernel file uses a helper a front's area defines only as an optional
// call (`ctx.x?.(`), since the front may not be served; a front's engine file uses another front's
// helper the same way; a front uses the kernel's helpers plainly. A name a channel file sets on ctx
// itself (`ctx.x = …`, the Oracle's performer, the Product Owner's request) counts as that file's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { installedFronts, serviceFiles } = require('../../service/fronts');

const ENGINE = path.join(__dirname, '..', '..');
const ROOT = path.join(ENGINE, '..', '..');
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

// a ctx that answers anything, so an area's creation code runs without a workspace
const stub = new Proxy(function stub() {}, { get: (t, p) => (p === Symbol.toPrimitive ? () => '' : stub), apply: () => stub });
const recordingCtx = () => new Proxy({ host: {}, events: { on() {}, emit() {} }, code: {}, BUNDLED_SKILLS_DIR: '', fronts: [] }, { get: (t, p) => (p in t ? t[p] : stub), has: () => true });

function jsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['test', 'features', 'node_modules'].includes(e.name) ? [] : jsFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

// { definedBy: name → 'engine' | front id, sources: [{ file, owner, text }] }
function survey() {
  const fronts = installedFronts(ROOT);
  const definedBy = {};
  for (const { file, from } of serviceFiles(path.join(ENGINE, 'service', 'areas'), fronts, 'areas')) {
    const helpers = require(file)(recordingCtx());
    for (const name of Object.keys(Object.getOwnPropertyDescriptors(helpers))) definedBy[name] = from;
  }
  const sources = [];
  for (const dir of ['service', 'engine', 'domains', 'server', 'control']) for (const file of jsFiles(path.join(ENGINE, dir))) sources.push({ file, owner: 'engine', text: fs.readFileSync(file, 'utf8') });
  for (const f of fronts) if (f.engine) for (const file of jsFiles(f.engine)) sources.push({ file, owner: f.id, text: fs.readFileSync(file, 'utf8') });
  // a name a channel file (or an area) sets on ctx itself belongs to the package that holds the file
  for (const s of sources) for (const m of s.text.matchAll(/\bctx\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) definedBy[m[1]] ??= s.owner;
  return { definedBy, sources, fronts };
}

test('#590 a kernel file calls a front\'s helper only optionally, a front another front\'s only optionally', () => {
  const { definedBy, sources } = survey();
  const problems = [];
  for (const { file, owner, text: source } of sources) {
    // a comment line that names a helper is not a use (the line numbers are kept)
    const text = source.replace(/^\s*\/\/.*$/gm, '');
    for (const m of text.matchAll(/\bctx\.([A-Za-z_$][\w$]*)(\?\.)?/g)) {
      const [, name, optional] = m;
      const by = definedBy[name];
      if (!by || by === owner || by === 'engine' || optional) continue;
      const line = text.slice(0, m.index).split('\n').length;
      problems.push(`${rel(file)}:${line} uses ctx.${name}, which the ${by} front defines: call it as ctx.${name}?.(…) (the front may not be served), or move it to the kernel`);
    }
  }
  assert.deepEqual(problems, []);
});

test('#590 every installed front declares itself, and the service files have unique names across the kernel and the fronts', () => {
  const fronts = installedFronts(ROOT);
  assert.ok(fronts.length >= 1, 'no front declares multiagent.front');
  for (const f of fronts) assert.ok(fs.existsSync(path.join(f.dir, 'package.json')), f.id);
  assert.deepEqual(fronts.map((f) => f.id), [...fronts.map((f) => f.id)].sort(), 'by id');
  // the loaders refuse a duplicate: a channel file keeps its name when it moves to a front
  for (const sub of ['channels', 'areas']) {
    const names = serviceFiles(path.join(ENGINE, 'service', sub), fronts, sub).map((x) => x.name);
    assert.deepEqual(names, [...new Set(names)].sort(), sub);
  }
});
