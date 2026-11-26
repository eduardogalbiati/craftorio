// @ts-check
// The project's own linter and type checker (#50), for the check step (check-step.js) of a project with no
// `check` script and no check_command. Found, never guessed: a tool counts only when the project's files
// configure it AND it is installed (the project's node_modules/.bin, or the PATH the command runs with); the
// toolchain's own checkers need no configuration (#82: cargo clippy, else cargo check; go vet).
// Nothing is downloaded (no npx, the offline and no-restore options of each tool) and nothing is rewritten: a
// command that would is in `rewrites`, with why, and never runs. One rule per language, documented in
// docs/features/developer-check.md.
// foundChecks(dir, { env, platform }) → { checks: [{ command, env?, tool, unready? }], looked_for: [string], rewrites: [{ name, why }] }
// - tool: a short name for the log file; env: what the command's environment gets on top;
// - unready: what the command prints when it could not run at all (not a finding of it);
// - looked_for (#82): per language found with nothing to run, the checker it looked for (said when skipped).

'use strict';

const fs = require('fs');
const path = require('path');
const { programOnPath } = require('./command-missing');
const { packageScript } = require('./server-commands');

const read = (dir, rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return ''; } };
const listDir = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
// the section `name` of an INI or TOML text, its header included, up to the next header; '' without it
const sectionOf = (text, name) => text.split(/^(?=[ \t]*\[)/m).find((s) => s.trimStart().startsWith(`[${name}]`)) || '';
const firstOf = (dir, names) => names.find((n) => fs.existsSync(path.join(dir, n))) || null;

// ---- commands that rewrite files -----------------------------------------------------------------

const REWRITES = [
  /(?:^|\s)(--(?:apply|apply-unsafe|fix|fix-only|in-place|write))(?![\w-]|=false)/,
  /\b(?:gofmt|prettier)\b[^&|;]*\s(-w)(?![\w-])/,
  /\b((?:dotnet|ruff) format|cargo fmt)\b(?![^&|;]*--(?:check|diff|verify-no-changes))/,
];
const SCRIPT_RUN = /\b(bun|npm|pnpm|yarn)(?=\s+([^&|;\n]+))/g; // a lookahead: the words may hold another run
const SCRIPT_LIST = /\b(?:npm-run-all2?|run-[ps])\s+([^&|;]+)/g;

// the scripts of package.json a script's text runs (`npm run --silent x`, `run-s lint:*`)
function scriptsRun(text, scripts) {
  const names = [...text.matchAll(SCRIPT_RUN)].map((m) => packageScript(m[1], m[2].replace(/["'`()]/g, '').trim().split(/\s+/)));
  const listed = [...text.matchAll(SCRIPT_LIST)].flatMap((m) => m[1].trim().split(/\s+/));
  const globs = listed.map((g) => new RegExp(`^${g.replace(/["']/g, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*')}$`));
  return Object.keys(scripts).filter((s) => names.includes(s) || globs.some((g) => g.test(s)));
}

// What makes a script rewrite files (`--fix`), its pre and post scripts and the scripts it runs included, or null
function rewritesFiles(name, scripts, seen = new Set()) {
  for (const s of [`pre${name}`, name, `post${name}`]) {
    if (seen.has(s) || typeof scripts[s] !== 'string') continue;
    seen.add(s);
    const own = REWRITES.map((re) => re.exec(scripts[s])?.[1]).find(Boolean);
    if (own) return own;
    for (const nested of scriptsRun(scripts[s], scripts)) {
      const why = rewritesFiles(nested, scripts, seen);
      if (why) return why;
    }
  }
  return null;
}

// ---- one rule per language -------------------------------------------------------------------------

const ESLINT_CONFIG = /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.(?:c?js|json|ya?ml))?)$/;

// the project's script `name`, else its local tool when configured
function scriptOr(name, scripts, local) {
  if (!String(scripts[name] || '').trim()) return local();
  const command = `npm run ${name}`;
  const why = rewritesFiles(name, scripts);
  return why ? { rewrites: { name: command, why } } : { command, tool: name };
}

function javascript({ dir, platform }) {
  let pkg = null;
  try { pkg = JSON.parse(read(dir, 'package.json')); } catch { /* no package.json */ }
  if (!pkg) return [];
  const scripts = pkg.scripts || {};
  const bin = (name) => {
    const rel = path.join('node_modules', '.bin', platform === 'win32' ? `${name}.cmd` : name);
    return fs.existsSync(path.join(dir, rel)) ? rel : null;
  };
  const eslint = bin('eslint');
  const tsc = bin('tsc');
  return [
    scriptOr('lint', scripts, () => (eslint && (pkg.eslintConfig || listDir(dir).some((f) => ESLINT_CONFIG.test(f))) ? { command: `${eslint} .`, tool: 'eslint' } : null)),
    scriptOr('typecheck', scripts, () => (tsc && firstOf(dir, ['tsconfig.json']) ? { command: `${tsc} --noEmit --pretty false`, tool: 'tsc' } : null)),
  ];
}

function python({ dir, installed }) {
  const pyproject = read(dir, 'pyproject.toml');
  const ruff = firstOf(dir, ['ruff.toml', '.ruff.toml']) || /^\s*\[tool\.ruff[.\]]/m.test(pyproject);
  const mypyIni = read(dir, 'mypy.ini') || read(dir, '.mypy.ini');
  const mypyConfig = mypyIni ? sectionOf(mypyIni, 'mypy') : sectionOf(pyproject, 'tool.mypy') || sectionOf(read(dir, 'setup.cfg'), 'mypy');
  // mypy checks the files its own section names (never another tool's `packages`), else the whole folder
  const target = /^\s*(?:files|modules|packages)\s*=/m.test(mypyConfig) ? '' : ' .';
  const checks = [
    ruff && installed('ruff') && { command: 'ruff check --no-fix --output-format concise .', tool: 'ruff' },
    (mypyIni || mypyConfig) && installed('mypy') && { command: `mypy --no-pretty --no-install-types --no-error-summary${target}`, tool: 'mypy' },
  ];
  // #82: a Python project (the suite's own detection) with neither says what was looked for
  const project = firstOf(dir, ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini', 'setup.py', 'requirements.txt']);
  return checks.some(Boolean) || !project ? checks : [{ missing: '`ruff` or `mypy`, configured and installed (Python)' }];
}

function go({ dir, installed }) {
  if (!firstOf(dir, ['go.mod', 'go.work'])) return [];
  const config = firstOf(dir, ['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json']);
  if (config && installed('golangci-lint')) {
    const fix = /^\s*"?fix"?\s*[:=]\s*true\b/m.exec(read(dir, config));
    if (fix) return [{ rewrites: { name: 'golangci-lint run', why: `fix: true in ${config}` } }];
    return [{ command: 'golangci-lint run', env: { GOPROXY: 'off' }, tool: 'golangci-lint' }];
  }
  // #82: the toolchain's own checker needs no configuration; a module never downloaded is not a finding
  if (installed('go')) return [{ command: 'go vet ./...', env: { GOPROXY: 'off' }, tool: 'go-vet', unready: /GOPROXY=off|module lookup disabled|missing go\.sum entry/ }];
  return [{ missing: config ? '`golangci-lint` or `go vet` (Go)' : '`go vet` (Go)' }];
}

// #82: cargo is enough: clippy when its component is installed, else the compiler's own warnings
function rust({ dir, installed }) {
  if (!read(dir, 'Cargo.toml')) return [];
  if (!installed('cargo')) return [{ missing: '`cargo` (Rust: `cargo clippy`, else `cargo check`)' }];
  // --frozen: offline, and Cargo.lock stays as it is
  const offline = firstOf(dir, ['Cargo.lock']) ? '--frozen' : '--offline';
  // dependencies never downloaded, or a Cargo.lock that would have to change
  const unready = /--offline was specified|--frozen was passed|failed to download|lock file .*needs to be updated/;
  if (installed('cargo-clippy')) return [{ command: `cargo clippy ${offline} --message-format short`, tool: 'clippy', unready }];
  return [{ command: `cargo check ${offline} --message-format short`, tool: 'cargo-check', unready }];
}

function java({ dir, installed }) {
  const pom = read(dir, 'pom.xml').replace(/<!--[\s\S]*?-->/g, '');
  // #82: Gradle's `check` runs the tests too: the suite's job, never run here
  if (!pom) return firstOf(dir, ['build.gradle', 'build.gradle.kts']) ? [{ missing: 'a Gradle linter (`gradle check` runs the tests too: left to the suite)' }] : [];
  if (!/<artifactId>\s*maven-checkstyle-plugin\s*</.test(pom)) return [{ missing: '`maven-checkstyle-plugin` in pom.xml (Java)' }];
  if (!installed('mvn')) return [{ missing: '`mvn` (Java: Checkstyle)' }];
  // offline: a plugin that was never downloaded is not a finding
  return [{ command: 'mvn -o -B checkstyle:check', tool: 'checkstyle', unready: /in offline mode|PluginResolutionException|NoPluginFoundForPrefix/ }];
}

const DOTNET_ANALYZERS = /<(?:AnalysisLevel|AnalysisMode|EnableNETAnalyzers|EnforceCodeStyleInBuild|TreatWarningsAsErrors)\b|<PackageReference[^>]*Analyzers"/;
function csharp({ dir, installed }) {
  const files = listDir(dir);
  if (!files.some((f) => /\.(?:csproj|slnx?)$/i.test(f))) return [];
  if (!installed('dotnet')) return [{ missing: '`dotnet` (C#: `dotnet build` with the .NET analyzers)' }];
  const projects = files.filter((f) => /\.csproj$/i.test(f) || f === 'Directory.Build.props');
  const configured = projects.some((f) => DOTNET_ANALYZERS.test(read(dir, f))) || /^\s*(?:csharp_style|dotnet_diagnostic|dotnet_style)/m.test(read(dir, '.editorconfig'));
  if (!configured) return [{ missing: 'the .NET analyzers configured in a `*.csproj`, `Directory.Build.props` or `.editorconfig` (C#)' }];
  // a checkout nobody restored, or several solutions in one folder
  return [{ command: 'dotnet build --no-restore --no-incremental -nologo', tool: 'dotnet', unready: /\b(?:MSB1011|NETSDK1004)\b/ }];
}

const LANGUAGES = [javascript, python, go, rust, java, csharp];

function foundChecks(dir, { env = process.env, platform = process.platform } = {}) {
  if (!dir) return { checks: [], rewrites: [], looked_for: [] };
  const installed = (name) => programOnPath(name, { env, platform });
  const found = LANGUAGES.flatMap((rule) => rule({ dir, installed, platform })).filter(Boolean);
  return {
    checks: found.filter((f) => f.command),
    looked_for: found.filter((f) => f.missing).map((f) => f.missing),
    rewrites: found.filter((f) => f.rewrites).map((f) => f.rewrites),
  };
}

module.exports = {
  foundChecks,
};
