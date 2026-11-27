// Screenshot seed of Settings (--view settings): its tabs, and two entries of the dependency cache
// (demoDepsCache, #198: a size and Clear enabled; the E2E suite seeds them too).
// --mode sets the machine profile of Execution › Concurrent runs (#367): machine-auto (the default:
// concurrent runs off, this machine's values), machine-manual (the owner's 3 runs, 2 workers),
// machine-unknown (the threads cannot be read: today's defaults), machine-suggestion (auto, on, and
// the memory guard held or stopped runs on 3 days of the last 7: the suggestion and its Apply),
// workspace-refused (#106: Change… picked a folder with another project's files, the refusal shown).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeEvents } = require('../helpers');

// Settings › General › Dependency cache (#198): two complete entries of the demo project (sizes
// recorded in entry.json, as after an install), so the row shows a size and Clear is enabled.
function demoDepsCache(ws, projectId) {
  if (!ws.cache) return; // an app before the cache
  const day = 864e5;
  [['3f9a1c2e7b4d5a6c8e0f1a2b', 412 * 1024 ** 2, 1], ['8c2d4e6f0a1b3c5d7e9f1a2b', 1.3 * 1024 ** 3, 6]].forEach(([key, bytes, daysAgo]) => {
    const entry = path.join(ws.cache, 'deps', projectId, key);
    fs.mkdirSync(path.join(entry, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(entry, 'node_modules', '.package-lock.json'), '{}');
    const at = new Date(Date.now() - daysAgo * day).toISOString();
    fs.writeFileSync(path.join(entry, 'entry.json'), JSON.stringify({ key, lockfile: 'package-lock.json', manager: 'npm', sentinel: '.package-lock.json', bytes, created_at: at, last_used: at }));
  });
}

// the memory guard's events (#276) of three runs on three days of the last week
function demoMemoryGuard(ws) {
  const at = (days, hour) => new Date(Date.now() - days * 864e5 - hour * 36e5).toISOString();
  const runs = [
    ['20261007-221402-a1b2c3d4', [{ type: 'memory.hold', ts: at(5, 2), step_id: 'suite', free_bytes: 2.1 * 1024 ** 3 }]],
    ['20261009-031155-e5f6a7b8', [{ type: 'process.killed', ts: at(3, 4), step_id: 'develop', pid: 4242, bytes: 9.4 * 1024 ** 3 }]],
    ['20261011-235930-c9d0e1f2', [{ type: 'memory.hold', ts: at(1, 1), step_id: 'suite' }, { type: 'process.killed', ts: at(1, 0), step_id: 'suite', pid: 5151 }]],
  ];
  for (const [id, events] of runs) writeEvents(path.join(ws.runs, id), id, events);
}

function seed({ args, ws, workspace, project }) {
  demoDepsCache(ws, project.id);
  const cr = { enabled: true, max: 3, perProject: null, countSimulations: false };
  if (args.mode === 'machine-manual') workspace.writeSettings(ws, { concurrentRuns: cr, machineProfile: { mode: 'manual', concurrentRuns: 3, testWorkers: 2 } });
  if (args.mode === 'machine-suggestion') {
    workspace.writeSettings(ws, { concurrentRuns: cr, machineProfile: { mode: 'auto' } });
    demoMemoryGuard(ws);
  }
  // this process is the app's main process: a machine whose threads cannot be read
  if (args.mode === 'machine-unknown') { os.availableParallelism = () => 0; os.cpus = () => []; }
  if (args.mode === 'workspace-refused') pickProjectFolder();
}

// --mode workspace-refused (#106): General › Workspace folder › Change… picks a folder that holds
// another project's files (a docs-only repository); the native picker is replaced, as in the E2E
// steps, so the click reaches the real check and the General tab shows its refusal.
function pickProjectFolder() {
  const electron = require('electron');
  if (!electron.dialog) return; // plain Node (the seed tests): no picker to replace
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-docs-repo-'));
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Team handbook\n');
  fs.writeFileSync(path.join(dir, 'docs', 'onboarding.md'), '# Onboarding\n');
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
}

async function afterOpen({ args, click }) {
  if (args.tab) await click(`.settings-tab[data-stab="${args.tab}"]`);
  if (args.mode === 'workspace-refused') {
    if (!args.tab) await click('.settings-tab[data-stab="general"]');
    await click('#btn-ws-change');
  }
}

module.exports = {
  afterOpen,
  demoDepsCache,
  modes: [
    'machine-auto',
    'machine-manual',
    'machine-suggestion',
    'machine-unknown',
    'workspace-refused',
  ],
  seed,
  tabs: ['general', 'agents', 'execution', 'phone', 'about'],
};
