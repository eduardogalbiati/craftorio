// Embedded terminals: virtual terminals fed by the session log follower.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Terminals } = require('../src/terminals');
const { followSession } = require('../src/session-tail');

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function runDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'sessions'));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ ts: '2026-09-27T10:00:00Z', type: 'workflow.started', workflow: 'ai-arena', version: '1', inputs: { task: 'x' } }) + '\n');
  fs.writeFileSync(path.join(dir, 'sessions', 's1.jsonl'), JSON.stringify({ ts: '2026-09-27T10:00:01Z', type: 'session.message_sent', turn: 1, step_id: 'compete', prompt: 'hello' }) + '\n');
  return dir;
}

test('followSession prints a session, the orchestrator timeline, and follows appended lines', async (t) => {
  const dir = runDir(t);
  let session = '';
  let orch = '';
  const stopS = followSession(dir, 's1', (s) => { session += s; });
  const stopO = followSession(dir, 'orchestrator', (s) => { orch += s; });
  assert.match(strip(session), /── turn 1 compete/);
  assert.match(strip(orch), /▶ ai-arena 1/);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ ts: '2026-09-27T10:00:02Z', type: 'step.started', step_id: 'compete', visit: 1 }) + '\n');
  await wait(600);
  assert.match(strip(orch), /▶ compete/);
  stopS();
  stopO();
});

test('virtual terminals stream with CRLF, ignore input and stop on kill', async (t) => {
  const dir = runDir(t);
  const sent = [];
  const terms = new Terminals((channel, payload) => sent.push({ channel, ...payload }));
  let stopped = false;
  const { id, title } = terms.openVirtual({
    title: 'orchestrator · live',
    start: (write) => { const stop = followSession(dir, 'orchestrator', write); return () => { stopped = true; stop(); }; },
  });
  assert.equal(title, 'orchestrator · live');
  terms.input(id, 'ignored');
  terms.resize(id, 80, 20);
  await wait(50);
  const data = sent.filter((m) => m.channel === 'term:data' && m.id === id).map((m) => m.data).join('');
  assert.match(strip(data), /▶ ai-arena/);
  assert.ok(data.includes('\r\n') && !/[^\r]\n/.test(data), 'newlines are CRLF for xterm');
  assert.equal(terms.kill(id), true);
  assert.equal(stopped, true);
  assert.equal(terms.kill(id), false);
});
