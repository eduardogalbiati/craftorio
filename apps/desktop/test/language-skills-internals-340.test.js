// #340 internals: packages/engine/engine/language-skills.js (which languages a run's changed files need, the
// skill names expanded per language) and the multi-value control of apps/desktop/renderer/workflow-inputs.js
// (a `multiple: true` enum: one toggle per value, the value comma-separated).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  expandSkillNames,
  filesChangedByOutputs,
  isLanguageFile,
  languagesFor,
  splitValues,
} = require('@multiagent/engine/engine/language-skills');
const { render } = require('@multiagent/engine/engine/run/templates');
const wi = require('../renderer/workflow-inputs');

test('splitValues: trims, drops empty and repeated items, keeps the order', () => {
  assert.deepEqual(splitValues('rust, js,,rust'), ['rust', 'js']);
  assert.deepEqual(splitValues(undefined), []);
});

test('isLanguageFile: by extension or by manifest, whatever the folder', () => {
  assert.equal(isLanguageFile('rust', 'crates/core/src/lib.rs'), true);
  assert.equal(isLanguageFile('rust', 'crates/core/Cargo.toml'), true);
  assert.equal(isLanguageFile('js', 'src/App.TSX'), true);
  assert.equal(isLanguageFile('js', 'crates/core/src/lib.rs'), false);
  assert.equal(isLanguageFile('cobol', 'a.cbl'), false);
});

test('languagesFor: the touched languages in the input order; nothing changed: all; none touched: the main one', () => {
  assert.deepEqual(languagesFor(['js', 'rust'], ['src/a.rs', 'src/b.js']), ['js', 'rust']);
  assert.deepEqual(languagesFor(['rust', 'js'], ['src/b.js']), ['js']);
  assert.deepEqual(languagesFor(['rust', 'js'], []), ['rust', 'js']);
  assert.deepEqual(languagesFor(['rust', 'js'], ['README.md']), ['rust']);
});

test('expandSkillNames: a language skill once per language, other names rendered once', () => {
  const scope = { inputs: { language: 'js,rust', git_platform: 'gh' } };
  const names = ['unit-test-writer-{{ inputs.language }}', 'ci-pipeline-{{ inputs.git_platform }}', 'decision-log'];
  assert.deepEqual(expandSkillNames(names, scope, ['js', 'rust'], render),
    ['unit-test-writer-js', 'unit-test-writer-rust', 'ci-pipeline-gh', 'decision-log']);
  assert.deepEqual(expandSkillNames(names, scope, ['rust'], render), ['unit-test-writer-rust', 'ci-pipeline-gh', 'decision-log']);
});

test('filesChangedByOutputs: every step output\'s files_changed, fan-out lists included', () => {
  const steps = {
    develop: { output: { files_changed: ['a.js'] } },
    fan: { output: [{ files_changed: ['b.rs'] }, { other: 1 }] },
    idle: { output: null },
  };
  assert.deepEqual(filesChangedByOutputs(steps), ['a.js', 'b.rs']);
});

test('workflow-inputs: a multiple enum is a group of toggles holding the comma-separated value', () => {
  const def = { label: 'Language', enum: ['js', 'rust'], multiple: true, options: { js: 'JavaScript', rust: 'Rust' } };
  assert.equal(wi.kind('language', def), 'multi');
  const html = wi.fieldHtml('language', def, { value: 'rust, js' });
  assert.match(html, /role="group" aria-label="Language"/);
  assert.match(html, /role="checkbox" data-wi-pill="rust" class="active" aria-checked="true"/);
  assert.match(html, /data-wi-multi="1" value="rust,js"/);
  assert.match(wi.inputPills({ inputs: { language: def } }, { language: 'rust,js' }), /Language: Rust \+ JavaScript/);
});
