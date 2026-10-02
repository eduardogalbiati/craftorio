// What the app knows about a project for a workflow's inputs (#116), so the input forms (the
// renderer's workflow-inputs.js) can prefill them: the main language, detected from the project's
// files (go.mod → go, pom.xml / build.gradle → java, *.csproj / *.sln → csharp, pyproject.toml /
// requirements.txt / setup.py → python, package.json → js; the first match in that order, so a
// tooling package.json does not hide the real language), and its local branches with the default
// one (origin's HEAD, else main / master, else the checked-out branch) for `base_branch`.
// Values are the workflows' enum values (`language: [js, python, go, java, csharp]`).

const fs = require('fs');
const path = require('path');
const { execGit } = require('./workspace');

const LANGUAGES = [
  ['go', (names) => names.includes('go.mod')],
  ['java', (names) => names.some((n) => ['pom.xml', 'build.gradle', 'build.gradle.kts'].includes(n))],
  ['csharp', (names) => names.some((n) => /\.(csproj|sln)$/i.test(n))],
  ['python', (names) => names.some((n) => ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'].includes(n))],
  ['js', (names) => names.includes('package.json')],
];

/** The project's main language from the files at its root (null when none says). */
function detectLanguage(folder) {
  let names;
  try { names = fs.readdirSync(folder); } catch { return null; }
  return LANGUAGES.find(([, has]) => has(names))?.[0] || null;
}

/** The local branches of `folder` and its default branch; empty when it is not a git repository. */
async function listBranches(folder) {
  let branches;
  try {
    branches = (await execGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], folder)).split(/\r?\n/).map((b) => b.trim()).filter(Boolean);
  } catch { return { branches: [], defaultBranch: null }; }
  const origin = await execGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], folder).then((s) => s.trim().replace(/^origin\//, ''), () => '');
  const current = await execGit(['branch', '--show-current'], folder).then((s) => s.trim(), () => '');
  const defaultBranch = [origin, 'main', 'master', current].find((b) => b && branches.includes(b)) || null;
  return { branches, defaultBranch };
}

/** { language, branches, defaultBranch } of a project folder (nulls and [] when unknown). */
async function inputHints(folder) {
  if (!folder || !fs.existsSync(path.resolve(folder))) return { language: null, branches: [], defaultBranch: null };
  return { language: detectLanguage(folder), ...(await listBranches(folder)) };
}

module.exports = {
  detectLanguage,
  inputHints,
  listBranches,
};
