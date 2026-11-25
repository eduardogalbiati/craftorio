// #50, edge cases of the rule check that finds the project's tools: more scripts that rewrite files, the options each
// language's tool runs with and what leaves it out (check-tools.js), more output formats (check-findings.js), and how
// the step ends when the base or the tool cannot be used (check-step.js, with a fake command runner) and what the
// machine step records of it (run/machine-steps.js). The behaviour is in check-step-found.test.js, the other details
// in check-tools-internals-50.test.js and check-found-review-50.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runDefaultsWith } = require('../domains/project/project-run-defaults');
const { compareFindings, parseFindings } = require('../engine/check-findings');
const { runCheck } = require('../engine/check-step');
const { foundChecks } = require('../engine/check-tools');
const { methods } = require('../engine/run/machine-steps');
const { evalExpr, render } = require('../engine/run/templates');

function tmp(t, files = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'check-edges-50-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, { mode: 0o755 });
  }
  return dir;
}
const scripts = (s) => ({ 'package.json': JSON.stringify({ scripts: s }) });
const NO_PATH = { PATH: '' };
// the environment of a machine with these programs installed, and no other
const withTools = (t, ...names) => ({ PATH: tmp(t, Object.fromEntries(names.flatMap((n) => [[n, '#!/bin/sh\n'], [`${n}.cmd`, '']]))), PATHEXT: '.CMD' });
const commandsOf = (dir, env, platform) => foundChecks(dir, { env, ...(platform ? { platform } : {}) }).checks.map((c) => c.command);

// ---- scripts that rewrite files --------------------------------------------------------------------

for (const [what, s, why] of [
  ['its post script', { lint: 'eslint .', postlint: 'eslint . --fix' }, '--fix'],
  ['a pnpm script', { lint: 'pnpm lint:js', 'lint:js': 'eslint . --fix' }, '--fix'],
  ['a yarn script', { lint: 'yarn run lint:js', 'lint:js': 'biome check --write .' }, '--write'],
  ['a parallel list', { lint: 'npm-run-all "lint:*"', 'lint:a': 'eslint .', 'lint:b': 'biome check --apply .' }, '--apply'],
  ['two levels of scripts', { lint: 'npm run a', a: 'npm run b', b: 'eslint --fix .' }, '--fix'],
  ['gofmt -w', { lint: 'gofmt -w . && go vet ./...' }, '-w'],
  ['cargo fmt', { lint: 'cargo fmt && cargo clippy' }, 'cargo fmt'],
  ['dotnet format', { lint: 'dotnet format' }, 'dotnet format'],
  ['a script run with npm run --silent', { lint: 'npm run --silent lint:js', 'lint:js': 'eslint . --fix' }, '--fix'],
  ['a script run with npm run -s', { lint: 'npm run -s lint:js', 'lint:js': 'eslint . --fix' }, '--fix'],
  ['a script run with pnpm --silent', { lint: 'pnpm --silent lint:js', 'lint:js': 'eslint . --fix' }, '--fix'],
  ['a script run with pnpm --filter', { lint: 'pnpm --filter app run lint:js', 'lint:js': 'eslint . --fix' }, '--fix'],
  ['a script run with npm run --loglevel', { lint: 'npm run --loglevel error lint:js', 'lint:js': 'eslint . --fix' }, '--fix'],
]) {
  test(`#50 a lint script that rewrites files is said, not run: ${what}`, (t) => {
    const found = foundChecks(tmp(t, scripts(s)), { env: NO_PATH });
    assert.deepEqual(found, { checks: [], rewrites: [{ name: 'npm run lint', why }] });
  });
}

for (const [what, s] of [
  ['scripts that run each other', { lint: 'npm run a', a: 'npm run lint' }],
  ['a fixing script it does not run', { lint: 'eslint .', 'lint:fix': 'eslint . --fix' }],
  ['an argument named like a fixing script', { lint: 'npm run ok -- fix', ok: 'eslint .', fix: 'eslint . --fix' }],
  ['cargo fmt --check', { lint: 'cargo fmt --check' }],
  ['prettier --check', { lint: 'prettier --check .' }],
]) {
  test(`#50 a lint script that only reads runs: ${what}`, (t) => {
    assert.deepEqual(foundChecks(tmp(t, scripts(s)), { env: NO_PATH }), { checks: [{ command: 'npm run lint', tool: 'lint' }], rewrites: [] });
  });
}

// ---- what each language's rule finds ---------------------------------------------------------------

test('#50 no folder, an empty one or a broken package.json finds nothing', (t) => {
  for (const dir of [null, '', tmp(t), tmp(t, { 'package.json': '{ "scripts": ' })]) {
    assert.deepEqual(foundChecks(dir, { env: NO_PATH }), { checks: [], rewrites: [] });
  }
});

test('#50 a blank lint script counts as none: the local ESLint runs, configured in package.json or a .eslintrc', (t) => {
  const bins = { 'node_modules/.bin/eslint': '', 'node_modules/.bin/eslint.cmd': '' };
  const inPackage = tmp(t, { ...bins, 'package.json': JSON.stringify({ scripts: { lint: ' ' }, eslintConfig: {} }) });
  const inFile = tmp(t, { ...bins, ...scripts({}), '.eslintrc.yml': '' });
  const eslint = path.join('node_modules', '.bin', 'eslint');
  assert.deepEqual(commandsOf(inPackage, NO_PATH, 'linux'), [`${eslint} .`]);
  assert.deepEqual(commandsOf(inFile, NO_PATH, 'linux'), [`${eslint} .`]);
  assert.deepEqual(commandsOf(inFile, NO_PATH, 'win32'), [`${eslint}.cmd .`]);
});

test('#50 python: ruff\'s own file configures it, and ruff is told not to fix', (t) => {
  for (const file of ['ruff.toml', '.ruff.toml']) {
    const [command, ...more] = commandsOf(tmp(t, { [file]: 'fix = true\n' }), withTools(t, 'ruff', 'mypy'));
    assert.match(command, /^ruff check .*--no-fix\b/);
    assert.deepEqual(more, [], 'mypy is installed but not configured');
  }
});

test('#50 go: a linter configuration outside a module finds nothing; in one it downloads nothing', (t) => {
  const env = withTools(t, 'golangci-lint');
  assert.deepEqual(commandsOf(tmp(t, { '.golangci.yml': '' }), env), []);
  const [check] = foundChecks(tmp(t, { '.golangci.toml': '', 'go.work': '' }), { env }).checks;
  assert.deepEqual([check.command, check.env], ['golangci-lint run', { GOPROXY: 'off' }]);
});

test('#50 rust: needs clippy installed beside cargo, keeps a Cargo.lock as it is and stays offline', (t) => {
  const files = { 'Cargo.toml': '[workspace.lints.clippy]\nall = "warn"\n' };
  const env = withTools(t, 'cargo', 'cargo-clippy');
  assert.deepEqual(commandsOf(tmp(t, files), withTools(t, 'cargo')), []);
  assert.match(commandsOf(tmp(t, files), env)[0], /^cargo clippy --offline /);
  assert.match(commandsOf(tmp(t, { ...files, 'Cargo.lock': '' }), env)[0], /^cargo clippy --frozen /);
  assert.deepEqual(commandsOf(tmp(t, { 'Cargo.toml': '[package]\nname = "a"\n' }), env), [], 'clippy is not configured');
});

test('#50 java: a Checkstyle plugin commented out of the pom finds nothing', (t) => {
  const plugin = '<plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>';
  const env = withTools(t, 'mvn');
  assert.equal(commandsOf(tmp(t, { 'pom.xml': `<project>${plugin}</project>` }), env).length, 1);
  assert.deepEqual(commandsOf(tmp(t, { 'pom.xml': `<project><!-- ${plugin} --></project>` }), env), []);
});

test('#50 c#: analyzers of Directory.Build.props or .editorconfig count; a project with none finds nothing', (t) => {
  const env = withTools(t, 'dotnet');
  const project = { 'a.csproj': '<Project></Project>' };
  assert.deepEqual(commandsOf(tmp(t, project), env), []);
  for (const extra of [{ 'Directory.Build.props': '<Project><AnalysisLevel>latest</AnalysisLevel></Project>' }, { '.editorconfig': '[*.cs]\ndotnet_diagnostic.CA1822.severity = error\n' }]) {
    const [command] = commandsOf(tmp(t, { ...project, ...extra }), env);
    assert.match(command, /^dotnet build --no-restore\b/);
  }
});

// ---- what a tool's output says ---------------------------------------------------------------------

const linesOf = (text, dir) => parseFindings(text, dir).map((f) => f.line);

test('#50 Prettier\'s files, colours, CRLF and several ESLint headers are read; a Prettier summary is not a file', (t) => {
  const dir = tmp(t, { 'src/a.js': '' });
  assert.deepEqual(linesOf('[warn] src/a.js\n[warn] Code style issues found. Run it.', dir), ['src/a.js']);
  assert.deepEqual(linesOf('\u001b[31msrc/a.js:2:1: bad\u001b[0m\r\nsrc/b.js:3:1: worse\r\n', dir), ['src/a.js:2:1: bad', 'src/b.js:3:1: worse']);
  assert.deepEqual(linesOf(`${dir}/a.js\n  1:5  error  X  r\n  2:5  error  Y  s\n\n${dir}/b.js\n  9:1  error  X  r\n`, dir), ['a.js:1:5: error X r', 'a.js:2:5: error Y s', 'b.js:9:1: error X r']);
});

test('#50 a finding is the same one when only the line its text names or the checkout\'s folder changed', (t) => {
  const here = tmp(t);
  const base = tmp(t);
  const text = (dir, line) => `${dir}/a.py:${line}: error: name "x" already defined on line ${line - 2} of ${dir}/a.py`;
  assert.deepEqual(compareFindings(parseFindings(text(here, 12), here), parseFindings(text(base, 4), base)), { added: [], old: 1 });
});

// ---- how the step ends -----------------------------------------------------------------------------

// a lint script whose command is faked, in the checkout and on the base; `over` goes to runCheck
async function fakeCheck(t, { now, before = {}, files = scripts({ lint: 'x' }), env = NO_PATH, ...over }) {
  const dir = tmp(t, files);
  const baseDir = tmp(t, files);
  const logs = tmp(t);
  const ran = [];
  const run = async ({ command, cwd, logFile, env: toolEnv }) => {
    const r = cwd === dir ? now : before;
    ran.push({ command, where: cwd === dir ? 'checkout' : 'base', log: path.basename(logFile), env: toolEnv });
    fs.appendFileSync(logFile, r.text || '');
    return { code: 1, timedOut: false, error: null, ...r };
  };
  const out = await runCheck({ dir, command: '', logFile: path.join(logs, 'check-1.log'), env, run, baseCheckout: async () => ({ dir: baseDir }), ...over });
  return { out, ran, logs };
}
const BAD = { text: 'a.js:1:1: bad' };

for (const [what, over, reason] of [
  ['the base checkout cannot be prepared', { baseCheckout: async () => { throw new Error('no disk'); } }, /no disk/],
  ['there is no base checkout', { baseCheckout: async () => null }, /no base checkout/],
  ['the base\'s folder is gone', { baseCheckout: async () => ({ dir: path.join(os.tmpdir(), 'check-edges-50-none') }) }, /no base checkout/],
  ['the tool times out on the base', { before: { code: null, timedOut: true } }, /could not run on the base/],
  ['the tool is missing on the base', { before: { code: 127 } }, /could not run on the base/],
  ['the base fails another way', { before: { ...BAD, code: 2 } }, /exits with code 2/],
]) {
  test(`#50 findings are reported without blocking when ${what}`, async (t) => {
    const { out } = await fakeCheck(t, { now: BAD, ...over });
    assert.equal(out.status, 'pass');
    assert.match(out.message.split('\n')[0], /could not be compared with the base/);
    assert.match(out.message, reason);
    assert.deepEqual(out.findings, ['a.js:1:1: bad']);
  });
}

test('#50 the base runs only when the check fails, each run into its own log', async (t) => {
  const passing = await fakeCheck(t, { now: { code: 0 } });
  assert.deepEqual(passing.ran.map((r) => r.where), ['checkout']);
  const failing = await fakeCheck(t, { now: BAD, before: { code: 0 } });
  assert.deepEqual(failing.ran.map((r) => [r.where, r.log]), [['checkout', 'check-1-lint.log'], ['base', 'check-1-lint-base.log']]);
});

test('#50 an earlier log of the same visit (a resumed run) is not read as findings', async (t) => {
  const logs = tmp(t, { 'check-1-lint.log': 'old.js:1:1: stale\n' });
  const { out } = await fakeCheck(t, { now: BAD, before: { code: 0 }, logFile: path.join(logs, 'check-1.log') });
  assert.deepEqual(out.findings, ['a.js:1:1: bad']);
});

test('#50 at most 40 new findings are shown, the rest counted, and the base\'s are counted in one line', async (t) => {
  const many = Array.from({ length: 45 }, (_, i) => `a.js:${i + 1}:1: bad ${i + 1}`).join('\n');
  const { out } = await fakeCheck(t, { now: { text: `${many}\nb.js:1:1: old` }, before: { text: 'b.js:7:1: old' } });
  assert.equal(out.status, 'fail');
  assert.equal(out.findings.length, 40);
  assert.match(out.message, /45 new findings/);
  assert.match(out.message, /and 5 more/);
  assert.match(out.message.split('\n')[0], /1 finding of `npm run lint` already on the base/);
});

test('#50 the checks stop at the first that cannot run here, or when the run stops', async (t) => {
  const files = scripts({ lint: 'x', typecheck: 'y' });
  const missing = await fakeCheck(t, { files, now: { code: 127 } });
  assert.deepEqual([missing.out.status, missing.out.failure_kind, missing.ran.map((r) => r.command)], ['fail', 'environment', ['npm run lint']]);
  const stopped = await fakeCheck(t, { files, now: BAD, signal: AbortSignal.abort() });
  assert.deepEqual(stopped.ran.map((r) => r.command), ['npm run lint']);
});

for (const [tool, files, text] of [
  ['mvn', { 'pom.xml': '<artifactId>maven-checkstyle-plugin</artifactId>' }, 'Cannot access central in offline mode'],
  ['dotnet', { 'a.csproj': '<Project><AnalysisMode>All</AnalysisMode></Project>' }, 'a.csproj(1,1): error NETSDK1004: no assets file'],
]) {
  test(`#50 ${tool} on a checkout nobody prepared is reported, never sent back`, async (t) => {
    const { out, ran } = await fakeCheck(t, { files, env: withTools(t, tool), now: { text }, before: { code: 0 } });
    assert.deepEqual([out.status, ran.length], ['pass', 1]);
    assert.match(out.message, /could not be compared with the base/);
  });
}

test('#50 a tool\'s own environment reaches its command', async (t) => {
  const { ran } = await fakeCheck(t, { files: { 'go.mod': '', '.golangci.yml': '' }, env: withTools(t, 'golangci-lint'), now: { code: 0 } });
  assert.equal(ran[0].env.GOPROXY, 'off');
});

// ---- the run and the project's defaults ------------------------------------------------------------

async function machineStep(t, step) {
  const dir = tmp(t, scripts({ lint: 'node bad.js' }));
  fs.writeFileSync(path.join(dir, 'bad.js'), "console.log('a.js:1:1: bad'); process.exit(1);\n");
  const base = tmp(t, { ...scripts({ lint: 'node bad.js' }), 'bad.js': "console.log('b.js:1:1: old'); process.exit(1);\n" });
  const events = [];
  let asked = 0;
  const run = {
    ctx: { worktree_dir: dir, where: dir }, runDir: tmp(t), abort: new AbortController(), worktree: null,
    emitEvent: (type, e) => events.push({ type, ...e }), envPassthrough: () => [], suiteBase: async () => { asked++; return { dir: base }; },
  };
  const out = await methods.runCheckStep.call(run, { id: 'rule_check', ...step }, { visits: 2 });
  return { out, events, asked };
}

test('#50 the step names the log each command really writes, and compares with the run\'s base', { timeout: 60000 }, async (t) => {
  const { out, events, asked } = await machineStep(t, {});
  assert.deepEqual([out.status, out.round, asked], ['fail', 2, 1]);
  assert.deepEqual(events.filter((e) => e.type === 'step.log').map((e) => [e.path, e.command]), [['logs/check-2-lint.log', 'npm run lint']]);
});

test('#50 a step with its own folder has no base: what it finds is reported without blocking', { timeout: 60000 }, async (t) => {
  const { out, asked } = await machineStep(t, { dir: '{{ where }}' });
  assert.deepEqual([out.status, asked], ['pass', 0]);
  assert.match(out.message, /a\.js:1:1/);
});

test('#50 the project\'s defaults list what a run would check, and the script it would not run', (t) => {
  const of = (s) => {
    const d = runDefaultsWith({ project: { folder: tmp(t, scripts(s)) } });
    return [d.check_command, d.check_commands, d.check_rewrites];
  };
  assert.deepEqual(of({ check: 'x', lint: 'eslint --fix' }), ['npm run check', ['npm run check'], []]);
  assert.deepEqual(of({ lint: 'eslint --fix', typecheck: 'tsc' }), ['', ['npm run typecheck'], [{ name: 'npm run lint', why: '--fix' }]]);
  assert.deepEqual(of({}), ['', [], []]);
});

test('#50 the route to the step is open with found checks, and closed when off or without a folder', (t) => {
  const route = (dir, command) => evalExpr('dir | check_command(command)', { dir, command });
  const dir = tmp(t, scripts({ lint: 'x', typecheck: 'y' }));
  assert.equal(!!route(dir, ''), true);
  assert.equal(render('{{ dir | check_command }}', { dir }), 'npm run lint && npm run typecheck');
  assert.equal(!!route(dir, 'off'), false);
  assert.equal(!!route(tmp(t), ''), false);
  assert.equal(!!route('', ''), false);
});
