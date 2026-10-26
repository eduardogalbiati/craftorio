// #366: the E2E behaviour lane's workers default to `auto`, sized from the machine:
// clamp(1, 4, min(floor(threads / 8), floor((freeGB - 4) / 1.5))). A number in MULTIAGENT_E2E_WORKERS
// still wins; an invalid value falls back to auto with a warning. The suite says what it chose in one line.
// Seams: scripts/e2e-workers.js's e2eWorkers({ value, threads, freeBytes }) -> { workers, line, warning }
// (pure: the env value and the machine passed in), and playwright.config.js loaded with the machine
// (os.availableParallelism, os.freemem) mocked: the only system boundary. The module is loaded inside
// each test: it does not exist before the change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GB = 1024 ** 3;
const load = () => require('../scripts/e2e-workers');
const AUTO_LINE = (n, threads) => new RegExp(`^E2E: ${n} workers? \\(auto: ${threads} threads, \\d+(\\.\\d+)? GB free\\)$`);

// [threads, GB free, workers]; the free memory is picked so that GB or GiB give the same answer
const MACHINES = [
  [20, 11, 2], // the owner's machine (i9-10900KF), measured in #366
  [8, 16, 1], // a laptop with 8 threads
  [20, 6, 1], // 16 GB with 6 GB free
  [4, 14, 1], // a 4-vCPU CI runner
  [24, 20, 3],
  [32, 7, 2], // memory decides
  [64, 64, 4], // never more than 4
  [20, 3, 1], // under 4 GB free: never less than 1
];

for (const [threads, free, workers] of MACHINES) {
  test(`#366 auto: ${threads} threads and ${free} GB free give ${workers} worker(s)`, () => {
    const { e2eWorkers } = load();
    for (const value of [undefined, 'auto']) {
      const r = e2eWorkers({ value, threads, freeBytes: free * GB });
      assert.equal(r.workers, workers, `MULTIAGENT_E2E_WORKERS=${value}`);
      assert.equal(Boolean(r.warning), false, `no warning for ${value}`);
    }
  });
}

test('#366 a number in MULTIAGENT_E2E_WORKERS forces that many workers, whatever the machine', () => {
  const { e2eWorkers } = load();
  assert.equal(e2eWorkers({ value: '3', threads: 4, freeBytes: 5 * GB }).workers, 3);
  assert.equal(e2eWorkers({ value: '1', threads: 64, freeBytes: 64 * GB }).workers, 1);
  assert.equal(e2eWorkers({ value: '6', threads: 20, freeBytes: 11 * GB }).workers, 6);
  assert.equal(Boolean(e2eWorkers({ value: '3', threads: 20, freeBytes: 11 * GB }).warning), false);
});

test('#366 an invalid MULTIAGENT_E2E_WORKERS falls back to auto with a warning that names it, never a crash', () => {
  const { e2eWorkers } = load();
  for (const value of ['abc', '0', '-2']) {
    const r = e2eWorkers({ value, threads: 20, freeBytes: 11 * GB });
    assert.equal(r.workers, 2, `MULTIAGENT_E2E_WORKERS=${value}`);
    assert.equal(typeof r.warning, 'string', `a warning for ${value}`);
    assert.match(r.warning, /MULTIAGENT_E2E_WORKERS/);
    assert.equal(r.warning.includes(value), true, `the warning quotes ${value}: ${r.warning}`);
    assert.match(r.warning, /auto/);
  }
});

test('#366 the start line says what was chosen: auto with the machine, or the variable', () => {
  const { e2eWorkers } = load();
  assert.match(e2eWorkers({ value: undefined, threads: 20, freeBytes: 11.2 * GB }).line, AUTO_LINE(2, 20));
  assert.match(e2eWorkers({ value: 'nope', threads: 20, freeBytes: 11.2 * GB }).line, AUTO_LINE(2, 20));
  assert.equal(e2eWorkers({ value: '3', threads: 20, freeBytes: 11.2 * GB }).line, 'E2E: 3 workers (MULTIAGENT_E2E_WORKERS)');
});

// playwright.config.js loaded again on a mocked machine, with MULTIAGENT_E2E_WORKERS set to value
// (undefined: unset); returns the worker counts and what it printed through the console
function configOn(t, value, { threads, free }) {
  const files = [require.resolve('../playwright.config.js'), path.join(ROOT, 'scripts', 'e2e-workers.js')];
  const forget = () => { for (const f of files) delete require.cache[f]; };
  const before = process.env.MULTIAGENT_E2E_WORKERS;
  const printed = [];
  t.mock.method(os, 'availableParallelism', () => threads);
  t.mock.method(os, 'freemem', () => free * GB);
  for (const m of ['log', 'info', 'warn', 'error']) t.mock.method(console, m, (...args) => { printed.push(args.join(' ')); });
  forget();
  if (value === undefined) delete process.env.MULTIAGENT_E2E_WORKERS;
  else process.env.MULTIAGENT_E2E_WORKERS = value;
  try {
    const config = require(files[0]);
    const lane = (name) => config.projects.find((p) => p.name === name);
    return { pool: config.workers, behaviour: lane('behaviour').workers, visual: lane('visual').workers, printed };
  } finally {
    forget();
    for (const m of ['log', 'info', 'warn', 'error']) console[m].mock.restore();
    if (before === undefined) delete process.env.MULTIAGENT_E2E_WORKERS;
    else process.env.MULTIAGENT_E2E_WORKERS = before;
  }
}

test('#366 the config sizes the behaviour lane and the pool from the machine by default; the visual lane stays at one worker', (t) => {
  const own = configOn(t, undefined, { threads: 20, free: 11 });
  assert.deepEqual([own.pool, own.behaviour, own.visual], [2, 2, 1]);
  const ci = configOn(t, 'auto', { threads: 4, free: 14 });
  assert.deepEqual([ci.pool, ci.behaviour, ci.visual], [1, 1, 1]);
  const big = configOn(t, undefined, { threads: 64, free: 64 });
  assert.deepEqual([big.pool, big.behaviour, big.visual], [4, 4, 1]);
});

test('#366 the config: a number wins over the machine, an invalid value falls back to auto', (t) => {
  const forced = configOn(t, '3', { threads: 4, free: 5 });
  assert.deepEqual([forced.pool, forced.behaviour, forced.visual], [3, 3, 1]);
  for (const value of ['', '0', 'abc']) {
    const r = configOn(t, value, { threads: 20, free: 11 });
    assert.deepEqual([r.pool, r.behaviour, r.visual], [2, 2, 1], `MULTIAGENT_E2E_WORKERS=${JSON.stringify(value)}`);
  }
});

test('#366 loading the config prints one start line with the choice, and a warning for an invalid value', (t) => {
  const auto = configOn(t, undefined, { threads: 20, free: 11 });
  const lines = auto.printed.filter((l) => l.startsWith('E2E: '));
  assert.equal(lines.length, 1, `start lines: ${JSON.stringify(auto.printed)}`);
  assert.match(lines[0], AUTO_LINE(2, 20));

  const forced = configOn(t, '3', { threads: 20, free: 11 });
  assert.deepEqual(forced.printed.filter((l) => l.startsWith('E2E: ')), ['E2E: 3 workers (MULTIAGENT_E2E_WORKERS)']);

  const bad = configOn(t, 'abc', { threads: 20, free: 11 });
  assert.equal(bad.printed.some((l) => l.includes('MULTIAGENT_E2E_WORKERS') && l.includes('abc')), true, `printed: ${JSON.stringify(bad.printed)}`);
});

test('#366 a Playwright worker process loading the config prints nothing (the line is printed once, by the main process)', (t) => {
  const before = process.env.TEST_WORKER_INDEX;
  t.after(() => { if (before === undefined) delete process.env.TEST_WORKER_INDEX; else process.env.TEST_WORKER_INDEX = before; });
  process.env.TEST_WORKER_INDEX = '0';
  for (const value of [undefined, '3']) {
    const r = configOn(t, value, { threads: 20, free: 11 });
    assert.deepEqual(r.printed.filter((l) => l.startsWith('E2E: ')), [], `MULTIAGENT_E2E_WORKERS=${value}`);
  }
});

test('#366 a number with surrounding spaces is still that number', (t) => {
  const { e2eWorkers } = load();
  const r = e2eWorkers({ value: ' 3 ', threads: 4, freeBytes: 5 * GB });
  assert.equal(r.workers, 3);
  assert.equal(Boolean(r.warning), false);
  const c = configOn(t, ' 3 ', { threads: 4, free: 5 });
  assert.deepEqual([c.pool, c.behaviour, c.visual], [3, 3, 1]);
});

test("#366 the config's header documents auto and points at the measurements", () => {
  const header = read('playwright.config.js').split(/\r?\n/).filter((l) => l.startsWith('//')).join('\n');
  assert.match(header, /#366/);
  assert.match(header, /\bauto\b/);
  assert.match(header, /MULTIAGENT_E2E_WORKERS/);
});

test('#366 docs/agents/testing.md says how to set the workers on a slow machine', () => {
  const doc = fs.readdirSync(path.join(ROOT, 'docs', 'agents', 'testing')).map((f) => read(`docs/agents/testing/${f}`)).join('\n');
  assert.match(doc, /#366/);
  assert.match(doc, /\bauto\b/);
  assert.match(doc, /MULTIAGENT_E2E_WORKERS=1/);
});

test('#366 CONTRIBUTING.md tells contributors about MULTIAGENT_E2E_WORKERS', () => {
  assert.match(read('CONTRIBUTING.md'), /MULTIAGENT_E2E_WORKERS/);
});

test("#366 ci.yml leaves the E2E workers to auto or sets them with the reason in a comment", () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /#366/);
  const lines = ci.split(/\r?\n/);
  const sets = lines.findIndex((l) => /^\s*MULTIAGENT_E2E_WORKERS\s*:/.test(l));
  if (sets === -1) {
    assert.equal(lines.some((l) => l.trim().startsWith('#') && /\bauto\b/.test(l)), true, 'a comment says the workers are auto');
  } else {
    assert.equal(lines.slice(Math.max(0, sets - 4), sets + 1).some((l) => /#/.test(l)), true, 'a comment gives the reason next to the value');
  }
});
