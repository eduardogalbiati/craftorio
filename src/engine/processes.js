// Processes an agent left running inside the run's worktree.
//
// An agent can start a program from the worktree and not wait for it: a UI check with the
// worktree's own Electron (node_modules/electron/dist/electron.exe), a dev server, a watcher.
// If its session ends (or the agent stops it the wrong way, e.g. killing only `npx`), the
// program keeps running and holds files of the worktree: every later `npm ci` fails with
// EBUSY/EPERM and no agent can fix it (unattended agents may not list or stop processes, and
// stopping electron.exe by name would also close the user's app). So the engine stops them
// itself after each agent step and when the run ends.
//
// What is stopped: processes whose executable is inside the folder (every platform) or, on
// Linux/macOS, whose working directory is (Windows does not expose another process's working
// directory cheaply), with their whole process tree. Never touched: this process, its ancestors
// and its descendants (e.g. the app's embedded terminals), and, for the working-directory match,
// processes with a terminal (a shell the user opened there). Nothing outside the folder is
// matched, so the user's app and other runs are safe.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { canonicalPath } = require('./worktree');

const LIST_TIMEOUT_MS = 30e3;

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: LIST_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
    resolve(err && !stdout ? null : String(stdout));
  });
});

// Win32_Process gives the executable path, not the working directory. UTF-8 output: user
// folders may have non-ASCII names.
const WIN_LIST = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,ExecutablePath | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId,$_.ParentProcessId,$_.ExecutablePath }";

async function listWindows() {
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_LIST]);
  if (out == null) throw new Error('could not list processes (Get-CimInstance Win32_Process)');
  return out.split(/\r?\n/).map((l) => l.trim().split('|')).filter((f) => f.length >= 3 && /^\d+$/.test(f[0]))
    .map(([pid, ppid, ...exe]) => ({ pid: +pid, ppid: +ppid, exe: exe.join('|') || null, cwd: null, tty: false }));
}

function listLinux() {
  const read = (fn) => { try { return fn(); } catch { return null; } };
  return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map((d) => {
    const stat = read(() => fs.readFileSync(`/proc/${d}/stat`, 'utf8'));
    if (!stat) return null;
    // after the command name "(...)": state ppid pgrp session tty_nr ...
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return {
      pid: +d, ppid: +f[1], tty: +f[4] !== 0,
      exe: read(() => fs.readlinkSync(`/proc/${d}/exe`)), cwd: read(() => fs.readlinkSync(`/proc/${d}/cwd`)),
    };
  }).filter(Boolean);
}

async function listMac() {
  const out = await run('ps', ['-axo', 'pid=,ppid=,tty=,comm=']);
  if (out == null) throw new Error('could not list processes (ps)');
  const procs = out.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], tty: m[3] !== '??', exe: m[4].trim() || null, cwd: null }));
  // working directories: lsof -F prints "p<pid>", "fcwd", "n<path>" per process
  const cwd = await run('lsof', ['-nP', '-d', 'cwd', '-Fpn']);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  let cur = null;
  for (const l of String(cwd || '').split('\n')) {
    if (l[0] === 'p') cur = byPid.get(+l.slice(1));
    else if (l[0] === 'n' && cur) cur.cwd = l.slice(1);
  }
  return procs;
}

/** Every process: [{ pid, ppid, exe, cwd, tty }] (exe/cwd null when unknown). */
function listProcesses() {
  if (process.platform === 'win32') return listWindows();
  if (process.platform === 'linux') return Promise.resolve(listLinux());
  return listMac();
}

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

/**
 * The processes to stop for `dir`, from a process list (pure: no process is touched).
 * @param {object[]} procs  [{ pid, ppid, exe, cwd, tty }]
 * @param {string} dir      the worktree
 * @param {object} [o]
 * @param {number} [o.self] pid to protect with its ancestors and descendants (default: this process)
 * @param {boolean} [o.caseInsensitive]
 * @returns {object[]} [{ pid, ppid, exe, cwd, reason: 'executable' | 'cwd' | 'child' }], roots first
 */
function selectProcesses(procs, dir, { self = process.pid, caseInsensitive = CASE_INSENSITIVE } = {}) {
  const norm = (p) => (caseInsensitive ? p.toLowerCase() : p);
  const root = norm(canonicalPath(dir));
  const name = norm(path.basename(root));
  const inside = (p) => {
    if (!p || !norm(p).includes(name)) return false; // cheap filter before resolving the path
    const rel = path.relative(root, norm(canonicalPath(p)));
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const children = new Map();
  for (const p of procs) if (p.ppid !== p.pid) children.set(p.ppid, [...(children.get(p.ppid) || []), p]);
  const tree = (pid, seen = new Set()) => {
    for (const c of children.get(pid) || []) if (!seen.has(c.pid)) { seen.add(c.pid); tree(c.pid, seen); }
    return seen;
  };
  const spared = new Set([self, ...tree(self)]);
  for (let p = byPid.get(self), n = 0; p && n < 64; p = byPid.get(p.ppid), n++) spared.add(p.ppid);

  const out = new Map();
  for (const p of procs) {
    if (spared.has(p.pid) || out.has(p.pid)) continue;
    const reason = inside(p.exe) ? 'executable' : !p.tty && inside(p.cwd) ? 'cwd' : null;
    if (!reason) continue;
    out.set(p.pid, { ...p, reason });
    for (const c of tree(p.pid)) if (!spared.has(c) && !out.has(c)) out.set(c, { ...byPid.get(c), reason: 'child' });
  }
  return [...out.values()].map(({ pid, ppid, exe, cwd, reason }) => ({ pid, ppid, exe, cwd, reason }));
}

/**
 * Stops the processes running from `dir` (see selectProcesses) with their process trees.
 * @returns {Promise<object[]>} what was found: [{ pid, exe, cwd, reason, stopped, error? }]
 */
async function stopProcessesIn(dir, { self = process.pid } = {}) {
  if (!dir || !fs.existsSync(dir)) return [];
  const found = selectProcesses(await listProcesses(), dir, { self });
  for (const p of found) {
    try {
      process.kill(p.pid, 'SIGKILL');
      p.stopped = true;
    } catch (e) {
      p.stopped = e.code === 'ESRCH'; // already gone (e.g. with its parent)
      if (!p.stopped) p.error = e.message;
    }
  }
  return found;
}

module.exports = { listProcesses, selectProcesses, stopProcessesIn };
