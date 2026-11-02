// #735: the test command discovery (packages/engine/engine/suite-step.js detectTestCommand, the
// `type: suite` step's command when test_command is empty) covers Rust: Cargo.toml → `cargo test`.
// Acceptance tests written before the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectTestCommand } = require('../engine/suite-step');

function projectDir(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-step-735-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

test('#735 detectTestCommand: Cargo.toml -> cargo test', (t) => {
  const dir = projectDir(t, { 'Cargo.toml': '[package]\nname = "svc"\n' });
  assert.equal(detectTestCommand(dir), 'cargo test');
});

test('#735 detectTestCommand: a Rust crate with a tooling package.json and no npm test script runs cargo test', (t) => {
  const dir = projectDir(t, { 'Cargo.toml': '[package]\nname = "svc"\n', 'package.json': JSON.stringify({ scripts: { lint: 'prettier -c .' } }) });
  assert.equal(detectTestCommand(dir), 'cargo test');
});
