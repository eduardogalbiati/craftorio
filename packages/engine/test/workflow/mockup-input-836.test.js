// #836 Mockups phase 3, the workflows:
// - the dev workflows (workflows/feature.yaml, workflows/fix.yaml and the repository's own
//   .craftorio/workflows/ai-development-local-hero.yaml) take an OPTIONAL `mockup` input (a string, default
//   ''): the folder of a frozen mockup version (packages/engine/fronts/plan/domains/mockups.js freezeVersion: its
//   index.html and kit/); the develop step reads it (the developer sees the screen and its kit), and a run
//   without it behaves as today;
// - "Matches the mockup": with a `mockup` input, the UI reviewer (feature and the hero's code_review prompt,
//   and its rubric in skills/ui-conventions/SKILL.md, the "Evidence and UI reviewer" section) compares the
//   screenshots with the frozen screen and reports each difference as a finding;
// - workflows/mockup-generate.yaml gets a running-app source: `mode` recreate and an optional `app_url`
//   input (the page of the running app, Run App / Local preview) that the design step reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { loadWorkflow } = require('../../engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const DEV_WORKFLOWS = ['workflows/feature.yaml', 'workflows/fix.yaml', '.craftorio/workflows/ai-development-local-hero.yaml'];
const UI_REVIEWED = ['workflows/feature.yaml', '.craftorio/workflows/ai-development-local-hero.yaml'];
const raw = (rel) => yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const step = (wf, id) => (wf.steps || []).find((s) => s.id === id);
const readsMockup = (text) => /\binputs\.mockup\b/.test(String(text ?? ''));

test('#836 every dev workflow declares a `mockup` input', () => {
  assert.deepEqual(DEV_WORKFLOWS.filter((f) => !raw(f).inputs?.mockup), []);
});

test('#836 the `mockup` input is optional: a string, not required, empty by default', () => {
  const wrong = DEV_WORKFLOWS.filter((f) => {
    const i = raw(f).inputs?.mockup;
    return !i || i.type !== 'string' || i.required === true || i.default !== '';
  });
  assert.deepEqual(wrong, []);
});

test('#836 every dev workflow still loads with its `mockup` input', () => {
  assert.deepEqual(DEV_WORKFLOWS.map((f) => loadWorkflow(path.join(ROOT, f)).inputs?.mockup?.default ?? null), ['', '', '']);
});

test('#836 the develop step of every dev workflow reads the `mockup` input (the developer sees the screen and its kit)', () => {
  const blind = DEV_WORKFLOWS.filter((f) => {
    const wf = raw(f);
    return !readsMockup(step(wf, 'develop')?.prompt) && !readsMockup(wf.agents?.developer?.system_prompt);
  });
  assert.deepEqual(blind, []);
});

test('#836 the UI reviewer\'s code_review prompt reads the `mockup` input', () => {
  assert.deepEqual(UI_REVIEWED.filter((f) => !readsMockup(step(raw(f), 'code_review')?.prompt)), []);
});

test('#836 the UI reviewer\'s code_review prompt asks whether the screen matches the mockup', () => {
  assert.deepEqual(UI_REVIEWED.filter((f) => !/matches the mockup/i.test(String(step(raw(f), 'code_review')?.prompt ?? ''))), []);
});

test('#836 the UI reviewer\'s rubric (ui-conventions, Evidence and UI reviewer) has a "Matches the mockup" item', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'ui-conventions', 'SKILL.md'), 'utf8');
  const at = skill.indexOf('## Evidence and UI reviewer');
  const next = skill.indexOf('\n## ', at + 1);
  const section = at < 0 ? '' : skill.slice(at, next < 0 ? undefined : next);
  assert.equal(/matches the mockup/i.test(section), true);
});

// ---- mockup-generate: the running-app source -------------------------------------------------------

const GENERATE = 'workflows/mockup-generate.yaml';

test('#836 mockup-generate has a recreate mode (the running-app source), generate staying the default', () => {
  const mode = raw(GENERATE).inputs?.mode;
  assert.deepEqual([(mode?.enum || []).includes('recreate'), mode?.default], [true, 'generate']);
});

test('#836 mockup-generate declares an optional app_url input (the running app\'s page)', () => {
  const i = raw(GENERATE).inputs?.app_url;
  assert.deepEqual([i?.type, i?.required === true, i?.default], ['string', false, '']);
});

test('#836 mockup-generate\'s design step reads app_url', () => {
  assert.equal(/\binputs\.app_url\b/.test(String(step(raw(GENERATE), 'design')?.prompt ?? '')), true);
});

test('#836 mockup-generate still loads with its running-app source', () => {
  assert.equal(loadWorkflow(path.join(ROOT, GENERATE)).inputs?.app_url?.default ?? null, '');
});
