// A recorded run read in the current shape (#350): runs/<id>/summary.json and events.jsonl, upgraded
// on read by src/shared/run-record.js (one upgrade per change of a run's shape). The files are
// only read, never rewritten: an old run stays readable as it was recorded.

const fs = require('fs');
const path = require('path');
const { summaryNeedsEvents, upgradeRunRecord } = require('./shared/run-record');

function readEvents(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
}

function readSummary(runDir) {
  try { return JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8')); } catch { return null; }
}

/** `{ summary, events }` of a run folder in the current shape; summary null while the run has no summary.json. */
function readRunRecord(runDir) {
  return upgradeRunRecord({ summary: readSummary(runDir), events: readEvents(path.join(runDir, 'events.jsonl')) });
}

/**
 * A run's summary.json in the current shape, null without one: its events are read only when it
 * needs them (src/shared/run-record.js summaryNeedsEvents), cached by both files' size and time.
 */
const summaries = new Map(); // run folder → { key, summary }
function readRunSummary(runDir) {
  const summary = readSummary(runDir);
  if (!summaryNeedsEvents(summary)) return summary && upgradeRunRecord({ summary }).summary;
  const sig = (f) => { try { const st = fs.statSync(path.join(runDir, f)); return `${st.mtimeMs}:${st.size}`; } catch { return '-'; } };
  const key = `${sig('summary.json')} ${sig('events.jsonl')}`;
  const hit = summaries.get(runDir);
  if (hit?.key === key) return hit.summary;
  const out = upgradeRunRecord({ summary, events: readEvents(path.join(runDir, 'events.jsonl')) }).summary;
  summaries.set(runDir, { key, summary: out });
  return out;
}

module.exports = {
  readEvents,
  readRunRecord,
  readRunSummary,
};
