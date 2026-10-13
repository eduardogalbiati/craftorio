// The external live terminal's follower (#342): src/session-tail.js as a script and its Rust twin
// multiagent-tail (native/, built here once with `cargo build --release -p multiagent-tail`) run the
// same cases, invoked alike: `<tail> <runDir> <sessionId>` ("orchestrator" follows <run>/events.jsonl,
// any other id <run>/sessions/<id>.jsonl). The binary must print exactly what the script prints (the
// window title, the "Following" line, the colours, the clipping, local times): its stdout is compared
// byte for byte with the script's on the same fixture, with FORCE_COLOR=1 and without. Without cargo
// the binary's cases are skipped with one line; CI (CI set) never skips them, and a failed build fails
// them with cargo's message. Ctrl+C: on macOS/Linux, SIGINT ends either without a stack trace; on
// Windows a console Ctrl+C cannot be sent to a piped child, so that case is skipped there.
// Fixture times are local (toLocaleTimeString), so both run on this machine with the same timezone.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'src', 'session-tail.js');
const NATIVE = path.join(ROOT, 'native');
const BINARY_NAME = process.platform === 'win32' ? 'multiagent-tail.exe' : 'multiagent-tail';
const BINARY = path.join(process.env.CARGO_TARGET_DIR || path.join(NATIVE, 'target'), 'release', BINARY_NAME);

const hasCargo = () => spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0;
const SKIP_BINARY = !process.env.CI && !hasCargo() ? 'cargo is not installed: multiagent-tail\'s cases are skipped (CI runs them)' : false;

let built = null;
function buildBinary() {
  if (built) return built;
  const r = spawnSync('cargo', ['build', '--release', '--manifest-path', path.join(NATIVE, 'Cargo.toml'), '-p', 'multiagent-tail'], {
    encoding: 'utf8', timeout: 9 * 60 * 1000,
  });
  if (r.status !== 0) built = { error: `cargo build of multiagent-tail failed: ${(r.stderr || r.error?.message || '').slice(-1500)}` };
  else if (!fs.existsSync(BINARY)) built = { error: `cargo built multiagent-tail but ${BINARY} does not exist` };
  else built = { file: BINARY };
  return built;
}

const TAILS = [
  { label: 'session-tail.js (Node)', command: () => ({ file: process.execPath, args: [SCRIPT] }) },
  {
    label: 'multiagent-tail (Rust binary)',
    skip: SKIP_BINARY,
    command: () => {
      const b = buildBinary();
      if (b.error) throw new Error(b.error);
      return { file: b.file, args: [] };
    },
  },
];
const JS = TAILS[0];
const BIN = TAILS[1];

// ---- fixtures: one line per format session-tail.js prints -----------------------------------------

const at = (s) => new Date(Date.UTC(2026, 9, 13, 12, 0, s)).toISOString();
const long = (n) => `${'x'.repeat(n - 4)}café`; // clipped by characters, not bytes

const SESSION_EVENTS = [
  { type: 'session.opened', ts: at(0), session_id: 'developer-1', session: { agent: 'developer', provider: 'claude', model: 'opus' } },
  { type: 'session.message_sent', ts: at(1), turn: 1, step_id: 'implement', prompt: `Do the work\nline two\n${long(1600)}` },
  { type: 'session.message_sent', ts: at(2), turn: 2, prompt: 'no step id' },
  { type: 'session.stream', ts: at(3), item: { kind: 'thinking', text: `think\nmore ${long(2100)}` } },
  { type: 'session.stream', ts: at(4), item: { kind: 'text', text: 'Hello ✓ café\nsecond line' } },
  { type: 'session.stream', ts: at(5), item: { kind: 'tool_call', name: 'Bash', input: { command: 'npm test' } } },
  { type: 'session.stream', ts: at(6), item: { kind: 'tool_call', name: 'Read', input: { file_path: 'a.js', limit: 3 } } },
  { type: 'session.stream', ts: at(7), item: { kind: 'tool_call', input: { command: long(500) } } },
  { type: 'session.stream', ts: at(8), item: { kind: 'tool_result', output: `ok\n${long(900)}` } },
  { type: 'session.stream', ts: at(9), item: { kind: 'tool_result', is_error: true, output: 'boom' } },
  { type: 'session.stream', ts: at(10), item: { kind: 'stderr', text: 'warning: x' } },
  { type: 'session.stream', ts: at(11), item: { kind: 'spawn', command: '/usr/local/bin/claude', args: ['-p', '--verbose'] } },
  { type: 'session.stream', ts: at(12), item: { kind: 'session', sessionId: 'abc-123' } },
  { type: 'session.stream', ts: at(13), item: { kind: 'unknown-kind', text: 'ignored' } },
  { type: 'session.message_received', ts: at(14), duration_ms: 12500, usage: { input: 10, cache_read: 2000, output: 30 }, cost_usd: 0.5 },
  { type: 'session.message_received', ts: at(15), duration_ms: 400 },
  { type: 'session.status', ts: at(16), status: 'retrying' },
  { type: 'session.status', ts: at(17), status: 'running' },
  { type: 'session.status', ts: at(18), status: 'error' },
  { type: 'some.other', ts: at(19) },
  { type: 'session.closed', ts: at(20), status: 'success' },
];

const RUN_EVENTS = [
  { type: 'workflow.started', ts: at(0), workflow: 'software-development', version: '1.2', mock: true, inputs: { task: 'Fix   the\nbug', repo_path: 'C:/x', n: 3 } },
  { type: 'workflow.started', ts: at(1), workflow: 'other' },
  { type: 'step.started', ts: at(2), step_id: 'implement', visit: 1, agent: 'developer' },
  { type: 'step.started', ts: at(3), step_id: 'gate', visit: 2 },
  { type: 'step.finished', ts: at(4), step_id: 'implement', output: { status: 'ok' } },
  { type: 'step.transition', ts: at(5), to: 'review', when: 'status == ok' },
  { type: 'step.waiting', ts: at(6), interval_ms: 60000 },
  { type: 'step.goal', ts: at(7), met: true, goal: 'tests pass' },
  { type: 'step.goal', ts: at(8), met: false },
  { type: 'session.opened', ts: at(9), session_id: 'developer-1', session: { agent: 'developer', provider: 'claude', model: 'opus' } },
  { type: 'session.opened', ts: at(10), session_id: 'orchestrator', session: { agent: 'orchestrator', provider: 'x', model: 'y' } },
  { type: 'session.message_received', ts: at(11), session_id: 'developer-1', duration_ms: 2500, cost_usd: 0.25 },
  { type: 'session.closed', ts: at(12), session_id: 'developer-1', status: 'success' },
  { type: 'approval.requested', ts: at(13), message: 'Accept?\nReally?' },
  { type: 'approval.resolved', ts: at(14), approved: true, by: 'owner' },
  { type: 'approval.resolved', ts: at(15), choice: 'stop', by: 'phone' },
  { type: 'action.executed', ts: at(16), command: 'git push', skipped: true },
  { type: 'action.executed', ts: at(17), command: 'npm test', exit_code: 1 },
  { type: 'file.saved', ts: at(18), path: 'docs/prd.md' },
  { type: 'decision.logged', ts: at(19), agent: 'architect', count: 2 },
  { type: 'supervisor.started', ts: at(20), step_id: 'implement', error: long(400) },
  { type: 'supervisor.decision', ts: at(21), action: 'goto', goto: 'implement', explanation: 'Retry\nnow', instruction: 'Fix it\nfast' },
  { type: 'supervisor.decision', ts: at(22), action: 'retry' },
  { type: 'budget.exceeded', ts: at(23), provider: 'claude' },
  { type: 'limit.exceeded', ts: at(24), limit: 'max_visits' },
  { type: 'log', ts: at(25), level: 'error', message: 'bad' },
  { type: 'log', ts: at(26), level: 'warn', message: 'careful' },
  { type: 'log', ts: at(27), level: 'info', message: 'fine' },
  { type: 'workflow.finished', ts: at(28), status: 'failed', error: 'step implement failed' },
  { type: 'workflow.finished', ts: at(29), status: 'success', summary: { duration_ms: 61000, cost_usd: 1.25 } },
];

const jsonl = (events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;

// A run folder: sessions/<id>.jsonl and events.jsonl as given (a broken line included).
function runFolder(t, { session, events } = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tail-342-'));
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  if (session !== undefined) {
    fs.mkdirSync(path.join(runDir, 'sessions'));
    fs.writeFileSync(path.join(runDir, 'sessions', 'developer-1.jsonl'), session);
  }
  if (events !== undefined) fs.writeFileSync(path.join(runDir, 'events.jsonl'), events);
  return runDir;
}

// Starts a tail with a hard kill timeout; killed in t.after.
function startTail(t, tail, runDir, sessionId, env = {}) {
  const { file, args } = tail.command();
  const childEnv = { ...process.env, ...env };
  if (!('FORCE_COLOR' in env)) delete childEnv.FORCE_COLOR;
  const child = spawn(file, [...args, runDir, sessionId], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('error', () => {});
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const hard = setTimeout(() => child.kill('SIGKILL'), 30000);
  t.after(() => { clearTimeout(hard); child.kill('SIGKILL'); });
  const waitFor = async (text, timeoutMs = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (stdout.includes(text)) return stdout;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out waiting for ${JSON.stringify(text)} (stdout ${JSON.stringify(stdout.slice(-800))}, stderr ${JSON.stringify(stderr.slice(-800))})`);
  };
  return { child, waitFor, exited, out: () => stdout, err: () => stderr };
}

// What a tail prints for a fixture once it has read everything (the last line is the marker).
async function printed(t, tail, runDir, sessionId, marker, env) {
  const run = startTail(t, tail, runDir, sessionId, env);
  await run.waitFor(marker);
  await new Promise((r) => setTimeout(r, 200));
  run.child.kill('SIGKILL');
  return run.out();
}

// ---- both tails ------------------------------------------------------------------------------------

for (const tail of TAILS) {
  test(`#342 ${tail.label}: prints an existing session log, the broken line skipped`, { skip: tail.skip }, async (t) => {
    const runDir = runFolder(t, { session: `${jsonl(SESSION_EVENTS.slice(0, 5))}{not json\n${jsonl(SESSION_EVENTS.slice(5))}` });
    const out = await printed(t, tail, runDir, 'developer-1', 'session closed: success');
    assert.ok(out.includes(`Following ${path.join(runDir, 'sessions', 'developer-1.jsonl')}`), 'names the file it follows');
    assert.ok(out.includes('developer-1 · multiagent'), 'the window title');
    for (const s of ['── turn 1', 'npm test', 'provider session abc-123', 'in 10 · cache 2000 · out 30 · $0.5000', 'retrying']) assert.ok(out.includes(s), s);
    assert.equal(out.includes('ignored'), false, 'unknown stream kinds print nothing');
  });

  test(`#342 ${tail.label}: follows lines appended after it started, a partial line printed once complete`, { skip: tail.skip }, async (t) => {
    const runDir = runFolder(t, { session: jsonl(SESSION_EVENTS.slice(0, 1)) });
    const file = path.join(runDir, 'sessions', 'developer-1.jsonl');
    const run = startTail(t, tail, runDir, 'developer-1');
    await run.waitFor('opus');
    const line = JSON.stringify({ type: 'session.stream', ts: at(30), item: { kind: 'text', text: 'appended later' } });
    fs.appendFileSync(file, line.slice(0, 20));
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(run.out().includes('appended later'), false, 'a partial line waits for its end');
    fs.appendFileSync(file, `${line.slice(20)}\n`);
    await run.waitFor('appended later');
    fs.appendFileSync(file, `${JSON.stringify({ type: 'session.closed', ts: at(31), status: 'success' })}\n`);
    await run.waitFor('session closed: success');
    assert.equal(run.out().split('appended later').length, 2, 'printed once');
  });

  test(`#342 ${tail.label}: waits for a session file that does not exist yet and prints it once created`, { skip: tail.skip }, async (t) => {
    const runDir = runFolder(t);
    const run = startTail(t, tail, runDir, 'developer-1');
    await run.waitFor('Following');
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(run.child.exitCode, null, 'still running');
    fs.mkdirSync(path.join(runDir, 'sessions'));
    fs.writeFileSync(path.join(runDir, 'sessions', 'developer-1.jsonl'), jsonl(SESSION_EVENTS.slice(0, 1)));
    await run.waitFor('opus');
  });

  test(`#342 ${tail.label}: "orchestrator" follows the whole run (events.jsonl)`, { skip: tail.skip }, async (t) => {
    const runDir = runFolder(t, { events: jsonl(RUN_EVENTS) });
    const out = await printed(t, tail, runDir, 'orchestrator', '61s · $1.25');
    assert.ok(out.includes(`Following ${path.join(runDir, 'events.jsonl')}`));
    for (const s of ['▶ software-development 1.2', '(simulation)', 'task: Fix the bug', '→ review   [status == ok]', 'decision: approved (owner)', 'skipped (simulation)', '◆ supervisor → goto implement']) {
      assert.ok(out.includes(s), s);
    }
    assert.equal(out.includes('+ session orchestrator'), false, 'the orchestrator\'s own session is not listed');
  });

  test(`#342 ${tail.label}: without its two arguments it prints the usage and exits 1`, { skip: tail.skip }, async (t) => {
    const { file, args } = tail.command();
    const r = spawnSync(file, [...args, os.tmpdir()], { encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /usage: session-tail <runDir> <sessionId>/);
  });

  test(`#342 ${tail.label}: Ctrl+C (SIGINT) ends it without a stack trace`, { skip: tail.skip || (process.platform === 'win32' ? 'a console Ctrl+C cannot be sent to a piped child on Windows' : false) }, async (t) => {
    const runDir = runFolder(t, { session: jsonl(SESSION_EVENTS.slice(0, 1)) });
    const run = startTail(t, tail, runDir, 'developer-1');
    await run.waitFor('opus');
    run.child.kill('SIGINT');
    const { code, signal } = await run.exited;
    assert.ok(code === 0 || code === 130 || signal === 'SIGINT', `code ${code}, signal ${signal}`);
    assert.equal(run.err(), '');
  });
}

// ---- the binary prints exactly what the script prints ----------------------------------------------

for (const [label, env] of [['FORCE_COLOR=1', { FORCE_COLOR: '1' }], ['no FORCE_COLOR', {}]]) {
  test(`#342 multiagent-tail prints a session log byte for byte like session-tail.js (${label})`, { skip: BIN.skip }, async (t) => {
    const runDir = runFolder(t, { session: `${jsonl(SESSION_EVENTS.slice(0, 5))}{not json\n${jsonl(SESSION_EVENTS.slice(5))}` });
    const expected = await printed(t, JS, runDir, 'developer-1', 'session closed: success', env);
    const actual = await printed(t, BIN, runDir, 'developer-1', 'session closed: success', env);
    assert.equal(actual, expected);
  });

  test(`#342 multiagent-tail prints a whole run byte for byte like session-tail.js (${label})`, { skip: BIN.skip }, async (t) => {
    const runDir = runFolder(t, { events: jsonl(RUN_EVENTS) });
    const expected = await printed(t, JS, runDir, 'orchestrator', '61s · $1.25', env);
    const actual = await printed(t, BIN, runDir, 'orchestrator', '61s · $1.25', env);
    assert.equal(actual, expected);
  });
}
