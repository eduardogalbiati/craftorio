// Fixtures for the repository workflows tests (#485): a throwaway git repository with a
// `.multiagent/project.yaml` manifest and `.multiagent/workflows/<file>`. Not a test file (no
// *.test.js suffix): exports functions and constants only, never registers a test.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// A repository workflow the engine accepts as is: one agent turn, read-only tools.
const repoFlow = (stepId = 'committed', name = 'repo-flow') => `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: ${name}
  description: A workflow kept in the repository
agents:
  a: { provider: claude, model: m, session: ephemeral, capabilities: { tools: [read] } }
steps:
  - id: ${stepId}
    agent: a
    prompt: "do the work"
`;

const MANIFEST = `version: 1
workflows:
  - name: repo-flow
    file: workflows/repo-flow.yaml
    category: solo
    description: The repository's own flow
  - name: writer-reviewer
    category: team
`;

function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
}

// A git repository in a temp folder; `files` ({ relPath: text }) written and committed as the first
// commit. Returns { dir, git(...args), write(files), commit(message) -> sha, head() -> sha }.
function makeRepo(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-wf-485-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-wf-485-cfg-'));
  t.after(() => { rm(dir); rm(cfgDir); });
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const write = (more) => {
    for (const [rel, text] of Object.entries(more)) {
      const file = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  };
  const head = () => git('rev-parse', 'HEAD');
  const commit = (message) => { git('add', '-A'); git('commit', '-q', '--allow-empty', '-m', message); return head(); };
  git('init', '-q');
  write({ 'README.md': '# demo\n', ...files });
  commit('first');
  return { dir, git, write, commit, head };
}

// The standard repository of these tests: the manifest above and repo-flow.yaml.
function repoWithManifest(t, { manifest = MANIFEST, flow = repoFlow() } = {}) {
  return makeRepo(t, { '.multiagent/project.yaml': manifest, '.multiagent/workflows/repo-flow.yaml': flow });
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir));
  return dir;
}

module.exports = { MANIFEST, makeRepo, repoFlow, repoWithManifest, tempDir };
