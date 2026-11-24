// #853 (acceptance tests, written before the code): the engine guard against a dev server run in the
// foreground. When a Bash tool call that is a server/watcher (`next dev`) runs without
// `run_in_background` and gets no tool_result within the threshold (`serverForegroundMs`, default
// SERVER_FOREGROUND_MS = 90 s next to IDLE_WARN_MS in run/turns.js), the engine stops only that
// server's process tree under the agent CLI's pid; the Bash call returns, the agent goes on in the
// same turn (no interrupt, no retry), a warning `server_in_foreground` reaches the run and its chat,
// and the run summary counts them (`servers_in_foreground`, like `tool_timeouts`). A matching command
// started with `run_in_background` is left alone.
// Seam: WorkflowRun in mock mode with providers.runTurn replaced by a fake turn that starts a real
// fake CLI process (the turn's pid, given through onSpawn and the spawn item), which itself starts a
// never-ending `node server.js next dev` child, as the Bash tool of a real CLI would.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const providers = require('@craftorio/engine/engine/providers');
const { RunChatModel } = require('@craftorio/front-build/views/runchat/run-chat-model.js');

const WORKFLOW = require.resolve('@craftorio/engine/engine/workflow');
const THRESHOLD_MS = 400;

const YAML = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: server-in-foreground-853 }
agents:
  developer:
    provider: claude
    model: mock-model
steps:
  - id: develop
    agent: developer
    prompt: "show the screen working"
`;

// a server that never ends by itself
const SERVER_JS = 'setInterval(() => {}, 1000);\n';
// the fake agent CLI: starts the server as its child, prints its pid, prints how it ended, then exits by itself
const CLI_JS = `const { spawn } = require('child_process');
const child = spawn(process.execPath, [process.argv[2], 'next', 'dev'], { stdio: 'ignore' });
process.stdout.write('server ' + child.pid + '\\n');
child.on('exit', (code, signal) => { process.stdout.write('server-exit ' + code + ' ' + signal + '\\n'); setTimeout(() => process.exit(0), 50); });
`;
// the same CLI with a server already started in the background before (same command line): it starts
// the background one, then the foreground one a moment later, and exits when the foreground one ends
// (detached on Windows: there a Node process takes its attached children with it when it exits; in another folder,
// so that killing it at the end never leaves the test's own folder held)
const CLI_TWO_JS = `const { spawn } = require('child_process');
const bg = spawn(process.execPath, [process.argv[2], 'next', 'dev'], { stdio: 'ignore', detached: process.platform === 'win32', windowsHide: true, cwd: require('os').tmpdir() });
process.stdout.write('background ' + bg.pid + '\\n');
setTimeout(() => {
  const child = spawn(process.execPath, [process.argv[2], 'next', 'dev'], { stdio: 'ignore' });
  process.stdout.write('server ' + child.pid + '\\n');
  child.on('exit', () => setTimeout(() => process.exit(0), 50));
}, 300);
`;

const alive =(pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(predicate, ms) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => (predicate() ? resolve(true) : Date.now() - started > ms ? resolve(false) : setTimeout(tick, 20));
    tick();
  });
}

async function runWith(t, { background, withBackgroundFirst = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-853-'));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, YAML);
  fs.writeFileSync(path.join(dir, 'server.js'), SERVER_JS);
  fs.writeFileSync(path.join(dir, 'cli.js'), withBackgroundFirst ? CLI_TWO_JS : CLI_JS);
  const seen = { calls: 0, serverPid: null, backgroundPid: null, cliExit: null, serverAliveAfterWait: null, stoppedByGuard: false };
  const leftovers = [];
  t.after(() => {
    for (const pid of leftovers) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  const original = providers.runTurn;
  providers.runTurn = async (opts) => {
    seen.calls++;
    const cli = spawn(process.execPath, [path.join(dir, 'cli.js'), path.join(dir, 'server.js')], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    leftovers.push(cli.pid);
    let out = '';
    cli.stdout.on('data', (b) => { out += b; });
    const cliExited = new Promise((r) => cli.on('exit', (code, signal) => r({ code, signal })));
    opts.onItem?.({ kind: 'spawn', pid: cli.pid, command: process.execPath, args: [], cwd: dir, env: [] });
    opts.onSpawn?.({ pid: cli.pid, shim: false });
    if (withBackgroundFirst) {
      await waitFor(() => /background \d+/.test(out), 5000);
      seen.backgroundPid = Number(/background (\d+)/.exec(out)?.[1]) || null;
      if (seen.backgroundPid) leftovers.push(seen.backgroundPid);
      opts.onItem?.({ kind: 'tool_call', id: 's0', name: 'Bash', input: { command: 'next dev', run_in_background: true } });
      opts.onItem?.({ kind: 'tool_result', id: 's0', output: 'Command running in background with ID: bash_1' });
    }
    await waitFor(() => /server \d+/.test(out), 5000);
    seen.serverPid = Number(/server (\d+)/.exec(out)?.[1]) || null;
    if (seen.serverPid) leftovers.push(seen.serverPid);
    opts.onItem?.({ kind: 'tool_call', id: 's1', name: 'Bash', input: background ? { command: 'next dev', run_in_background: true } : { command: 'next dev' } });
    if (background) {
      await sleep(THRESHOLD_MS * 5);
      seen.serverAliveAfterWait = alive(seen.serverPid);
      opts.onItem?.({ kind: 'tool_result', id: 's1', output: 'Command running in background with ID: bash_1' });
      process.kill(seen.serverPid, 'SIGKILL');
      seen.cliExit = await cliExited;
    } else {
      // the Bash call returns only when its server ends: the guard must end it (or the deadline does)
      const ended = await Promise.race([cliExited, sleep(15000).then(() => null)]);
      seen.stoppedByGuard = ended !== null;
      if (!ended) process.kill(seen.serverPid, 'SIGKILL');
      seen.cliExit = ended || await cliExited;
      opts.onItem?.({ kind: 'tool_result', id: 's1', output: 'ready on http://localhost:3000\nKilled', is_error: true });
    }
    opts.onItem?.({ kind: 'tool_call', id: 's2', name: 'Bash', input: { command: 'git status' } });
    opts.onItem?.({ kind: 'tool_result', id: 's2', output: 'nothing to commit, working tree clean' });
    return { text: 'the screen works', costUsd: 0.1, providerSessionId: 'p-853', exitCode: 0 };
  };
  delete require.cache[WORKFLOW];
  t.after(() => { providers.runTurn = original; delete require.cache[WORKFLOW]; });
  const { WorkflowRun } = require(WORKFLOW);
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), serverForegroundMs: THRESHOLD_MS });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const warns = events.filter((e) => e.type === 'log' && e.kind === 'server_in_foreground');
  return { events, finished, warns, seen };
}

test('the guard\'s default threshold is 90 s, next to the idle watch\'s', () => {
  const turns = require('@craftorio/engine/engine/run/turns');
  assert.equal(turns.SERVER_FOREGROUND_MS, 90000);
  assert.equal(typeof turns.IDLE_WARN_MS, 'number');
});

test('a dev server run in the foreground is stopped after the threshold and the turn goes on to the end', { timeout: 60000 }, async (t) => {
  const { finished, seen } = await runWith(t, { background: false });
  assert.equal(seen.stoppedByGuard, true, 'the engine stopped the foreground server');
  assert.equal(alive(seen.serverPid), false);
  // only the server's tree: the agent CLI was not killed, it ended by itself after its Bash call returned
  assert.equal(seen.cliExit.signal, null);
  assert.equal(seen.cliExit.code, 0);
  // same turn: no interrupt, no step retry
  assert.equal(seen.calls, 1);
  assert.equal(finished.status, 'success', finished.error);
});

test('each stop is a server_in_foreground warning in the run and its chat, counted in the summary', { timeout: 60000 }, async (t) => {
  const { events, finished, warns } = await runWith(t, { background: false });
  assert.equal(warns.length, 1);
  const [w] = warns;
  assert.equal(w.level, 'warn');
  assert.equal(w.step_id, 'develop');
  assert.equal(w.agent, 'developer');
  assert.match(String(w.command), /next dev/);
  assert.match(String(w.message), /next dev/);
  assert.match(String(w.message), /\d+(\.\d+)?\s*s\b/);
  assert.equal(finished.summary.servers_in_foreground, 1);
  assert.equal(events.some((e) => e.type === 'log' && e.kind === 'agent_idle'), false);

  const model = new RunChatModel();
  for (const ev of events) model.apply(ev);
  assert.equal(model.items.some((it) => it.kind === 'system' && it.level === 'warn' && /next dev/.test(String(it.text))), true);
});

test('a server started with run_in_background is not stopped by the guard', { timeout: 60000 }, async (t) => {
  const { finished, warns, seen } = await runWith(t, { background: true });
  assert.equal(seen.serverAliveAfterWait, true);
  assert.equal(warns.length, 0);
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(finished.summary.servers_in_foreground ?? 0, 0);
});

test('with the same command already running in the background, only the foreground server is stopped', { timeout: 60000 }, async (t) => {
  const { finished, warns, seen } = await runWith(t, { background: false, withBackgroundFirst: true });
  assert.equal(seen.stoppedByGuard, true, 'the engine stopped the foreground server');
  assert.equal(alive(seen.serverPid), false);
  assert.equal(alive(seen.backgroundPid), true, 'the background server started earlier is still running');
  assert.equal(warns.length, 1);
  assert.equal(finished.status, 'success', finished.error);
});
