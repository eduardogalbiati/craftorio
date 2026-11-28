// #130: the developer step's output the shared fragments read (`steps | developer_output`): develop, else refactor.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { developerOutput, render } = require('../../engine/run/templates');

test('#130 developer_output: develop first, refactor otherwise, {} when none answered', () => {
  assert.equal(developerOutput({ develop: { output: { branch: 'd' } }, refactor: { output: { branch: 'r' } } }).branch, 'd');
  assert.equal(developerOutput({ develop: { visits: 0 }, refactor: { output: { branch: 'r' } } }).branch, 'r');
  assert.deepEqual(developerOutput({}), {});
  assert.deepEqual(developerOutput(undefined), {});
});

test('#130 developer_output as a filter in a template', () => {
  const out = render('{% set dev = steps | developer_output %}{{ dev.branch }}|{{ dev.summary }}', { steps: { refactor: { output: { branch: 'refactor/x', summary: 'ok' } } } });
  assert.equal(out, 'refactor/x|ok');
});
