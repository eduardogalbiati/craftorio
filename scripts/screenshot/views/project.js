// Screenshot seed of a project's screen (--view project, opened with openProjectView): the local merge
// (its run list's "issue from cache" badge, #168), the demo roadmap's runs (#289: tonight's runs and
// the artifact runs expanded), child runs, a long run history and a simulated run.
// #354: --tab overview | conflicts | architecture | refactor opens that tab of the page. The Conflict
// map tab (conflicts) reads a demo git repository with three nights of merged runs (views/analytics.js)
// and the saved conflict map (views/backlog.js); a row opened: --click "[data-testid=project-conflict-row]".
// Its states, --mode: not-git (the folder is a plain folder), no-runs (a git repository no run
// merged into), loading (analytics:performance never answers).

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { demoPerformanceRuns } = require('./analytics');
const { demoConflictMap } = require('./backlog');
const { demoLocalMerge } = require('./releases');
const { demoRoadmap } = require('./roadmap');
const { demoChildRuns, demoRunHistory } = require('./workflows');

function seed({ args, ws, project }) {
  demoLocalMerge(ws, project.id);
  demoRoadmap(ws, project.id, args.live, args.budget, args.roadmap);
  demoChildRuns(ws, project.id);
  demoRunHistory(ws, project.id);
  if (args.tab !== 'conflicts' || args.mode === 'not-git') return;
  if (args.mode === 'no-runs') {
    const git = (a) => execFileSync('git', ['-C', project.folder, ...a], { stdio: 'pipe' });
    git(['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(project.folder, 'README.md'), '# demo-app\n');
    git(['add', '-A']);
    git(['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', 'commit', '-q', '-m', 'Initial commit']);
    return;
  }
  demoPerformanceRuns(ws, project.folder, project.id);
  fs.mkdirSync(ws.backlog, { recursive: true });
  demoConflictMap(ws, project.id);
}

const open = ({ js, project }) => js(`openProjectView(${JSON.stringify(project.id)})`);

async function afterOpen({ args, click }) {
  if (!args.tab) return;
  // the tab's first read never ends: its loading state stays on screen
  if (args.tab === 'conflicts' && args.mode === 'loading') {
    const { ipcMain } = require('electron');
    ipcMain.removeHandler('analytics:performance');
    ipcMain.handle('analytics:performance', () => new Promise(() => {}));
  }
  await click(`[data-pv-tab="${args.tab}"]`);
}

module.exports = {
  afterOpen,
  modes: ['loading', 'no-runs', 'not-git'],
  open,
  run: true,
  seed,
  tabs: ['overview', 'conflicts', 'architecture', 'refactor'],
};
