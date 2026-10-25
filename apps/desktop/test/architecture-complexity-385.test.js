// #385 acceptance: the Architecture facts (packages/engine/domains/project/architecture-facts.js readFacts) measure JavaScript
// and TypeScript complexity inside the app, without lizard or Python, with the same rules as
// scripts/code-health.js (acorn); one pure measuring core in packages/shared/ used by both; a language
// without a tool is "not measured" (null, never 0) and named; the Facts tab says which languages
// are not measured and how to measure them (`pip install lizard`, which needs Python).
// lizard is made unavailable by stubbing packages/engine/engine/providers.js resolveCommand/resolveCommandAsync
// for 'lizard' only (git keeps working) and loading packages/engine/domains/project/architecture-facts.js afresh.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { execFileSync } = require('child_process');
const { createDom } = require('./mini-dom');
const { analyzeSource } = require('../../../scripts/code-health');

const ROOT = path.join(__dirname, '..', '..', '..');
const RENDERER = path.join(ROOT, 'apps', 'desktop', 'renderer');

// One if with an && (1 + 1 + 1 = 3); a for...of with an if and a ternary (1 + 1 + 1 + 1 = 4)
const A_JS = [
  'function check(a, b) {',
  '  if (a && b) return 1;',
  '  return 0;',
  '}',
  'const pick = (xs) => {',
  '  for (const x of xs) {',
  '    if (x) return x > 1 ? 1 : 2;',
  '  }',
  '  return null;',
  '};',
  'module.exports = { check, pick };',
  '',
].join('\n');
const B_JS = [
  'module.exports = function plain() {',
  '  return 1;',
  '};',
  '',
].join('\n');
// TypeScript with type annotations: one function, one ternary (1 + 1 = 2)
const C_TS = [
  'export interface Box { items: string[] }',
  'export function size(box: Box): number {',
  '  return box.items.length > 0 ? box.items.length : 0;',
  '}',
  '',
].join('\n');
const X_PY = [
  'def odd(n):',
  '    if n % 2:',
  '        return True',
  '    return False',
  '',
].join('\n');

const FIXTURE = { 'src/a.js': A_JS, 'src/b.js': B_JS, 'src/c.ts': C_TS, 'tools/x.py': X_PY };

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch385-'));
  for (const [file, text] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  const git = (args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: dir, windowsHide: true, stdio: 'pipe' });
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'fixture']);
  return dir;
}

// packages/engine/domains/project/architecture-facts.js loaded afresh with lizard not installed; restored afterwards
function factsWithoutLizard(t) {
  const providers = require('@multiagent/engine/engine/providers');
  const { resolveCommand, resolveCommandAsync } = providers;
  providers.resolveCommand = (cmd, ...rest) => (/^lizard/i.test(String(cmd)) ? null : resolveCommand(cmd, ...rest));
  providers.resolveCommandAsync = async (cmd, ...rest) => (/^lizard/i.test(String(cmd)) ? null : resolveCommandAsync(cmd, ...rest));
  const id = require.resolve('@multiagent/engine/domains/project/architecture-facts');
  delete require.cache[id];
  const facts = require('@multiagent/engine/domains/project/architecture-facts');
  t.after(() => {
    providers.resolveCommand = resolveCommand;
    providers.resolveCommandAsync = resolveCommandAsync;
    delete require.cache[id];
  });
  return facts;
}

async function readFixtureFacts(t) {
  const dir = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { readFacts } = factsWithoutLizard(t);
  const facts = await readFacts(dir, { refresh: true });
  assert.equal(facts.state, 'ok');
  return facts;
}

const row = (model, file) => {
  const r = model.files.find((f) => f.file === file);
  assert.ok(r, `${file} is in the facts`);
  return { complexity: r.complexity, worst: r.worst, functions: r.functions };
};

// What code-health.js gives a file, in the facts' per-file shape
function codeHealthRow(source, file) {
  const fns = analyzeSource(source, file);
  return { complexity: fns.reduce((s, f) => s + f.complexity, 0), worst: fns.reduce((m, f) => Math.max(m, f.complexity), 0), functions: fns.length };
}

// The language names a complexity status lists as not measured (any array of names or { language })
function listedLanguages(complexity) {
  const out = [];
  for (const value of Object.values(complexity || {})) {
    if (!Array.isArray(value)) continue;
    for (const v of value) {
      const name = typeof v === 'string' ? v : v && typeof v.language === 'string' ? v.language : null;
      if (name) out.push(name);
    }
  }
  return out;
}

test('#385 JavaScript complexity is measured without lizard, with the same numbers as code-health.js', async (t) => {
  const { model } = await readFixtureFacts(t);
  // worked example: check() = 1 + if + && = 3, pick() = 1 + for + if + ternary = 4
  assert.deepEqual(row(model, 'src/a.js'), { complexity: 7, worst: 4, functions: 2 });
  assert.deepEqual(row(model, 'src/a.js'), codeHealthRow(A_JS, 'src/a.js'));
  assert.deepEqual(row(model, 'src/b.js'), codeHealthRow(B_JS, 'src/b.js'));
  assert.deepEqual(row(model, 'src/b.js'), { complexity: 1, worst: 1, functions: 1 });
});

test('#385 a TypeScript file with type annotations is measured too, not "not measured"', async (t) => {
  const { model } = await readFixtureFacts(t);
  // size() = 1 + ternary = 2; the interface is no function
  assert.deepEqual(row(model, 'src/c.ts'), { complexity: 2, worst: 2, functions: 1 });
});

test('#385 a language without a tool is not measured (null, never 0) and named in the facts', async (t) => {
  const { model } = await readFixtureFacts(t);
  assert.deepEqual(row(model, 'tools/x.py'), { complexity: null, worst: null, functions: null });
  const listed = listedLanguages(model.complexity);
  assert.ok(listed.includes('Python'), `Python is listed as not measured: ${JSON.stringify(model.complexity)}`);
  assert.equal(listed.includes('JavaScript'), false, 'JavaScript is measured');
  assert.equal(listed.includes('TypeScript'), false, 'TypeScript is measured');
});

test('#385 one measuring core: packages/shared/code-complexity.js measureSource gives code-health.js\'s numbers', () => {
  const { measureSource } = require('@multiagent/shared/code-complexity');
  assert.equal(typeof measureSource, 'function');
  const pick = (fns) => fns.map((f) => ({ name: f.name, line: f.line, complexity: f.complexity }));
  const measured = measureSource(A_JS, { file: 'src/a.js' });
  assert.deepEqual(pick(measured), pick(analyzeSource(A_JS, 'src/a.js')));
  assert.deepEqual(pick(measured), [{ name: 'check', line: 1, complexity: 3 }, { name: 'pick', line: 5, complexity: 4 }]);
  // the TypeScript source is measured by the same core
  assert.deepEqual(pick(measureSource(C_TS, { file: 'src/c.ts' })), [{ name: 'size', line: 2, complexity: 2 }]);
});

// The Facts tab (project-architecture.js) in a mini DOM, as test/project-architecture-action-381.test.js loads it
function loadTab(model) {
  const api = {
    architectureFacts: async () => ({ state: 'ok', model, exclude: [], gate: [] }),
    architectureReport: async () => ({ report: null, findings: [], gone: [], runsSince: 0 }),
    listArchitectureReports: async () => [],
    architectureEstimate: async () => ({ estimate: null }),
    architectureCity: async () => ({ state: 'not-git', model: null, validation: null }),
    chainEstimate: async () => null,
    startRun: async () => ({ runId: 'run-1' }),
    onEvent: () => () => {},
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
    api, state: { projects: [{ id: 'p1', name: 'fixture', folder: 'C:/fixture' }], simulationOnly: true },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), fmtNum: (n) => String(n), fmtUsd: (n) => `US$ ${n}`, showToast: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'architecture-facts-view.js', 'city-model.js', 'city-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  vm.runInContext(fs.readFileSync(path.join(RENDERER, 'date-range.js'), 'utf8'), sandbox, { filename: 'date-range.js' });
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-architecture.js']) {
    vm.runInContext(fs.readFileSync(path.join(RENDERER, 'views', 'project', f), 'utf8'), sandbox, { filename: f });
  }
  const box = dom.document.createElement('div');
  dom.document.body.appendChild(box);
  return { PA: sandbox.ProjectArchitecture, box };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

test('#385 the Facts tab names the languages not measured and how to measure them; an unmeasured file shows no 0', async (t) => {
  const { model } = await readFixtureFacts(t);
  const w = loadTab(JSON.parse(JSON.stringify(model)));
  w.PA.show('p1', w.box);
  await settle();
  const note = [...w.box.querySelectorAll('p')].map(text).find((s) => s.includes('pip install lizard'));
  assert.ok(note, 'a note says how to measure: pip install lizard');
  assert.match(note, /Python/, 'the note names Python (not measured; lizard needs it)');
  assert.doesNotMatch(note, /JavaScript[^.]*not measured/, 'JavaScript is not called unmeasured');
  const table = w.box.querySelector('[data-testid="architecture-hotspots"]');
  const cells = (file) => {
    const tr = [...table.querySelectorAll('tr')].find((r) => r.getAttribute('data-arch-file') === file);
    assert.ok(tr, `${file} has a row`);
    return [...tr.querySelectorAll('td')].map(text);
  };
  const js = cells('src/a.js');
  assert.ok(js.includes('7') && js.includes('4'), `src/a.js shows its complexity 7 and worst 4: ${JSON.stringify(js)}`);
  const py = cells('tools/x.py');
  // the cells after the 5 git columns (file, lines, commits, rank, changes most with) are complexity's
  assert.ok(py.length > 5, 'the complexity columns are shown');
  assert.equal(py.slice(5).includes('0'), false, `tools/x.py's complexity is not shown as 0: ${JSON.stringify(py)}`);
});

test('#385 the note names lizard when no tool is listed and lizard gives no install command, never "They need ."', async (t) => {
  const { model } = await readFixtureFacts(t);
  const copy = JSON.parse(JSON.stringify(model));
  Object.assign(copy.complexity, { install: null, needed: [], reason: null });
  const w = loadTab(copy);
  w.PA.show('p1', w.box);
  await settle();
  const note = text(w.box.querySelector('[data-testid="architecture-measure-note"]'));
  assert.match(note, /Python/);
  assert.match(note, /They need lizard\./);
  assert.equal(note.includes('They need .'), false, note);
});

// lizard "installed": resolveCommand finds it, and the external process (child_process.execFile, the
// system boundary) answers with `csv`; packages/engine/domains/project/architecture-facts.js loaded afresh, restored afterwards
function factsWithFakeLizard(t, csv) {
  const providers = require('@multiagent/engine/engine/providers');
  const cp = require('child_process');
  const { resolveCommand } = providers;
  const { execFile } = cp;
  const FAKE = 'C:/fake/lizard.exe';
  providers.resolveCommand = (cmd, ...rest) => (/^lizard/i.test(String(cmd)) ? { file: FAKE } : resolveCommand(cmd, ...rest));
  cp.execFile = (file, args, opts, cb) => {
    if (file !== FAKE) return execFile(file, args, opts, cb);
    setImmediate(() => cb(null, csv, ''));
    return null;
  };
  const id = require.resolve('@multiagent/engine/domains/project/architecture-facts');
  delete require.cache[id];
  const facts = require('@multiagent/engine/domains/project/architecture-facts');
  t.after(() => {
    providers.resolveCommand = resolveCommand;
    cp.execFile = execFile;
    delete require.cache[id];
  });
  return facts;
}

// A TypeScript enum: Node's type stripping refuses it, so the app cannot measure the file
const E_TS = [
  'export enum Mode { A, B }',
  'export function mode(x: number): Mode {',
  '  if (x > 0) return Mode.A;',
  '  return x < 0 ? Mode.B : Mode.A;',
  '}',
  '',
].join('\n');

test('#385 lizard keeps its numbers for a TypeScript file the app cannot parse; the app\'s numbers win for the files it measured', async (t) => {
  const dir = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'src', 'e.ts'), E_TS);
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'core.autocrlf=false', 'add', '-A'], { cwd: dir, windowsHide: true, stdio: 'pipe' });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '-m', 'enum'], { cwd: dir, windowsHide: true, stdio: 'pipe' });
  // lizard --csv: NLOC, CCN, token, PARAM, length, location, file, function, long name, start, end
  const csv = [
    '4,3,30,1,4,"mode@2-5@./src/e.ts","./src/e.ts","mode","mode( x : number)",2,5',
    '3,99,20,2,3,"check@1-4@./src/a.js","./src/a.js","check","check( a , b)",1,4',
    '4,2,15,1,4,"odd@1-4@./tools/x.py","./tools/x.py","odd","odd( n)",1,4',
    '',
  ].join('\n');
  const { readFacts } = factsWithFakeLizard(t, csv);
  const { state, model } = await readFacts(dir, { refresh: true });
  assert.equal(state, 'ok');
  assert.deepEqual(row(model, 'src/e.ts'), { complexity: 3, worst: 3, functions: 1 });
  assert.deepEqual(row(model, 'tools/x.py'), { complexity: 2, worst: 2, functions: 1 });
  // the app measured src/a.js: lizard's 99 is not added to it
  assert.deepEqual(row(model, 'src/a.js'), { complexity: 7, worst: 4, functions: 2 });
});

test('#385 Electron\'s own Node measures TypeScript with the shared core (the packaged app\'s runtime)', (t) => {
  let electron;
  try { electron = require('electron'); } catch { electron = null; }
  if (typeof electron !== 'string' || !fs.existsSync(electron)) return t.skip('the Electron binary is not installed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch385-electron-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'measure.js');
  fs.writeFileSync(script, [
    `const { measureSource } = require(${JSON.stringify(path.join(ROOT, 'packages', 'shared', 'code-complexity.js'))});`,
    `const fns = measureSource(${JSON.stringify(C_TS)}, { file: 'src/c.ts' });`,
    'process.stdout.write(JSON.stringify(fns.map((f) => ({ name: f.name, line: f.line, complexity: f.complexity }))));',
    '',
  ].join('\n'));
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const out = execFileSync(electron, [script], { env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.deepEqual(JSON.parse(out), [{ name: 'size', line: 2, complexity: 2 }]);
});
