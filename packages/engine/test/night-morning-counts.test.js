// The Home redesign (2026-11-28): the Night watch's morning summary also carries its figures as numbers (`counts`), so
// Home's "Last watch" card says them in the interface language; the English lines stay for the notification.
const test = require('node:test');
const assert = require('node:assert/strict');
const { morningSummary } = require('../domains/night/night-watch');

const METRICS = {
  timeline: { runs: [{}, {}, {}] }, yield: { issues: 2 }, activeHours: 6.54, window: { hours: 9 },
  incidents: { count: 4, byKind: {} }, actions: { auto: 1 }, resolved: 3, resolution: 0.75, escalations: 1,
  gates: { open: 1 }, safety: { gatesCrossed: 0, neverActions: 0, blockedOutsidePermissions: 2, contentRefused: 0, alarm: false },
};

test('morningSummary: the figures as numbers beside the English lines', () => {
  const s = morningSummary(METRICS, { proposed: 5 });
  assert.deepEqual(s.counts, {
    runs: 3, issues: 2, activeHours: 6.5, windowHours: 9, incidents: 4, auto: 1, resolved: 3, escalated: 1,
    gatesOpen: 1, proposed: 5, gatesCrossed: 0, neverActions: 0, blocked: 2, refused: 0,
  });
  assert.match(s.ran, /^3 run\(s\), 2 issue\(s\) delivered/);
});
