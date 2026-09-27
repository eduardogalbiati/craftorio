// Writes the run's observability data to disk:
//   runs/<run_id>/events.jsonl            all events
//   runs/<run_id>/sessions/<id>.jsonl     events of each session
//   runs/<run_id>/summary.json            final metrics per session

const fs = require('fs');
const path = require('path');

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
    this.events = fs.createWriteStream(path.join(runDir, 'events.jsonl'), { flags: 'a' });
    this.patterns = (redactRules || []).map((r) => toRegex(r.pattern || r));
  }

  redact(v) {
    if (typeof v === 'string') return this.patterns.reduce((s, re) => s.replace(re, '[REDACTED]'), v);
    if (Array.isArray(v)) return v.map((x) => this.redact(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.redact(x)]));
    return v;
  }

  write(ev) {
    const clean = this.redact(ev);
    const line = JSON.stringify(clean) + '\n';
    this.events.write(line);
    if (ev.session_id) fs.appendFileSync(path.join(this.sessionsDir, `${ev.session_id}.jsonl`), line);
    if (ev.type === 'workflow.finished') {
      fs.writeFileSync(path.join(this.runDir, 'summary.json'), JSON.stringify(clean.summary, null, 2));
      this.events.end();
    }
  }
}

module.exports = { Recorder };
