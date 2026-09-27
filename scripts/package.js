// Packages the app for Windows (x64) into dist/. Requires Node 24 (see .nvmrc).
//   node scripts/package.js [output-folder]   (default: dist/)

const path = require('path');

const root = path.join(__dirname, '..');

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
    // node-pty is a native module (embedded terminals): it has to live outside app.asar
    asar: { unpack: '**/node_modules/node-pty/**' },
    // .claude/ may contain worktrees from other sessions (with their own node_modules)
    ignore: [/^\/(runs|dist|build|scripts|test|\.github|\.claude)(\/|$)/],
  });
  console.log(`Build created at: ${paths.join(', ')}`);
})().catch((e) => {
  console.error('Build failed:', e.message);
  process.exit(1);
});
