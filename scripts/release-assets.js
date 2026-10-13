// Release assets of a packaged app (scripts/package.js output), named with the OS and the architecture
// and written to the current folder. The release jobs (deploy.yml, preview.yml) run it on each OS:
//   node scripts/release-assets.js [--platform win32|darwin|linux] [--arch x64|arm64] [dist-folder]
// - Windows: MultiagentOrchestrator-win32-<arch>.zip (the folder's content, Compress-Archive);
// - macOS: MultiagentOrchestrator-darwin-<arch>.zip (the .app, zipped with ditto so the bundle keeps
//   its symlinks and its ad-hoc signature);
// - Linux: MultiagentOrchestrator-linux-<arch>.tar.gz (the folder) and .AppImage (appimagetool, its
//   path in APPIMAGETOOL). The AppImage's AppRun turns Chromium's sandbox off only when the kernel
//   refuses unprivileged user namespaces (Ubuntu 23.10+): the setuid chrome-sandbox cannot work from
//   the AppImage's read-only mount.
// Every asset carries the native sidecars package.js built for its target (resources/bin/, #341).
// Exports assetNames for the tests; builds the assets only when run directly.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./package');

const root = path.join(__dirname, '..');
const NAME = 'MultiagentOrchestrator';
const APPIMAGE_ARCH = { arm64: 'aarch64', x64: 'x86_64' };

const APP_RUN = `#!/bin/sh
# Starts the app; without Chromium's sandbox only when the kernel refuses unprivileged user
# namespaces (the setuid chrome-sandbox cannot work from the AppImage's read-only mount)
HERE="$(dirname "$(readlink -f "$0")")"
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] || [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = "0" ]; then
  exec "$HERE/app/${NAME}" --no-sandbox "$@"
fi
exec "$HERE/app/${NAME}" "$@"
`;

const DESKTOP = `[Desktop Entry]
Type=Application
Name=Multiagent Orchestrator
Comment=Runs multi-agent workflows defined in YAML
Exec=AppRun %U
Icon=multiagent-orchestrator
Categories=Development;
Terminal=false
`;

// The files a build becomes, per OS.
function assetNames({ platform, arch }) {
  const base = `${NAME}-${platform}-${arch}`;
  return platform === 'linux' ? [`${base}.tar.gz`, `${base}.AppImage`] : [`${base}.zip`];
}

const run = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function appImage(build, file, arch) {
  const appDir = `${build}.AppDir`;
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.cpSync(build, path.join(appDir, 'app'), { recursive: true, verbatimSymlinks: true });
  fs.writeFileSync(path.join(appDir, 'AppRun'), APP_RUN, { mode: 0o755 });
  fs.writeFileSync(path.join(appDir, 'multiagent-orchestrator.desktop'), DESKTOP);
  fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(appDir, 'multiagent-orchestrator.png'));
  fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(appDir, '.DirIcon'));
  run(process.env.APPIMAGETOOL || 'appimagetool', [appDir, file], { env: { ...process.env, ARCH: APPIMAGE_ARCH[arch] } });
}

function buildAssets({ platform, arch, out }) {
  const build = path.join(out, `${NAME}-${platform}-${arch}`);
  if (!fs.existsSync(build)) throw new Error(`No build at ${build}: run npm run package first`);
  const files = assetNames({ platform, arch }).map((f) => path.resolve(f));
  if (platform === 'win32') {
    run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${build}\\*' -DestinationPath '${files[0]}' -Force`]);
  } else if (platform === 'darwin') {
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(build, `${NAME}.app`), files[0]]);
  } else {
    run('tar', ['-czf', files[0], '-C', path.dirname(build), path.basename(build)]);
    appImage(build, files[1], arch);
  }
  return files;
}

module.exports = {
  assetNames,
};

if (require.main === module) {
  try {
    console.log(`Release assets: ${buildAssets(parseArgs(process.argv.slice(2))).join(', ')}`);
  } catch (e) {
    console.error('Release assets failed:', e.message);
    process.exit(1);
  }
}
