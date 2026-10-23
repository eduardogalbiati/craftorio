// Packages the app for one OS into dist/MultiagentOrchestrator-<platform>-<arch>/: the current machine
// by default. Requires Node 24 (see .nvmrc). The release jobs (deploy.yml, preview.yml) run it on each OS.
//   node scripts/package.js [--platform win32|darwin|linux] [--arch x64|arm64] [output-folder]   (default: dist/)
// Icons: assets/icon.ico, .icns and .png, generated from one source image by scripts/icons.js.
// Native sidecars (#341): first builds the cargo workspace native/ in release for the target (needs
// rustup and stable Rust) and ships its binaries in resources/bin/, outside app.asar.
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
    [FuseV1Options.EnableCookieEncryption]: true, // the remote engine's session cookie, OS-encrypted on disk (#480)
  });
}

// The native sidecars (native/, #341): the Rust target of each platform and arch, and the binaries
// shipped in resources/bin/ (src/native-bin.js nativeBinaryPath finds them there): the MCP server,
// the external live terminal's follower and the control channel's client (#342).
const RUST_TARGETS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
};
const NATIVE_BINARIES = [
  'multiagent-ctl',
  'multiagent-mcp',
  'multiagent-tail',
];

// The folder packaged as resources/bin/ for one platform and arch (filled by buildNative).
function nativeBinDir({ platform, arch, out }) {
  return path.join(out, '.native', `${platform}-${arch}`, 'bin');
}

// Builds the native sidecars in release for the target and copies them into nativeBinDir. Needs cargo
// (rustup, stable); the release jobs install it. macOS: signed ad hoc, like the app.
function buildNative(opts, run = require('child_process').spawnSync) {
  const fs = require('fs');
  const target = RUST_TARGETS[`${opts.platform}-${opts.arch}`];
  const manifest = path.join(root, 'native', 'Cargo.toml');
  const exec = (cmd, args) => {
    const r = run(cmd, args, { stdio: 'inherit' });
    if (r.error) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.error.message} (the build needs the Rust toolchain: rustup, stable)`);
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with exit status ${r.status}`);
  };
  exec('rustup', ['target', 'add', target]);
  exec('cargo', ['build', '--release', '--locked', '--manifest-path', manifest, '--target', target, ...NATIVE_BINARIES.flatMap((b) => ['-p', b])]);
  const targetDir = process.env.CARGO_TARGET_DIR || path.join(root, 'native', 'target');
  const dir = nativeBinDir(opts);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const name of NATIVE_BINARIES) {
    const file = opts.platform === 'win32' ? `${name}.exe` : name;
    fs.copyFileSync(path.join(targetDir, target, 'release', file), path.join(dir, file));
    if (opts.platform === 'darwin' && process.platform === 'darwin') exec('codesign', ['--force', '--sign', '-', path.join(dir, file)]);
  }
  return dir;
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
    // Nothing else is (#342): the external live terminal and the MCP server are the Rust binaries
    // of resources/bin/, always shipped, so no script needs the system node.
    asar: { unpack: '**/node_modules/node-pty/**' },
    // the native sidecars (buildNative), outside app.asar: resources/bin/multiagent-{ctl,mcp,tail}[.exe]
    extraResource: [nativeBinDir({ platform, arch, out })],
    // .claude/ may contain worktrees from other sessions (with their own node_modules); poc/ holds
    // proofs of concept, never part of the app; generated/ (the run's 3D view and the project city,
    // scripts/build-3d.js) is packed, and src/renderer/run3d/ and city3d/ (their sources) are not
    // needed once bundled; native/ (the Rust sources and cargo's target/) arrives as resources/bin/
    // through extraResource
    ignore: [/^\/(runs|dist|build|scripts|test|supabase|poc|native|\.github|\.claude)(\/|$)/, /^\/src\/renderer\/(run3d|city3d)(\/|$)/],
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
  buildNative,
  executablePath,
  nativeBinDir,
  packagerOptions,
  parseArgs,
  RUST_TARGETS,
};

if (require.main === module) {
  (async () => {
    const opts = parseArgs(process.argv.slice(2));
    buildNative(opts);
    const { packager } = await import('@electron/packager');
    const paths = await packager(packagerOptions(opts));
    console.log(`Build created at: ${paths.join(', ')}`);
  })().catch((e) => {
    console.error('Build failed:', e.message);
    process.exit(1);
  });
}
