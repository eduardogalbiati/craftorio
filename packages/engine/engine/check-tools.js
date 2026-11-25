// The project's own linter and type checker (#50), for the check step (check-step.js) of a project with no
// `check` script and no check_command. Found, never guessed: a tool counts only when the project's files
// configure it AND it is installed (the project's node_modules/.bin, or the PATH the command runs with).
// Nothing is downloaded (no npx, the offline and no-restore options of each tool) and nothing is rewritten: a
// command that would is in `rewrites`, with why, and never runs. One rule per language, documented in
// docs/features/developer-check.md.
// foundChecks(dir, { env, platform }) → { checks: [{ command, env?, tool, unready? }], rewrites: [{ name, why }] }
// - tool: a short name for the log file; env: what the command's environment gets on top;
// - unready: what the command prints when it could not run at all (not a finding of it).

'use strict';

const fs = require('fs');
const path = require('path');
const { programOnPath } = require('./command-missing');

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
const SCRIPT_RUN = /\b(?:bun|npm|pnpm|yarn)\s+(?:run(?:-script)?\s+)?([\w:.-]+)/g;
const SCRIPT_LIST = /\b(?:npm-run-all2?|run-[ps])\s+([^&|;]+)/g;

// the scripts of package.json a script's text runs (`npm run x`, `run-s lint:*`)
function scriptsRun(text, scripts) {
  const names = [...text.matchAll(SCRIPT_RUN)].map((m) => m[1]);
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
  return [
    ruff && installed('ruff') && { command: 'ruff check --no-fix --output-format concise .', tool: 'ruff' },
    (mypyIni || mypyConfig) && installed('mypy') && { command: `mypy --no-pretty --no-install-types --no-error-summary${target}`, tool: 'mypy' },
  ];
}

function go({ dir, installed }) {
  const config = firstOf(dir, ['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json']);
  if (!config || !firstOf(dir, ['go.mod', 'go.work']) || !installed('golangci-lint')) return [];
  const fix = /^\s*"?fix"?\s*[:=]\s*true\b/m.exec(read(dir, config));
  if (fix) return [{ rewrites: { name: 'golangci-lint run', why: `fix: true in ${config}` } }];
  return [{ command: 'golangci-lint run', env: { GOPROXY: 'off' }, tool: 'golangci-lint' }];
}

function rust({ dir, installed }) {
  const cargo = read(dir, 'Cargo.toml');
  if (!cargo || !(firstOf(dir, ['clippy.toml', '.clippy.toml']) || /^\s*\[(?:workspace\.)?lints\.clippy\]/m.test(cargo))) return [];
  if (!installed('cargo') || !installed('cargo-clippy')) return [];
  // --frozen: offline, and Cargo.lock stays as it is
  const offline = firstOf(dir, ['Cargo.lock']) ? '--frozen' : '--offline';
  return [{ command: `cargo clippy ${offline} --message-format short`, tool: 'clippy' }];
}

function java({ dir, installed }) {
  const pom = read(dir, 'pom.xml').replace(/<!--[\s\S]*?-->/g, '');
  if (!/<artifactId>\s*maven-checkstyle-plugin\s*</.test(pom) || !installed('mvn')) return [];
  // offline: a plugin that was never downloaded is not a finding
  return [{ command: 'mvn -o -B checkstyle:check', tool: 'checkstyle', unready: /in offline mode|PluginResolutionException|NoPluginFoundForPrefix/ }];
}

const DOTNET_ANALYZERS = /<(?:AnalysisLevel|AnalysisMode|EnableNETAnalyzers|EnforceCodeStyleInBuild|TreatWarningsAsErrors)\b|<PackageReference[^>]*Analyzers"/;
function csharp({ dir, installed }) {
  const files = listDir(dir);
  if (!files.some((f) => /\.(?:csproj|slnx?)$/i.test(f)) || !installed('dotnet')) return [];
  const projects = files.filter((f) => /\.csproj$/i.test(f) || f === 'Directory.Build.props');
  const configured = projects.some((f) => DOTNET_ANALYZERS.test(read(dir, f))) || /^\s*(?:csharp_style|dotnet_diagnostic|dotnet_style)/m.test(read(dir, '.editorconfig'));
  // a checkout nobody restored, or several solutions in one folder
  return configured ? [{ command: 'dotnet build --no-restore --no-incremental -nologo', tool: 'dotnet', unready: /\b(?:MSB1011|NETSDK1004)\b/ }] : [];
}

const LANGUAGES = [javascript, python, go, rust, java, csharp];

function foundChecks(dir, { env = process.env, platform = process.platform } = {}) {
  if (!dir) return { checks: [], rewrites: [] };
  const installed = (name) => programOnPath(name, { env, platform });
  const found = LANGUAGES.flatMap((rule) => rule({ dir, installed, platform })).filter(Boolean);
  return { checks: found.filter((f) => f.command), rewrites: found.filter((f) => f.rewrites).map((f) => f.rewrites) };
}

module.exports = {
  foundChecks,
};
