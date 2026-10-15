// Embedded terminals: virtual terminals fed by the session log follower.
// #393: every test has its own timeout and stops what it starts (followers, ptys, the detached
// child) in its teardown, so a failing assertion never leaves a handle that keeps the file alive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Terminals } = require('../src/terminals');
const { followSession } = require('../src/session-tail');

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// a stuck pty fails its test with its name instead of hanging the suite
const TIMEOUT = { timeout: 30000 };

// polls instead of a fixed sleep: a loaded machine reads the log later than an idle one
async function until(check, ms = 10000) {
  for (let waited = 0; !check() && waited < ms; waited += 100) await wait(100);
  return check();
}

function runDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'sessions'));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'ai-arena', version: '1', inputs: { task: 'x' } }) + '\n');
  fs.writeFileSync(path.join(dir, 'sessions', 's1.jsonl'), JSON.stringify({ ts: '2026-09-27T10:00:01Z', type: 'session.message_sent', turn: 1, step_id: 'compete', prompt: 'hello' }) + '\n');
  return dir;
}

test('followSession prints a session, the orchestrator timeline, and follows appended lines', TIMEOUT, async (t) => {
  const dir = runDir(t);
  let session = '';
  let orch = '';
  const stopS = followSession(dir, 's1', (s) => { session += s; });
  t.after(stopS);
  const stopO = followSession(dir, 'orchestrator', (s) => { orch += s; });
  t.after(stopO);
  assert.match(strip(session), /── turn 1 compete/);
  assert.match(strip(orch), /▶ ai-arena 1/);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ ts: '2026-09-27T10:00:02Z', type: 'step.started', step_id: 'compete', visit: 1 }) + '\n');
  await until(() => /▶ compete/.test(strip(orch)));
  assert.match(strip(orch), /▶ compete/);
});

test('virtual terminals stream with CRLF, ignore input and stop on kill', TIMEOUT, async (t) => {
  const dir = runDir(t);
  const sent = [];
  const terms = new Terminals((channel, payload) => sent.push({ channel, ...payload }));
  t.after(() => terms.killAll());
  let stopped = false;
  const { id, title } = terms.openVirtual({
    title: 'orchestrator · live',
    start: (write) => { const stop = followSession(dir, 'orchestrator', write); return () => { stopped = true; stop(); }; },
  });
  assert.equal(title, 'orchestrator · live');
  terms.input(id, 'ignored');
  terms.resize(id, 80, 20);
  const data = () => sent.filter((m) => m.channel === 'term:data' && m.id === id).map((m) => m.data).join('');
  await until(() => /▶ ai-arena/.test(strip(data())));
  assert.match(strip(data()), /▶ ai-arena/);
  assert.ok(data().includes('\r\n') && !/[^\r]\n/.test(data()), 'newlines are CRLF for xterm');
  assert.equal(terms.kill(id), true);
  assert.equal(stopped, true);
  assert.equal(terms.kill(id), false);
});

test('killing a pseudoterminal ends the programs it started too', TIMEOUT, async (t) => {
  // a parent that starts a detached long-running child (own console / process group, like an
  // MCP server or a daemon: it survives the pty closing) and prints the child's pid
  const script = "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});console.log('CHILD='+c.pid);setInterval(()=>{},1000)";
  let out = '';
  let child = null;
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const sink = new Terminals((channel, p) => { if (channel === 'term:data') out += p.data; });
  t.after(() => sink.killAll());
  // the detached child outlives a failed assertion: never leave it running
  t.after(() => { if (child && alive(child)) { try { process.kill(child, 'SIGKILL'); } catch { /* gone */ } } });
  const { id } = sink.open({ title: 'tree', file: process.execPath, args: ['-e', script], cwd: process.cwd(), env: process.env });
  await until(() => (child = Number((/CHILD=(\d+)/.exec(out) || [])[1]) || null));
  assert.ok(child, `the child started (output: ${JSON.stringify(out)})`);
  assert.equal(alive(child), true);
  sink.kill(id);
  await until(() => !alive(child), 5000);
  assert.equal(alive(child), false, 'the child was killed with its parent');
});
