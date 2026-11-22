// The Monitor's grouping (#634, spec R12): production errors grouped and deduplicated with no model.
// An event is { id, at, source, status (500 or 'ERR'), method?, path?, worker?, message, file?, line? }.
// Its fingerprint ignores id and time; numeric and uuid path segments become :id, so
// /api/orders/123 and /api/orders/9 are one group. Pure functions: called by the ai front's
// monitor channels (packages/engine/fronts/ai/channels/monitor.js).
const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path with its numeric and uuid segments as :id (the query string dropped). */
function normalizePath(p) {
  return String(p || '').split('?')[0].split('/').map((s) => (/^\d+$/.test(s) || UUID.test(s) ? ':id' : s)).join('/');
}

/** What the owner recognises a group by: "<METHOD> <path>", "worker: <name>", or the message. */
function titleOf(ev) {
  if (ev.worker) return `worker: ${ev.worker}`;
  if (ev.path) return `${ev.method ? `${String(ev.method).toUpperCase()} ` : ''}${normalizePath(ev.path)}`;
  return String(ev.message || 'Error');
}

const whereOf = (ev) => (ev.file && ev.line != null && ev.line !== '' ? `${ev.file}:${ev.line}` : null);

/** The group key of an event: status, title and message (never its id or time). */
function fingerprint(ev) {
  const key = [String(ev.status ?? ''), titleOf(ev), String(ev.message || '')].join('\n');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/** The groups of `events`, an event id counted once, highest count first. */
function groupErrors(events) {
  const seen = new Set();
  const groups = new Map();
  for (const ev of events || []) {
    if (!ev) continue;
    if (ev.id != null) {
      const key = `${ev.source ?? ''}\n${ev.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const fp = fingerprint(ev);
    let g = groups.get(fp);
    if (!g) {
      g = { fingerprint: fp, title: titleOf(ev), status: ev.status ?? 'ERR', message: String(ev.message || ''), where: whereOf(ev), count: 0, firstSeen: null, lastSeen: null };
      groups.set(fp, g);
    }
    g.count += 1;
    if (!g.where) g.where = whereOf(ev);
    if (ev.at && (!g.firstSeen || ev.at < g.firstSeen)) g.firstSeen = ev.at;
    if (ev.at && (!g.lastSeen || ev.at > g.lastSeen)) g.lastSeen = ev.at;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** The Errors screen's sparkline: the events of the group `fp` per bucket over `windowMs` up to `now`, oldest first. */
function sparkOf(events, fp, { now = Date.now(), windowMs = 3600e3, buckets = 6 } = {}) {
  const out = new Array(buckets).fill(0);
  const from = now - windowMs;
  for (const ev of events || []) {
    const at = Date.parse(ev?.at);
    if (!ev || Number.isNaN(at) || at < from || at > now || fingerprint(ev) !== fp) continue;
    out[Math.min(buckets - 1, Math.floor(((at - from) / windowMs) * buckets))] += 1;
  }
  return out;
}

module.exports = {
  fingerprint,
  groupErrors,
  normalizePath,
  sparkOf,
};
