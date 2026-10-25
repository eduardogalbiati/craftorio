// Who runs a run (#112): runs/<id>/owner.json holds the pid, host and a heartbeat refreshed every
// few seconds by the process that runs it, and is removed when the run ends. A run without
// summary.json is "running" (maybe in another app process) while its owner is alive, and only
// "interrupted" once the owner is gone (dead pid on this host, or a stale heartbeat).
// Also the workspace lock (<workspace>/.lock, same shape): one app process per workspace, and
// hold() for other one-process records (the Oracle's owner.json, src/domains/oracle/oracle.js).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { keepBeating } = require('./domains/session/app-sessions');

const HEARTBEAT_MS = 5000;
// a heartbeat older than this means the owner is gone (a suspended laptop catches up on wake)
const STALE_MS = 30000;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Whether the owner record ({ pid, host, heartbeat_at }) is a live process. */
function ownerAlive(owner, now = Date.now()) {
  if (!owner) return false;
  const beat = Date.parse(owner.heartbeat_at || '');
  if (!Number.isFinite(beat) || now - beat > STALE_MS) return false;
  // on this machine the pid decides at once; on another one (a shared folder) the heartbeat does
  return owner.host !== os.hostname() || pidAlive(owner.pid);
}

const record = (extra = {}) => ({ pid: process.pid, host: os.hostname(), started_at: new Date().toISOString(), ...extra, heartbeat_at: new Date().toISOString() });

function write(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch { /* the folder went away */ }
}

// Writes the record now and refreshes its heartbeat until release(); the timer never keeps the
// process alive.
function hold(file, extra) {
  let data = record(extra);
  write(file, data);
  const timer = setInterval(() => { data = { ...data, heartbeat_at: new Date().toISOString() }; write(file, data); }, HEARTBEAT_MS);
  timer.unref?.();
  return {
    file,
    release() {
      clearInterval(timer);
      // only our own record: a process that took over a stale one keeps it
      if (readJson(file)?.pid === process.pid) { try { fs.unlinkSync(file); } catch { /* gone */ } }
    },
  };
}

const ownerFile = (runDir) => path.join(runDir, 'owner.json');

/** The owner of a run folder, or null. */
const readOwner = (runDir) => readJson(ownerFile(runDir));

/** Marks this process as the owner of a run; returns { release }. */
function claimRun(runDir) {
  fs.mkdirSync(runDir, { recursive: true });
  return hold(ownerFile(runDir));
}

/** Whether another live process owns the run (this process's own runs are known by the service). */
function runOwnedElsewhere(runDir) {
  const owner = readOwner(runDir);
  return !!owner && owner.pid !== process.pid && ownerAlive(owner);
}

const lockFile = (workspace) => path.join(workspace, '.lock');

/**
 * Takes the workspace lock: { ok: true, release } or { ok: false, holder } when another live
 * process holds it. A stale lock (dead pid, old heartbeat) is taken over.
 */
function lockWorkspace(workspace, extra = {}) {
  fs.mkdirSync(workspace, { recursive: true });
  const file = lockFile(workspace);
  // the lock's holder also keeps the app's heartbeat log (the 24/7 meter's "app closed" time, #188)
  const held = () => {
    const h = hold(file, extra);
    const beats = keepBeating(workspace);
    return { ok: true, ...h, release() { beats.stop(); h.release(); } };
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(record(extra), null, 2), { flag: 'wx' });
      return held();
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = readJson(file);
      if (holder?.pid === process.pid) return held();
      if (holder && ownerAlive(holder)) return { ok: false, holder };
      try { fs.unlinkSync(file); } catch { /* another process took it over first */ }
    }
  }
  return { ok: false, holder: readJson(file) };
}

module.exports = {
  claimRun,
  HEARTBEAT_MS,
  hold,
  lockWorkspace,
  ownerAlive,
  pidAlive,
  readOwner,
  runOwnedElsewhere,
  STALE_MS,
};
