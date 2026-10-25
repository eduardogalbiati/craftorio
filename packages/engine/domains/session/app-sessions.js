// The app's own heartbeat log (#188): <workspace>/app-sessions.json, { sessions: [{ start, end }] },
// the times an app process held the workspace lock (packages/engine/domains/run/run-owner.js lockWorkspace beats it every
// minute). A gap between two sessions is "app closed / machine asleep" for the 24/7 meter
// (packages/engine/domains/run/occupancy.js). Small: the sessions of the last KEEP_DAYS days only.

const fs = require('fs');
const path = require('path');

const BEAT_MS = 60e3;
// a beat later than this after the last one starts a new session (the machine slept in between)
const GAP_MS = 3 * BEAT_MS;
const KEEP_DAYS = 40;

const fileOf = (workspace) => path.join(workspace, 'app-sessions.json');

/** The sessions [{ start, end }] (ISO), oldest first; [] when the app never wrote the log. */
function readAppSessions(workspace) {
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(workspace), 'utf8'));
    return Array.isArray(j.sessions) ? j.sessions.filter((s) => s && s.start && s.end) : [];
  } catch { return []; }
}

/** Records one beat at `now`: extends the last session, or starts a new one after a gap. */
function beat(workspace, now = Date.now()) {
  const sessions = readAppSessions(workspace).filter((s) => now - Date.parse(s.end) < KEEP_DAYS * 864e5);
  const last = sessions.at(-1);
  const at = new Date(now).toISOString();
  if (last && now - Date.parse(last.end) <= GAP_MS && now >= Date.parse(last.start)) last.end = at;
  else sessions.push({ start: at, end: at });
  try { fs.writeFileSync(fileOf(workspace), JSON.stringify({ sessions }, null, 1)); } catch { /* the folder went away */ }
}

/** Beats now and every minute until stop(); the timer never keeps the process alive. */
function keepBeating(workspace) {
  beat(workspace);
  const timer = setInterval(() => beat(workspace), BEAT_MS);
  timer.unref?.();
  return { stop() { clearInterval(timer); beat(workspace); } };
}

module.exports = {
  beat,
  GAP_MS,
  keepBeating,
  readAppSessions,
};
