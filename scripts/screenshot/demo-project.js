// The demo project's configuration for --project (#735, #745), on any view: its repository's
// platform and its kind, so the Backlog / Roadmap show the project's platform and the run dialog
// starts from the project's run defaults.
// - gitlab: a gitlab.com repository (the platform badge reads GitLab, no select);
// - self-hosted: a git.company.com repository with no stored platform (the select stays, its pick
//   is saved on the project);
// - rust-backend: a Rust backend (Cargo.toml, kind backend, remote, unit tests only): the run dialog
//   shows Mode Remote, E2E Off, `cargo test` "from the project", and no UI default.
// - own-checks (#50): no `check` script, a lint script that rewrites files and a type check: the project's settings
//   and the Start panel show what the rule check runs; checks-off: the same project with its checks turned off.
// - no-repo (#35): a project with no remote: no synced cache, the demo issues in its local backlog
//   (<id>.local-issues.json: open, closed and archived ones, no URL), Nova issue enabled, Sincronizar hidden.

const fs = require('fs');
const path = require('path');

const DEMO_PROJECTS = ['checks-off', 'gitlab', 'no-repo', 'own-checks', 'rust-backend', 'self-hosted'];

const PATCHES = {
  'checks-off': { runDefaults: { check_command: 'off' } },
  gitlab: { repo: 'https://gitlab.com/demo/demo-app', platform: 'gitlab' },
  'no-repo': { repo: '', platform: null },
  'own-checks': {},
  'rust-backend': {
    kind: 'backend',
    runDefaults: { e2e_tests: 'off', mode: 'remote', screenshots: 'off', test_command: 'cargo test' },
  },
  'self-hosted': { repo: 'https://git.company.com/demo/demo-app' },
};

// the project patched in the workspace and the synced backlog's platform with it; the project back
function applyDemoProject({ which, projects, ws, project }) {
  if (!which) return project;
  const patch = PATCHES[which];
  const next = projects.updateProject(ws.projects, project.id, patch) || { ...project, ...patch };
  const backlogFile = path.join(ws.backlog, `${project.id}.json`);
  if (patch.repo && fs.existsSync(backlogFile)) {
    const data = JSON.parse(fs.readFileSync(backlogFile, 'utf8'));
    fs.writeFileSync(backlogFile, JSON.stringify({ ...data, platform: patch.platform || null, repo: patch.repo }, null, 2));
  }
  if (which === 'no-repo') demoLocalBacklog(backlogFile, ws, project.id);
  if (which === 'rust-backend' && project.folder && fs.existsSync(project.folder)) {
    fs.writeFileSync(path.join(project.folder, 'Cargo.toml'), '[package]\nname = "demo-app"\nversion = "0.1.0"\nedition = "2021"\n');
  }
  if (['checks-off', 'own-checks'].includes(which) && project.folder) {
    fs.mkdirSync(project.folder, { recursive: true });
    const scripts = { lint: 'eslint . --fix', start: 'node server.js', typecheck: 'tsc --noEmit' };
    fs.writeFileSync(path.join(project.folder, 'package.json'), JSON.stringify({ name: 'demo-app', private: true, scripts }, null, 2));
  }
  return next;
}

// no-repo (#35): the synced demo issues moved into the local backlog (no URL, no author, no epic link)
function demoLocalBacklog(backlogFile, ws, projectId) {
  if (!fs.existsSync(backlogFile)) return;
  const data = JSON.parse(fs.readFileSync(backlogFile, 'utf8'));
  const issues = (data.issues || []).map(({ epic, isEpic, ...i }) => ({ ...i, url: null, local: true, author: null }));
  fs.unlinkSync(backlogFile);
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.local-issues.json`), JSON.stringify({ projectId, issues }, null, 2));
  // #73: no remote, so no push status (the demo's local merge has nothing to push)
  const status = { base: 'main', ahead: 0, behind: 0, commits: [], issues: [], fetchError: null, error: null, noRemote: true, checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.local.json`), JSON.stringify(status, null, 2));
}

module.exports = {
  applyDemoProject,
  DEMO_PROJECTS,
};
