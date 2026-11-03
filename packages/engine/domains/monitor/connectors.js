// The Monitor's polling connectors (#634, spec R12): read a source's production errors now.
// Sources: { id, type: 'log-file', path }, { id, type: 'log-url', url }, { id, type: 'sentry', org,
// project }. Logs are JSON lines (blank or malformed lines skipped). Sentry is read with the token
// from the system keychain (`getToken(source.id)`, never stored here). pollSource never throws: a
// failure is { ok: false, error }. Called by fronts/ai/engine/channels/monitor.js.
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
};
