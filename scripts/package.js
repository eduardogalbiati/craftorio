// Packages the app for Windows (x64) into dist/. Requires Node 24 (see .nvmrc).
//   node scripts/package.js [output-folder]   (default: dist/)

const path = require('path');

const root = path.join(__dirname, '..');

// Electron fuses are flipped in the binary itself, so they can't be undone by flags or env vars.
// Integrity validation covers app.asar only (not app.asar.unpacked).
async function hardenExe(exe) {
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false, // ELECTRON_RUN_AS_NODE
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // NODE_OPTIONS
    [FuseV1Options.EnableNodeCliInspectArguments]: false, // --inspect, --inspect-brk
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, // refuse a modified app.asar
    [FuseV1Options.OnlyLoadAppFromAsar]: true, // ignore a loose resources/app folder
  });
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
    // node-pty is a native module (embedded terminals): it has to live outside app.asar.
    // session-tail.js runs under the system node in the external live terminal (see
    // terminalSpec in src/main.js), and node can't read app.asar.
    // supervisor-mcp.js (the supervisor's MCP server, a child of claude) likewise.
    asar: { unpack: '{**/node_modules/node-pty/**,**/src/session-tail.js,**/src/supervisor-mcp.js}' },
    // .claude/ may contain worktrees from other sessions (with their own node_modules)
    ignore: [/^\/(runs|dist|build|scripts|test|supabase|\.github|\.claude)(\/|$)/],
    // Hardening: turn the packaged exe into "just this app", not a general Node/Electron runtime
    afterComplete: [({ buildPath }) => hardenExe(path.join(buildPath, 'MultiagentOrchestrator.exe'))],
  });
  console.log(`Build created at: ${paths.join(', ')}`);
})().catch((e) => {
  console.error('Build failed:', e.message);
  process.exit(1);
});
