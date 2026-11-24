// #56: an input's value that its enum no longer offers but its options still name (an earlier model) is kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const { choices, fits, keptOption, projectValue } = require('../run-inputs');

const MODEL = { enum: ['new'], options: { new: 'New', old: 'Old' }, default: 'new' };

test('#56 keptOption: only a value that options name and the enum does not', () => {
  assert.deepEqual(['old', 'new', 'other', '', undefined, 'constructor'].map((v) => keptOption(MODEL, v)), [true, false, false, false, false, false]);
});

test('#56 keptOption: an enum of numbers stays as it is, so does a multiple input and one without options', () => {
  assert.deepEqual([
    keptOption({ enum: [1, 2], options: { 1: 'One', 2: 'Two' } }, '1'),
    keptOption({ ...MODEL, multiple: true }, 'old'),
    keptOption({ enum: ['new'] }, 'old'),
  ], [false, false, false]);
});

test('#56 choices: the enum, and the kept value after it only when it is the saved one', () => {
  assert.deepEqual([choices(MODEL, 'old'), choices(MODEL, 'new'), choices(MODEL, 'other')], [['new', 'old'], ['new'], ['new']]);
});

test('#56 a multiple input takes only its enum: an option it no longer offers does not fit and is not a choice', () => {
  const many = { ...MODEL, multiple: true };
  assert.deepEqual([fits(many, 'new,old'), fits(many, 'old'), choices(many, 'old')], [false, false, ['new']]);
});

test('#56 a project value that is a kept option still fits', () => {
  assert.deepEqual([fits(MODEL, 'old'), fits(MODEL, 'other'), projectValue('model', MODEL, { model: 'old' })], [true, false, 'old']);
});
