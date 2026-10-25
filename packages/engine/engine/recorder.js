// Writes the run's observability data to disk:
//   runs/<run_id>/events.jsonl            all events
//   runs/<run_id>/sessions/<id>.jsonl     events of each session
//   runs/<run_id>/summary.json            final metrics per session
// Every string is redacted first by the baseline (packages/engine/engine/redact-baseline.js, #475), then by the
// workflow's `observability.capture.redact` rules.

const fs = require('fs');
const path = require('path');
const {
  isEnvDump,
  redactBaseline,
  redactEnvDump,
  redactMcpConfig,
} = require('./redact-baseline');

function toRegex(pattern) {
  let flags = 'g';
  if (pattern.startsWith('(?i)')) { pattern = pattern.slice(4); flags += 'i'; }
  return new RegExp(pattern, flags);
}

class Recorder {
  constructor(runDir, redactRules = []) {
    this.runDir = runDir;
    this.sessionsDir = path.join(runDir, 'sessions');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    // written synchronously, like the session files: a reader that sees workflow.finished (the run
    // list, a resume, a test) finds every event before it in the file
    this.fd = fs.openSync(path.join(runDir, 'events.jsonl'), 'a');
    this.patterns = (redactRules || []).map((r) => toRegex(r.pattern || r));
    this.envDumps = new Set(); // `<session>:<tool call id>` of printenv / env calls (#475)
  }

  redact(v) {
    if (typeof v === 'string') return this.patterns.reduce((s, re) => s.replace(re, '[REDACTED]'), redactBaseline(v));
    if (Array.isArray(v)) return v.map((x) => this.redact(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.redact(x)]));
    return v;
  }

  // #475: a spawn's --mcp-config env values and an environment dump's output are never recorded;
  // a copy: the event object also goes to the UI
  scrub(ev) {
    const item = ev.type === 'session.stream' ? ev.item : null;
    if (!item) return ev;
    const key = `${ev.session_id}:${item.id}`;
    if (item.kind === 'spawn') return { ...ev, item: { ...item, args: redactMcpConfig(item.args) } };
    if (item.kind === 'tool_call' && isEnvDump(item.input?.command)) this.envDumps.add(key);
    if (item.kind === 'tool_result' && this.envDumps.has(key)) {
      this.envDumps.delete(key);
      return { ...ev, item: { ...item, output: redactEnvDump(item.output) } };
    }
    return ev;
  }

  write(ev) {
    const clean = this.redact(this.scrub(ev));
    const line = JSON.stringify(clean) + '\n';
    if (this.fd === null) throw new Error(`event ${ev.type} after workflow.finished: not recorded`);
    fs.writeSync(this.fd, line);
    if (ev.session_id) fs.appendFileSync(path.join(this.sessionsDir, `${ev.session_id}.jsonl`), line);
    if (ev.type === 'workflow.finished') {
      fs.writeFileSync(path.join(this.runDir, 'summary.json'), JSON.stringify(clean.summary, null, 2));
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

module.exports = { Recorder };
