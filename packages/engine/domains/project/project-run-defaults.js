// #735: a project's run defaults, what a run's inputs take before the workflow's own defaults, and
// the precedence that resolves them. The run dialog (packages/ui-kit/workflow-inputs.js, through
// projects:inputHints' `runDefaults`), the Backlog's queue and the Roadmap (packages/engine/domains/
// backlog/backlog.js runInputs) and scripts/run.js all use it.
// - projectRunDefaults({ project, profile }): built from, in order, the project's own overrides
//   (`project.runDefaults`, edited on the project page), the new-project wizard's picks (#729,
//   `project.workflows[].variant`: local-* / remote-* / fork-*), the ways-of-working profile (#630,
//   may be null) and the facts read from the project's files (projectFacts): mode, test_order and
//   variant (#785: the wizard's pick, `*-code` is code_first, `*-e2e` e2e_first), language (#785:
//   every detected one, comma-separated), base_branch (the repository's default branch),
//   test_command, check_command, check_commands (#50: no workflow input, what the check runs without a
//   check_command: the `check` script, else the linter and type checker found in the folder) and
//   check_rewrites (those it does not run because they rewrite files: { name, why }), e2e_tests, e2e_command, ui_folders, screenshots, steps_folders and
//   the project's kind (backend / frontend / full-stack; #84: docs, no code). No Node assumption: an `npm …` command only
//   when the project's package.json has that script; no E2E unless an E2E suite was found (and the
//   profile does not say unit tests only). A backend project gets no UI default: ui_folders [],
//   screenshots off, e2e_tests off, steps_folders []. #80: pages at the root give the UI folder './'
//   (the `ui_files` filter reads it as the root-level files); only folders the project has are listed.
//   #57: an empty project (a README and dotfiles, what "Create new project" makes) has kind null, undecided:
//   screenshots stay on with no UI folder, so a first change with UI files gets its screenshots and review.
// - resolveRunInputs({ typed, roadmap, project, workflow }) → { values, sources }: per input of the
//   workflow, what the owner typed (the dialog, the CLI's --input) > the roadmap / queue item's saved
//   inputs > the project's run defaults > the workflow's default; `sources[key]` says which one.
//   #785: a blank string saved on an item (old items carry them) counts as not saved.
//   A project value outside the input's enum, or for an input the workflow lacks, is left out;
//   release.yaml's own names take theirs (unit_command ← test_command, e2e_suite ← e2e_tests).
//   The rule lives in packages/shared/run-inputs.js, shared with the screens; re-exported here.
// - savedProfile(root, projectId): the last ways-of-working analysis' profile (the seed's model
//   answer under <workspace>/architecture), or null.
// Where each input's project value comes from: docs/readme/040-workflows.md (Project run defaults).

const fs = require('fs');
const path = require('path');
const oracleSeeds = require('../oracle/oracle-seeds');
const { checkCommand, checkCommands } = require('../../engine/check-step');
const { foundChecks } = require('../../engine/check-tools');
const { detectTestCommand } = require('../../engine/suite-step');
const {
  NON_UI_DIRS,
  UI_FILE,
} = require('../../engine/test-ids');
const { detectLanguage, listBranches } = require('./project-inputs');
const {
  modeOfPicks,
  modeOfVariant,
  variantTestOrder,
} = require('@craftorio/shared/default-workflow');
const { PROFILE, PROJECT_KINDS: KINDS } = require('@craftorio/shared/onboarding-model');
const { resolveRunInputs, withAliases } = require('@craftorio/shared/run-inputs');

// #738: local, remote and fork (Fork + PR), the profile's modes
const MODES = PROFILE.mode;
const WAYS_OF_WORKING = 'ways-of-working';

// what the project page may override (`project.runDefaults`); #805 base_behind is no run input: what a
// roadmap does when a local base is behind origin (service/areas/roadmap.js)
const OVERRIDABLE = ['base_behind', 'base_branch', 'check_command', 'e2e_command', 'e2e_tests', 'mode', 'screenshots', 'steps_folders', 'test_command', 'ui_folders'];

const WEB_DEPS = ['@angular/core', '@sveltejs/kit', 'next', 'nuxt', 'preact', 'react', 'react-dom', 'solid-js', 'svelte', 'vue'];
const SERVER_DEPS = ['@hapi/hapi', '@nestjs/core', 'express', 'fastify', 'hono', 'koa', 'next', 'nuxt'];
const E2E_CONFIGS = ['cypress.config.js', 'cypress.config.ts', 'playwright.config.js', 'playwright.config.ts', 'playwright.config.mjs'];
// folders that hold several apps: the UI folder is one level deeper (apps/web/)
const CONTAINERS = new Set(['apps', 'packages', 'services']);
const STEPS_FOLDERS = ['features/steps', 'e2e/steps', 'tests/e2e/steps'];
const MAX_DEPTH = 4;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = (folder, rel) => { try { return fs.existsSync(path.join(folder, rel)); } catch { return false; } };

/** #630: the package.json script that runs the E2E suite (e2e, test:e2e...), as `npm run <name>`, or null. */
function detectE2eCommand(folder) {
  const scripts = readJson(path.join(folder || '', 'package.json'))?.scripts || {};
  const name = Object.keys(scripts).find((s) => /(^|:)e2e$/.test(s));
  return name ? `npm run ${name}` : null;
}

// the folders holding the project's UI files (pages, components), e.g. ['web/'], ['apps/desktop/'];
// #80: pages at the repository root (index.html) give the root folder './' (its root-level files)
function uiFolders(folder) {
  const found = new Set();
  const walk = (rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(path.join(folder, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!NON_UI_DIRS.has(e.name) && !e.name.startsWith('.') && depth < MAX_DEPTH) walk(child, depth + 1);
      } else if (!rel && UI_FILE.test(e.name)) {
        found.add('./');
      } else if (UI_FILE.test(e.name)) {
        const parts = rel.split('/');
        found.add(`${(CONTAINERS.has(parts[0]) && parts[1] ? parts.slice(0, 2) : parts.slice(0, 1)).join('/')}/`);
      }
    }
  };
  walk('', 0);
  return [...found].sort();
}

// #84: a document, not code: text and markup documents, images, and the extensionless files a repository keeps
// next to them, upper-case only (LICENSE, README, NOTICE…: Makefile, Dockerfile and scripts are code); dotfiles
// (.gitignore, .editorconfig) are neither
const DOC_EXTENSION = /\.(md|markdown|mdx|txt|rst|adoc|asciidoc|org|pdf|png|jpe?g|gif|svg|webp|ico)$/i;
const DOC_NAME = /^[A-Z][A-Z0-9_-]*$/;
const isDocFile = (/** @type {string} */ name) => DOC_EXTENSION.test(name) || DOC_NAME.test(name);

// #84: whether the folder holds a file other than documents (isDocFile) or dotfiles, up to MAX_DEPTH (the
// dependencies and dot folders aside)
function hasCode(folder) {
  const walk = (rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(path.join(folder, rel), { withFileTypes: true }); } catch { return false; }
    return entries.some((e) => {
      if (e.name.startsWith('.')) return false;
      if (e.isDirectory()) return e.name !== 'node_modules' && depth < MAX_DEPTH && walk(rel ? `${rel}/${e.name}` : e.name, depth + 1);
      return !isDocFile(e.name);
    });
  };
  return walk('', 0);
}

// #57: a new project's folder: nothing but a README (any case, any extension) and dotfiles at its root
// ("Create new project" makes README.md and .gitignore); its kind is not decided by its files yet
const README = /^readme(\.[^.]+)?$/i;
function isEmptyProject(folder) {
  let entries;
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return false; }
  return entries.every((e) => e.name.startsWith('.') || (e.isFile() && README.test(e.name)));
}

/**
 * What the project's files tell for its runs: { node, webFramework, server, uiFolders, e2eCommand,
 * e2eSuite, stepsFolders, kind }. #84: kind docs when it holds no code (documents only). #57: kind null
 * (undecided) for an empty project (isEmptyProject): its first change decides whether it has screens.
 */
function projectFacts(folder) {
  if (!folder || !isDir(folder)) return { node: false, webFramework: false, server: false, uiFolders: [], e2eCommand: null, e2eSuite: false, stepsFolders: [], kind: 'backend' };
  const pkg = readJson(path.join(folder, 'package.json'));
  const deps = Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies });
  const webFramework = deps.some((d) => WEB_DEPS.includes(d));
  // another toolchain than Node (Cargo, Go, Maven...) is a service; so is a Node server framework
  const otherToolchain = String(detectLanguage(folder) || '').split(',').some((l) => l && l !== 'js');
  const server = otherToolchain || deps.some((d) => SERVER_DEPS.includes(d)) || ['server', 'api'].some((d) => isDir(path.join(folder, d)));
  const ui = uiFolders(folder);
  const e2eCommand = detectE2eCommand(folder);
  const e2eSuite = !!e2eCommand || E2E_CONFIGS.some((f) => exists(folder, f));
  const hasUi = webFramework || ui.length > 0;
  const noCode = !hasUi && !pkg && !server && !hasCode(folder);
  const kind = hasUi ? (server ? 'full-stack' : 'frontend') : noCode && isEmptyProject(folder) ? null : noCode ? 'docs' : 'backend';
  return { node: !!pkg, webFramework, server, uiFolders: ui, e2eCommand, e2eSuite, stepsFolders: STEPS_FOLDERS.filter((f) => isDir(path.join(folder, f))), kind };
}

// #729: the mode the wizard picked for the project's workflows (variant local-* / remote-* / fork-*, #738), or null
const wizardMode = (project) => modeOfPicks(project?.workflows);

// #785: the wizard's variant for the project's workflows (`fork-code`...), the first of the local /
// remote / fork ones, else the first given, or null
function wizardVariant(project) {
  const variants = (project?.workflows || []).map((w) => String(w?.variant || '')).filter(Boolean);
  return variants.find(modeOfVariant) || variants[0] || null;
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The project's run defaults (see the header); every key always present. */
async function projectRunDefaults({ project, profile = null } = {}) {
  const folder = project?.folder || null;
  const { defaultBranch } = folder && isDir(folder) ? await listBranches(folder) : { defaultBranch: null };
  return runDefaultsWith({ project, profile, defaultBranch });
}

/** projectRunDefaults with the repository's default branch already read (null: none); synchronous (scripts/run.js). */
function runDefaultsWith({ project, profile = null, defaultBranch = null } = {}) {
  const folder = project?.folder || null;
  const facts = projectFacts(folder);
  const p = profile || {};
  const kind = [project?.kind, p.kind].find((k) => KINDS.includes(k)) || facts.kind;
  const mode = wizardMode(project) || (MODES.includes(p.mode) ? p.mode : null);
  const suite = str(p.e2eCommand) || facts.e2eCommand;
  // #84: a docs project has no UI either; #57: an undecided one (null, an empty project) keeps screenshots on, no
  // UI folder yet: the feature workflow's UI steps follow the UI files of the developer's change
  const noUi = kind === 'backend' || kind === 'docs';
  const e2eOff = noUi || !suite || p.tests === 'unit';
  const variant = wizardVariant(project);
  const defaults = {
    kind,
    variant,
    mode,
    test_order: variantTestOrder(variant),
    language: folder ? detectLanguage(folder) : null,
    base_branch: defaultBranch,
    test_command: str(p.testCommand) || detectTestCommand(folder) || '',
    check_command: str(p.checkCommand) || checkCommand(folder) || '',
    check_commands: checkCommands(folder),
    check_rewrites: checkCommand(folder) ? [] : foundChecks(folder).rewrites,
    e2e_tests: e2eOff ? 'off' : 'write_and_run',
    e2e_command: e2eOff ? '' : suite,
    ui_folders: noUi ? [] : facts.uiFolders,
    screenshots: noUi ? 'off' : 'changed',
    steps_folders: noUi ? [] : facts.stepsFolders,
  };
  const own = project?.runDefaults || {};
  for (const k of OVERRIDABLE) if (own[k] !== undefined && own[k] !== null) defaults[k] = own[k];
  return defaults;
}

/** The profile of the project's last ways-of-working analysis, or null. */
function savedProfile(root, projectId) {
  try {
    const last = oracleSeeds.listSeedRuns(root, projectId, WAYS_OF_WORKING)[0];
    const profile = last && oracleSeeds.readSeedRun(root, projectId, WAYS_OF_WORKING, last.date)?.model?.profile;
    return profile && typeof profile === 'object' ? profile : null;
  } catch { return null; }
}

module.exports = {
  detectE2eCommand,
  KINDS,
  OVERRIDABLE,
  projectFacts,
  projectRunDefaults,
  resolveRunInputs,
  runDefaultsWith,
  savedProfile,
  WAYS_OF_WORKING,
  withAliases,
};
