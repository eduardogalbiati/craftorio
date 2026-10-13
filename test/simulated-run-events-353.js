// #353: the events of a simulated run of software-development, for a snapshot. Each event keeps its
// type, its step and the fields simulation decides (transitions, statuses, the machine actions'
// command/skipped/output, the provider a session got, a probe's state), with machine paths and run
// ids replaced: no timestamps, sequence numbers, ids, timings, random mock usage or rendered
// prompts (they follow every skill edit). Recorded on the base commit into
// test/fixtures/events-software-development-353.json, compared in
// test/slow/simulation-adapters-353.slow.test.js. Exports functions only (#305).
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const KEEP = ['type', 'step_id', 'from', 'to', 'status', 'command', 'skipped', 'output', 'provider', 'simulates', 'state', 'kind'];

function normaliseString(s, dirs) {
  let out = s;
  for (const [dir, name] of dirs) {
    for (const form of [dir, dir.split(path.sep).join('/'), dir.split(path.sep).join('\\\\')]) out = out.split(form).join(name);
  }
  return out
    .replace(/\b(runs|wf|run-input)-[A-Za-z0-9]{6}\b/g, '$1-<tmp>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>')
    .replace(/\b\d{8}-\d{6}-[0-9a-f]{6,}\b/g, '<run-id>');
}

// inside a step's output: timings, ids, the mock's random usage and the repository's commit vary
const VOLATILE = /(_ms$|Ms$|_at$|^ts$|cost|Usd$|_usd$|^usage$|^tokens$|^context$|^commit$|^head$|^sha$|(^|_)id$|Id$)/;
function normalise(value, dirs) {
  if (Array.isArray(value)) return value.map((v) => normalise(v, dirs));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, VOLATILE.test(k) && value[k] != null ? '<volatile>' : normalise(value[k], dirs)]));
  }
  return typeof value === 'string' ? normaliseString(value, dirs).replace(/\b[0-9a-f]{40}\b/g, '<sha>') : value;
}

// One event's snapshot entry: the KEEP fields it has (a session's provider from its record too).
function project(ev, dirs) {
  const out = {};
  for (const k of KEEP) if (ev[k] !== undefined) out[k] = normalise(ev[k], dirs);
  if (ev.session && typeof ev.session === 'object') {
    for (const k of ['provider', 'simulates']) if (ev.session[k] !== undefined) out[`session.${k}`] = ev.session[k];
  }
  return out;
}

// The whole simulated run (test/engine-helpers.js's runSoftwareDevelopment), its events projected.
async function simulatedSoftwareDevelopmentEvents() {
  process.env.MULTIAGENT_MOCK_DELAY_SCALE = process.env.MULTIAGENT_MOCK_DELAY_SCALE || '0.02';
  const { runSoftwareDevelopment } = require('./engine-helpers');
  const { events, finished } = await runSoftwareDevelopment({});
  const dirs = [[root, '<repo>'], [os.tmpdir(), '<tmp>'], [os.homedir(), '<home>']];
  return { status: finished?.status || null, events: events.map((ev) => project(ev, dirs)) };
}

module.exports = { simulatedSoftwareDevelopmentEvents };
