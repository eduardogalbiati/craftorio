// The Monitor's state per project (#634, spec R12): <workspace>/monitor/<project id>.json holds the
// error sources (never a token: tokens live in the system keychain), the events read so far by id
// (deduplicated across polls), each group's state (new, intent with its Inbox card, fix-run with its
// run), the automation (diagnose / fix: ask | on | off, a daily cap) and today's diagnoses count.
// Read and written by fronts/ai/engine/channels/monitor.js.
const fs = require('fs');
const path = require('path');
const { writeJsonSafe } = require('../workspace/state-file');

const AUTOMATION_DEFAULT = Object.freeze({ diagnose: 'ask', fix: 'off', dailyCap: 5 });
// the events kept per project, newest first beyond it dropped
const MAX_EVENTS = 5000;

function fileOf(dir, projectId) {
  const id = String(projectId || '');
  if (!id || path.basename(id) !== id || id.startsWith('.')) throw new Error(`Not a project id: ${projectId}`);
  return path.join(dir, `${id}.json`);
}

const empty = () => ({ sources: [], events: {}, groups: {}, automation: { ...AUTOMATION_DEFAULT }, diagnosed: { day: null, count: 0 } });

/** The project's Monitor state (an empty one when nothing was saved yet). */
function readState(dir, projectId) {
  const file = fileOf(dir, projectId);
  let data = null;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet, or unreadable */ }
  const base = empty();
  if (!data || typeof data !== 'object') return base;
  return {
    sources: Array.isArray(data.sources) ? data.sources : [],
    events: data.events && typeof data.events === 'object' ? data.events : {},
    groups: data.groups && typeof data.groups === 'object' ? data.groups : {},
    automation: { ...base.automation, ...(data.automation || {}) },
    diagnosed: { ...base.diagnosed, ...(data.diagnosed || {}) },
  };
}

// a source as it is saved: its fields, never a token
const sourceOnly = ({ token, ...rest }) => rest;

/** Saves the project's Monitor state; the oldest events beyond MAX_EVENTS are dropped. */
function writeState(dir, projectId, state) {
  const events = Object.entries(state.events || {});
  const kept = events.length > MAX_EVENTS
    ? Object.fromEntries(events.sort((a, b) => String(b[1]?.at || '').localeCompare(String(a[1]?.at || ''))).slice(0, MAX_EVENTS))
    : state.events || {};
  return writeJsonSafe(fileOf(dir, projectId), { ...state, sources: (state.sources || []).map(sourceOnly), events: kept });
}

module.exports = {
  AUTOMATION_DEFAULT,
  readState,
  writeState,
};
