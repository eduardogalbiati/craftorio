// Where the app's native sidecars (native/, #341 and #342) live and how the external live terminal
// starts its follower. The sidecars: multiagent-mcp (the supervisor's MCP server), multiagent-tail
// (the external live terminal, the twin of packages/engine/domains/session/session-tail.js) and multiagent-ctl (the control
// channel's client, the twin of scripts/ctl.js). Packaged, they are in resources/bin/
// (apps/desktop/scripts/package.js); in a dev checkout, cargo's release output under native/. Never looked up on
// the PATH, so the packaged app needs no system Node for anything it starts.

const fs = require('fs');
const path = require('path');
const { appRoot } = require('../workspace/app-root');

// The path of a sidecar for this platform (.exe on Windows only).
function nativeBinaryPath(name, { isPackaged, resourcesPath = process.resourcesPath, platform = process.platform } = {}) {
  const file = platform === 'win32' ? `${name}.exe` : name;
  if (isPackaged) return path.join(resourcesPath, 'bin', file);
  return path.join(appRoot(), 'native', 'target', 'release', file);
}

// How the external live terminal follows a session: the Rust binary when it exists (no Node needed),
// else packages/engine/domains/session/session-tail.js. Dev: Electron itself as node. Packaged: the system node (an older build
// without the binary). The caller adds <runDir> <sessionId>.
function tailCommand(isPackaged, resolveCommand, { binary = nativeBinaryPath('multiagent-tail', { isPackaged }) } = {}) {
  if (fs.existsSync(binary)) return { command: binary, args: [], env: {} };
  const script = path.join(__dirname, '..', 'session', 'session-tail.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const node = isPackaged ? resolveCommand('node') : { file: process.execPath };
  if (!node) throw new Error('The external live terminal needs Node.js on the PATH. Use the embedded live terminal instead.');
  return { command: node.file, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

module.exports = {
  nativeBinaryPath,
  tailCommand,
};
