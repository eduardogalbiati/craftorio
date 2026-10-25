// #218: one launcher for child processes that may need a shell (packages/engine/domains/machine/shell.js, runShim). Node
// deprecates an args array together with `shell: true` (DEP0190: the args are concatenated into one
// command line, not escaped). runShim(file, args, opts) returns the ChildProcess: a Windows .cmd/.bat
// shim runs through cmd.exe with one command line whose arguments are escaped for cmd.exe; a real
// executable (and every file on Linux/macOS) runs without a shell. The arguments reach the child
// unchanged either way. The fixture shim is shaped like the ones npm installs (node + `%*`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// required in each test: the module is part of the change, a missing one fails the tests, not the file
const shell = () => require('../../domains/machine/shell');

// arguments a cmd.exe command line would otherwise expand, split or redirect
const ARGS = [
  'plain', 'two words', 'say "hi"', '"', '%PATH%', '%', '100%', 'a^b', '^', 'x & echo injected', 'a|b', 'a<b>c',
  '!bang!', 'C:\\dir with space\\', 'back\\\\slashes\\"quote', 'ünïcødé ✓ 日本', '',
];

// echo-args.js prints its arguments, cwd and SHIM_MARKER as ASCII-only JSON (no console code page involved)
function fixture(t) {
  const dir = path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'))), 'shim dir');
  fs.mkdirSync(dir);
  t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true, maxRetries: 3 }));
  const js = path.join(dir, 'echo-args.js');
  fs.writeFileSync(js, [
    "const out = JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), marker: process.env.SHIM_MARKER || null });",
    "process.stdout.write(out.replace(/[\\u007f-\\uffff]/g, (c) => '\\\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));",
  ].join('\n'));
  const cmd = path.join(dir, 'echo-args.cmd');
  fs.writeFileSync(cmd, `@"${process.execPath}" "%~dp0echo-args.js" %*\r\n`);
  return { dir, js, cmd };
}

function collect(child) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function watchWarnings(t) {
  const warnings = [];
  const onWarning = (w) => warnings.push(w);
  process.on('warning', onWarning);
  t.after(() => process.off('warning', onWarning));
  return warnings;
}

const same = (a, b) => fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase();

test('runShim: a real executable gets its arguments unchanged, without a shell, with the given cwd and env, and no DEP0190 warning', async (t) => {
  const f = fixture(t);
  const warnings = watchWarnings(t);
  const args = [...ARGS, 'line one\nline two'];
  const child = shell().runShim(process.execPath, [f.js, ...args], { cwd: f.dir, env: { ...process.env, SHIM_MARKER: 'marker-1' } });
  const r = await collect(child);
  assert.equal(r.code, 0, r.err);
  const got = JSON.parse(r.out);
  assert.deepEqual(got.args, args);
  assert.ok(same(got.cwd, f.dir), got.cwd);
  assert.equal(got.marker, 'marker-1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(warnings.filter((w) => w.code === 'DEP0190').map((w) => w.message), []);
});

test('runShim: a Windows .cmd shim gets every argument unchanged (quotes, %VAR%, ^, &, |, <>, !, trailing backslash, non-ASCII, empty) and nothing is injected, with no DEP0190 warning', { skip: process.platform !== 'win32' && '.cmd shims run through cmd.exe on Windows only' }, async (t) => {
  const f = fixture(t);
  const warnings = watchWarnings(t);
  const child = shell().runShim(f.cmd, ARGS, { cwd: f.dir, env: { ...process.env, SHIM_MARKER: 'marker-2' } });
  const r = await collect(child);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /^injected/m, 'an & inside an argument never runs a second command');
  const got = JSON.parse(r.out);
  assert.deepEqual(got.args, ARGS);
  assert.ok(same(got.cwd, f.dir), got.cwd);
  assert.equal(got.marker, 'marker-2');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(warnings.filter((w) => w.code === 'DEP0190').map((w) => w.message), []);
});

// ---- no args array together with a shell option, anywhere in src/ and scripts/ -------------------

const REPO = path.join(__dirname, '..', '..', '..', '..');
// every source file (src/, the workspaces, scripts/: scripts/source-tree.js), tests left out
const sourceFiles = () => require('../../../../scripts/source-tree').sourceFiles(REPO, { scripts: true }).map((f) => path.join(REPO, ...f.split('/')));
const CALL = /\b(spawn|spawnSync|execFile|execFileSync)\s*\(/g;
// a `shell` option that is not plainly `shell: false`: `shell: true`, `shell: x.shell`, `{ shell }`
const SHELL = /(^|[{,\s])shell\s*(:(?!\s*false\b)|[,}])/;

function jsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js') && !f.split(/[\\/]/).includes('node_modules'))
    .map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).isFile());
}

// the top-level arguments of the call whose '(' is at `open` (strings and comments skipped)
function callArgs(text, open) {
  const args = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += text[++i] || ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue; }
    if (c === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl; continue; }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) {
      if (depth === 0) { if (cur.trim()) args.push(cur.trim()); return args; }
      depth--;
    }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return args;
}

function offendersIn(text) {
  const found = [];
  for (const m of text.matchAll(CALL)) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const before = text.slice(lineStart, m.index);
    if (before.includes('//') || /^\s*\*/.test(before)) continue; // a comment
    const args = callArgs(text, m.index + m[0].length - 1);
    if (args.length >= 3 && args.slice(2).some((a) => SHELL.test(a))) found.push(text.slice(0, m.index).split('\n').length);
  }
  return found;
}

test('no spawn/execFile call in src/ or scripts/ passes an args array together with a shell option (DEP0190): shims go through runShim', () => {
  // the check itself: finds an args array with a shell option, accepts a single command line
  assert.deepEqual(offendersIn('spawn(cmd, args.map(q), {\n  cwd,\n  shell: true,\n});'), [1]);
  assert.deepEqual(offendersIn('x();\nexecFile(r.file, args, { shell: r.shell, timeout: 5 }, (e) => e);'), [2]);
  assert.deepEqual(offendersIn('execFile(file, args, { ...o, shell }, cb);'), [1]);
  assert.deepEqual(offendersIn('spawn(line, { shell: true, cwd });'), []);
  assert.deepEqual(offendersIn('spawn(file, args, { shell: false });'), []);
  assert.deepEqual(offendersIn('spawn(file, args, { cwd: "shell: true" });'), []);

  const offenders = [];
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of offendersIn(text)) offenders.push(`${path.relative(REPO, file)}:${line}: ${text.split('\n')[line - 1].trim()}`);
  }
  assert.deepEqual(offenders, []);
});
