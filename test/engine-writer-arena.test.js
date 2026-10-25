const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr, render } = require('../src/engine/workflow');
const evidence = require('../src/domains/evidence/evidence');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';
const { root } = require('./engine-helpers');

test('the renderer shuffle (arena-shuffle.js) gives the same order as the engine filter', () => {
  const { shuffle, sha256Word } = require('../src/renderer/views/arena/arena-shuffle.js');
  const crypto = require('crypto');
  for (const seed of ['', 'abc', '20260929-150045-d112f7dc', 'ção ✓'.repeat(40)]) {
    assert.equal(sha256Word(seed), crypto.createHash('sha256').update(seed).digest().readUInt32BE(0), seed);
    const list = ['contender_1', 'contender_2', 'contender_3', 'contender_4', 'contender_5'];
    assert.deepEqual(shuffle(list, seed), render('{{ l | shuffle(s) | join(",") }}', { l: list, s: seed }).split(','));
  }
});
test('document skills for the arena exist and have a structure and a rubric', () => {
  for (const id of ['prd-writing', 'adr-writing', 'rfc-writing', 'test-plan-writing', 'design-doc-writing', 'design-sketch']) {
    const text = fs.readFileSync(path.join(root, 'skills', id, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(`^---\r?\nname: ${id}\r?\n`), id);
    assert.match(text, /rubric/i, id);
  }
});
// ---- #160: sub-agents by default for code research (test_writer gets them too) ---------------

test('#160: test_writer gets subagents: true and the context-economy skill; the developer still has subagents: true', () => {
  for (const file of ['software-development.yaml', 'software-development-local-hero.yaml']) {
    const wf = loadWorkflow(path.join(root, 'workflows', file));
    assert.equal(wf.agents.test_writer.capabilities.subagents, true, file);
    assert.ok(wf.agents.test_writer.skills.includes('context-economy'), file);
    assert.equal(wf.agents.developer.capabilities.subagents, true, file);
  }
});
