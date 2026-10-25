// The main process's recent log (#361): capture() keeps the last 200 lines of console.log / info /
// warn / error (still printed as before), and recent() gives them to a finding's context.json
// (src/findings.js). src/host/main.js calls capture() at startup; there is no log file.
const MAX_LINES = 200;
const lines = [];
let captured = false;

function text(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function remember(level, args) {
  const at = new Date().toISOString();
  for (const line of args.map(text).join(' ').split(/\r?\n/)) lines.push(`${at} ${level} ${line}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

/** Starts keeping the console's lines (once per process). */
function capture(con = console) {
  if (captured) return;
  captured = true;
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = con[level].bind(con);
    con[level] = (...args) => {
      remember(level, args);
      original(...args);
    };
  }
}

const recent = () => lines.slice();

module.exports = {
  capture,
  recent,
};
