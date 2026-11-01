// #647 Write doc phase 1 (docs/work/write-doc/spec.md R5, R6, R10): workflows/write-doc.yaml and its two
// skills. Run once per stage document: evidence (type: screenshots) → draft (the `writer` agent) →
// edit with you (type: human_edit) → review (the `reviewer` agent) → approval (human_approval). The
// `document` input picks intent or spec; the writer loads intent-writing or spec-writing accordingly,
// in one persistent session that goes fresh after 55m idle. Written before the files exist: each test
// reads them itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('@multiagent/engine/engine/workflow');
const { root } = require('@multiagent/engine/test/engine-helpers');

const load = () => loadWorkflow(path.join(root, 'workflows', 'write-doc.yaml'));
const skill = (id) => fs.readFileSync(path.join(root, 'skills', id, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');

test('#647 write-doc.yaml goes evidence, writer draft, human_edit, reviewer review, human_approval, in that order', () => {
  const steps = load().steps;
  const at = (from, ok) => steps.findIndex((s, i) => i > from && ok(s));
  const agentStep = (s, agent) => (!s.type || s.type === 'agent') && s.agent === agent;
  const evidence = at(-1, (s) => s.type === 'screenshots');
  const draft = at(evidence, (s) => agentStep(s, 'writer'));
  const edit = at(draft, (s) => s.type === 'human_edit');
  const review = at(edit, (s) => agentStep(s, 'reviewer'));
  const approval = at(review, (s) => s.type === 'human_approval');
  assert.deepEqual([evidence, draft, edit, review, approval].map((i) => i >= 0), [true, true, true, true, true],
    steps.map((s) => `${s.id}:${s.type || s.agent}`).join(' → '));
});

test('#647 the human_edit step of write-doc.yaml sends the requests to the writer', () => {
  const edit = load().steps.find((s) => s.type === 'human_edit');
  assert.equal(edit?.agent, 'writer');
});

test('#647 the document input of write-doc.yaml offers intent and spec', () => {
  const choices = load().inputs.document.enum;
  assert.deepEqual(['intent', 'spec'].map((d) => choices.includes(d)), [true, true]);
});

test('#647 the writer of write-doc.yaml loads intent-writing or spec-writing', () => {
  const skills = JSON.stringify(load().agents.writer.skills || []);
  assert.deepEqual(['intent-writing', 'spec-writing'].map((id) => skills.includes(id)), [true, true], skills);
});

test('#647 the writer of write-doc.yaml keeps one persistent session that goes fresh after 55m idle', () => {
  const wf = load();
  assert.equal(wf.agents.writer.session, 'persistent');
  assert.equal(wf.agents.writer.fresh_after_idle ?? wf.defaults?.fresh_after_idle, '55m');
});

test('#647 the intent-writing skill names itself, has a rubric and the intent\'s playbook sections', () => {
  const text = skill('intent-writing');
  assert.match(text, /^---\nname: intent-writing\n/);
  assert.match(text, /rubric/i);
  const sections = ['Problem', 'Proposed outcome', 'Affected users and systems', 'Constraints', 'Open questions'];
  assert.deepEqual(sections.filter((s) => !text.includes(s)), []);
});

test('#647 the spec-writing skill names itself, has a rubric and the spec\'s playbook sections', () => {
  const text = skill('spec-writing');
  assert.match(text, /^---\nname: spec-writing\n/);
  assert.match(text, /rubric/i);
  const sections = ['Requirements', 'Design', 'Areas of concern', 'Open questions'];
  assert.deepEqual(sections.filter((s) => !text.includes(s)), []);
});
