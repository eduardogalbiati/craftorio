// The demo project's configuration for --demo-project (#735, #745), on any view: its repository's
// platform and its kind, so the Backlog / Roadmap show the project's platform and the run dialog
// starts from the project's run defaults.
// - gitlab: a gitlab.com repository (the platform badge reads GitLab, no select);
// - self-hosted: a git.company.com repository with no stored platform (the select stays, its pick
//   is saved on the project);
// - rust-backend: a Rust backend (Cargo.toml, kind backend, remote, unit tests only): the run dialog
//   shows Mode Remote, E2E Off, `cargo test` "from the project", and no UI default.

const fs = require('fs');
const path = require('path');

const DEMO_PROJECTS = ['gitlab', 'rust-backend', 'self-hosted'];

const PATCHES = {
  gitlab: { repo: 'https://gitlab.com/demo/demo-app', platform: 'gitlab' },
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
  if (which === 'rust-backend' && project.folder && fs.existsSync(project.folder)) {
    fs.writeFileSync(path.join(project.folder, 'Cargo.toml'), '[package]\nname = "demo-app"\nversion = "0.1.0"\nedition = "2021"\n');
  }
  return next;
}

module.exports = {
  applyDemoProject,
  DEMO_PROJECTS,
};
