// Embedded terminals: the renderer draws them with xterm.js; here they are either
// - a pseudoterminal (node-pty: ConPTY on Windows, forkpty on macOS/Linux) running a program,
//   e.g. a provider CLI resuming an agent's conversation, or
// - a virtual terminal: output produced in this process with no child program, e.g. following
//   a session's log (src/session-tail.js). On Windows a GUI-subsystem binary such as Electron's
//   writes nothing into a pseudoterminal, so the log follower does not run as a process.

const fs = require('fs');

// In the packaged app node-pty lives in app.asar.unpacked (native module). Its Windows helper
// starts a worker thread from its own folder, and worker threads cannot read from app.asar, so
// load it from the unpacked folder explicitly.
function loadPty() {
  const resolved = require.resolve('node-pty');
  const unpacked = resolved.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return require(unpacked !== resolved && fs.existsSync(unpacked) ? unpacked : 'node-pty');
}
let pty = null;

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

  /** Pseudoterminal running `file args` in `cwd`. */
  open({ title, file, args = [], cwd, env, cols = 100, rows = 24 }) {
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
    });
    this.procs.set(id, { title, write: (d) => proc.write(d), resize: (c, r) => proc.resize(c, r), kill: () => proc.kill() });
    return { id, title };
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
