// src/renderer/po-calibration.js (#189): the Product Owner's Speed ↔ Quality calibration, a pure
// module (window.PoCalibration in the renderer, module.exports in Node): the five steps' planning
// parameters, the prompt section they produce, and the per-question phrase an owner's question may ask for.
const test = require('node:test');
const assert = require('node:assert/strict');
const calibration = require('../src/renderer/po-calibration');

test('clamp keeps an integer 1..5, and falls back (default 2) otherwise', () => {
  assert.equal(calibration.clamp(1), 1);
  assert.equal(calibration.clamp(5), 5);
  assert.equal(calibration.clamp(3), 3);
  assert.equal(calibration.clamp(0), 2);
  assert.equal(calibration.clamp(6), 2);
  assert.equal(calibration.clamp('x'), 2);
  assert.equal(calibration.clamp(null), 2);
  assert.equal(calibration.clamp(undefined), 2);
  assert.equal(calibration.clamp(2.5), 2);
});

test('clamp takes an explicit fallback instead of the default', () => {
  assert.equal(calibration.clamp(0, 9), 9);
  assert.equal(calibration.clamp('x', null), null);
  assert.equal(calibration.clamp(4, 9), 4); // a valid value ignores the fallback
});

test('DEFAULT is 2 (Speed-leaning, the owner\'s current choice)', () => {
  assert.equal(calibration.DEFAULT, 2);
  assert.equal(calibration.step(2).name, 'Speed-leaning');
});

test('step(n): maxRuns and maxComplexity per step, from Speed (1) to Quality (5)', () => {
  const runs = calibration.STEPS.map((s) => s.maxRuns);
  const complexity = calibration.STEPS.map((s) => s.maxComplexity);
  assert.deepEqual(runs, [null, 4, 3, 2, 2]);
  assert.deepEqual(complexity, [6, 6, 5, 5, 4]);
  assert.equal(calibration.step(1).name, 'Speed');
  assert.equal(calibration.step(3).name, 'Balanced');
  assert.equal(calibration.step(4).name, 'Quality-leaning');
  assert.equal(calibration.step(5).name, 'Quality');
  assert.equal(calibration.step(5).review, 'add a developer self-review (#179) when the workflow has it');
});

test('params lists the five planning parameters with their numbers, for the prompt and the slider\'s details', () => {
  const p = Object.fromEntries(calibration.params(5));
  assert.equal(p['Parallel runs per stage'], '1–2');
  assert.equal(p['Max complexity per group'], '4');
  assert.equal(p['UI issues mode'], 'validated for any screen');
  assert.equal(p.Placement, 'its own stage after the most stable base');
});

test('tooltip and label name the step and its position out of 5', () => {
  assert.equal(calibration.label(1), 'Speed (1/5)');
  assert.equal(calibration.label(5), 'Quality (5/5)');
  assert.match(calibration.tooltip(3), /^Balanced \(3\/5\): /);
  assert.match(calibration.tooltip(3), /Max complexity per group: 5/);
});

test('promptSection states the step, that its numbers replace the skill\'s defaults, every parameter, and asks the answer to say which calibration it planned with', () => {
  const s = calibration.promptSection(5);
  assert.match(s, /^## Calibration: Quality \(5\/5\)/);
  assert.match(s, /replace the skill's defaults/);
  assert.match(s, /- Parallel runs per stage: 1–2/);
  assert.match(s, /- Max complexity per group: 4/);
  assert.match(s, /"Planned for Quality"/);
});

test('fromQuestion reads an explicit "for quality" / "for speed" / "for balanced" phrase; a plain mention of the word is not a request', () => {
  assert.equal(calibration.fromQuestion('plan this one for quality'), 5);
  assert.equal(calibration.fromQuestion('Favor speed for this one'), 1);
  assert.equal(calibration.fromQuestion('calibrate for balanced'), 3);
  assert.equal(calibration.fromQuestion('What is the quality of this backlog?'), null);
  assert.equal(calibration.fromQuestion('quality'), null);
  assert.equal(calibration.fromQuestion(''), null);
  assert.equal(calibration.fromQuestion(undefined), null);
});
