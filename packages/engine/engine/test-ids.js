// The test ids the E2E step definitions use and the renderer lacks (#246). One rule shared by the
// `type: test_ids` step (workflow.js runTestIdsStep; ai-development-local-hero's testid_check, right
// after `develop`), the `missing_test_ids` template filter (the develop prompt's upfront list) and
// test/e2e-playwright.test.js, so the check and the test never disagree:
//   - a used id is the static string of `getByTestId('…')` / `getByTestId("…")` in a step file;
//     dynamic ids (template strings, variables) are skipped;
//   - an id is defined when the renderer's source text contains it (a plain substring check).
// Folders are repository-relative, one folder or a list (#579, #588: this app's step definitions and
// UI are spread over its root and its fronts): steps default to features/steps, the renderer to
// src/renderer (the old layout; the bundled workflow passes its `steps_folders` / `ui_folders` inputs).
// #80: './' is the root; an empty renderer list (no UI folders) is the whole repository, step files aside.

const fs = require('fs');
const path = require('path');

const DEFAULT_STEPS = 'features/steps';
const DEFAULT_RENDERER = 'src/renderer';
const STEP_EXTS = ['.js', '.cjs', '.mjs', '.ts'];
const RENDERER_EXTS = ['.cjs', '.html', '.js', '.jsx', '.mjs', '.svelte', '.ts', '.tsx', '.vue'];
const SKIPPED_DIRS = new Set(['.git', 'node_modules']);
// #80: the folders that hold no UI of a project (builds, tests, docs, tooling): skipped when its UI
// folders are looked for (domains/project/project-run-defaults.js) and when the renderer is the root
const NON_UI_DIRS = new Set(['.craftorio', '.git', '.github', '.multiagent', 'build', 'coverage', 'dist', 'docs', 'e2e', 'features', 'node_modules', 'out', 'target', 'test', 'tests', 'vendor']);
// #80: a UI file (a page or a component), what finds a project's UI folders (domains/project/
// project-run-defaults.js) and what the `ui_files` filter matches in a run without UI folders
const UI_FILE = /\.(html|jsx|tsx|vue|svelte)$/i;
// #80: a stylesheet, a UI file too under the root UI folder ('./': a site's pages and its css/)
const STYLE_FILE = /\.(css|less|sass|scss)$/i;

// #80: a repository-relative folder or file with forward slashes, without a leading './' nor a
// trailing '/'; the root ('./', '.') is ''. Shared with the `ui_files` filter, so both read a
// project's UI folders alike.
function normFolder(p) {
  const f = String(p ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  return f === '.' ? '' : f;
}

// The unique static ids of `getByTestId(...)` in a source text, in order of first use.
function testIdsUsed(source) {
  const ids = [...String(source || '').matchAll(/getByTestId\(\s*(['"])([^'"$`]+)\1/g)].map((m) => m[2]);
  return [...new Set(ids)];
}

// Every file under a repository-relative folder with one of the extensions, repository-relative
// with forward slashes, sorted; [] when the folder does not exist. `skip`: the folder names not visited.
function listFiles(root, dir, exts, skip = SKIPPED_DIRS) {
  const out = [];
  const visit = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!skip.has(e.name)) visit(child); } else if (exts.includes(path.extname(e.name))) out.push(child);
    }
  };
  visit(normFolder(dir));
  return out.sort();
}

// The step definition files of a project (repository-relative, forward slashes), each once when the
// folders overlap. `steps`: one folder or a list (#588: the root's and each front's features/steps).
function stepFiles(root, { steps = DEFAULT_STEPS } = {}) {
  return [...new Set([].concat(steps).flatMap((dir) => listFiles(root, dir, STEP_EXTS)))];
}

// One `{ id, files }` per id the step definitions use that the renderer lacks (files: the step files
// that use it), in order of first use.
function missingTestIds(root, { steps = DEFAULT_STEPS, renderer = DEFAULT_RENDERER } = {}) {
  const used = new Map();
  const files = stepFiles(root, { steps });
  for (const file of files) {
    for (const id of testIdsUsed(fs.readFileSync(path.join(root, file), 'utf8'))) {
      if (!used.has(id)) used.set(id, []);
      used.get(id).push(file);
    }
  }
  if (!used.size) return [];
  // `renderer`: one folder, or a list of folders (this app's page is spread over its UI kit and its fronts);
  // the step definitions inside a UI folder (fronts/<id>/features/steps, #588) never define an id
  const stepSet = new Set(files);
  // #80: an empty list (a project without UI folders) is the whole repository, never src/renderer; the
  // root skips its builds, tests and docs (a spec or a bundle citing an id never defines it)
  const given = [].concat(renderer ?? []).filter((d) => String(d ?? '').trim());
  const source = [...new Set((given.length ? given : ['']).flatMap((dir) => listFiles(root, dir, RENDERER_EXTS, normFolder(dir) ? SKIPPED_DIRS : NON_UI_DIRS)))].filter((f) => !stepSet.has(f)).map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  return [...used].filter(([id]) => !source.includes(id)).map(([id, files]) => ({ id, files }));
}

// One Markdown line per missing id, for a prompt: "- `id` (used in a.steps.js, b.steps.js)".
function missingTestIdLines(missing) {
  return (missing || []).map((m) => `- \`${m.id}\` (used in ${m.files.join(', ')})`).join('\n');
}

module.exports = {
  DEFAULT_RENDERER,
  DEFAULT_STEPS,
  listFiles,
  missingTestIdLines,
  missingTestIds,
  NON_UI_DIRS,
  normFolder,
  stepFiles,
  STYLE_FILE,
  testIdsUsed,
  UI_FILE,
};
