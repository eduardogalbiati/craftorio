// The Monitor's polling connectors (#634, spec R12): read a source's production errors now.
// Sources: { id, type: 'log-file', path }, { id, type: 'log-url', url }, { id, type: 'sentry', org,
// project }. Logs are JSON lines (blank or malformed lines skipped). Sentry is read with the token
// from the system keychain (`getToken(source.id)`, never stored here). pollSource never throws: a
// failure is { ok: false, error }. webhookEvents maps a pushed payload (the Monitor's webhook) to the
// same events. Called by fronts/ai/engine/areas/monitor.js.
const crypto = require('crypto');
const fs = require('fs');

const SENTRY_API = 'https://sentry.io/api/0';

// the events of a JSON-lines text, each tagged with its source; events older than `since` dropped
function parseLines(text, sourceId, since) {
  const events = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) continue;
    if (since && ev.at && String(ev.at) < since) continue;
    events.push({ ...ev, source: sourceId });
  }
  return events;
}

const tagOf = (ev, key) => (Array.isArray(ev.tags) ? ev.tags.find((t) => t?.key === key)?.value : undefined);

function sentryEvent(ev, sourceId) {
  return { id: ev.eventID || ev.id, at: ev.dateCreated, source: sourceId, status: 500, message: ev.title || ev.message || 'Error', path: tagOf(ev, 'url') };
}

const cursorOf = (events, since) => events.reduce((max, e) => (e.at && (!max || e.at > max) ? e.at : max), since || null);

async function read(source, { fetch = globalThis.fetch, readFile, getToken, since }) {
  if (source.type === 'log-file') {
    if (!source.path) return { ok: false, error: 'The log file has no path.' };
    const text = readFile ? await readFile(source.path) : await fs.promises.readFile(source.path, 'utf8');
    return { ok: true, events: parseLines(text, source.id, since) };
  }
  if (source.type === 'log-url') {
    if (!source.url) return { ok: false, error: 'The log URL is missing.' };
    const res = await fetch(source.url);
    if (!res.ok) return { ok: false, error: `Log URL ${res.status}` };
    return { ok: true, events: parseLines(await res.text(), source.id, since) };
  }
  if (source.type === 'sentry') {
    const token = getToken ? await getToken(source.id) : null;
    if (!token) return { ok: false, error: 'No Sentry token in the keychain: add it in Sources.' };
    const url = `${SENTRY_API}/projects/${encodeURIComponent(source.org || '')}/${encodeURIComponent(source.project || '')}/events/`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { ok: false, error: `Sentry ${res.status}` };
    const body = await res.json();
    return { ok: true, events: (Array.isArray(body) ? body : []).map((ev) => sentryEvent(ev, source.id)) };
  }
  return { ok: false, error: `Unknown source type: ${source.type}` };
}

// ---- pushed events (the Monitor's webhook, POST /hooks/monitor/<project> on the engine server) ----
// the events one push may carry; more are dropped
const MAX_PUSHED = 100;
const isEvent = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const isoOf = (v, now) => {
  if (v == null || v === '') return now;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? now : d.toISOString();
};
const pathOf = (url) => { try { return url ? new URL(url).pathname : undefined; } catch { return String(url); } };
const digest = (ev) => crypto.createHash('sha256').update(JSON.stringify(ev)).digest('hex').slice(0, 24);

// a Sentry webhook's event (an internal integration's data.event / data.error, the legacy plugin's event)
function sentryPushed(ev, sourceId, payload, now) {
  return {
    id: ev.event_id || ev.eventID || ev.id || digest(ev),
    at: isoOf(ev.datetime || ev.timestamp || ev.dateCreated, now),
    source: sourceId,
    status: 500,
    message: String(ev.title || ev.message || payload.message || 'Error'),
    method: ev.request?.method || undefined,
    path: pathOf(ev.request?.url || tagOf(ev, 'url')),
  };
}

/**
 * The events of a pushed payload: a Sentry webhook, else one event or a list of events in the log
 * lines' shape ({ id?, at?, status, method?, path?, worker?, message, file?, line? }; one with neither
 * message nor status is no error and dropped). An event with no
 * id gets one from its content (with its `at`): a payload sent twice counts once. Never throws.
 */
function webhookEvents(payload, sourceId, now = new Date().toISOString()) {
  if (!payload || typeof payload !== 'object') return [];
  const sentry = !Array.isArray(payload) && (payload.data?.event || payload.data?.error || payload.event);
  if (isEvent(sentry)) return [sentryPushed(sentry, sourceId, payload, now)];
  const errorLike = (ev) => isEvent(ev) && (ev.message != null || ev.status != null);
  return (Array.isArray(payload) ? payload : [payload]).filter(errorLike).slice(0, MAX_PUSHED).map((ev) => {
    const at = isoOf(ev.at, now);
    return { ...ev, id: ev.id != null ? String(ev.id) : digest({ ...ev, at }), at, source: sourceId };
  });
}

/** Polls one source → { ok: true, events, cursor } or { ok: false, error }; never throws. */
async function pollSource(source, opts = {}) {
  try {
    if (!source || typeof source !== 'object') return { ok: false, error: 'No source.' };
    const out = await read(source, opts || {});
    if (!out.ok) return out;
    return { ok: true, events: out.events, cursor: cursorOf(out.events, opts?.since) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

module.exports = {
  pollSource,
  webhookEvents,
};
