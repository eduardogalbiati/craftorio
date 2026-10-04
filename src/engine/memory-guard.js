// Memory guard (#276): stops a run's runaway process before it exhausts the machine.
//
// A test, a build or a script an agent (or a `suite` / `e2e` step) starts can take all the machine's
// memory in about a minute; every other run then fails on errors unrelated to its change. While a
// run's process is watched, the guard samples the process list every few seconds and stops (with its
// children) any descendant of the watched root over the per-process limit. Never stopped: the app, the
// watched root itself (an agent CLI: its turn would be lost, it is only reported), the protected pids
// and anything outside the watched tree (the owner's programs, the embedded terminals).
//
// What a process's size is: on Windows its committed (private) bytes, since the working set stays
// low while the commit passes 70 GB; elsewhere its resident memory. Free memory: Windows' free
// commit, elsewhere the available memory.
//
// Sampling never starts a process per sample (when memory is gone, a new `git` cannot even start):
// Windows uses one long-lived PowerShell helper started with the first sample, macOS one long-lived
// `sh` loop around `ps`, Linux reads /proc. If sampling fails, the watch is told once that the guard
// is off and the run goes on.
//
// The guard also records incidents (a stop, a low-memory wait) so the suite step can tell an
// environment failure from the change's own failure (incidentsBetween), and holds suites and new
// runs while free memory is under the floor (waitForMemory, memoryProblem).

const fs = require('fs');
const os = require('os');
const cp = require('child_process');

const GB = 1024 ** 3;
const gb = (bytes) => (bytes / GB).toFixed(1);
const MAX_COMMAND = 300;
const REQUEST_TIMEOUT_MS = 30e3;
const MAX_INCIDENTS = 500;

/** '' or the reason a new real run cannot start now (like slotProblem in src/service/areas/runs.js). */
function memoryProblem({ freeBytes, floorBytes }) {
  if (!(floorBytes > 0) || !(freeBytes < floorBytes)) return '';
  return `Low memory: ${gb(freeBytes)} GB free, under the memory guard's floor of ${gb(floorBytes)} GB (Settings › Execution); it starts when memory recovers`;
}

// --- the real sampler ------------------------------------------------------------------------------

const WIN_HELPER = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($null -eq $l) { break }
  try {
    if ($l -eq 'm') {
      $o = Get-CimInstance -ClassName Win32_OperatingSystem -Property FreeVirtualMemory,TotalVirtualMemorySize
      [Console]::Out.WriteLine('M|' + $o.FreeVirtualMemory + '|' + $o.TotalVirtualMemorySize)
    } else {
      $sb = New-Object System.Text.StringBuilder
      foreach ($p in Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,PrivatePageCount,CommandLine) {
        [void]$sb.Append('P|').Append($p.ProcessId).Append('|').Append($p.ParentProcessId).Append('|').Append($p.PrivatePageCount).Append('|').AppendLine(($p.CommandLine -replace '[\\r\\n]+', ' '))
      }
      [Console]::Out.Write($sb.ToString())
    }
  } catch { [Console]::Out.WriteLine('E|' + ($_.Exception.Message -replace '[\\r\\n]+', ' ')) }
  [Console]::Out.WriteLine('END')
  [Console]::Out.Flush()
}
`;

const MAC_HELPER = 'while read l; do ps -axo pid=,ppid=,rss=,args=; echo END; done';

// One long-lived child answering requests (one line in, lines out up to "END"), one at a time.
function lineHelper(file, args) {
  let child = null;
  let buf = '';
  let current = null; // { lines, resolve, reject, timer }
  let chain = Promise.resolve();
  const fail = (err) => {
    const c = current;
    current = null;
    if (c) { clearTimeout(c.timer); c.reject(err); }
  };
  const start = () => {
    child = cp.spawn(file, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    child.unref();
    for (const s of [child.stdin, child.stdout]) s.unref?.();
    child.on('error', (e) => { child = null; fail(e); });
    child.on('exit', () => { child = null; fail(new Error('the memory sampler exited')); });
    child.stdin.on('error', () => {});
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (!current) continue;
        if (line === 'END') { const c = current; current = null; clearTimeout(c.timer); c.resolve(c.lines); } else current.lines.push(line);
      }
    });
  };
  const request = (cmd) => new Promise((resolve, reject) => {
    if (!child) { buf = ''; start(); }
    current = { lines: [], resolve, reject, timer: setTimeout(() => { fail(new Error('the memory sampler did not answer')); close(); }, REQUEST_TIMEOUT_MS) };
    current.timer.unref?.();
    child.stdin.write(`${cmd}\n`);
  });
  const ask = (cmd) => {
    const p = chain.then(() => request(cmd));
    chain = p.catch(() => {});
    return p;
  };
  const close = () => { if (child) { try { child.kill(); } catch { /* gone */ } child = null; } };
  return { ask, close };
}

const cut = (s) => String(s || '').slice(0, MAX_COMMAND);

function linuxSample() {
  const page = 4096;
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map((d) => {
    const stat = read(`/proc/${d}/stat`);
    const statm = read(`/proc/${d}/statm`);
    if (!stat || !statm) return null;
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid: +d, ppid: +f[1], bytes: (+statm.split(' ')[1] || 0) * page, commandLine: String(read(`/proc/${d}/cmdline`) || '').split('\0').join(' ').trim() };
  }).filter(Boolean);
}

function linuxFree() {
  const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
  return { freeBytes: m ? +m[1] * 1024 : os.freemem(), totalBytes: os.totalmem() };
}

function realProbe() {
  if (process.platform === 'linux') return { sample: async () => linuxSample(), free: async () => linuxFree(), close() {} };
  if (process.platform === 'win32') {
    const helper = lineHelper('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WIN_HELPER, 'utf16le').toString('base64')]);
    const answer = (lines) => {
      const err = lines.find((l) => l.startsWith('E|'));
      if (err) throw new Error(err.slice(2));
      return lines;
    };
    return {
      sample: async () => answer(await helper.ask('p')).filter((l) => l.startsWith('P|')).map((l) => {
        const [, pid, ppid, bytes, ...cmd] = l.split('|');
        return { pid: +pid, ppid: +ppid, bytes: +bytes || 0, commandLine: cmd.join('|') };
      }),
      free: async () => {
        const m = answer(await helper.ask('m')).find((l) => l.startsWith('M|'));
        if (!m) throw new Error('no free memory reading');
        const [, free, total] = m.split('|');
        return { freeBytes: +free * 1024, totalBytes: +total * 1024 };
      },
      close: helper.close,
    };
  }
  const helper = lineHelper('/bin/sh', ['-c', MAC_HELPER]);
  return {
    sample: async () => (await helper.ask('p')).map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
      .map((m) => ({ pid: +m[1], ppid: +m[2], bytes: +m[3] * 1024, commandLine: m[4].trim() })),
    free: async () => ({ freeBytes: os.freemem(), totalBytes: os.totalmem() }),
    close: helper.close,
  };
}

// Stops `pid` and its descendants (from the last sample) without starting a process.
function killProcess(pid, descendants = []) {
  for (const p of [pid, ...descendants]) {
    try { process.kill(p, 'SIGKILL'); } catch { /* already gone */ }
  }
}

// --- the guard -------------------------------------------------------------------------------------

/**
 * @param {object} [o]
 * @param {number} [o.limitBytes]  per-process limit (default 25% of the RAM)
 * @param {number} [o.floorBytes]  free-memory floor for the hold (default 10% of the RAM; 0 = no hold)
 * @param {number} [o.intervalMs]  sampling period while something is watched
 * @param {Function} [o.sampler]   async () => [{ pid, ppid, commandLine, bytes }]
 * @param {Function} [o.freeMemory] async () => ({ freeBytes, totalBytes })
 * @param {Function} [o.kill]      (pid, descendants) => void: stops a process with its children
 * @param {Function} [o.now]       () => ms (the incidents' times)
 */
function createMemoryGuard({ limitBytes, floorBytes, intervalMs = 5000, sampler, freeMemory, kill = killProcess, now = Date.now } = {}) {
  const total = os.totalmem();
  let limit = limitBytes ?? Math.round(total * 0.25);
  let floor = floorBytes ?? Math.round(total * 0.10);
  let probe = null;
  const real = () => (probe ??= realProbe());
  const sample = sampler || (() => real().sample());
  const readFree = freeMemory || (() => real().free());
  const watches = new Set();
  const incidents = [];
  let timer = null;
  let ticking = null;

  const record = (incident) => {
    incidents.push(incident);
    if (incidents.length > MAX_INCIDENTS) incidents.shift();
    return incident;
  };

  const startTimer = () => {
    if (timer || !watches.size) return;
    timer = setInterval(() => { guard.tick(); }, intervalMs);
    timer.unref?.();
  };
  const stopTimer = () => { if (timer && !watches.size) { clearInterval(timer); timer = null; } };

  async function pass() {
    if (!watches.size) return;
    let procs;
    try {
      procs = await sample();
    } catch (e) {
      for (const w of watches) {
        if (w.warned) continue;
        w.warned = true;
        w.onLog?.({ level: 'warn', message: `The memory guard is off for this step: the processes could not be sampled (${e?.message || e}).` });
      }
      return;
    }
    const children = new Map();
    for (const p of procs) if (p.ppid !== p.pid) children.set(p.ppid, [...(children.get(p.ppid) || []), p]);
    const subtree = (pid) => {
      const out = [];
      const seen = new Set([pid]);
      for (let queue = [pid]; queue.length;) {
        for (const c of children.get(queue.shift()) || []) if (!seen.has(c.pid)) { seen.add(c.pid); out.push(c); queue.push(c.pid); }
      }
      return out;
    };
    const stopped = new Set();
    for (const w of [...watches]) {
      if (!watches.has(w)) continue;
      const event = (p) => ({ pid: p.pid, commandLine: cut(p.commandLine), bytes: p.bytes, limitBytes: limit, step: w.step, session: w.session });
      // the root's children are the CLI itself when the root is a .cmd shim (protectChildren)
      const tree = subtree(w.rootPid);
      const cli = w.protectChildren ? tree.filter((p) => p.ppid === w.rootPid).map((p) => p.pid) : [];
      const spared = new Set([...w.protectedPids, ...cli]);
      const root = procs.find((p) => p.pid === w.rootPid);
      for (const p of [root, ...procs.filter((x) => spared.has(x.pid))]) {
        if (p && p.bytes > limit && !w.reported.has(p.pid)) { w.reported.add(p.pid); w.onReport?.(event(p)); }
      }
      for (const p of tree) {
        if (!(p.bytes > limit) || stopped.has(p.pid) || p.pid === process.pid || spared.has(p.pid)) continue;
        stopped.add(p.pid);
        try { await kill(p.pid, subtree(p.pid).map((c) => c.pid)); } catch { /* reported below anyway */ }
        const ev = event(p);
        record({ kind: 'stop', at: now(), ...ev });
        w.onKill?.(ev);
      }
    }
  }

  const delay = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });
  const free = async () => { try { return await readFree(); } catch { return null; } };

  const guard = {
    get limitBytes() { return limit; },
    get floorBytes() { return floor; },
    configure({ limitBytes: l, floorBytes: f } = {}) {
      if (l > 0) limit = l;
      if (f >= 0) floor = f;
    },
    // protectChildren: the root is a .cmd/.bat shim, its children are the agent CLI (only reported too)
    watch({ rootPid, protectedPids = [], protectChildren = false, step = null, session = null, onKill, onReport, onLog } = {}) {
      if (!rootPid) return { stop() {} };
      const w = { rootPid, protectedPids: new Set(protectedPids), protectChildren, step, session, onKill, onReport, onLog, reported: new Set(), warned: false };
      watches.add(w);
      startTimer();
      return { stop: () => { watches.delete(w); stopTimer(); } };
    },
    tick() {
      ticking ??= pass().finally(() => { ticking = null; });
      return ticking;
    },
    /** The machine's free memory ({ freeBytes, totalBytes }) or null when it cannot be read. */
    freeMemory: free,
    async waitForMemory({ maxWaitMs = 600e3, onWait } = {}) {
      if (!(floor > 0)) return { recovered: true, waitedMs: 0 };
      let r = await free();
      if (!r || r.freeBytes >= floor) return { recovered: true, waitedMs: 0 };
      onWait?.({ freeBytes: r.freeBytes, totalBytes: r.totalBytes, floorBytes: floor });
      const t0 = Date.now();
      const low = record({ kind: 'low_memory', start: now(), end: now() });
      for (;;) {
        await delay(Math.min(intervalMs, Math.max(1, maxWaitMs - (Date.now() - t0))));
        r = await free();
        low.end = now();
        const waitedMs = Date.now() - t0;
        if (!r || r.freeBytes >= floor) return { recovered: true, waitedMs };
        if (waitedMs >= maxWaitMs) return { recovered: false, waitedMs };
      }
    },
    incidentsBetween(startMs, endMs) {
      return incidents.filter((i) => (i.kind === 'stop' ? i.at >= startMs && i.at <= endMs : i.start <= endMs && i.end >= startMs)).map((i) => ({ ...i }));
    },
    close() {
      watches.clear();
      if (timer) { clearInterval(timer); timer = null; }
      probe?.close();
      probe = null;
    },
  };
  return guard;
}

// The app's guard for real runs (src/engine/workflow.js), configured from Settings › Execution
// (workspace settings `memoryGuard`); null when the owner turned it off. Created on first use; it
// starts nothing until a real process is watched.
let shared = null;
let sharedSettings = { enabled: true, limitPercent: 25, floorPercent: 10 };

function configureMemoryGuard(settings = {}) {
  sharedSettings = { ...sharedSettings, ...settings };
  if (shared) shared.configure(bytesOf(sharedSettings));
}

const bytesOf = ({ limitPercent, floorPercent }) => ({
  limitBytes: Math.round(os.totalmem() * (Number(limitPercent) || 25) / 100),
  floorBytes: Math.round(os.totalmem() * Math.max(0, Number(floorPercent) || 0) / 100),
});

function sharedMemoryGuard() {
  if (sharedSettings.enabled === false) return null;
  shared ??= createMemoryGuard(bytesOf(sharedSettings));
  return shared;
}

module.exports = {
  configureMemoryGuard,
  createMemoryGuard,
  memoryProblem,
  sharedMemoryGuard,
};
