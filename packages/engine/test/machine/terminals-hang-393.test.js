// #393: test/terminals.test.js hung the full suite past its timeout. Cause found: the pty test ended
// right after killing its pseudoterminal, before node-pty reported the exit, and the suite's
// --test-force-exit then hung the file's process in its exit on Windows (about half the runs; the
// tests themselves had passed). Each test of the file has its own timeout, the file ends with and
// without --test-force-exit, and a closed terminal (pty or virtual) leaves no handle that keeps the
// process alive. Every child here is started with a kill timeout, so this file cannot hang either.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FILE = path.join(__dirname, 'terminals.test.js');
const TERMINALS = path.join(ROOT, 'packages', 'engine', 'domains', 'machine', 'terminals.js');
const SESSION_TAIL = path.join(ROOT, 'packages', 'engine', 'domains', 'session', 'session-tail.js');

// a plain child process: without NODE_TEST_CONTEXT a `node --test` child is a runner, not a test file
function runNode(args, killAfterMs) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const started = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: killAfterMs, windowsHide: true });
  return { status: r.status, timedOut: r.error?.code === 'ETIMEDOUT', ms: Date.now() - started, out: `${r.stdout || ''}${r.stderr || ''}`.slice(-2000) };
}

test('every test of test/terminals.test.js has its own timeout of at most 60 s', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  // test('<name>', <options>, fn): the options may be an object literal or a constant declared in the file
  const calls = [...src.matchAll(/^test\(\s*(['"`])(.*?)\1\s*,\s*([^,]+?)\s*,\s*(?:async\s*)?(?:\(|function)/gm)];
  const all = [...src.matchAll(/^test\(/gm)].length;
  assert.ok(all >= 3, `only ${all} tests found in test/terminals.test.js`);
  const timeoutOf = (opts) => {
    let literal = opts.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(literal)) {
      const decl = new RegExp(`const\\s+${literal}\\s*=\\s*(\\{[^}]*\\})`).exec(src);
      literal = decl ? decl[1] : '';
    }
    const m = /timeout\s*:\s*([\d_]+)/.exec(literal);
    return m ? Number(m[1].replace(/_/g, '')) : null;
  };
  const missing = [];
  for (const name of [...src.matchAll(/^test\(\s*(['"`])(.*?)\1/gm)].map((m) => m[2])) {
    const call = calls.find((c) => c[2] === name);
    const ms = call ? timeoutOf(call[3]) : null;
    if (!(ms > 0 && ms <= 60000)) missing.push(name);
  }
  assert.deepEqual(missing, []);
});

test('test/terminals.test.js passes and exits on its own within 30 s, without --test-force-exit', { timeout: 120000 }, () => {
  const r = runNode(['--test', '--test-reporter=dot', FILE], 90000);
  assert.equal(r.timedOut, false, `the file was still running after 90 s:\n${r.out}`);
  assert.equal(r.status, 0, r.out);
  assert.ok(r.ms < 30000, `the file took ${r.ms} ms`);
});

// the suite runs each file with --test-force-exit: before #393 the pty test's process hung in that
// exit in about half the runs (the pty killed, its exit not yet reported by node-pty)
test('test/terminals.test.js run as the suite does (--test-force-exit) ends within 30 s, 5 times in a row', { timeout: 240000 }, () => {
  for (let i = 1; i <= 5; i++) {
    const r = runNode(['--test', '--test-force-exit', '--test-reporter=dot', FILE], 30000);
    assert.equal(r.timedOut, false, `run ${i} was still running after 30 s:\n${r.out}`);
    assert.equal(r.status, 0, `run ${i}:\n${r.out}`);
  }
});

test('a process that kills its pseudoterminal exits on its own: no pty handle is left open', { timeout: 60000 }, () => {
  const script = [
    `const { Terminals } = require(${JSON.stringify(TERMINALS)});`,
    'const terms = new Terminals(() => {});',
    "const { id } = terms.open({ title: 'x', file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: process.cwd(), env: process.env });",
    "setTimeout(() => { console.log('KILLED=' + terms.kill(id)); }, 500);",
  ].join('\n');
  const r = runNode(['-e', script], 30000);
  assert.equal(r.timedOut, false, `the process was still alive 30 s after killing its terminal:\n${r.out}`);
  assert.match(r.out, /KILLED=true/);
  assert.equal(r.status, 0, r.out);
});

test('a process that closes all its terminals (a pty and a session follower) exits on its own', { timeout: 60000 }, () => {
  const script = [
    "const fs = require('fs'); const os = require('os'); const path = require('path');",
    `const { Terminals } = require(${JSON.stringify(TERMINALS)});`,
    `const { followSession } = require(${JSON.stringify(SESSION_TAIL)});`,
    "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-393-'));",
    "fs.mkdirSync(path.join(dir, 'sessions'));",
    "fs.writeFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ ts: '2026-10-15T10:00:00Z', type: 'workflow.started', workflow: 'w', version: '1', inputs: {} }) + '\\n');",
    'const terms = new Terminals(() => {});',
    "terms.openVirtual({ title: 'live', start: (write) => followSession(dir, 'orchestrator', write) });",
    "terms.open({ title: 'x', file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: process.cwd(), env: process.env });",
    "setTimeout(() => { terms.killAll(); fs.rmSync(dir, { recursive: true, force: true }); console.log('CLOSED'); }, 500);",
  ].join('\n');
  const r = runNode(['-e', script], 30000);
  assert.equal(r.timedOut, false, `the process was still alive 30 s after closing its terminals:\n${r.out}`);
  assert.match(r.out, /CLOSED/);
  assert.equal(r.status, 0, r.out);
});
