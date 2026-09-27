// Packages the app for Windows (x64) into dist/.
// @electron/packager requires Node >= 20. On older Node the script
// relaunches itself using the Node bundled with Electron (ELECTRON_RUN_AS_NODE).
//   node scripts/package.js [output-folder]   (default: dist/)

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

if (+process.versions.node.split('.')[0] < 20 && !process.env.ELECTRON_RUN_AS_NODE) {
  console.log(`Node ${process.versions.node} is too old for the packager; using the Node bundled with Electron.`);
  const r = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(r.status ?? 1);
}

(async () => {
  const { packager } = await import('@electron/packager');
  const paths = await packager({
    dir: root,
    name: 'MultiagentOrchestrator',
    platform: 'win32',
    arch: 'x64',
    out: path.resolve(process.argv[2] || path.join(root, 'dist')),
    overwrite: true,
    prune: true,
    tmpdir: false, // avoids EPERM when moving from %TEMP% on Windows
    // .claude/ may contain worktrees from other sessions (with their own node_modules)
    ignore: [/^\/(runs|dist|build|scripts|test|\.github|\.claude)(\/|$)/],
  });
  console.log(`Build created at: ${paths.join(', ')}`);
})().catch((e) => {
  console.error('Build failed:', e.message);
  process.exit(1);
});
