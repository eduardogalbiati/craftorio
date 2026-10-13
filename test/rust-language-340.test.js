// #340: Rust as a supported language: the Rust skill family (unit-test-writer-rust,
// e2e-test-writer-rust, build-audit-rust), code-review's rules/rust.md, `rust` (label "Rust") in
// every workflow's `language` input, the toolchain allowlists with cargo, and a `language` that
// takes several values ("js,rust") while a single value keeps working. Static checks only: the
// skills loaded for the files a run changed are in test/slow/language-skills-340.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const skills = require('../src/skills');
const { loadWorkflow, WorkflowRun } = require('../src/engine/workflow');

const root = path.join(__dirname, '..');
const SKILLS = path.join(root, 'skills');
const WORKFLOWS = ['ai-development-local-hero', 'software-development', 'software-development-local-hero', 'e2e-release', 'test-batch'];
const body = (id) => skills.resolveSkill([SKILLS], id).body;
// a `*toolchains` anchor inside a tools list arrives as a nested list
const toolsOf = (agent) => (agent.capabilities?.tools || []).flat(Infinity).map(String);

// ---- the Rust skill family --------------------------------------------------------------------

test('unit-test-writer-rust: runs the suite and one test with cargo test (nextest when present), integration tests under tests/', () => {
  const text = body('unit-test-writer-rust');
  assert.match(text, /cargo test/);
  assert.match(text, /nextest/);
  assert.match(text, /`tests\/`/);
  assert.match(text, /CARGO_TARGET_DIR/);
});

test('e2e-test-writer-rust: an E2E skill of its own, built on the shared e2e-scenarios rules like its siblings', () => {
  const skill = skills.resolveSkill([SKILLS], 'e2e-test-writer-rust');
  assert.ok(skill.body.trim().length > 0);
  assert.match(skill.body, /cargo/);
});

test('build-audit-rust: clippy with warnings as errors, fmt --check, a per-worktree CARGO_TARGET_DIR and the never-crash rules', () => {
  const text = body('build-audit-rust');
  assert.match(text, /cargo clippy[^\n]*-- -D warnings/);
  assert.match(text, /cargo fmt --check/);
  assert.match(text, /CARGO_TARGET_DIR/);
  assert.match(text, /worktree/);
  for (const banned of ['unwrap', 'expect', 'panic!']) assert.ok(text.includes(banned), `build-audit-rust names ${banned}`);
  assert.match(text, /Result/);
  assert.match(text, /clippy\.toml/);
});

// ---- code-review: rules/rust.md ---------------------------------------------------------------

test('code-review: .rs files are reviewed with rules/rust.md, which exists and covers unsafe, errors, blocking in async and handles', () => {
  const review = skills.resolveSkill([SKILLS], 'code-review');
  const rules = fs.readFileSync(path.join(SKILLS, 'code-review', 'rules', 'rust.md'), 'utf8');
  assert.match(rules, /unsafe/);
  assert.match(rules, /lifetime/i);
  assert.match(rules, /Result/);
  assert.match(rules, /async/);
  assert.match(rules, /block/i);
  const row = review.body.split('\n').find((l) => l.includes('`rules/rust.md`'));
  assert.ok(row, 'the extensions table has a row for rules/rust.md');
  assert.match(row, /`\.rs`/);
});

// ---- the workflows' `language` input and toolchains -------------------------------------------

test('every workflow with a language input offers rust, labelled "Rust", next to the five languages it had', () => {
  for (const name of WORKFLOWS) {
    const def = loadWorkflow(path.join(root, 'workflows', `${name}.yaml`)).inputs.language;
    assert.ok(def, `${name} has a language input`);
    for (const lang of ['js', 'python', 'go', 'java', 'csharp', 'rust']) assert.ok(def.enum.includes(lang), `${name}: ${lang} in the language enum`);
    assert.equal(def.options?.rust, 'Rust', `${name}: the label of rust`);
    assert.equal(def.default, 'js', `${name}: the default is still js`);
  }
});

test('every agent allowed the language toolchains may run cargo (the Rust skills run cargo test / clippy / fmt)', () => {
  for (const name of WORKFLOWS) {
    const wf = loadWorkflow(path.join(root, 'workflows', `${name}.yaml`));
    for (const [id, agent] of Object.entries(wf.agents || {})) {
      const tools = toolsOf(agent);
      if (!tools.includes('bash:go')) continue; // not an agent of the language toolchains
      assert.ok(tools.includes('bash:cargo'), `${name}: agent ${id} has bash:cargo`);
    }
  }
});

// ---- several languages in one value ------------------------------------------------------------

function newRun(t, file, inputs) {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-340-'));
  t.after(() => fs.rmSync(runsDir, { recursive: true, force: true }));
  return new WorkflowRun({ file: path.join(root, 'workflows', file), inputs: { task: 'Rust skills', repo_path: root, project_path: root, ...inputs }, mock: true, runsDir });
}

test('language: a comma-separated list of known languages is accepted ("js,rust", "rust, js")', (t) => {
  for (const name of WORKFLOWS) {
    for (const language of ['js,rust', 'rust, js']) {
      assert.doesNotThrow(() => newRun(t, `${name}.yaml`, { language }), `${name}: language "${language}"`);
    }
  }
});

test('language: a single value keeps working (js, rust), and an unknown language is still refused, alone or in a list', (t) => {
  for (const language of ['js', 'rust']) assert.doesNotThrow(() => newRun(t, 'software-development.yaml', { language }), language);
  for (const language of ['cobol', 'js,cobol']) {
    assert.throws(() => newRun(t, 'software-development.yaml', { language }), /language/, language);
  }
});
