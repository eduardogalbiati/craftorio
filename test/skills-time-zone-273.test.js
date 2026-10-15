// #273 acceptance tests (written before the code): the bundled skills of the Oracle, the Product
// Owner and the Supervisor tell them to report times in the owner's time zone (their turn context
// carries it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const skill = (id) => fs.readFileSync(path.join(__dirname, '..', 'skills', id, 'SKILL.md'), 'utf8');
const SAYS = /owner'?s time zone/i;

test('#273 skill oracle: reports times in the owner\'s time zone', () => {
  assert.match(skill('oracle'), SAYS);
});

test('#273 skill backlog-product-owner: reports times in the owner\'s time zone', () => {
  assert.match(skill('backlog-product-owner'), SAYS);
});

test('#273 skill run-supervisor: reports times in the owner\'s time zone', () => {
  assert.match(skill('run-supervisor'), SAYS);
});
