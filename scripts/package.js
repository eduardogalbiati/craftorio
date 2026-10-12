// Packages the app for one OS into dist/MultiagentOrchestrator-<platform>-<arch>/: the current machine
// by default. Requires Node 24 (see .nvmrc). The release jobs (deploy.yml, preview.yml) run it on each OS.
//   node scripts/package.js [--platform win32|darwin|linux] [--arch x64|arm64] [output-folder]   (default: dist/)
// Icons: assets/icon.ico, .icns and .png, generated from one source image by scripts/icons.js.
// Exports parseArgs, executablePath and packagerOptions for the tests; packages only when run directly.

const path = require('path');

const root = path.join(__dirname, '..');
const NAME = 'MultiagentOrchestrator';
const PLATFORMS = ['darwin', 'linux', 'win32'];
const ARCHS = ['arm64', 'x64'];
const ICON_EXT = { darwin: '.icns', linux: '.png', win32: '.ico' };

// argv without node and the script; host = the machine (process). Throws on an unknown platform or arch.
function parseArgs(argv, host = process) {
  const opts = { platform: host.platform, arch: host.arch, out: path.join(root, 'dist') };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(platform|arch)(?:=(.*))?$/.exec(argv[i]);
    if (!m && argv[i].startsWith('--')) throw new Error(`Unknown option "${argv[i]}": use --platform, --arch`);
    if (!m) { opts.out = path.resolve(argv[i]); continue; }
    opts[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
  }
  if (!PLATFORMS.includes(opts.platform)) throw new Error(`Unknown platform "${opts.platform}": use ${PLATFORMS.join(', ')}`);
  if (!ARCHS.includes(opts.arch)) throw new Error(`Unknown arch "${opts.arch}": use ${ARCHS.join(', ')}`);
  return opts;
}

// The Electron binary the fuses are flipped in, inside the packager's output folder.
function executablePath(buildPath, platform) {
  if (platform === 'win32') return path.join(buildPath, `${NAME}.exe`);
  if (platform === 'darwin') return path.join(buildPath, `${NAME}.app`, 'Contents', 'MacOS', NAME);
  return path.join(buildPath, NAME);
}

// Electron fuses are flipped in the binary itself, so they can't be undone by flags or env vars.
// Integrity validation covers app.asar only (not app.asar.unpacked).
async function hardenExe(exe, platform) {
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  await flipFuses(exe, {
    version: FuseVersion.V1,
    // macOS: writing the fuses invalidates the bundle's ad-hoc signature (Apple Silicon refuses to
    // run it): codesign it again, ad hoc, right after the flip
    resetAdHocDarwinSignature: platform === 'darwin',
    [FuseV1Options.RunAsNode]: false, // ELECTRON_RUN_AS_NODE
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // NODE_OPTIONS
    [FuseV1Options.EnableNodeCliInspectArguments]: false, // --inspect, --inspect-brk
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, // refuse a modified app.asar
    [FuseV1Options.OnlyLoadAppFromAsar]: true, // ignore a loose resources/app folder
  });
}

// The @electron/packager options: the same app, ignore and unpack lists on every OS.
function packagerOptions({ platform, arch, out }) {
  return {
    dir: root,
    name: NAME,
    platform,
    arch,
    out,
    icon: path.join(root, 'assets', `icon${ICON_EXT[platform]}`),
    overwrite: true,
    prune: true,
    tmpdir: false, // avoids EPERM when moving from %TEMP% on Windows
    // node-pty is a native module (embedded terminals): it has to live outside app.asar.
    // session-tail.js runs under the system node in the external live terminal (see
    // terminalSpec in src/main.js), and node can't read app.asar.
    // supervisor-mcp.js (the supervisor's MCP server, a child of claude) likewise.
    asar: { unpack: '{**/node_modules/node-pty/**,**/src/session-tail.js,**/src/supervisor-mcp.js}' },
    // .claude/ may contain worktrees from other sessions (with their own node_modules); poc/ holds
    // proofs of concept, never part of the app; generated/ (the run's 3D view, scripts/build-3d.js) is
    // packed, and src/renderer/run3d/ (its sources) is not needed once bundled
    ignore: [/^\/(runs|dist|build|scripts|test|supabase|poc|\.github|\.claude)(\/|$)/, /^\/src\/renderer\/run3d(\/|$)/],
    ...(platform === 'darwin' && {
      appBundleId: 'io.github.eduardogalbiati.multiagent-orchestrator',
      appCategoryType: 'public.app-category.developer-tools',
      // Info.plist: macOS asks for the microphone with this text (voice input)
      extendInfo: { NSMicrophoneUsageDescription: 'Voice input transcribes what you say into the task field.' },
    }),
    // Hardening: turn the packaged binary into "just this app", not a general Node/Electron runtime
    afterComplete: [({ buildPath }) => hardenExe(executablePath(buildPath, platform), platform)],
  };
}

module.exports = {
  executablePath,
  packagerOptions,
  parseArgs,
};

if (require.main === module) {
  (async () => {
    const opts = parseArgs(process.argv.slice(2));
    const { packager } = await import('@electron/packager');
    const paths = await packager(packagerOptions(opts));
    console.log(`Build created at: ${paths.join(', ')}`);
  })().catch((e) => {
    console.error('Build failed:', e.message);
    process.exit(1);
  });
}
