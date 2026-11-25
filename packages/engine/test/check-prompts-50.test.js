// #50: what the developer's prompt says of the rule checks, in every workflow whose develop step names the
// check command (feature.yaml and the two AI Development heroes): the given command, the commands found in the
// project, and none when they are off: `off` is no command to run.
// Seam: the rendered develop prompt (as warm-up-reuse-758.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow, render } = require('../engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');
const HEROES = path.join(ROOT, '.craftorio', 'workflows');
const WORKFLOWS = [
  path.join(ROOT, 'workflows', 'feature.yaml'),
  path.join(HEROES, 'ai-development-local-hero.yaml'),
  path.join(HEROES, 'ai-development-remote-hero.yaml'),
].filter((f) => fs.existsSync(f));

function checkout(t, scripts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-prompts-50-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts }));
  return dir;
}

function developPrompt(file, worktree_dir, check_command) {
  return render(loadWorkflow(file).steps.find((s) => s.id === 'develop').prompt, {
    agent: 'developer', run_dir: 'C:/runs/r1', previous_step: 'warm_up', test_map: 'C:/runs/r1/test-map.md', worktree_dir, vars: {},
    inputs: { task: 'x', base_branch: 'main', issues: [], screenshots: 'all', mode: 'auto', repo_path: 'C:/repo', check_command },
    steps: {
      acceptance_tests: { output: { branch: 'feat', tests_added: [], committed: true, commit: 'abc1234', criteria: [], affected_tests: [] } },
      red_check: { output: { status: 'fail', message: 'red', affected_tests: [] } },
    },
  });
}

for (const file of WORKFLOWS) {
  const name = path.basename(file, '.yaml');

  for (const off of ['off', 'OFF']) {
    test(`#50 ${name}: with the checks turned off (${off}) the developer is told to run no check command`, (t) => {
      const prompt = developPrompt(file, checkout(t, { check: 'x', lint: 'y' }), off);
      assert.equal(prompt.includes(`\`${off}\``), false, `the prompt gives \`${off}\` as a command`);
      assert.equal(/run the project's check command/.test(prompt), false, 'the prompt still asks for a check command');
    });
  }

  test(`#50 ${name}: the developer is told to run the given command`, (t) => {
    assert.equal(developPrompt(file, checkout(t, { lint: 'y' }), 'make lint').includes('`make lint`'), true);
  });

  test(`#50 ${name}: without a command nor a check script the developer is told the commands found`, (t) => {
    const prompt = developPrompt(file, checkout(t, { lint: 'x', typecheck: 'y' }), '');
    assert.equal(/npm run lint\b[^\n]*npm run typecheck\b/.test(prompt), true, 'the prompt does not name the found commands');
  });

  // the sentence costs prompt budget (#418): only the runs it applies to carry it
  const both = { lint: 'x', typecheck: 'y' };
  for (const [when, scripts, command, told] of [
    ['with the project\'s tools found', both, '', true],
    ['with the tools found and a blank command', both, '   ', true],
    ['with the tools found and no command input', both, undefined, true],
    ['with nothing found', {}, '', false],
    ['with a check script', { ...both, check: 'z' }, '', false],
    ['with a given command', both, 'make lint', false],
    ['with a given command and spaces around it', both, '  make lint  ', false],
    ['with the checks turned off', both, 'off', false],
  ]) {
    test(`#50 ${name}: ${when} the developer is ${told ? 'told' : 'not told'} that only what the change added goes back`, (t) => {
      const flat = developPrompt(file, checkout(t, scripts), command).replace(/\s+/g, ' ');
      assert.equal(flat.includes('the project\'s own linter and type checker'), told, 'the tools sentence');
      assert.equal(/only what your change added goes back/.test(flat), told, 'the base findings sentence');
      assert.equal(flat.includes('Your turn ends at green acceptance tests'), true, 'the paragraph after it stays');
    });
  }
}
