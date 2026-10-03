// Runs the engine as a server: the HTTP/WebSocket API (src/server) and the UI in a browser.
//   npm run serve -- [--port 7300] [--host 127.0.0.1] [--workspace <dir>]
//
// The token comes from MULTIAGENT_SERVER_TOKEN, else a random one is generated; open the printed
// URL (it carries the token once, then a cookie keeps it). Same workspace as the app unless
// --workspace is given. Runs need the same account as the app: sign in from the browser UI (the
// sign-in page opens on this machine) or set MULTIAGENT_AUTH=off in development.
//
// Outside 127.0.0.1 the traffic is plain HTTP: put it behind a reverse proxy with TLS.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const workspace = require('../src/workspace');
const { createService } = require('../src/service');
const { createServer } = require('../src/server');
const { createAuth, fileStorage } = require('../src/auth');
const authConfig = require('../src/auth-config');

function parseArgs(argv) {
  const a = { port: 7300, host: '127.0.0.1', workspace: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`Missing value for ${k}`); return v; };
    if (k === '--port') a.port = Number(next());
    else if (k === '--host') a.host = next();
    else if (k === '--workspace') a.workspace = path.resolve(next());
    else throw new Error(`Unknown argument: ${k}`);
  }
  if (!Number.isInteger(a.port) || a.port < 0 || a.port > 65535) throw new Error('--port must be a number between 0 and 65535.');
  return a;
}

// Opens the sign-in page in this machine's browser (and prints it, for a headless machine).
function openBrowser(url) {
  console.log(`Sign-in page: ${url}`);
  const [cmd, args] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' }).on('error', () => {}).unref();
  } catch { /* printed above */ }
}

const args = parseArgs(process.argv.slice(2));
const found = args.workspace ? { dir: args.workspace, source: 'arg' } : workspace.resolveWorkspace();
const ws = workspace.setupWorkspace(found.dir || found.fallback, { persist: !['arg', 'env', 'simulation'].includes(found.source) });

// The account session of the server lives next to the user's home, readable only by this user
// (there is no OS encryption here as in the desktop app).
const accountFile = path.join(os.homedir(), '.multiagent-orchestrator', 'server-account.json');
const authOff = process.env.MULTIAGENT_AUTH === 'off';
const storage = fileStorage(accountFile);
const auth = createAuth({
  url: authOff ? '' : process.env.MULTIAGENT_SUPABASE_URL || authConfig.url,
  key: authOff ? '' : process.env.MULTIAGENT_SUPABASE_KEY || authConfig.publishableKey,
  providers: authConfig.providers,
  required: !authOff,
  storage: {
    ...storage,
    setItem: (k, v) => { storage.setItem(k, v); try { fs.chmodSync(accountFile, 0o600); } catch { /* Windows: per-user profile folder */ } },
  },
  openExternal: async (url) => openBrowser(url),
});

const service = createService({
  host: {
    // no system trash on a server: removed skills/workflows go to <workspace>/.trash
    trashItem: async (p) => {
      const dest = path.join(ws.root, '.trash', `${Date.now()}-${path.basename(p)}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(p, dest);
    },
    appVersion: require('../package.json').version,
    isPackaged: false,
    assertCanRun: (opts) => auth.assertCanRun(opts),
  },
});
service.setWorkspace(ws);
service.cleanupWorktrees().catch((e) => console.error('worktree cleanup:', e.message));
service.clearPastedImages();

const token = process.env.MULTIAGENT_SERVER_TOKEN || crypto.randomBytes(24).toString('base64url');
const server = createServer({ service, auth, token });
server.listen(args.port, args.host, async () => {
  const { port } = server.address();
  const shown = args.host === '0.0.0.0' || args.host === '::' ? os.hostname() : args.host.includes(':') ? `[${args.host}]` : args.host;
  console.log(`Multiagent Orchestrator engine server — workspace ${ws.root}`);
  console.log(`Open: http://${shown}:${port}/?token=${encodeURIComponent(token)}`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(args.host)) console.warn('Listening beyond this machine over plain HTTP: use a reverse proxy with TLS.');
  if (authOff) console.warn('MULTIAGENT_AUTH=off: runs do not need an account.');
  else {
    const s = await auth.refresh().catch(() => auth.state());
    console.log(s.user ? `Account: ${s.user.email}` : 'Not signed in: sign in from the browser UI before starting runs.');
  }
});

const stop = () => {
  service.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
