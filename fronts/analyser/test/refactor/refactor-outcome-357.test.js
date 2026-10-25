// #357: a refactor's success measured on the architecture map (fronts/analyser/engine/domains/refactor-outcome.js): whether
// its file left the Danger Zone, how much its score dropped, whether it improved at all, and how many
// proposals left the Danger Zone in the last 30 / 90 days. Tests first: loaded inside each test.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../engine/domains/refactor-outcome');

test('#357 refactorOutcome: a file that left the Danger Zone improved', () => {
  const { refactorOutcome } = load();
  const out = refactorOutcome({ quadrant: 'danger-zone', score: 80 }, { quadrant: 'healthy', score: 30 });
  assert.equal(out.leftDangerZone, true);
  assert.equal(out.scoreDrop, 50);
  assert.equal(out.improved, true);
});

test('#357 refactorOutcome: a score that dropped while still in the Danger Zone improved without leaving it', () => {
  const { refactorOutcome } = load();
  const out = refactorOutcome({ quadrant: 'danger-zone', score: 80 }, { quadrant: 'danger-zone', score: 65 });
  assert.equal(out.leftDangerZone, false);
  assert.equal(out.scoreDrop, 15);
  assert.equal(out.improved, true);
});

test('#357 refactorOutcome: no drop and still in the Danger Zone is returned as not improved', () => {
  const { refactorOutcome } = load();
  const out = refactorOutcome({ quadrant: 'danger-zone', score: 70 }, { quadrant: 'danger-zone', score: 75 });
  assert.equal(out.leftDangerZone, false);
  assert.equal(out.scoreDrop, -5);
  assert.equal(out.improved, false);
});

test('#357 leftDangerZoneCount counts the proposals that left the Danger Zone within 30 and 90 days', () => {
  const { leftDangerZoneCount } = load();
  const now = new Date('2026-10-15T00:00:00.000Z');
  const proposals = [
    { id: 'a', outcome: { leftDangerZone: true, at: '2026-10-05T00:00:00.000Z' } },
    { id: 'b', outcome: { leftDangerZone: true, at: '2026-08-15T00:00:00.000Z' } },
    { id: 'c', outcome: { leftDangerZone: true, at: '2026-05-01T00:00:00.000Z' } },
    { id: 'd', outcome: { leftDangerZone: false, at: '2026-10-10T00:00:00.000Z' } },
    { id: 'e' },
  ];
  assert.equal(leftDangerZoneCount(proposals, now, 30), 1);
  assert.equal(leftDangerZoneCount(proposals, now, 90), 2);
});
