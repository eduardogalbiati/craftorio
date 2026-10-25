// What the app knows about a project for a workflow's inputs (#116), so the input forms (the
// renderer's workflow-inputs.js) can prefill them: the languages, detected from the project's
// files (go.mod → go, pom.xml / build.gradle → java, *.csproj / *.sln → csharp, Cargo.toml → rust,
// pyproject.toml / requirements.txt / setup.py → python, package.json → js). Every language found,
// main one first, in that order (so a tooling package.json does not hide the real language), as
// one comma-separated value ("rust,js", #340: the `language` input takes several); and its local
// branches with the default one (origin's HEAD, else main / master, else the checked-out branch)
// for `base_branch`. Values are the workflows' enum values (`language: [js, python, go, java, csharp, rust]`).

const fs = require('fs');
const path = require('path');
const { execGit } = require('../workspace/workspace');

const LANGUAGES = [
  ['go', (names) => names.includes('go.mod')],
  ['java', (names) => names.some((n) => ['pom.xml', 'build.gradle', 'build.gradle.kts'].includes(n))],
  ['csharp', (names) => names.some((n) => /\.(csproj|sln)$/i.test(n))],
  ['rust', (names) => names.includes('Cargo.toml')],
  ['python', (names) => names.some((n) => ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'].includes(n))],
  ['js', (names) => names.includes('package.json')],
];

/** The project's languages from the files at its root, main one first ("go,js"; null when none says). */
function detectLanguage(folder) {
  let names;
  try { names = fs.readdirSync(folder); } catch { return null; }
  return LANGUAGES.filter(([, has]) => has(names)).map(([lang]) => lang).join(',') || null;
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
