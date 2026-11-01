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

const fs = require('fs');
const path = require('path');

const DEFAULT_STEPS = 'features/steps';
const DEFAULT_RENDERER = 'src/renderer';
const STEP_EXTS = ['.js', '.cjs', '.mjs', '.ts'];
const RENDERER_EXTS = ['.cjs', '.html', '.js', '.jsx', '.mjs', '.svelte', '.ts', '.tsx', '.vue'];
const SKIPPED_DIRS = new Set(['.git', 'node_modules']);

// The unique static ids of `getByTestId(...)` in a source text, in order of first use.
function testIdsUsed(source) {
  const ids = [...String(source || '').matchAll(/getByTestId\(\s*(['"])([^'"$`]+)\1/g)].map((m) => m[2]);
  return [...new Set(ids)];
}

// Every file under a repository-relative folder with one of the extensions, repository-relative
// with forward slashes, sorted; [] when the folder does not exist.
function listFiles(root, dir, exts) {
  const out = [];
  const visit = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIPPED_DIRS.has(e.name)) visit(child); } else if (exts.includes(path.extname(e.name))) out.push(child);
    }
  };
  visit(String(dir || '').replace(/\\/g, '/').replace(/\/+$/, ''));
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
  const source = [...new Set([].concat(renderer).flatMap((dir) => listFiles(root, dir, RENDERER_EXTS)))].filter((f) => !stepSet.has(f)).map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
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
  stepFiles,
  testIdsUsed,
};
