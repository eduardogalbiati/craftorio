// Embedded terminals: the renderer draws them with xterm.js; here they are either
// - a pseudoterminal (node-pty: ConPTY on Windows, forkpty on macOS/Linux) running a program,
//   e.g. a provider CLI resuming an agent's conversation, or
// - a virtual terminal: output produced in this process with no child program, e.g. following
//   a session's log (src/session-tail.js). On Windows a GUI-subsystem binary such as Electron's
//   writes nothing into a pseudoterminal, so the log follower does not run as a process.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// In the packaged app node-pty lives in app.asar.unpacked (native module). Its Windows helper
// starts a worker thread from its own folder, and worker threads cannot read from app.asar, so
// load it from the unpacked folder explicitly.
function loadPty() {
  const resolved = require.resolve('node-pty');
  const unpacked = resolved.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const main = unpacked !== resolved && fs.existsSync(unpacked) ? unpacked : resolved;
  makeSpawnHelperExecutable(path.join(path.dirname(main), '..'));
  return require(main);
}

// macOS: node-pty starts programs through its prebuilt spawn-helper, which npm installs without
// the execute bit; every spawn then fails with "posix_spawnp failed".
function makeSpawnHelperExecutable(ptyDir) {
  if (process.platform !== 'darwin') return;
  for (const dir of [`prebuilds/darwin-${process.arch}`, 'build/Release']) {
    const helper = path.join(ptyDir, dir, 'spawn-helper');
    try {
      if (fs.existsSync(helper) && !(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755);
    } catch (e) { console.warn(`node-pty spawn-helper (${helper}):`, e.message); }
  }
}
let pty = null;

// Ends a terminal's program and everything it started (a CLI behind cmd.exe, its MCP servers,
// tool processes): closing a terminal must not leave an agent running in the background.
// Windows: taskkill /T walks the process tree. Elsewhere the descendants are found with pgrep -P
// (detached ones left the pty's process group, so signalling the group is not enough).
function descendants(pid) {
  let kids = [];
  try { kids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 5000 }).split('\n').map(Number).filter(Boolean); } catch { /* none */ }
  return kids.flatMap((k) => [k, ...descendants(k)]);
}
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch { /* already gone */ }
    return;
  }
  for (const p of [pid, ...descendants(pid)]) { try { process.kill(p, 'SIGKILL'); } catch { /* already gone */ } }
  try { process.kill(-pid, 'SIGKILL'); } catch { /* no such group */ }
}

// Closes the pty once killTree has ended its program. On Windows (ConPTY) node-pty's kill() first
// forks an agent that attaches to the shell's pid and kills every process on that console. The shell
// is already gone: the agent crashes ("AttachConsole failed") and node-pty kills the stale pid 5 s
// later, or the pid was reused by a process on our own console and the agent kills that whole
// console (every sibling process of a test run). killTree already did that job: skip the lookup, keep
// the part that closes the pseudoconsole.
function closePty(proc) {
  const agent = proc._agent;
  if (process.platform === 'win32' && typeof agent?._getConsoleProcessList === 'function') agent._getConsoleProcessList = () => Promise.resolve([]);
  proc.kill();
}

class Terminals {
  /** @param send (channel, payload) => void, e.g. webContents.send */
  constructor(send) {
    this.send = send;
    this.procs = new Map();
    this.seq = 0;
  }

  // Coalesces output: CLIs write many tiny chunks, one IPC message per chunk is wasteful.
  output(id) {
    let buf = '';
    let timer = null;
    const flush = () => { timer = null; if (buf) { this.send('term:data', { id, data: buf }); buf = ''; } };
    const write = (d) => { buf += d; timer ??= setTimeout(flush, 8); };
    return { write, flush };
  }

  /** Pseudoterminal running `file args` in `cwd`; onExit(exitCode) once the program ends or is killed. */
  open({ title, file, args = [], cwd, env, cols = 100, rows = 24, onExit }) {
    pty ??= loadPty();
    const id = `t${++this.seq}`;
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color', cols: Math.max(20, cols | 0), rows: Math.max(5, rows | 0), cwd, env,
    });
    const out = this.output(id);
    proc.onData(out.write);
    proc.onExit(({ exitCode }) => {
      out.flush();
      this.procs.delete(id);
      this.send('term:exit', { id, exitCode });
      try { onExit?.(exitCode); } catch (e) { console.error('terminal exit:', e); }
    });
    this.procs.set(id, { title, pid: proc.pid, write: (d) => proc.write(d), resize: (c, r) => proc.resize(c, r), kill: () => { killTree(proc.pid); closePty(proc); } });
    return { id, title, pid: proc.pid };
  }

  /** Virtual terminal: start(write) produces the output and returns a stop function. Input is ignored. */
  openVirtual({ title, start }) {
    const id = `t${++this.seq}`;
    const out = this.output(id);
    // xterm needs \r\n to return to the first column
    const stop = start((text) => out.write(String(text).replace(/\r?\n/g, '\r\n')));
    this.procs.set(id, { title, write: () => {}, resize: () => {}, kill: () => { stop?.(); out.flush(); } });
    return { id, title };
  }

  input(id, data) { this.procs.get(id)?.write(String(data)); }

  resize(id, cols, rows) {
    const t = this.procs.get(id);
    if (t && cols > 0 && rows > 0) { try { t.resize(cols | 0, rows | 0); } catch { /* exited */ } }
  }

  kill(id) {
    const t = this.procs.get(id);
    if (!t) return false;
    this.procs.delete(id);
    try { t.kill(); } catch { /* already gone */ }
    return true;
  }

  killAll() { for (const id of [...this.procs.keys()]) this.kill(id); }
}

module.exports = { Terminals };
