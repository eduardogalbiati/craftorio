// #404 internals: src/engine/check-step.js (which command a project's rule checks run, the lines
// kept as findings, a run of the command: pass, fail, skipped, timed out) and the `check_command`
// template filter the routes to rule_check test (src/engine/run/templates.js). Real commands
// (`node <script>`) in temp folders: local, free and fast. The mock runs are in
// test/slow/check-step-404.slow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkCommand, findingLines, runCheck } = require('../src/engine/check-step');
const { render, evalExpr } = require('../src/engine/run/templates');

function tmpDir(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-step-404-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
  return dir;
}
const pkg = (scripts) => JSON.stringify({ name: 'fixture', version: '1.0.0', scripts });

test('checkCommand: a given command wins over the project\'s check script', (t) => {
  const dir = tmpDir(t, { 'package.json': pkg({ check: 'node check.js' }) });
  assert.equal(checkCommand(dir, '  make lint  '), 'make lint');
});

test('checkCommand: the project\'s check script gives npm run check', (t) => {
  const dir = tmpDir(t, { 'package.json': pkg({ check: 'node check.js' }) });
  assert.equal(checkCommand(dir, ''), 'npm run check');
});

test('checkCommand: no package.json, no check script, an empty one or an unreadable package.json give null', (t) => {
  assert.equal(checkCommand(tmpDir(t), ''), null);
  assert.equal(checkCommand(tmpDir(t, { 'package.json': pkg({ test: 'node --test' }) }), ''), null);
  assert.equal(checkCommand(tmpDir(t, { 'package.json': pkg({ check: '   ' }) }), ''), null);
  assert.equal(checkCommand(tmpDir(t, { 'package.json': '{ not json' }), ''), null);
  assert.equal(checkCommand(null, ''), null);
});

test('findingLines drops blank lines, npm banners and npm error lines', () => {
  const log = ['', '> fixture@1.0.0 check', '> node check.js', '', 'layers: src/a.js:2 requires src/b.js', '   ', 'checks: 1 finding', 'npm error Lifecycle script `check` failed', 'npm ERR! code 1'].join('\r\n');
  assert.deepEqual(findingLines(log), ['layers: src/a.js:2 requires src/b.js', 'checks: 1 finding']);
});

test('findingLines keeps the last 40 lines', () => {
  const lines = findingLines(Array.from({ length: 50 }, (_, i) => `finding ${i + 1}`).join('\n'));
  assert.equal(lines.length, 40);
  assert.equal(lines[0], 'finding 11');
  assert.equal(lines[39], 'finding 50');
});

test('runCheck: a passing command passes and writes its log', async (t) => {
  const dir = tmpDir(t, { 'ok.js': "console.log('checks: pass');\n" });
  const logFile = path.join(tmpDir(t), 'logs', 'check-1.log');
  const out = await runCheck({ dir, command: 'node ok.js', logFile });
  assert.equal(out.status, 'pass');
  assert.equal(out.command, 'node ok.js');
  assert.match(fs.readFileSync(logFile, 'utf8'), /checks: pass/);
});

test('runCheck: a failing command fails with its finding lines in the message', async (t) => {
  const dir = tmpDir(t, { 'bad.js': "console.log('code-health: scripts/x.js:f has complexity 41');\nprocess.exit(1);\n" });
  const out = await runCheck({ dir, command: 'node bad.js', logFile: path.join(tmpDir(t), 'check-1.log') });
  assert.equal(out.status, 'fail');
  assert.deepEqual(out.findings, ['code-health: scripts/x.js:f has complexity 41']);
  assert.match(out.message, /exited with code 1/);
  assert.match(out.message, /complexity 41/);
});

test('runCheck: a project without a check command, or a missing folder, is skipped', async (t) => {
  const none = await runCheck({ dir: tmpDir(t), command: '', logFile: path.join(tmpDir(t), 'check-1.log') });
  assert.equal(none.status, 'skipped');
  assert.match(none.message, /skip/i);
  const gone = await runCheck({ dir: path.join(os.tmpdir(), 'check-step-404-no-such-folder'), command: 'node x.js', logFile: path.join(tmpDir(t), 'check-1.log') });
  assert.equal(gone.status, 'skipped');
});

test('runCheck: a command that runs too long fails as timed out', { timeout: 60000 }, async (t) => {
  const dir = tmpDir(t, { 'slow.js': 'setTimeout(() => {}, 30000);\n' });
  const out = await runCheck({ dir, command: 'node slow.js', logFile: path.join(tmpDir(t), 'check-1.log'), timeoutMs: 1000 });
  assert.equal(out.status, 'fail');
  assert.match(out.message, /timed out/);
});

test('the check_command filter: the given command, the project\'s script, or \'\' (the route to the check step is skipped)', (t) => {
  const withScript = tmpDir(t, { 'package.json': pkg({ check: 'node check.js' }) });
  const without = tmpDir(t, { 'package.json': pkg({}) });
  const tpl = '{{ worktree_dir | check_command(inputs.check_command) }}';
  assert.equal(render(tpl, { worktree_dir: withScript, inputs: { check_command: '' } }), 'npm run check');
  assert.equal(render(tpl, { worktree_dir: without, inputs: { check_command: 'node lint.js' } }), 'node lint.js');
  assert.equal(render(tpl, { worktree_dir: without, inputs: { check_command: '' } }), '');
  assert.equal(render(tpl, { worktree_dir: path.join(without, 'missing'), inputs: { check_command: 'node lint.js' } }), '');
  assert.equal(render(tpl, { worktree_dir: '', inputs: { check_command: 'node lint.js' } }), '');
  assert.equal(evalExpr('worktree_dir | check_command(inputs.check_command)', { worktree_dir: without, inputs: { check_command: '' } }) ? 'truthy' : 'falsy', 'falsy');
});
