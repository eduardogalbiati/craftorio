// packages/ui-kit/occupancy-chip.js (#188): the top bar's 24/7 chip, a summary number only. Browser:
// window.OccupancyChip; Node: module.exports (like packages/ui-kit/estimates.js). Seam: chipModel.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const load = () => require(path.join(__dirname, '..', 'occupancy-chip.js'));

test('chipModel: shows the last 24 h occupancy as "24/7 · 87%"', () => {
  const { chipModel } = load();
  assert.equal(chipModel({ occupancy: 0.87, activeHours: 20.9, idleNowMinutes: 12, running: false }).text, '24/7 · 87%');
});

test('chipModel: green from 90 %, amber from 60 % to 89 %, red under 60 %', () => {
  const { chipModel } = load();
  const level = (occupancy) => chipModel({ occupancy, activeHours: 0, idleNowMinutes: 0, running: false }).level;
  assert.equal(level(1), 'green');
  assert.equal(level(0.9), 'green');
  assert.equal(level(0.89), 'amber');
  assert.equal(level(0.6), 'amber');
  assert.equal(level(0.59), 'red');
  assert.equal(level(0), 'red');
});

test('chipModel: the dot pulses while a run is active and is grey when none is', () => {
  const { chipModel } = load();
  assert.equal(chipModel({ occupancy: 0.5, activeHours: 12, idleNowMinutes: 0, running: true }).dot, 'pulse');
  assert.equal(chipModel({ occupancy: 0.5, activeHours: 12, idleNowMinutes: 30, running: false }).dot, 'grey');
});

test('chipModel: a one-line tooltip with the active hours and the current idle time', () => {
  const { chipModel } = load();
  const { tooltip } = chipModel({ occupancy: 0.87, activeHours: 20.9, idleNowMinutes: 12, running: false });
  assert.equal(tooltip, 'last 24 h: 20.9 h active; idle now 12 min');
  assert.doesNotMatch(tooltip, /\n/);
});
