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
// What is stopped: processes whose executable is inside the folder (every platform), whose
// command line names a file inside it (#390: a `node --test` worker run by the machine's node,
// orphaned when its suite ended, held a worktree for 21 hours) or, on Linux/macOS, whose working
// directory is (Windows does not expose another process's working directory cheaply), with their
// whole process tree. Never touched: this process, its ancestors and its descendants (e.g. the
// app's embedded terminals), the owners of other live runs with their trees (#7: a terminal run
// working in the same folder), and, for the command-line and working-directory matches, processes
// with a terminal (a shell the user opened there). Nothing outside the folder is matched, so the
// user's app and other runs are safe; the folder itself on a command line (an editor opened on
// it) is not a match either, only a path inside it, and only for a runtime, runner or shell
// (RUNNERS): an editor opened on a file of the folder is left alone.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { canonicalPath } = require('./worktree');
const { caseInsensitive } = require('../domains/machine/platform-paths');
const { isServerCommand } = require('./server-commands');

const LIST_TIMEOUT_MS = 30e3;

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: LIST_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
    resolve(err && !stdout ? null : String(stdout));
  });
});

// Win32_Process gives the executable path and the command line, not the working directory. UTF-8
// output: user folders may have non-ASCII names.
const WIN_LIST = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine | ForEach-Object { '{0}|{1}|{2}|{3}|{4}' -f $_.ProcessId,$_.ParentProcessId,$(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() }),$_.ExecutablePath,($_.CommandLine -replace '[\\r\\n]+',' ') }";

async function listWindows() {
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_LIST]);
  if (out == null) throw new Error('could not list processes (Get-CimInstance Win32_Process)');
  return out.split(/\r?\n/).map((l) => l.trim().split('|')).filter((f) => f.length >= 5 && /^\d+$/.test(f[0]))
    .map(([pid, ppid, started, exe, ...cmd]) => ({ pid: +pid, ppid: +ppid, started: +started || null, exe: exe || null, cmd: cmd.join('|') || null, cwd: null, tty: false }));
}

function listLinux() {
  const read = (fn) => { try { return fn(); } catch { return null; } };
  return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map((d) => {
    const stat = read(() => fs.readFileSync(`/proc/${d}/stat`, 'utf8'));
    if (!stat) return null;
    // after the command name "(...)": state ppid pgrp session tty_nr ...; starttime is the 20th
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return {
      pid: +d, ppid: +f[1], tty: +f[4] !== 0, started: +f[19] || null,
      exe: read(() => fs.readlinkSync(`/proc/${d}/exe`)), cwd: read(() => fs.readlinkSync(`/proc/${d}/cwd`)),
      cmd: read(() => fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0').join(' ').trim()) || null,
    };
  }).filter(Boolean);
}

async function listMac() {
  const out = await run('ps', ['-axo', 'pid=,ppid=,tty=,comm=']);
  if (out == null) throw new Error('could not list processes (ps)');
  const procs = out.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], tty: m[3] !== '??', exe: m[4].trim() || null, cmd: null, cwd: null }));
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  // command lines apart: comm and args both may hold spaces
  for (const m of String(await run('ps', ['-axo', 'pid=,args=']) || '').split('\n').map((l) => /^\s*(\d+)\s+(.*)$/.exec(l))) {
    const p = m && byPid.get(+m[1]);
    if (p) p.cmd = m[2].trim() || null;
  }
  // working directories: lsof -F prints "p<pid>", "fcwd", "n<path>" per process
  const cwd = await run('lsof', ['-nP', '-d', 'cwd', '-Fpn']);
  let cur = null;
  for (const l of String(cwd || '').split('\n')) {
    if (l[0] === 'p') cur = byPid.get(+l.slice(1));
    else if (l[0] === 'n' && cur) cur.cwd = l.slice(1);
  }
  return procs;
}

/**
 * Every process: [{ pid, ppid, exe, cmd, cwd, tty, started }] (exe/cmd/cwd null when unknown). started: when it
 * started, a number only to compare with another of the same list (no value on macOS).
 */
function listProcesses() {
  if (process.platform === 'win32') return listWindows();
  if (process.platform === 'linux') return Promise.resolve(listLinux());
  return listMac();
}

// the app's one rule for case (packages/engine/domains/machine/platform-paths.js)
const CASE_INSENSITIVE = caseInsensitive(process.platform);

/**
 * Whether a command line names a path inside `dir` (`dir` followed by a separator; `dir` alone is
 * not enough, nor `dir`'s siblings sharing its prefix: run-1 is not run-10). On Windows `/` counts as `\`.
 */
function commandMentions(commandLine, dir, { caseInsensitive = CASE_INSENSITIVE } = {}) {
  if (!commandLine || !dir) return false;
  const norm = (s) => {
    const t = path.sep === '\\' ? String(s).replace(/\//g, '\\') : String(s);
    return caseInsensitive ? t.toLowerCase() : t;
  };
  return norm(commandLine).includes(norm(dir).replace(/[\\/]+$/, '') + path.sep);
}

// The programs a command line may name a worktree's file to run (#390): runtimes, runners and
// shells. A tool opened on one of its files (an editor) is the owner's: naming it is not enough.
const RUNNERS = /^(bash|bun|cargo|cmd|deno|dotnet|electron|go|gradlew?|java|javaw|jest|mocha|mvnw?|node|nodejs|npm|npx|perl|php|pnpm|powershell|pwsh|py|pytest|python\d*(\.\d+)?|pythonw|ruby|sh|tsx|vitest|yarn|zsh)(\.(exe|cmd|bat))?$/i;
const programOf = (p) => {
  const first = String(p.cmd || '').match(/^\s*(?:"([^"]+)"|(\S+))/);
  return (p.exe || first?.[1] || first?.[2] || '').split(/[\\/]/).pop();
};
const isRunner = (p) => RUNNERS.test(programOf(p));

/**
 * The processes to stop for `dir`, from a process list (pure: no process is touched).
 * @param {object[]} procs  [{ pid, ppid, exe, cmd, cwd, tty }]
 * @param {string} dir      the worktree
 * @param {object} [o]
 * @param {number} [o.self] pid to protect with its ancestors and descendants (default: this process)
 * @param {number[]} [o.spare] #7: pids of other live runs' owners, spared with their descendants
 * @param {boolean} [o.caseInsensitive]
 * @returns {object[]} [{ pid, ppid, exe, cmd, cwd, reason: 'executable' | 'cwd' | 'command' | 'child' }], roots first
 */
function selectProcesses(procs, dir, { self = process.pid, spare = [], caseInsensitive = CASE_INSENSITIVE } = {}) {
  const norm = (p) => (caseInsensitive ? p.toLowerCase() : p);
  const root = norm(canonicalPath(dir));
  const name = norm(path.basename(root));
  const inside = (p) => {
    if (!p || !norm(p).includes(name)) return false; // cheap filter before resolving the path
    const rel = path.relative(root, norm(canonicalPath(p)));
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  // the folder as given and resolved: a command line may name either
  const dirs = [...new Set([path.resolve(dir), canonicalPath(dir)])];
  const named = (p) => !!p.cmd && isRunner(p) && norm(p.cmd).includes(name) && dirs.some((d) => commandMentions(p.cmd, d, { caseInsensitive }));
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const children = new Map();
  for (const p of procs) if (p.ppid !== p.pid) children.set(p.ppid, [...(children.get(p.ppid) || []), p]);
  const tree = (pid, seen = new Set()) => {
    for (const c of children.get(pid) || []) if (!seen.has(c.pid)) { seen.add(c.pid); tree(c.pid, seen); }
    return seen;
  };
  const spared = new Set([self, ...tree(self)]);
  for (let p = byPid.get(self), n = 0; p && n < 64; p = byPid.get(p.ppid), n++) spared.add(p.ppid);
  for (const pid of spare) for (const s of [pid, ...tree(pid)]) spared.add(s);

  const out = new Map();
  for (const p of procs) {
    if (spared.has(p.pid) || out.has(p.pid)) continue;
    const reason = inside(p.exe) ? 'executable' : p.tty ? null : inside(p.cwd) ? 'cwd' : named(p) ? 'command' : null;
    if (!reason) continue;
    out.set(p.pid, { ...p, reason });
    for (const c of tree(p.pid)) if (!spared.has(c) && !out.has(c)) out.set(c, { ...byPid.get(c), reason: 'child' });
  }
  return [...out.values()].map(({ pid, ppid, exe, cmd, cwd, reason }) => ({ pid, ppid, exe, cmd: cmd || null, cwd, reason }));
}

/**
 * Stops the processes running from `dir` (see selectProcesses) with their process trees.
 * @param {string} dir
 * @param {{ self?: number, spare?: number[] }} [o] see selectProcesses
 * @returns {Promise<object[]>} what was found: [{ pid, exe, cwd, reason, stopped, error? }]
 */
async function stopProcessesIn(dir, { self = process.pid, spare = [] } = {}) {
  if (!dir || !fs.existsSync(dir)) return [];
  const found = selectProcesses(await listProcesses(), dir, { self, spare });
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

// Command lines of every process: [{ pid, ppid, cmd }] (the suite step's timeout names the test
// files still running from them, #210).
const WIN_COMMANDS = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CommandLine | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId,$_.ParentProcessId,$_.CommandLine }";

async function listCommandLines() {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_COMMANDS]);
    return String(out || '').split(/\r?\n/).map((l) => l.trim().split('|')).filter((f) => f.length >= 3 && /^\d+$/.test(f[0]))
      .map(([pid, ppid, ...cmd]) => ({ pid: +pid, ppid: +ppid, cmd: cmd.join('|') }));
  }
  const out = await run('ps', ['-axo', 'pid=,ppid=,args=']);
  return String(out || '').split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], cmd: m[3].trim() }));
}

/** The descendants of `pid` with their command lines: [{ pid, ppid, cmd }]; [] when they cannot be listed. */
async function processTreeCommands(pid) {
  let procs;
  try { procs = await listCommandLines(); } catch { return []; }
  const children = new Map();
  for (const p of procs) if (p.ppid !== p.pid) children.set(p.ppid, [...(children.get(p.ppid) || []), p]);
  const out = [];
  const seen = new Set([pid]);
  for (let queue = [pid]; queue.length;) {
    for (const c of children.get(queue.shift()) || []) if (!seen.has(c.pid)) { seen.add(c.pid); out.push(c); queue.push(c.pid); }
  }
  return out;
}

// Newest first: by start time, else by pid. A pid alone does not say it: Windows gives them in no order and every
// system reuses them.
const byNewest = (a, b) => (a.started && b.started ? b.started - a.started : 0) || b.pid - a.pid;

/**
 * #853: stops the tree of one dev server or watcher an agent runs in the foreground: under the agent
 * CLI's `rootPid`, the highest descendant whose command line holds `command` (the Bash tool's shell)
 * or is a server (server-commands.js), with its whole subtree; of several such (the same command
 * already running in the background), the newest one. Never `rootPid` itself, never anything
 * outside its tree; `protectChildren` (a .cmd/.bat shim whose child is the CLI, as the memory guard's)
 * spares rootPid's direct children too: the CLI's own command line may quote the command (its system prompt).
 * @param {number} rootPid
 * @param {string} command
 * @param {{ protectChildren?: boolean }} [o]
 * @returns {Promise<{ listed: boolean, stopped: Array<{ pid: number, cmd: string | null }>, error?: string }>}
 *   listed false when the processes could not be listed (nothing stopped, the caller says so)
 */
async function stopServerTree(rootPid, command, { protectChildren = false } = {}) {
  let procs;
  try { procs = await listProcesses(); } catch (e) { return { listed: false, stopped: [], error: e.message }; }
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
  const wanted = String(command || '').trim();
  const below = subtree(rootPid).filter((p) => !(protectChildren && p.ppid === rootPid));
  // the highest matches (the shell running the command, not the server it started), then the newest
  // of them: the same command may already run in the background, started earlier
  const newestTop = (matches) => {
    const pids = new Set(matches.map((p) => p.pid));
    const byPid = new Map(below.map((p) => [p.pid, p]));
    const hasMatchAbove = (p) => {
      for (let up = byPid.get(p.ppid); up; up = byPid.get(up.ppid)) if (pids.has(up.pid)) return true;
      return false;
    };
    return matches.filter((p) => !hasMatchAbove(p)).sort(byNewest)[0];
  };
  const top = newestTop(below.filter((p) => wanted && p.cmd?.includes(wanted))) || newestTop(below.filter((p) => isServerCommand(p.cmd)));
  if (!top) return { listed: true, stopped: [] };
  const tree = [top, ...subtree(top.pid)];
  if (process.platform === 'win32') {
    await run('taskkill', ['/pid', String(top.pid), '/T', '/F']);
  } else {
    for (const p of tree) {
      try { process.kill(p.pid, 'SIGKILL'); } catch { /* ESRCH: already gone with its parent */ }
    }
  }
  return { listed: true, stopped: tree.map((p) => ({ pid: p.pid, cmd: p.cmd || null })) };
}

module.exports = {
  byNewest,
  commandMentions,
  listProcesses,
  processTreeCommands,
  selectProcesses,
  stopProcessesIn,
  stopServerTree,
};
