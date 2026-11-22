#!/usr/bin/env node
// The `craftorio-engine` bin (the engine package's, phase 2 of docs/reorganisation-study-2026-10.md;
// `npm run serve` at the repository root). Runs the engine as a server: the HTTP/WebSocket API
// (packages/engine/server) and the UI in a browser (the folder the root package.json's `craftorio.ui`
// names, served from the app root), or in
// the desktop app of another computer (Settings › Execution › Engine, apps/desktop/host/engine-connection.js).
//   npm run serve -- [--port 7300] [--host 127.0.0.1 | tailscale | <ip>] [--allow-host <name>]... [--insecure-http] [--workspace <dir>] [--fronts <id,id>]
//
// The fronts it serves (phase 4, #590, docs/agents/engine/fronts.md): the composition of the UI app it
// serves (`<multiagent.ui>/../composition.js`, apps/web/composition.js), every installed front
// without one; --fronts narrows it to a list of ids (a one-front engine: its channels plus the
// kernel's, the others answer 404; the page stays the app's generated one).
//
// The token is full control of this machine (a shell, gate approval, paid runs, #479): the banner
// says so and prints the URL that carries it once (clear it from the shell history).
// The token comes from CRAFTORIO_SERVER_TOKEN, else a random one is generated; open the printed
// URL (it carries the token once, then a cookie keeps it). A desktop app saves the token: set
// CRAFTORIO_SERVER_TOKEN so it stays the same across restarts. Same workspace as the app unless
// --workspace is given; like the app, the server locks its workspace (#112): it refuses to start on a
// workspace the desktop app (or another server) has open. Runs need the same account as the app: sign in from the browser UI (the
// sign-in page opens on this machine) or set CRAFTORIO_AUTH=off. A desktop app on another computer
// cannot sign this server in (the sign-in page would open here): it uses CRAFTORIO_AUTH=off.
//
// --host tailscale listens on this computer's Tailscale address only (100.64.0.0/10), not on the
// local network. Outside 127.0.0.1 the traffic is plain HTTP: put it behind a reverse proxy with TLS
// (on a tailnet WireGuard already encrypts it; `tailscale serve` adds HTTPS). Any other address
// (0.0.0.0, a LAN IP) is refused unless --insecure-http is given: only behind a VPN or a TLS proxy.
//
// HTTPS over Tailscale (#541): leave the server on 127.0.0.1 and run `tailscale serve --bg 7300`
// (it proxies only to loopback, not to this machine's own Tailscale IP). `tailscale serve` forwards
// the browser's Host (`<machine>.<tailnet>.ts.net`), which a loopback server refuses (DNS rebinding,
// SEC-16) unless allowed: this machine's MagicDNS name (`tailscale status --json`, Self.DNSName) is
// read at start, and --allow-host <name> (repeatable) adds names. The banner lists them; without
// Tailscale the server starts with the loopback names only and says so.

require('../domains/workspace/legacy-env'); // MULTIAGENT_* → CRAFTORIO_* for scripts and shells written before the rename (T2b)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const workspace = require('../domains/workspace/workspace');
const { createService } = require('../service');
const {
  createServer,
  normalizeHostName,
} = require('../server');
const { createAuth, fileStorage } = require('../domains/account/auth');
const authConfig = require('../domains/account/auth-config');
const runOwner = require('../domains/run/run-owner');
const {
  isLoopback,
  isTailscaleIp,
  lanAddresses,
  resolveListenHost,
} = require('../server/listen-host');
const { appPackage, appRoot } = require('../domains/workspace/app-root');

function parseArgs(argv) {
  const a = { port: 7300, host: '127.0.0.1', workspace: null, insecureHttp: false, fronts: null, allowHosts: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`Missing value for ${k}`); return v; };
    if (k === '--port') a.port = Number(next());
    else if (k === '--host') a.host = next();
    else if (k === '--allow-host') a.allowHosts.push(next());
    else if (k === '--insecure-http') a.insecureHttp = true;
    else if (k === '--workspace') a.workspace = path.resolve(next());
    else if (k === '--fronts') a.fronts = next().split(',').map((x) => x.trim()).filter(Boolean);
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

// This machine's MagicDNS name, the Host `tailscale serve` forwards (#541): { name } or { name: null,
// why }. Never fails the start: Tailscale missing, stopped or slow means loopback names only.
function readMagicDnsName() {
  return new Promise((resolve) => {
    execFile('tailscale', ['status', '--json'], { timeout: 3000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      let status = null;
      try { status = JSON.parse(stdout); } catch { /* below */ }
      if (!status) {
        const why = err?.code === 'ENOENT' ? 'the tailscale command is not installed or not on the PATH'
          : err?.killed ? 'tailscale status did not answer' : 'tailscale status failed';
        return resolve({ name: null, why });
      }
      if (status.BackendState && status.BackendState !== 'Running') return resolve({ name: null, why: `Tailscale is ${status.BackendState}` });
      const name = String(status.Self?.DNSName || '').replace(/\.$/, '');
      resolve(name ? { name } : { name: null, why: 'Tailscale has no MagicDNS name for this machine' });
    });
  });
}

// the composition of the UI app this server serves (apps/web/composition.js: `{ fronts: [ids] }`), if any
function uiComposition() {
  const ui = appPackage().craftorio?.ui;
  const file = ui ? path.join(appRoot(), ui, '..', 'composition.js') : null;
  if (!file || !fs.existsSync(file)) return null;
  const def = require(file);
  return Array.isArray(def.fronts) ? def.fronts : null;
}

const args = parseArgs(process.argv.slice(2));
const listen = resolveListenHost(args.host, os.networkInterfaces(), { insecureHttp: args.insecureHttp });
if (listen.error) {
  console.error(listen.error);
  process.exit(1);
}
const found = args.workspace ? { dir: args.workspace, source: 'arg' } : workspace.resolveWorkspace();
const ws = workspace.setupWorkspace(found.dir || found.fallback, { persist: !['arg', 'env', 'simulation'].includes(found.source) });

// One engine per workspace (#112): the desktop app holds this lock on the workspace it opens, and so
// does the server; two engines on one workspace would take each other's runs for interrupted.
const lock = runOwner.lockWorkspace(ws.root, { app: appRoot(), server: true });
if (!lock.ok) {
  const h = lock.holder;
  console.error(`This workspace is already open${h ? ` in process ${h.pid} on ${h.host}, since ${h.started_at}` : ' in another copy of the app'}: ${ws.root}`);
  console.error('Close the desktop app (or the other server) on this computer first, or pass --workspace <another folder>.');
  process.exit(1);
}

// The account session of the server lives next to the user's home, readable only by this user
// (there is no OS encryption here as in the desktop app).
const accountFile = path.join(os.homedir(), '.multiagent-orchestrator', 'server-account.json');
const authOff = !authConfig.enabled || process.env.CRAFTORIO_AUTH === 'off';
const storage = fileStorage(accountFile);
const auth = createAuth({
  url: authOff ? '' : process.env.CRAFTORIO_SUPABASE_URL || authConfig.url,
  key: authOff ? '' : process.env.CRAFTORIO_SUPABASE_KEY || authConfig.publishableKey,
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
    appVersion: appPackage().version,
    isPackaged: false,
    // the engine host's language, as the app's app.getLocale(): an unset Interface and the agents' default follow it (#424)
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
  },
  fronts: args.fronts || uiComposition(),
});
service.setWorkspace(ws);
service.cleanupWorktrees().catch((e) => console.error('worktree cleanup:', e.message));
// then every 30 minutes, as in the app (#202)
setInterval(() => service.cleanupWorktrees().catch((e) => console.error('worktree cleanup:', e.message)), 30 * 60 * 1000).unref();
service.clearPastedImages();

const token = process.env.CRAFTORIO_SERVER_TOKEN || crypto.randomBytes(24).toString('base64url');
// a loopback server answers only the loopback names and these (#541); another address answers any Host
const loopback = isLoopback(listen.host);
let server = null;
// Beyond this machine: the addresses another computer can type (Tailscale's first), and where the
// desktop app takes them.
function printRemoteAccess(host, port) {
  const wildcard = host === '0.0.0.0' || host === '::';
  const addrs = wildcard ? lanAddresses(os.networkInterfaces()) : [{ address: host, tailscale: isTailscaleIp(host) }];
  const at = (a) => (a.address.includes(':') ? `[${a.address}]` : a.address);
  for (const a of addrs) console.log(`  reachable at http://${at(a)}:${port}${a.tailscale ? '  (Tailscale: this machine\'s MagicDNS name works too)' : ''}`);
  const first = addrs[0] ? `${at(addrs[0])}:${port}` : `<this machine>:${port}`;
  console.log(`Desktop app on another computer: Settings › Execution › Engine › Change… › Remote engine, address ${first}, and the token.`);
  if (!process.env.CRAFTORIO_SERVER_TOKEN) console.warn('The token changes at every start: set CRAFTORIO_SERVER_TOKEN to keep it (the desktop app saves it).');
  if (!addrs.every((a) => a.tailscale)) console.warn('Listening beyond this machine over plain HTTP (--insecure-http): only behind a VPN or a reverse proxy with TLS.');
  if (addrs.some((a) => a.tailscale)) console.log('On a tailnet WireGuard encrypts the traffic; `tailscale serve` adds HTTPS.');
}

// The names a loopback server answers besides localhost, 127.0.0.1 and [::1] (#541), never the token.
function printAllowedHosts(names, magic) {
  const unread = magic.name ? '' : `Tailscale's name not read: ${magic.why}`;
  if (names.length) {
    console.log(`Also answers (tailscale serve): ${names.join(', ')}${unread ? ` (${unread})` : ''}`);
  } else {
    console.log(`Answers only localhost, 127.0.0.1 and [::1] (no --allow-host; ${unread}): behind \`tailscale serve\` pass --allow-host <machine>.<tailnet>.ts.net.`);
  }
}

(async () => {
  const magic = loopback ? await readMagicDnsName() : { name: null };
  const allowedHosts = loopback ? [...new Set([...args.allowHosts, magic.name].map(normalizeHostName).filter(Boolean))] : [];
  server = createServer({ service, auth, token, allowedHosts });
  server.listen(args.port, listen.host, async () => {
    const { port } = server.address();
    const host = listen.host;
    const shown = host === '0.0.0.0' || host === '::' ? os.hostname() : host.includes(':') ? `[${host}]` : host;
    console.log(`Craftorio engine server — workspace ${ws.root}`);
    console.warn('The token is full control of this machine (a shell, gate approval, paid runs): share it only with yourself.');
    console.log(`Open: http://${shown}:${port}/?token=${encodeURIComponent(token)}`);
    console.log('  (shown once: the page keeps it in a cookie; clear this line from the shell history and the terminal\'s scrollback if others can read them.)');
    if (loopback) printAllowedHosts(allowedHosts, magic);
    else printRemoteAccess(host, port);
    if (authOff) console.warn('Sign-in is off: runs do not need an account.');
    else {
      const s = await auth.refresh().catch(() => auth.state());
      console.log(s.user ? `Account: ${s.user.email}` : 'Not signed in: sign in from the browser UI before starting runs.');
    }
  });
})();

const stop = () => {
  service.shutdown();
  lock.release();
  if (!server) process.exit(0);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
