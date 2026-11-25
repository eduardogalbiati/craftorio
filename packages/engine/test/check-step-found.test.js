// #50: the rule check finds the project's own linter and type checker. Acceptance tests written before the code.
//
// Contract (the interface these tests assume):
// - runCheckStep (`type: check`): the `command` given, else the project's `check` script, else the tools the
//   project configures AND has installed, every one of them run: the `lint` and `typecheck` scripts, else (each
//   on its own) the local ESLint with its configuration and the local `tsc --noEmit` with a tsconfig.json; ruff
//   and mypy (pyproject.toml), golangci-lint (.golangci.yml), cargo clippy (clippy.toml), Checkstyle through
//   Maven (pom.xml), the .NET analyzers (dotnet). Nothing is downloaded (no npx).
// - A found command that rewrites files (--fix, --write) does not run; the step's message or the run's log says so.
// - A found command's findings are compared with the base (the run's base checkout): those already there,
//   whatever their line or the checkout's folder, do not fail the step, and the message (or log) says how many
//   there are. No base to compare with: said, reported, not a failure. An environment failure still is one (#30).
// - `check_command: 'off'` turns the checks off, as a step's command and in the project's run defaults.
// - projectRunDefaults and projects:inputHints show the commands found; a run given that check_command default
//   still compares with the base.
// The exact command lines are not pinned: the tests look at what ran, where, and what came back.
//
// Seam: WorkflowRun.prototype.runCheckStep on a small run state (as check-step-dir-63.test.js), in a real git
// worktree whose base checkout is the engine's own. Fake tools: each one logs its calls outside the repository
// and reports, as `file:line:col: error: name`, every `<tool>-bug:<name>` in src/, with a summary line.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../engine/workflow');

// no user git config (identity, hooks, aliases), as on CI
const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitcfg-50-')), 'config');
fs.writeFileSync(emptyConfig, '');
process.env.GIT_CONFIG_GLOBAL = emptyConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const LIMIT = { timeout: 120000 };
const TOOLS_ON_PATH = { python: ['ruff', 'mypy'], go: ['golangci-lint'] };

function tmp(t, name) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `check-found-${name}-`)));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 }); } catch { /* left in tmp */ } });
  return dir;
}

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { mode: 0o755 });
  }
}

// ---- fake tools --------------------------------------------------------------------------------

// `when`: the arguments (as one string) the tool reports findings for; absolute: prints full paths, as ESLint does
function fakeTool(tool, log, { when = '', absolute = false } = {}) {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const probe = /^(-v|-V|--version|version|--help|help|--info|--list-sdks)$/.test(args[args.length - 1] || '');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ tool: ${JSON.stringify(tool)}, args, probe, cwd: fs.realpathSync.native(process.cwd()) }) + '\\n');
if (probe) { console.log('1.0.0'); process.exit(0); }
if (!new RegExp(${JSON.stringify(when)}).test(args.join(' '))) process.exit(0);
let count = 0;
const walk = (dir) => {
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) { walk(file); continue; }
    fs.readFileSync(file, 'utf8').split('\\n').forEach((line, i) => {
      const m = line.match(/${tool}-bug:([\\w-]+)/);
      if (!m) return;
      count++;
      console.log((${absolute} ? path.resolve(file) : file.split(path.sep).join('/')) + ':' + (i + 1) + ':1: error: ' + m[1] + ' (${tool})');
    });
  }
};
walk('src');
if (count) { console.log('Found ' + count + ' problem' + (count === 1 ? '' : 's') + '.'); process.exit(1); }
`;
}
const CMD = (target) => `@echo off\r\nnode "%~dp0${target}" %*\r\n`;

// fake tools first on PATH, for this test
function onPath(t, log, tools) {
  const bin = tmp(t, 'bin');
  for (const [name, options] of Object.entries(tools)) write(bin, { [name]: fakeTool(name, log, options), [`${name}.cmd`]: CMD(name) });
  setPath(t, `${bin}${path.delimiter}${process.env.PATH}`);
}
function setPath(t, value) {
  const before = process.env.PATH;
  process.env.PATH = value;
  t.after(() => { process.env.PATH = before; });
}

// a package installed in the project's node_modules, with its bin
function localTool(log, pkg, bin) {
  return {
    [`node_modules/${pkg}/package.json`]: JSON.stringify({ name: pkg, version: '9.0.0', bin: { [bin]: `bin/${bin}.js` } }),
    [`node_modules/${pkg}/bin/${bin}.js`]: fakeTool(bin, log),
    [`node_modules/${pkg}/bin/${bin}`]: fakeTool(bin, log),
    [`node_modules/.bin/${bin}`]: fakeTool(bin, log),
    [`node_modules/.bin/${bin}.cmd`]: CMD(bin),
  };
}

const pkg = (scripts, more = {}) => JSON.stringify({ name: 'found-50', version: '1.0.0', private: true, scripts, ...more }, null, 2);
// the package.json of a project with those scripts, each one a fake tool of its own (<name>.js)
function scripted(log, scripts, options) {
  const files = {};
  for (const name of scripts) files[`${name}.js`] = fakeTool(name, log, options);
  return { 'package.json': pkg(Object.fromEntries(scripts.map((s) => [s, `node ${s}.js`]))), ...files };
}

// ---- runs --------------------------------------------------------------------------------------

// a repository on main with the base files, and the run's worktree on a branch with the branch's files committed
function project(t, { base, branch = {} }) {
  const repo = tmp(t, 'repo');
  const worktrees = tmp(t, 'worktrees');
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, { 'src/app.txt': 'the app\n', ...base });
  git(repo, 'add', '-A', '-f');
  git(repo, 'commit', '-q', '-m', 'base');
  const dir = path.join(worktrees, 'run-50');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature-50', dir, 'main');
  if (Object.keys(branch).length) {
    write(dir, branch);
    git(dir, 'add', '-A', '-f');
    git(dir, 'commit', '-q', '-m', 'the change');
  }
  return { repo, worktrees, dir };
}

// → { out, said, dir }: the step's output, and everything the run says (the message and the log events)
async function check(t, where, command = '') {
  const events = [];
  const runDir = path.join(tmp(t, 'runs'), 'runs', 'run-50');
  fs.mkdirSync(runDir, { recursive: true });
  const { dir } = where;
  const worktree = where.repo ? { dir, workDir: dir, repo: where.repo, base: 'main', branch: 'feature-50', remote: false } : null;
  const state = Object.assign(Object.create(WorkflowRun.prototype), {
    mock: false, machine: { simulated: false }, runDir, runId: 'run-50', worktree, worktreesDir: where.worktrees || null,
    ctx: { worktree_dir: dir, inputs: {}, steps: {} }, abort: new AbortController(), wf: {},
    emitEvent: (type, data) => events.push({ type, ...data }),
  });
  const out = await state.runCheckStep({ id: 'rule_check', type: 'check', command }, { visits: 1 });
  const said = [out.message, out.cause, ...events.filter((e) => e.type === 'log').map((e) => e.message)].filter(Boolean).join('\n');
  return { out, said, dir };
}

const logFile = (t) => path.join(tmp(t, 'log'), 'calls.jsonl');
const calls = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => !c.probe) : []);
// the tools that ran (version probes aside), in the run's checkout when `dir` is given
const ran = (log, dir) => [...new Set(calls(log).filter((c) => !dir || c.cwd === fs.realpathSync.native(dir)).map((c) => c.tool))].sort();
const found = (out) => out.findings.join('\n');

// ---- order -------------------------------------------------------------------------------------

test('#50 order: the check_command given runs alone, whatever the project has', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['check', 'lint', 'typecheck']), 'given.js': fakeTool('given', log) } });
  const { out } = await check(t, p, 'node given.js');
  assert.equal(out.status, 'pass', out.message);
  assert.deepEqual(ran(log), ['given']);
});

test('#50 order: the check script runs alone, before any tool found', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: scripted(log, ['check', 'lint', 'typecheck']) });
  const { out } = await check(t, p);
  assert.equal(out.status, 'pass', out.message);
  assert.deepEqual(ran(log), ['check']);
});

test('#50 order: without both, the project\'s own lint and typecheck scripts run', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: scripted(log, ['lint', 'typecheck']) });
  const { out } = await check(t, p);
  assert.equal(out.status, 'pass', out.message);
  assert.deepEqual(ran(log, p.dir), ['lint', 'typecheck']);
});

// ---- JavaScript and TypeScript -----------------------------------------------------------------

test('#50 JS: the new findings of lint and of typecheck come back together, as a rule failure', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: scripted(log, ['lint', 'typecheck']), branch: { 'src/new.js': '// lint-bug:unused-var\n// typecheck-bug:not-a-number\n' } });
  const { out } = await check(t, p);
  assert.equal(out.status, 'fail', out.message);
  assert.equal(out.failure_kind, 'rules');
  assert.match(found(out), /src\/new\.js:1:1: error: unused-var/);
  assert.match(found(out), /src\/new\.js:2:1: error: not-a-number/);
});

const ESLINT_CONFIG = { 'eslint.config.js': 'module.exports = [];\n' };
const TSCONFIG = { 'tsconfig.json': '{ "compilerOptions": { "strict": true } }\n' };
const ESLINT_DEP = { devDependencies: { eslint: '^9.0.0', typescript: '^5.0.0' } };
const eslintAndTsc = (log) => ({ ...localTool(log, 'eslint', 'eslint'), ...localTool(log, 'typescript', 'tsc') });

test('#50 JS: without the scripts, the local ESLint and the local tsc --noEmit run', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, {
    base: { 'package.json': pkg({}, ESLINT_DEP), ...ESLINT_CONFIG, ...TSCONFIG, ...eslintAndTsc(log) },
    branch: { 'src/new.ts': '// eslint-bug:no-undef\n// tsc-bug:TS2322\n' },
  });
  const { out } = await check(t, p);
  assert.deepEqual(ran(log, p.dir), ['eslint', 'tsc']);
  assert.equal(calls(log).filter((c) => c.tool === 'tsc').every((c) => c.args.includes('--noEmit')), true);
  assert.equal(calls(log).some((c) => c.args.some((a) => /^--fix/.test(a))), false);
  assert.equal(out.status, 'fail', out.message);
  assert.match(found(out), /no-undef/);
  assert.match(found(out), /TS2322/);
});

test('#50 JS: a project with a lint script and a tsconfig.json runs the script and the local tsc', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['lint']), ...ESLINT_CONFIG, ...TSCONFIG, ...eslintAndTsc(log) } });
  const { out } = await check(t, p);
  assert.equal(out.status, 'pass', out.message);
  assert.deepEqual(ran(log, p.dir), ['lint', 'tsc']);
});

test('#50 JS: an ESLint without configuration and a tsc without tsconfig.json do not run', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { 'package.json': pkg({}, ESLINT_DEP), ...eslintAndTsc(log) } });
  const { out } = await check(t, p);
  assert.equal(out.status, 'skipped', out.message);
  assert.deepEqual(ran(log), []);
});

test('#50 JS: configured but not installed, nothing runs and nothing is downloaded', LIMIT, async (t) => {
  const log = logFile(t);
  onPath(t, log, { npx: {} });
  const p = project(t, { base: { 'package.json': pkg({}, ESLINT_DEP), ...ESLINT_CONFIG, ...TSCONFIG } });
  const { out } = await check(t, p);
  assert.equal(out.status, 'skipped', out.message);
  assert.deepEqual(ran(log), []);
  assert.equal(fs.existsSync(path.join(p.dir, 'node_modules')), false);
});

// ---- the other languages -----------------------------------------------------------------------

const POM = `<project><modelVersion>4.0.0</modelVersion><groupId>a</groupId><artifactId>b</artifactId><version>1</version>
  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-checkstyle-plugin</artifactId><version>3.4.0</version>
    <configuration><configLocation>checkstyle.xml</configLocation></configuration></plugin></plugins></build></project>
`;
const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework>
  <EnableNETAnalyzers>true</EnableNETAnalyzers><AnalysisLevel>latest</AnalysisLevel><EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild></PropertyGroup></Project>
`;
const PYTHON = { 'pyproject.toml': '[project]\nname = "svc"\nversion = "0.1.0"\n\n[tool.ruff]\nline-length = 100\n\n[tool.mypy]\nstrict = true\n', 'src/svc.py': 'x = 1\n' };
const LANGUAGES = {
  python: { files: PYTHON, tools: { ruff: { when: '^check' }, mypy: {} }, source: 'src/new.py' },
  go: { files: { 'go.mod': 'module svc\n\ngo 1.22\n', '.golangci.yml': 'version: "2"\n', 'src/svc.go': 'package svc\n' }, tools: { 'golangci-lint': { when: '^run' }, go: { when: '^no-findings$' } }, source: 'src/new.go', reports: ['golangci-lint'] },
  rust: { files: { 'Cargo.toml': '[package]\nname = "svc"\nversion = "0.1.0"\nedition = "2021"\n\n[lints.clippy]\nall = "warn"\n', 'clippy.toml': 'msrv = "1.70"\n', 'src/main.rs': 'fn main() {}\n' }, tools: { cargo: { when: 'clippy' }, 'cargo-clippy': { when: '^no-findings$' } }, source: 'src/new.rs', reports: ['cargo'] },
  java: { files: { 'pom.xml': POM, 'checkstyle.xml': '<module name="Checker"/>\n', 'src/main/java/App.java': 'class App {}\n' }, tools: { mvn: { when: 'checkstyle' } }, source: 'src/main/java/New.java' },
  csharp: { files: { 'App.csproj': CSPROJ, '.editorconfig': 'root = true\n\n[*.cs]\ndotnet_diagnostic.CA1822.severity = error\n', 'src/App.cs': 'class App {}\n' }, tools: { dotnet: { when: '^(build|format)' } }, source: 'src/New.cs' },
};

for (const [language, { files, tools, source, reports = Object.keys(tools) }] of Object.entries(LANGUAGES)) {
  test(`#50 ${language}: the tools its files configure run, and their new findings come back`, LIMIT, async (t) => {
    const log = logFile(t);
    onPath(t, log, tools);
    const p = project(t, { base: files, branch: { [source]: `${reports.map((tool) => `// ${tool}-bug:new-${tool}`).join('\n')}\n` } });
    const { out } = await check(t, p);
    assert.equal(out.status, 'fail', out.message);
    assert.equal(out.failure_kind, 'rules');
    for (const tool of reports) assert.match(found(out), new RegExp(`error: new-${tool} `));
  });
}

test('#50 the tools found for a language never rewrite files: no --fix, no dotnet format without --verify-no-changes', LIMIT, async (t) => {
  const log = logFile(t);
  onPath(t, log, Object.assign({}, ...Object.values(LANGUAGES).map((l) => l.tools)));
  for (const { files } of Object.values(LANGUAGES)) await check(t, project(t, { base: files }));
  const all = calls(log);
  assert.equal(all.length > 0, true, 'no tool ran');
  const rewrites = all.filter((c) => c.args.some((a) => /^--(fix|write)/.test(a)) || (c.tool === 'ruff' && c.args[0] === 'format' && !c.args.includes('--check'))
    || (c.tool === 'dotnet' && c.args[0] === 'format' && !c.args.includes('--verify-no-changes')));
  assert.deepEqual(rewrites, []);
});

test('#50 python: configured but not installed, the step is skipped', LIMIT, async (t) => {
  const log = logFile(t);
  const has = (dir, name) => ['', '.exe', '.cmd', '.bat'].some((ext) => fs.existsSync(path.join(dir, name + ext)));
  const dirs = process.env.PATH.split(path.delimiter).filter(Boolean);
  const kept = dirs.filter((dir) => !TOOLS_ON_PATH.python.some((tool) => has(dir, tool)));
  if (!kept.some((dir) => has(dir, 'node')) || !kept.some((dir) => has(dir, 'git'))) { t.skip('ruff or mypy share a folder with node or git here'); return; }
  setPath(t, kept.join(path.delimiter));
  onPath(t, log, { pip: {}, pipx: {}, uvx: {} });
  const { out } = await check(t, project(t, { base: PYTHON }));
  assert.equal(out.status, 'skipped', out.message);
  assert.deepEqual(ran(log), []);
});

// ---- read only ---------------------------------------------------------------------------------

for (const flag of ['--fix', '--write']) {
  test(`#50 read only: a lint script with ${flag} does not run, the run says so, and typecheck still runs`, LIMIT, async (t) => {
    const log = logFile(t);
    const p = project(t, { base: { ...scripted(log, ['lint', 'typecheck']), 'package.json': pkg({ lint: `node lint.js ${flag}`, typecheck: 'node typecheck.js' }) } });
    const { out, said } = await check(t, p);
    assert.equal(out.status, 'pass', out.message);
    assert.deepEqual(ran(log), ['typecheck']);
    assert.match(said, /\blint\b/);
    assert.match(said, /--fix|--write|rewrit/i);
  });
}

test('#50 read only: a project whose only check rewrites files is skipped, and the run says why', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['lint']), 'package.json': pkg({ lint: 'node lint.js --fix' }) } });
  const { out, said } = await check(t, p);
  assert.equal(out.status, 'skipped', out.message);
  assert.deepEqual(ran(log), []);
  assert.match(said, /\blint\b/);
  assert.match(said, /--fix|rewrit/i);
});

// ---- only what the change added ----------------------------------------------------------------

const OLD = 'one\n// lint-bug:old-one\ntwo\n// lint-bug:old-two\n';
const countOnBase = /\b2\b.*\bbase\b|\bbase\b.*\b2\b/i;

test('#50 base: findings that are all on the base do not fail the step, and the run says how many', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['lint']), 'src/old.js': OLD }, branch: { 'src/new.js': 'clean\n' } });
  const { out, said } = await check(t, p);
  assert.equal(out.status, 'pass', out.message);
  assert.match(said, countOnBase);
});

test('#50 base: among old findings, only the new one goes back to the developer, and the run says how many are old', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['lint']), 'src/old.js': OLD }, branch: { 'src/new.js': '// lint-bug:brand-new\n' } });
  const { out, said } = await check(t, p);
  assert.equal(out.status, 'fail', out.message);
  assert.equal(out.failure_kind, 'rules');
  assert.match(found(out), /brand-new/);
  assert.doesNotMatch(found(out), /old-one|old-two/);
  assert.match(said, countOnBase);
});

test('#50 base: an old finding moved by lines added above it is not new', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['lint']), 'src/old.js': OLD }, branch: { 'src/old.js': `added\nadded\nadded\n${OLD}` } });
  const { out } = await check(t, p);
  assert.equal(out.status, 'pass', out.message);
});

test('#50 base: one more of the same finding in the same file is new', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['lint']), 'src/old.js': OLD }, branch: { 'src/old.js': `${OLD}// lint-bug:old-one\n` } });
  const { out } = await check(t, p);
  assert.equal(out.status, 'fail', out.message);
  assert.match(found(out), /old-one/);
});

test('#50 base: fixing one of the old findings is not a failure (the summary line changes)', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['lint']), 'src/old.js': OLD }, branch: { 'src/old.js': 'one\ntwo\n// lint-bug:old-two\n' } });
  const { out } = await check(t, p);
  assert.equal(out.status, 'pass', out.message);
});

test('#50 base: a tool that prints full paths still finds its old findings on the base', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['lint'], { absolute: true }), 'src/old.js': OLD }, branch: { 'src/new.js': 'clean\n' } });
  const { out } = await check(t, p);
  assert.equal(out.status, 'pass', out.message);
});

test('#50 base: a given check_command is not compared: its failure goes back as today', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['lint']), 'src/old.js': OLD } });
  const { out } = await check(t, p, 'node lint.js');
  assert.equal(out.status, 'fail', out.message);
  assert.match(found(out), /old-one/);
});

test('#50 base: a project that cannot be compared with a base gets its findings reported, not a failure', LIMIT, async (t) => {
  const log = logFile(t);
  const dir = tmp(t, 'folder');
  write(dir, { ...scripted(log, ['lint']), 'src/old.js': '// lint-bug:seen-here\n' });
  const { out, said } = await check(t, { dir });
  assert.deepEqual(ran(log), ['lint']);
  assert.notEqual(out.status, 'fail', out.message);
  assert.match(`${said}\n${found(out)}`, /seen-here/);
  assert.match(said, /\bbase\b/i);
});

test('#50 a found command that cannot run here is an environment failure (#30), even without a base', LIMIT, async (t) => {
  const dir = tmp(t, 'folder');
  const lock = JSON.stringify({ name: 'found-50', version: '1.0.0', lockfileVersion: 3, requires: true, packages: {} });
  write(dir, { 'package.json': pkg({ lint: 'node lint.js' }), 'package-lock.json': lock, 'lint.js': "require('fixture-dep-50');\n" });
  const { out } = await check(t, { dir });
  assert.equal(out.status, 'fail', out.message);
  assert.equal(out.failure_kind, 'environment');
});

// ---- none, and off -----------------------------------------------------------------------------

test('#50 a project with no check, linter or type checker is skipped, as today', LIMIT, async (t) => {
  const p = project(t, { base: { 'package.json': pkg({ test: 'node --test' }) } });
  const { out } = await check(t, p);
  assert.equal(out.status, 'skipped', out.message);
  assert.deepEqual(out.findings, []);
});

test('#50 off: a check_command "off" skips the step and runs nothing', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: scripted(log, ['check', 'lint', 'typecheck']) });
  const { out } = await check(t, p, 'off');
  assert.equal(out.status, 'skipped', out.message);
  assert.deepEqual(ran(log), []);
});

// ---- the project's run defaults ----------------------------------------------------------------

const runDefaults = () => require('../domains/project/project-run-defaults');

test('#50 defaults: a project\'s run defaults show the lint and typecheck commands found', async (t) => {
  const folder = tmp(t, 'defaults');
  write(folder, scripted(logFile(t), ['lint', 'typecheck']));
  const shown = JSON.stringify(await runDefaults().projectRunDefaults({ project: { folder }, profile: null }));
  assert.match(shown, /\blint\b/);
  assert.match(shown, /\btypecheck\b/);
});

test('#50 defaults: a Python project\'s run defaults show the tools found', async (t) => {
  onPath(t, logFile(t), LANGUAGES.python.tools);
  const folder = tmp(t, 'defaults');
  write(folder, PYTHON);
  const shown = JSON.stringify(await runDefaults().projectRunDefaults({ project: { folder }, profile: null }));
  assert.match(shown, /\bruff\b/);
  assert.match(shown, /\bmypy\b/);
});

for (const own of ['off', 'npm run lint']) {
  test(`#50 defaults: the owner's check_command "${own}" wins over the commands found`, async (t) => {
    const folder = tmp(t, 'defaults');
    write(folder, scripted(logFile(t), ['lint', 'typecheck']));
    const defaults = await runDefaults().projectRunDefaults({ project: { folder, runDefaults: { check_command: own } }, profile: null });
    assert.equal(defaults.check_command, own);
  });
}

test('#50 defaults: a run given the project\'s own check_command default still lets the base\'s findings through', LIMIT, async (t) => {
  const log = logFile(t);
  const p = project(t, { base: { ...scripted(log, ['lint', 'typecheck']), 'src/old.js': OLD }, branch: { 'src/new.js': 'clean\n' } });
  const defaults = await runDefaults().projectRunDefaults({ project: { folder: p.repo }, profile: null });
  const { out } = await check(t, p, defaults.check_command);
  assert.equal(out.status, 'pass', out.message);
  assert.deepEqual(ran(log, p.dir), ['lint', 'typecheck']);
});

test('#50 defaults: projects:inputHints shows the commands found, and the owner\'s "off" once saved', async (t) => {
  const { makeService } = require('./service/helpers');
  const { api } = makeService(t);
  const folder = tmp(t, 'defaults');
  write(folder, scripted(logFile(t), ['lint', 'typecheck']));
  const p = await api['projects:create']({ name: 'Found', folder });
  const shown = JSON.stringify(await api['projects:inputHints'](p.id));
  assert.match(shown, /\blint\b/);
  assert.match(shown, /\btypecheck\b/);
  await api['projects:update']({ id: p.id, patch: { runDefaults: { check_command: 'off' } } });
  assert.equal((await api['projects:inputHints'](p.id)).runDefaults.check_command, 'off');
});
