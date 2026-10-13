// #333: every service channel survives hostile arguments. The sweep enumerates the manifest (no
// hand-written list: a new channel is swept automatically) and calls each channel's function in a
// scratch workspace (MULTIAGENT_SIMULATION_ONLY=1) with a fixed set of hostile values: the whole
// argument hostile, then each named parameter hostile on its own (missing, null, a number, an array,
// an object, '', '../../outside', an absolute path outside the workspace, a 1 MB string, an object
// with a __proto__ key). Each call has a time limit (4 s).
// It passes when every call returns a value or rejects with an Error whose message names the
// problem (never a raw "Cannot read properties of undefined"), no call blocks the process, no file
// outside the scratch workspace is created or changed, nothing is trashed outside it, and no
// unhandled rejection or uncaught exception happens during the sweep. The channels it skips are
// listed, each with why, in test/service/channel-sweep-skips.js (pattern: storytold/photocraft's
// panic_hunt). The calls run in test/service/channel-sweep-runner.js, a child process: a call that
// blocks the event loop is killed by the watchdog here, reported, and the sweep goes on from the
// next channel.
// Seams: createService's manifest, api and notifications (src/service/index.js), through the runner.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createService } = require('../../src/service');
const SKIPS = require('../service/channel-sweep-skips');

const RUNNER = path.join(__dirname, '..', 'service', 'channel-sweep-runner.js');
const BLOCKED_MS = 15000; // no output for this long: the call in progress blocks the process
const MAX_RESTARTS = 40;

// A scratch layout: base/a/b/workspace is the workspace; sentinel folders sit next to it at each
// level a '../..' could reach, and one more is the absolute path outside the workspace.
function scratch(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-333-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
  const wsDir = path.join(base, 'a', 'b', 'workspace');
  fs.mkdirSync(wsDir, { recursive: true });
  for (const dir of [path.join(base, 'outside'), path.join(base, 'a', 'outside'), path.join(base, 'a', 'b', 'outside'), path.join(base, 'outside-abs')]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sentinel.txt'), 'do not touch\n');
  }
  return { base, wsDir, outsideAbs: path.join(base, 'outside-abs') };
}

// Every file and folder under base except the workspace, with a hash of each file's content.
function snapshot(base, wsDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (full === wsDir) continue;
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (fs.statSync(full).isDirectory()) { out.push(`${rel}/`); walk(full); } else out.push(`${rel} ${crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex')}`);
    }
  };
  walk(base);
  return out;
}

// One runner process from channel index `from`: resolves with its events and how it ended.
function runSegment(wsDir, outsideAbs, from) {
  return new Promise((resolve) => {
    const events = [];
    const child = spawn(process.execPath, [RUNNER, wsDir, outsideAbs, String(from)], {
      env: { ...process.env, MULTIAGENT_SIMULATION_ONLY: '1' },
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let buffer = '';
    let blocked = false;
    let watchdog;
    const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => { blocked = true; child.kill(); }, BLOCKED_MS); };
    arm();
    child.stdout.on('data', (chunk) => {
      arm();
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try { events.push(JSON.parse(line)); } catch { /* a stray line from a channel */ }
      }
    });
    child.on('close', (code) => { clearTimeout(watchdog); resolve({ events, blocked, code }); });
  });
}

test('#333 every skipped channel is in the manifest and says why', () => {
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  try {
    const names = service.manifest.map((e) => e.channel || e.send).filter(Boolean);
    const problems = [];
    for (const s of SKIPS) {
      if (typeof s.reason !== 'string' || s.reason.trim().length < 10) problems.push(`${s.channel}: no reason`);
      const matches = s.channel.endsWith(':*') ? names.some((n) => n.startsWith(s.channel.slice(0, -1))) : names.includes(s.channel);
      if (!matches) problems.push(`${s.channel}: no such channel in the manifest`);
    }
    assert.deepEqual(problems, []);
  } finally { service.shutdown(); }
});

test('#333 every channel of the manifest survives hostile arguments: an answer or a named error, nothing written outside the workspace, no unhandled rejection', { timeout: 20 * 60 * 1000 }, async (t) => {
  const { base, wsDir, outsideAbs } = scratch(t);
  const cwdOutside = path.resolve(process.cwd(), '../../outside');
  const cwdOutsideExisted = fs.existsSync(cwdOutside);
  const before = snapshot(base, wsDir);

  const problems = [];
  const unhandled = [];
  const trashed = [];
  const swept = new Set();
  let done = null;
  let from = 0;
  for (let restarts = 0; restarts <= MAX_RESTARTS && !done; restarts++) {
    const { events, blocked, code } = await runSegment(wsDir, outsideAbs, from);
    let last = null;
    for (const ev of events) {
      if (ev.type === 'call') { last = ev; swept.add(ev.name); }
      if (ev.type === 'problem') problems.push(ev.text);
      if (ev.type === 'unhandled') unhandled.push(ev.text);
      if (ev.type === 'trashed') trashed.push(ev.path);
      if (ev.type === 'done') done = ev;
    }
    if (done) break;
    const where = last ? `${last.name} (${last.label})` : `the start of the sweep (channel #${from})`;
    problems.push(blocked ? `${where}: blocks the process (no answer for ${BLOCKED_MS / 1000} s)` : `${where}: the process ended (exit code ${code})`);
    if (!last) break;
    from = last.index + 1;
  }

  assert.deepEqual(problems, []);
  assert.deepEqual(unhandled, []);
  assert.equal(done === null, false, 'the sweep reached the end of the manifest');
  assert.ok(swept.size >= 150, `the sweep enumerates the manifest (${swept.size} channels swept)`);
  assert.deepEqual(snapshot(base, wsDir), before, 'nothing created or changed outside the scratch workspace');
  if (!cwdOutsideExisted) assert.equal(fs.existsSync(cwdOutside), false, `${cwdOutside} was created`);
  const wsRoot = path.resolve(wsDir) + path.sep;
  assert.deepEqual(trashed.filter((p) => !path.resolve(p).startsWith(wsRoot)), [], 'nothing trashed outside the workspace');
  assert.equal(done.relaunched, 0, 'the app was not relaunched');
  assert.equal(done.polluted, false, 'no prototype pollution');
});
