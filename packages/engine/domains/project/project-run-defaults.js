// #735: a project's run defaults, what a run's inputs take before the workflow's own defaults, and
// the precedence that resolves them. The run dialog (packages/ui-kit/workflow-inputs.js, through
// projects:inputHints' `runDefaults`), the Backlog's queue and the Roadmap (packages/engine/domains/
// backlog/backlog.js runInputs) and scripts/run.js all use it.
// - projectRunDefaults({ project, profile }): built from, in order, the project's own overrides
//   (`project.runDefaults`, edited on the project page), the new-project wizard's picks (#729,
//   `project.workflows[].variant`: local-* / remote-*), the ways-of-working profile (#630, may be
//   null) and the facts read from the project's files (projectFacts): mode, base_branch (the
//   repository's default branch), test_command, check_command, e2e_tests, e2e_command, ui_folders,
//   screenshots, steps_folders and the project's kind (backend / frontend / full-stack). No Node
//   assumption: an `npm …` command only when the project's package.json has that script; no E2E
//   unless an E2E suite was found (and the profile does not say unit tests only). A backend project
//   gets no UI default: ui_folders [], screenshots off, e2e_tests off, steps_folders [].
// - resolveRunInputs({ typed, roadmap, project, workflow }) → { values, sources }: per input of the
//   workflow, what the owner typed (the dialog, the CLI's --input) > the roadmap / queue item's saved
//   inputs > the project's run defaults > the workflow's default; `sources[key]` says which one.
//   A project value outside the input's enum, or for an input the workflow lacks, is left out;
//   release.yaml's own names take theirs (unit_command ← test_command, e2e_suite ← e2e_tests).
// - savedProfile(root, projectId): the last ways-of-working analysis' profile (the seed's model
//   answer under <workspace>/architecture), or null.
// Where each input's project value comes from: docs/readme/040-workflows.md (Project run defaults).

const fs = require('fs');
const path = require('path');
const oracleSeeds = require('../oracle/oracle-seeds');
const { checkCommand } = require('../../engine/check-step');
const { detectTestCommand } = require('../../engine/suite-step');
const { listBranches } = require('./project-inputs');

const KINDS = ['backend', 'frontend', 'full-stack'];
const WAYS_OF_WORKING = 'ways-of-working';

// what the project page may override (`project.runDefaults`)
const OVERRIDABLE = ['base_branch', 'check_command', 'e2e_command', 'e2e_tests', 'mode', 'screenshots', 'steps_folders', 'test_command', 'ui_folders'];

const WEB_DEPS = ['@angular/core', '@sveltejs/kit', 'next', 'nuxt', 'preact', 'react', 'react-dom', 'solid-js', 'svelte', 'vue'];
const SERVER_DEPS = ['@hapi/hapi', '@nestjs/core', 'express', 'fastify', 'hono', 'koa', 'next', 'nuxt'];
const E2E_CONFIGS = ['cypress.config.js', 'cypress.config.ts', 'playwright.config.js', 'playwright.config.ts', 'playwright.config.mjs'];
const UI_FILE = /\.(html|jsx|tsx|vue|svelte)$/i;
const SKIP_DIRS = new Set(['.git', '.github', '.multiagent', 'build', 'coverage', 'dist', 'docs', 'e2e', 'features', 'node_modules', 'out', 'target', 'test', 'tests', 'vendor']);
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

// the folders holding the project's UI files (pages, components), e.g. ['web/'], ['apps/desktop/']
function uiFolders(folder) {
  const found = new Set();
  const walk = (rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(path.join(folder, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && depth < MAX_DEPTH) walk(child, depth + 1);
      } else if (rel && UI_FILE.test(e.name)) {
        const parts = rel.split('/');
        found.add(`${(CONTAINERS.has(parts[0]) && parts[1] ? parts.slice(0, 2) : parts.slice(0, 1)).join('/')}/`);
      }
    }
  };
  walk('', 0);
  return [...found].sort();
}

/**
 * What the project's files tell for its runs: { node, webFramework, server, uiFolders, e2eCommand,
 * e2eSuite, stepsFolders, kind }.
 */
function projectFacts(folder) {
  if (!folder || !isDir(folder)) return { node: false, webFramework: false, server: false, uiFolders: [], e2eCommand: null, e2eSuite: false, stepsFolders: [], kind: 'backend' };
  const pkg = readJson(path.join(folder, 'package.json'));
  const deps = Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies });
  const webFramework = deps.some((d) => WEB_DEPS.includes(d));
  // another toolchain than Node (Cargo, Go, Maven...) is a service; so is a Node server framework
  const otherToolchain = ['Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'pyproject.toml', 'requirements.txt', 'setup.py'].some((f) => exists(folder, f));
  const server = otherToolchain || deps.some((d) => SERVER_DEPS.includes(d)) || ['server', 'api'].some((d) => isDir(path.join(folder, d)));
  const ui = uiFolders(folder);
  const e2eCommand = detectE2eCommand(folder);
  const e2eSuite = !!e2eCommand || E2E_CONFIGS.some((f) => exists(folder, f));
  const hasUi = webFramework || ui.length > 0;
  const kind = hasUi ? (server ? 'full-stack' : 'frontend') : 'backend';
  return { node: !!pkg, webFramework, server, uiFolders: ui, e2eCommand, e2eSuite, stepsFolders: STEPS_FOLDERS.filter((f) => isDir(path.join(folder, f))), kind };
}

// #729: the mode the wizard picked for the project's workflows (variant local-* / remote-*), or null
function wizardMode(project) {
  const variants = (project?.workflows || []).map((w) => String(w?.variant || ''));
  const picked = variants.map((v) => (v.match(/^(local|remote)\b/) || [])[1]).filter(Boolean);
  return picked[0] || null;
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The project's run defaults (see the header); every key always present. */
async function projectRunDefaults({ project, profile = null } = {}) {
  const folder = project?.folder || null;
  const facts = projectFacts(folder);
  const p = profile || {};
  const kind = [project?.kind, p.kind].find((k) => KINDS.includes(k)) || facts.kind;
  const { defaultBranch } = folder && isDir(folder) ? await listBranches(folder) : { defaultBranch: null };
  const mode = wizardMode(project) || (['local', 'remote'].includes(p.mode) ? p.mode : null);
  const suite = str(p.e2eCommand) || facts.e2eCommand;
  const noUi = kind === 'backend';
  const e2eOff = noUi || !suite || p.tests === 'unit';
  const defaults = {
    kind,
    mode,
    base_branch: defaultBranch,
    test_command: str(p.testCommand) || detectTestCommand(folder) || '',
    check_command: str(p.checkCommand) || checkCommand(folder) || '',
    e2e_tests: e2eOff ? 'off' : 'write_and_run',
    e2e_command: e2eOff ? '' : suite,
    ui_folders: noUi ? [] : facts.uiFolders,
    screenshots: noUi ? 'off' : 'all',
    steps_folders: noUi ? [] : facts.stepsFolders,
  };
  const own = project?.runDefaults || {};
  for (const k of OVERRIDABLE) if (own[k] !== undefined && own[k] !== null) defaults[k] = own[k];
  return defaults;
}

// release.yaml names some inputs its own way
const ALIASES = {
  unit_command: (d) => d.test_command,
  e2e_suite: (d) => (d.e2e_tests == null ? undefined : d.e2e_tests === 'off' ? 'skip' : 'run'),
};

const given = (v) => v !== undefined && v !== null;
const fits = (def, v) => !Array.isArray(def?.enum) || def.enum.includes(v);

/** The run's inputs from the four sources, highest first (see the header) → { values, sources }. */
function resolveRunInputs({ typed = {}, roadmap = {}, project = {}, workflow = {} } = {}) {
  const values = {};
  const sources = {};
  const projectValue = (k) => (Object.prototype.hasOwnProperty.call(project || {}, k) ? project[k] : ALIASES[k]?.(project || {}));
  for (const [k, def] of Object.entries(workflow?.inputs || {})) {
    const fromProject = projectValue(k);
    const picks = [
      ['typed', typed?.[k]],
      ['roadmap', roadmap?.[k]],
      ['project', given(fromProject) && fits(def, fromProject) ? fromProject : undefined],
      ['workflow', def?.default],
    ];
    const found = picks.find(([, v]) => given(v));
    if (!found) continue;
    values[k] = found[1];
    sources[k] = found[0];
  }
  // what the owner or the item set for a key the workflow does not declare stays (the engine checks it)
  for (const src of [roadmap, typed]) for (const [k, v] of Object.entries(src || {})) if (!(k in values) && given(v)) { values[k] = v; sources[k] = src === typed ? 'typed' : 'roadmap'; }
  return { values, sources };
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
  savedProfile,
};
