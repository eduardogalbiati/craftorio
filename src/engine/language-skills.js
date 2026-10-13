// The language skills of a mixed repository (#340). The `language` input takes several values
// ("js,rust", main one first; `multiple: true` in the workflow); a skill name that uses it
// (`unit-test-writer-{{ inputs.language }}`) is then loaded once per language whose files the run
// changed, so a JS-only change never carries the Rust skills. Nothing changed yet (a test writer
// before the developer): every listed language; changes in none of them (docs only): the main one.
// A single value renders as before. The run's changed files: its worktree's diff against the base
// and every step's `files_changed` output (what a simulated run has). Used by agentTurn (agent
// skills) and runAgentStep (step skills) through the run's `skillNames` (src/engine/run/sessions.js).

'use strict';

const path = require('path');

// The files of each language: extensions, and manifests that only that language has
const LANGUAGE_FILES = {
  csharp: { ext: ['.cs', '.csproj', '.sln'], names: [] },
  go: { ext: ['.go'], names: ['go.mod', 'go.sum'] },
  java: { ext: ['.java', '.kt', '.kts'], names: ['pom.xml'] },
  js: { ext: ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'], names: ['package.json', 'package-lock.json'] },
  python: { ext: ['.py', '.pyi'], names: ['Pipfile', 'pyproject.toml', 'requirements.txt', 'setup.py'] },
  rust: { ext: ['.rs'], names: ['Cargo.lock', 'Cargo.toml'] },
};

/** The items of a multi-value input: "rust, js" → ['rust', 'js'] (empty and repeated items dropped). */
function splitValues(value) {
  return [...new Set(String(value ?? '').split(',').map((x) => x.trim()).filter(Boolean))];
}

/** Whether `file` (a path relative to the repository) belongs to `language`. */
function isLanguageFile(language, file) {
  const spec = LANGUAGE_FILES[language];
  if (!spec) return false;
  const base = path.basename(String(file));
  return spec.names.includes(base) || spec.ext.includes(path.extname(base).toLowerCase());
}

/** The languages of `languages` (main first) whose skills a run that changed `files` needs. */
function languagesFor(languages, files) {
  if (!files.length) return languages;
  const touched = languages.filter((l) => files.some((f) => isLanguageFile(l, f)));
  return touched.length ? touched : languages.slice(0, 1);
}

/**
 * The skill names of `templates` rendered with `scope`: a name that uses `inputs.language`, once
 * per language of `languages`. `renderName(name, scope)` renders one.
 */
function expandSkillNames(templates, scope, languages, renderName) {
  return templates.flatMap((name) => {
    if (!/\binputs\.language\b/.test(name)) return [renderName(name, scope).trim()];
    return languages.map((language) => renderName(name, { ...scope, inputs: { ...scope.inputs, language } }).trim());
  });
}

/** The `files_changed` lists of the steps' outputs (a fan-out's output is a list of them). */
function filesChangedByOutputs(steps) {
  const out = [];
  for (const st of Object.values(steps || {})) {
    for (const o of [st?.output].flat()) {
      if (Array.isArray(o?.files_changed)) out.push(...o.files_changed.filter((f) => typeof f === 'string'));
    }
  }
  return out;
}

module.exports = {
  expandSkillNames,
  filesChangedByOutputs,
  isLanguageFile,
  languagesFor,
  splitValues,
};
