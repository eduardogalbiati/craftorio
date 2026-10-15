// Machine profile (#367): sizes the concurrent runs and the test workers per run from this machine,
// shown with its reasons (Settings › Execution › Concurrent runs, the Setup) and always overridable.
// Pure apart from readMachine reading `os` (an os-like object can be given).
// - readMachine(osLike) → { threads, totalBytes, freeBytes, platform }, null for a value it cannot read;
// - machineWorkers(threads): the test workers this machine runs at once, all runs together;
// - proposeLimits(machine) → { concurrentRuns, testWorkers } or null (machine unknown);
// - resolveLimits(settings, machine) → { state: auto | manual | unknown, concurrentRuns, testWorkers,
//   machine, proposal }: settings.machineProfile { mode, concurrentRuns, testWorkers }, manual always wins;
// - machineLine(resolved): the one line Settings and the Setup show;
// - suggestFromMemoryGuard(events, { now, concurrentRuns, timeZone }): one run fewer when the memory
//   guard (#276) held or stopped runs on 2+ days of the last 7, with the days and runs; null otherwise.
//   It only suggests: Settings applies it on the owner's click;
// - workerEnv({ testWorkers }): what every run's agents and suite receive (src/engine/capabilities.js
//   agentEnv, src/engine/suite-step.js suiteEnv). Never touches the memory guard's own limits.

const os = require('os');
// the shared module itself (not ./time-zone): the engine requires this file (scripts/layers.js utility)
const TimeZone = require('./shared/time-zone');

const GIB = 1024 ** 3;
const DAY_MS = 864e5;

// The formula's numbers (#367), in one place:
//   concurrent runs = clamp(MIN_RUNS, MAX_RUNS, min(floor(threads / THREADS_PER_RUN), floor(GB / GB_PER_RUN)))
//   test workers per run = max(1, floor(machineWorkers(threads) / concurrent runs))
// Measured: this repository's E2E suite keeps about 4 threads busy and stays under 1 GB per Electron
// worker (#366); a run adds its agent CLI, node and the worktree's tooling, hence 4 threads and 6 GB
// per run. Past 6 runs at once the memory guard (#276) is the limit, not this profile.
const CONSTANTS = Object.freeze({
  THREADS_PER_RUN: 4,
  GB_PER_RUN: 6,
  MIN_RUNS: 1,
  MAX_RUNS: 6,
  // one test worker (an E2E Electron worker, the heaviest kind) keeps about 4 threads busy (#366)
  THREADS_PER_WORKER: 4,
  // the values used when the machine cannot be read: today's defaults (concurrentRuns.max, E2E workers)
  UNKNOWN_RUNS: 2,
  UNKNOWN_TEST_WORKERS: 2,
  // the memory guard's suggestion: events of the last DAYS days, on at least MIN_DAYS distinct days
  SUGGEST_DAYS: 7,
  SUGGEST_MIN_DAYS: 2,
});

// the memory guard's events in a run's events.jsonl: a suite held for memory, a process stopped
const MEMORY_EVENTS = new Set(['memory.hold', 'process.killed']);

const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const tryRead = (fn) => { try { return fn(); } catch { return null; } };
const posInt = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? n : null; };

function readMachine(osLike = os) {
  const parallel = typeof osLike.availableParallelism === 'function' ? positive(tryRead(() => osLike.availableParallelism())) : null;
  const threads = parallel || positive(tryRead(() => osLike.cpus().length));
  const platform = tryRead(() => osLike.platform());
  return {
    threads,
    totalBytes: positive(tryRead(() => osLike.totalmem())),
    freeBytes: positive(tryRead(() => osLike.freemem())),
    platform: typeof platform === 'string' && platform ? platform : null,
  };
}

function machineWorkers(threads) {
  const t = posInt(threads) || 1;
  return Math.min(t, Math.max(1, Math.floor(t / CONSTANTS.THREADS_PER_WORKER)));
}

function proposeLimits(machine) {
  const threads = positive(machine?.threads);
  const totalBytes = positive(machine?.totalBytes);
  if (!threads || !totalBytes) return null;
  const byThreads = Math.floor(threads / CONSTANTS.THREADS_PER_RUN);
  const byMemory = Math.floor(totalBytes / GIB / CONSTANTS.GB_PER_RUN);
  const concurrentRuns = Math.min(CONSTANTS.MAX_RUNS, Math.max(CONSTANTS.MIN_RUNS, Math.min(byThreads, byMemory)));
  return { concurrentRuns, testWorkers: Math.max(1, Math.floor(machineWorkers(threads) / concurrentRuns)) };
}

function resolveLimits(settings, machine) {
  const proposal = proposeLimits(machine);
  const fallback = proposal || { concurrentRuns: CONSTANTS.UNKNOWN_RUNS, testWorkers: CONSTANTS.UNKNOWN_TEST_WORKERS };
  const mp = settings?.machineProfile || {};
  if (mp.mode === 'manual') {
    const concurrentRuns = posInt(mp.concurrentRuns) || posInt(settings?.concurrentRuns?.max) || fallback.concurrentRuns;
    // manual runs without manual workers: the machine's workers shared by those runs
    const testWorkers = posInt(mp.testWorkers) || (proposal ? Math.max(1, Math.floor(machineWorkers(machine.threads) / concurrentRuns)) : fallback.testWorkers);
    return { state: 'manual', concurrentRuns, testWorkers, machine, proposal };
  }
  return { state: proposal ? 'auto' : 'unknown', ...fallback, machine, proposal };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function machineLine(resolved) {
  const p = resolved?.proposal;
  const m = resolved?.machine;
  if (!p || !m) {
    const runs = resolved?.concurrentRuns || CONSTANTS.UNKNOWN_RUNS;
    const workers = resolved?.testWorkers || CONSTANTS.UNKNOWN_TEST_WORKERS;
    return `This machine's threads and memory couldn't be read: ${plural(runs, 'run')} at once, ${plural(workers, 'test worker')} per run.`;
  }
  return `This machine: ${m.threads} threads, ${Math.round(m.totalBytes / GIB)} GB → up to ${plural(p.concurrentRuns, 'run')} at once, ${plural(p.testWorkers, 'test worker')} per run`;
}

function suggestFromMemoryGuard(events, { now = Date.now(), concurrentRuns, timeZone } = {}) {
  const runs = posInt(concurrentRuns);
  if (!runs || runs <= 1) return null;
  const from = now - CONSTANTS.SUGGEST_DAYS * DAY_MS;
  const days = new Set();
  const runIds = new Set();
  for (const e of events || []) {
    if (!e || !MEMORY_EVENTS.has(e.type)) continue;
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t) || t <= from || t > now) continue;
    days.add(TimeZone.dayKey(t, timeZone));
    if (e.run_id) runIds.add(String(e.run_id));
  }
  if (days.size < CONSTANTS.SUGGEST_MIN_DAYS) return null;
  return { days: [...days].sort(), runs: [...runIds].sort(), concurrentRuns: runs - 1 };
}

function workerEnv({ testWorkers } = {}) {
  const n = String(posInt(testWorkers) || 1);
  return { MULTIAGENT_TEST_WORKERS: n, MULTIAGENT_E2E_WORKERS: n };
}

module.exports = {
  CONSTANTS,
  machineLine,
  machineWorkers,
  proposeLimits,
  readMachine,
  resolveLimits,
  suggestFromMemoryGuard,
  workerEnv,
};
