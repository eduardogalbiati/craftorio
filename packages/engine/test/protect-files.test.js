// packages/engine/engine/workflow.js protect_files (#220): an agent's turn that changes a protected file is sent
// back, while the other test files stay editable (edits_tests is not set). Runs are mock runs on a
// git repository in a temp folder; `onTurn` plays the CLI's side effects before each turn is answered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun, loadWorkflow } = require('../engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

function commit(dir, message, files) {
  for (const [f, text] of Object.entries(files)) {
    write(dir, f, text);
    git(dir, 'add', f);
  }
  git(dir, 'commit', '-q', '-m', message);
}

// a repository on main: production code, an acceptance test (to be protected) and a test file the developer may edit
function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protect-files-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  commit(dir, 'base', { 'src/app.js': 'module.exports = 1;\n', 'test/acceptance.test.js': 'acceptance\n', 'test/app.test.js': 'ok\n' });
  git(dir, 'switch', '-q', '-c', 'feat');
  return dir;
}

// A mock run of one agent step `develop` whose agent protects test/acceptance.test.js.
// `protectFiles` is the agent's protect_files value (a list or a template); `editsTests: false` adds
// the agent's edits_tests guard; `stopOnRefusal` presses Stop at the first tests.refused (#456).
async function runProtected(t, { protectFiles = ['test/acceptance.test.js'], editsTests, stopOnRefusal = false, onTurn }) {
  const repo = makeRepo(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protect-files-wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'inputs:',
    '  repo_path: { type: string, required: true }',
    '  acceptance: { type: string, required: true }',
    'providers:',
    '  claude: { type: claude-code, command: claude }',
    'defaults:',
    '  working_dir: "{{ inputs.repo_path }}"',
    'agents:',
    `  developer: { provider: claude, model: m, session: handoff, protect_files: ${JSON.stringify(protectFiles)},${editsTests === false ? ' edits_tests: false,' : ''} capabilities: { tools: [read, edit, write, bash:git] } }`,
    'steps:',
    '  - id: develop',
    '    agent: developer',
    '    prompt: "Implement the feature."',
    '    output_schema: { type: object, required: [summary], properties: { summary: { type: string } } }',
    '    transitions:',
    '      - { when: "true", goto: end }',
    '',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: { repo_path: repo, acceptance: 'test/acceptance.test.js' }, mock: true, runsDir: path.join(dir, 'runs'), skillsDirs: [] });
  const events = [];
  let turn = 0;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'session.message_sent' && ev.step_id === 'develop') onTurn(repo, ++turn);
    if (stopOnRefusal && ev.type === 'tests.refused') run.stop();
  });
  await run.start();
  return { events, finished: events.find((e) => e.type === 'workflow.finished'), repo };
}

test('protect_files: a turn that changes a protected file is sent back, and the step goes on once it is put back', { timeout: 60000 }, async (t) => {
  let base;
  const { events, finished } = await runProtected(t, {
    onTurn(repo, n) {
      if (n === 1) {
        base = git(repo, 'rev-parse', 'HEAD');
        // the protected acceptance test is rewritten; the developer's own test file is edited too: that one stays editable
        commit(repo, 'feature', { 'src/app.js': 'module.exports = 2;\n', 'test/acceptance.test.js': 'rewritten\n', 'test/app.test.js': 'developer test\n' });
      }
      if (n === 2) {
        git(repo, 'checkout', base, '--', 'test/acceptance.test.js');
        git(repo, 'commit', '-q', '-m', 'put the acceptance test back');
      }
    },
  });
  assert.equal(finished.status, 'success', finished.error);
  const refused = events.filter((e) => e.type === 'tests.refused');
  assert.equal(refused.length, 1, 'only the protected file is refused');
  assert.equal(refused[0].protected, true);
  assert.equal(refused[0].agent, 'developer');
  assert.deepEqual(refused[0].files, ['test/acceptance.test.js'], 'test/app.test.js stays editable');
  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').map((e) => e.prompt);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /- test\/acceptance\.test\.js/);
  assert.match(prompts[1], /Implement the feature\./, 'the task goes along with the refusal');
});

test('protect_files: a protected file still changed after two send-backs fails the step, naming the file', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runProtected(t, {
    onTurn(repo, n) { if (n === 1) commit(repo, 'rewrite', { 'test/acceptance.test.js': 'rewritten\n' }); },
  });
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /developer changed protected files in develop and did not put them back: test\/acceptance\.test\.js/);
  assert.equal(events.filter((e) => e.type === 'tests.refused' && e.protected).length, 3);
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').length, 3);
});

test('edits_tests: false: Stop pressed at a refused test change ends the run there, with no send-back (#456)', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runProtected(t, {
    protectFiles: [],
    editsTests: false,
    stopOnRefusal: true,
    onTurn(repo, n) { if (n === 1) commit(repo, 'edit a test', { 'test/app.test.js': 'changed by the developer\n' }); },
  });
  assert.equal(finished.status, 'cancelled');
  const refused = events.filter((e) => e.type === 'tests.refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].protected, undefined, 'the edits_tests guard, not protect_files');
  assert.deepEqual(refused[0].files, ['test/app.test.js']);
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').length, 1, 'a stopped run sends nothing back');
});

test('edits_tests: false: without Stop the refused test change is still sent back (#456 keeps the guard)', { timeout: 60000 }, async (t) => {
  const { events } = await runProtected(t, {
    protectFiles: [],
    editsTests: false,
    onTurn(repo, n) {
      if (n === 1) commit(repo, 'edit a test', { 'test/app.test.js': 'changed by the developer\n' });
      if (n === 2) commit(repo, 'put it back', { 'test/app.test.js': 'ok\n' });
    },
  });
  assert.equal(events.filter((e) => e.type === 'tests.refused').length, 1);
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'develop').length, 2);
});

test('protect_files: a turn that only edits the agent\'s own test file is not refused', { timeout: 60000 }, async (t) => {
  const { events, finished } = await runProtected(t, {
    onTurn(repo, n) { if (n === 1) commit(repo, 'own test', { 'test/app.test.js': 'developer test\n' }); },
  });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(events.filter((e) => e.type === 'tests.refused').length, 0);
});

test('protect_files: a template (another step\'s output) resolves to the files it names, and those are protected', { timeout: 60000 }, async (t) => {
  // the template is resolved from the run's inputs (in ai-development-local-hero: another step's tests_added)
  const { events, finished } = await runProtected(t, {
    protectFiles: '{{ inputs.acceptance }}',
    onTurn(repo, n) { if (n === 1) commit(repo, 'rewrite', { 'test/acceptance.test.js': 'rewritten\n' }); },
  });
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /changed protected files in develop and did not put them back: test\/acceptance\.test\.js/);
});

// loadWorkflow validation of the files and of the red check (#220, #219 test_map)
test('loadWorkflow: protect_files, files, expect and test_map are checked, with the reason', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protect-files-validate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  const load = (agentExtra, stepLines) => {
    fs.writeFileSync(file, [
      'agents: { a: { provider: claude, model: m' + agentExtra + ' } }',
      'steps:',
      ...stepLines,
      '',
    ].join('\n'));
    return () => loadWorkflow(file);
  };
  const agentStep = ['  - id: s1', '    agent: a', '    prompt: "x"'];
  const suiteStep = (...extra) => ['  - id: t', '    type: suite', ...extra];

  assert.throws(load(', protect_files: 5', agentStep), /Agent "a": protect_files must be a file list/);
  assert.throws(load('', [...agentStep, '    protect_files: 5']), /Step "s1": protect_files must be a file list/);
  assert.throws(load('', suiteStep('    protect_files: "x"')), /Step "t": protect_files is only valid on an agent step/);
  assert.throws(load('', [...agentStep, '    test_map: "yes"']), /Step "s1": test_map must be true or false, on an agent step/);
  assert.throws(load('', suiteStep('    test_map: true')), /Step "t": test_map must be true or false, on an agent step/);
  assert.throws(load('', suiteStep('    files: 5')), /Step "t": files must be a file list/);
  assert.throws(load('', suiteStep('    files: "{{ steps.a.output.tests_added }}"', '    scope: affected')), /Step "t": files and scope cannot be combined/);
  assert.throws(load('', suiteStep('    expect: red')), /Step "t": expect must be "red", with files/);
  // #355: green is the green check of tests that pin the current behaviour
  assert.throws(load('', suiteStep('    files: [test/a.test.js]', '    expect: blue')), /Step "t": expect must be "red", with files/);
  assert.doesNotThrow(load('', suiteStep('    files: [test/a.test.js]', '    expect: green')));

  assert.doesNotThrow(load(', protect_files: ["test/acceptance.test.js"]', agentStep));
  assert.doesNotThrow(load('', [...agentStep, '    protect_files: "{{ steps.acceptance_tests.output.tests_added }}"', '    test_map: true']));
  assert.doesNotThrow(load('', suiteStep('    files: "{{ steps.acceptance_tests.output.tests_added }}"', '    expect: red')));
});
