// Machine-wide slots (#199): at most one holder of a named slot at once across every run, app and
// agent on this machine. Used for Electron screenshots: several runs in parallel each starting the
// app (the `type: screenshots` step, the evidence agent's and the test writer's `npm run
// screenshot`) made the machine stop responding. The others wait.
//
// A slot is a file <dir>/<name>.slot created exclusively, holding { pid, host, token, started,
// holder }. It is freed by its holder (release), or taken over when its process is gone (same host)
// or it is older than maxHoldMs (a holder that hung). dir: MULTIAGENT_LOCKS_DIR, else the OS temp
// folder (shared by every workspace and every run's scratch workspace on this machine).
// A child process started by the holder (the screenshots step runs `npm run screenshot`) inherits
// the slot: the holder passes its token in SCREENSHOT_SLOT_ENV, and the child does not wait for it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SCREENSHOT_SLOT = 'screenshot';
const SCREENSHOT_SLOT_ENV = 'MULTIAGENT_SCREENSHOT_SLOT';
const MAX_HOLD_MS = 15 * 60e3;
const WAIT_MS = 20 * 60e3;

const slotDir = () => process.env.MULTIAGENT_LOCKS_DIR || path.join(os.tmpdir(), 'multiagent-orchestrator', 'locks');
const slotFile = (name, dir = slotDir()) => path.join(dir, `${name}.slot`);

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const readSlot = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/** Who holds the slot now ({ pid, host, token, started, holder }), null when it is free (a stale holder is removed). */
function slotHolder(name, { dir = slotDir(), maxHoldMs = MAX_HOLD_MS } = {}) {
  const file = slotFile(name, dir);
  if (!fs.existsSync(file)) return null;
  const held = readSlot(file);
  let mtime = Date.now();
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  const stale = !held
    ? Date.now() - mtime > 10e3 // unreadable for a while: a half-written file
    : (held.host === os.hostname() && !pidAlive(held.pid)) || Date.now() - held.started > maxHoldMs;
  if (!stale) return held || { pid: null };
  try { fs.unlinkSync(file); } catch { /* another waiter removed it */ }
  return null;
}

// One try: { release, token } when taken, { held } when someone else has it
function tryTake(name, { dir = slotDir(), maxHoldMs = MAX_HOLD_MS, holder = '', inherit = process.env[SCREENSHOT_SLOT_ENV] } = {}) {
  const file = slotFile(name, dir);
  const current = slotHolder(name, { dir, maxHoldMs });
  // the slot of the process that started this one
  if (current && inherit && current.token === inherit) return { release: () => {}, token: inherit, inherited: true };
  if (current) return { held: current };
  fs.mkdirSync(dir, { recursive: true });
  const token = crypto.randomBytes(8).toString('hex');
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, host: os.hostname(), token, started: Date.now(), holder }), { flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') return { held: readSlot(file) || { pid: null } };
    throw e;
  }
  const release = () => { if (readSlot(file)?.token === token) { try { fs.unlinkSync(file); } catch { /* gone */ } } };
  return { release, token };
}

/**
 * Waits for the slot and takes it → { release, token, waitedMs, inherited }. onWait(holder) is
 * called once when it has to wait. Throws after waitMs or when the signal aborts.
 */
async function acquireSlot(name, { dir, waitMs = WAIT_MS, pollMs = 1000, signal, onWait = () => {}, holder, maxHoldMs, inherit } = {}) {
  const t0 = Date.now();
  let told = false;
  for (;;) {
    const r = tryTake(name, { dir, holder, maxHoldMs, inherit });
    if (r.release) return { ...r, waitedMs: Date.now() - t0 };
    if (!told) { onWait(r.held); told = true; }
    if (signal?.aborted) throw new Error('Cancelled');
    if (Date.now() - t0 > waitMs) throw new Error(`the ${name} slot is still held by pid ${r.held?.pid ?? '?'} after ${Math.round(waitMs / 1000)} s`);
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

/** acquireSlot for a process that has nothing else to do while it waits (scripts/screenshot.js). */
function acquireSlotSync(name, { dir, waitMs = WAIT_MS, pollMs = 1000, onWait = () => {}, holder, maxHoldMs, inherit } = {}) {
  const t0 = Date.now();
  const nap = new Int32Array(new SharedArrayBuffer(4));
  let told = false;
  for (;;) {
    const r = tryTake(name, { dir, holder, maxHoldMs, inherit });
    if (r.release) return { ...r, waitedMs: Date.now() - t0 };
    if (!told) { onWait(r.held); told = true; }
    if (Date.now() - t0 > waitMs) throw new Error(`the ${name} slot is still held by pid ${r.held?.pid ?? '?'} after ${Math.round(waitMs / 1000)} s`);
    Atomics.wait(nap, 0, 0, pollMs);
  }
}

module.exports = {
  acquireSlot,
  acquireSlotSync,
  MAX_HOLD_MS,
  SCREENSHOT_SLOT,
  SCREENSHOT_SLOT_ENV,
  slotDir,
  slotFile,
  slotHolder,
};
