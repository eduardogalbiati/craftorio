// #250: the rules of the src/engine/run/ modules WorkflowRun is split into (docs/agents/engine/run-modules.md).
// A moved method only fails at call time when its module lacks a name it uses, so these static
// checks catch it at load: every top-level name of src/engine/workflow.js or a run module that a
// module uses is declared or imported there; no run module requires ../workflow and the require
// graph between them has no cycle; each module's `methods` land on WorkflowRun.prototype, one owner
// per name, not enumerable like class methods.
// Seams: the files on disk and WorkflowRun.prototype. The size caps, code map rows and event order
// are in test/engine-run-split-250.test.js and test/slow/engine-run-split-250.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ENGINE = path.join(__dirname, '..', 'src', 'engine');
const RUN_DIR = path.join(ENGINE, 'run');
const runFiles = () => fs.readdirSync(RUN_DIR).filter((f) => f.endsWith('.js')).sort();
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// The source with comments, strings, template text and regex literals blanked (`${…}` kept).
function codeOnly(src) {
  let out = '';
  let i = 0;
  let depth = 0;
  let prev = '';
  const braces = []; // brace depth at each open template `${`
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; out += blank(src.slice(i, end)); i = end; continue; }
    if (two === '/*') { const end = src.indexOf('*/', i + 2) + 2; out += blank(src.slice(i, end)); i = end; continue; }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += `""${blank(src.slice(i + 2, j + 1))}`; i = j + 1; prev = '"'; continue;
    }
    if (c === '`' || (c === '}' && braces.length && braces[braces.length - 1] === depth)) {
      if (c === '}') braces.pop();
      let j = i + 1;
      while (j < src.length && src[j] !== '`' && src.slice(j, j + 2) !== '${') j += src[j] === '\\' ? 2 : 1;
      out += ` ${blank(src.slice(i + 1, j))}`;
      if (src.slice(j, j + 2) === '${') { braces.push(depth); out += '  '; i = j + 2; prev = '{'; } else { out += ' '; i = j + 1; prev = '"'; }
      continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$|return$/.test(prev)) {
      let j = i + 1;
      let cls = false;
      while (j < src.length && (cls || src[j] !== '/') && src[j] !== '\n') { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      j++;
      while (/[a-z]/.test(src[j] || '')) j++;
      out += `""${blank(src.slice(i + 2, j))}`; i = j; prev = '"'; continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth--;
    out += c;
    if (!/\s/.test(c)) prev = (/[\w$]/.test(c) && /[\w$]$/.test(prev) ? prev + c : c).slice(-6);
    i++;
  }
  return out;
}
const ID = '[A-Za-z_$][\\w$]*';
const bindings = (list) => list.split(',').map((p) => p.split(':').pop().split('=')[0].replace(/[{}[\]\s]|\.\.\./g, '')).filter((n) => new RegExp(`^${ID}$`).test(n));
function topLevel(code) {
  const names = new Set();
  for (const m of code.matchAll(new RegExp(`^(?:const|let|var|class|function\\*?|async function)\\s+(${ID})`, 'gm'))) names.add(m[1]);
  for (const m of code.matchAll(/^(?:const|let|var)\s*\{([^}]*)\}\s*=/gm)) for (const n of bindings(m[1])) names.add(n);
  return names;
}
// every name the file binds anywhere: declarations, destructuring, parameters, catch
function bound(code) {
  const names = new Set();
  for (const m of code.matchAll(new RegExp(`\\b(?:const|let|var|class|function\\*?)\\s+(${ID})`, 'g'))) names.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*[{[]([^=]*?)[}\]]\s*(?:=|of|in)/g)) for (const n of bindings(m[1])) names.add(n);
  for (const m of code.matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:=>|\{)/g)) for (const n of bindings(m[1])) names.add(n);
  for (const m of code.matchAll(new RegExp(`(${ID})\\s*=>`, 'g'))) names.add(m[1]);
  for (const m of code.matchAll(new RegExp(`catch\\s*\\(\\s*(${ID})`, 'g'))) names.add(m[1]);
  return names;
}
// sources: { name: text }; returns { name: [top-level names of the others it uses without binding them] }
function unboundUses(sources) {
  const code = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, codeOnly(v)]));
  const shared = new Set(Object.values(code).flatMap((c) => [...topLevel(c)]));
  const out = {};
  for (const [name, c] of Object.entries(code)) {
    const local = bound(c);
    // a use: not a property (`.x`), an object key (`x:`) or a method shorthand definition (`x(…) {`)
    const missing = [...shared].filter((n) => !local.has(n) && new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])(?!\\s*:)(?!\\s*\\([^()]*\\)\\s*\\{)`).test(c)).sort();
    if (missing.length) out[name] = missing;
  }
  return out;
}

test('#250 the unbound-name check flags a module that uses a helper it never imports, and not one that does', () => {
  const sources = {
    'a.js': "// helpers\nconst { git } = require('./worktree');\nfunction slug(s) { return s; }\nmodule.exports = { slug };\n",
    'missing.js': "const methods = {\n  merge(x) {\n    // slug( in a comment, and `${'slug'}` text\n    return git(['merge', slug(x)]);\n  },\n};\nmodule.exports = { methods };\n",
    'ok.js': "const { slug } = require('./a');\nconst methods = {\n  slug(x) { return slug(x); },\n  run(git) { return git.x + `git ${slug('y')}`; },\n};\nmodule.exports = { methods };\n",
  };
  assert.deepEqual(unboundUses(sources), { 'missing.js': ['git', 'slug'] });
});

test('#250 every top-level name a src/engine/run/ module or workflow.js uses is declared or imported in that file', () => {
  const sources = { 'workflow.js': read(path.join(ENGINE, 'workflow.js')) };
  for (const f of runFiles()) sources[`run/${f}`] = read(path.join(RUN_DIR, f));
  assert.deepEqual(unboundUses(sources), {});
});

test('#250 no src/engine/run/ module requires ../workflow, and the requires between run modules have no cycle', () => {
  const deps = {};
  const back = [];
  for (const f of runFiles()) {
    const src = codeOnly(read(path.join(RUN_DIR, f)).replace(/require\(\s*(['"])([^'"]+)\1\s*\)/g, 'require(<$2>)'));
    const targets = [...src.matchAll(/require\(<([^>]+)>\)/g)].map((m) => m[1]);
    if (targets.some((t) => /^\.\.\/workflow(\.js)?$/.test(t))) back.push(f);
    deps[f] = targets.filter((t) => /^\.\/[^/]+$/.test(t)).map((t) => (t.endsWith('.js') ? t.slice(2) : `${t.slice(2)}.js`));
  }
  assert.deepEqual(back, [], 'run modules requiring ../workflow');
  const cycles = [];
  const visit = (f, trail) => {
    if (trail.includes(f)) { cycles.push([...trail.slice(trail.indexOf(f)), f].join(' -> ')); return; }
    for (const d of deps[f] || []) visit(d, [...trail, f]);
  };
  for (const f of Object.keys(deps)) visit(f, []);
  assert.deepEqual([...new Set(cycles)], [], 'require cycles between run modules');
});

test('#250 each run module\'s methods are WorkflowRun methods, one owner per name, not enumerable like class methods', () => {
  const { WorkflowRun } = require('../src/engine/workflow');
  const owners = {};
  for (const f of runFiles()) {
    const mod = require(path.join(RUN_DIR, f));
    for (const name of Object.keys(mod.methods || {})) (owners[name] ||= []).push(f);
  }
  assert.ok(Object.keys(owners).length > 0, 'the run modules export methods');
  assert.deepEqual(Object.entries(owners).filter(([, fs_]) => fs_.length > 1), [], 'method names defined by two modules');
  const wrong = Object.keys(owners).filter((name) => {
    const d = Object.getOwnPropertyDescriptor(WorkflowRun.prototype, name);
    return !d || typeof d.value !== 'function' || d.enumerable;
  });
  assert.deepEqual(wrong, [], 'methods missing from WorkflowRun.prototype, or enumerable there');
  // an instance's own keys are its state, never the moved methods
  assert.deepEqual(Object.keys(WorkflowRun.prototype), []);
});
