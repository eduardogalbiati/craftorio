// The UI reviewer applied this orchestrator's own rule ("One click, one way back": Undo in a toast)
// to a user's to-do app as a blocking finding, and the developer built an Undo toast nobody asked for
// (exploratory run 20261126-092137-d3e664e6, about US$ 1.5 of extra rounds). In another project the
// house rules are guidance: never blocking, never a behaviour the task did not ask for.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../packages/engine/engine/run/load');

const root = path.join(__dirname, '..');

for (const rel of ['workflows/feature.yaml', '.craftorio/workflows/ai-development-local-hero.yaml', '.craftorio/workflows/ai-development-remote-hero.yaml']) {
  test(`${rel}: the UI reviewer judges a project by its own conventions, never blocking on this orchestrator's house rules`, () => {
    const wf = loadWorkflow(path.join(root, rel));
    const prompts = wf.steps.map((s) => s.prompt || '').filter((p) => p.includes("agent == 'ui_reviewer'"));
    assert.ok(prompts.length, 'the ui_reviewer prompt');
    for (const p of prompts) {
      assert.match(p, /Judge the project by its own conventions/);
      assert.match(p, /never blocking[\s\S]*never asks for a behaviour the task did not ask for/);
    }
  });
}

test('the ui-conventions skill says whose conventions come first', () => {
  const text = fs.readFileSync(path.join(root, 'skills/ui-conventions/SKILL.md'), 'utf8');
  assert.match(text, /\*\*Whose conventions\.\*\* A project's own docs, design system and existing screens come first/);
  assert.match(text, /never blocks on a missing\s+house rule/);
});
