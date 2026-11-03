// The engine connection: the desktop app runs the engine on this computer (the default) or is a
// window onto an engine another computer runs with `npm run serve` (e.g. over Tailscale), the
// setting being per machine. Pure: no Electron and no network of its own (fetch is given), so the
// rules are unit-tested (test/host/engine-connection.test.js); apps/desktop/host/engine-connection-window.js draws the
// windows with them and apps/desktop/host/main.js decides at start.
//
//   parseAddress(text)          'host', 'host:port' or an http(s):// URL → { url, host, ... } (port 7300 by
//                               default); a pasted `…/?token=<t>` URL from the server gives its token too
//   insecureAddress(parsed)     why a parsed address is not encrypted (plain http to a host that is neither
//                               loopback nor Tailscale), or null: such an address needs the explicit
//                               `insecure: true` opt-in, which the connection page shows every time (#480)
//   readConnection(file, opts) / writeConnection(file, connection, opts)
//                               the setting in the app's user data folder (never the workspace): mode,
//                               address, the insecure opt-in and the token, encrypted by the caller's
//                               functions (safeStorage)
//   tokenStorage(file)          'encrypted' | 'plain' | null: Settings warns on a token kept unencrypted (#479)
//   connectionView(connection, { tokenStorage })   what a page may see of it: the token never leaves
//                               the main process
//   decideMode({ connection, env })   local, or remote with its URL and token (or why the setting is unusable)
//   testConnection({ address, token, fetch, localContract })   GET /api/version with the token → the
//                               engine's version and contract, or the reason it failed
//   startUrl, routeUrl, allowRemotePermission   the browser's first address (the remote window sends
//                               the token as `Authorization: Bearer` instead, #480), the remote window's
//                               navigation and permission rules (clipboard-read only over https or loopback)
//   lanAddresses, resolveListenHost   the server's side (packages/engine/server/listen-host.js, the
//                               multiagent-engine bin): the addresses another
//                               computer can type, and `--host tailscale` (this computer's Tailscale address);
//                               another non-loopback host needs `--insecure-http` (#479)

const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 7300;
const FILE = 'engine-connection.json';
// the remote page asks the desktop app for the connection page by opening this path of its own origin
// (apps/web/renderer/api-http.js openEngineConnection): the remote window runs without a preload
const CONNECTION_PATH = '/__desktop__/engine-connection';
// added to the remote window's user agent, so the engine's page knows it is inside the desktop app
const CLIENT_MARK = 'MultiagentRemoteClient';
const PARTITION = 'persist:remote-engine';
const TEST_TIMEOUT_MS = 5000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const isLoopback = (hostname) => LOOPBACK.has(String(hostname || '').toLowerCase());

// whether the typed address names its port ('host:7300', 'http://[fd7a::1]:80/…')
const hasPort = (raw) => /:\d+$/.test(raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0]);

/**
 * The engine's address as typed → { url, host, hostname, port, secure, token? } or { error }.
 * `url` is the origin (`http://host:7300`), the form the setting keeps.
 */
function parseAddress(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { error: 'Type the engine\'s address: its host name or IP address, with :port when it is not 7300.' };
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (scheme && !/^https?$/i.test(scheme[1])) return { error: `Use http:// or https://, not ${scheme[1]}://.` };
  let u;
  try {
    u = new URL(scheme ? raw : `http://${raw}`);
  } catch {
    return { error: /^[0-9a-f:]+$/i.test(raw) && raw.includes(':') ? 'Put an IPv6 address in brackets, e.g. [fd7a::1]:7300.' : `Not an address: ${raw}` };
  }
  if (!u.hostname) return { error: `Not an address: ${raw}` };
  if (u.username || u.password) return { error: 'Leave the user name and password out of the address: the token goes in its own field.' };
  const token = u.searchParams.get('token');
  const onlyToken = [...u.searchParams.keys()].every((k) => k === 'token');
  if ((u.pathname !== '/' && u.pathname !== '') || !onlyToken || u.hash) {
    return { error: 'Type only the address (host and port), without a path: the engine serves the app at its root.' };
  }
  // no port typed: the engine's (7300) over http; https keeps 443 (e.g. behind `tailscale serve`)
  const secure = u.protocol === 'https:';
  if (!secure && !hasPort(raw)) u.port = String(DEFAULT_PORT);
  return {
    url: u.origin,
    host: u.host,
    hostname: u.hostname,
    port: Number(u.port) || (secure ? 443 : 80),
    secure,
    ...(token ? { token } : {}),
  };
}

// Plain http carries the token and every page in clear text (#480): fine on this computer and over
// Tailscale (WireGuard encrypts it: 100.64.0.0/10, a *.ts.net name), anywhere else only with the
// explicit opt-in. The connection page asks it through engine-connection:check (one rule).
function insecureAddress(parsed) {
  if (!parsed || parsed.error || parsed.secure) return null;
  const host = String(parsed.hostname || '').toLowerCase();
  if (isLoopback(host) || isTailscaleIp(host) || /\.ts\.net$/.test(host)) return null;
  return `${parsed.host} is plain http outside this computer and Tailscale: the connection is not encrypted, so the token and every page can be read on the network. Use https (tailscale serve) or a Tailscale address, or check "Allow an insecure connection".`;
}

// ---- the setting --------------------------------------------------------------------------

// A stored connection → { mode: 'local' | 'remote', address, token, insecure? } (token '' when none or
// unreadable; insecure only when the user allowed an unencrypted address, #480).
function normalizeConnection(c) {
  const mode = c?.mode === 'remote' ? 'remote' : 'local';
  return {
    mode,
    address: typeof c?.address === 'string' ? c.address : '',
    token: typeof c?.token === 'string' ? c.token : '',
    ...(c?.insecure === true ? { insecure: true } : {}),
  };
}

// the saved token's form: 'plain', 'encrypted' or null
const storedTokenKind = (t) => (typeof t?.plain === 'string' ? 'plain' : typeof t?.encrypted === 'string' ? 'encrypted' : null);

/**
 * Reads the setting; a missing or corrupt file is the default (this computer). The token is stored
 * `{ encrypted: <base64> }` (decrypt(Buffer) → string, e.g. safeStorage) or `{ plain }` when the
 * computer offers no encryption; one that cannot be decrypted (another OS user) reads as ''.
 */
function readConnection(file, { decrypt = null } = {}) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return normalizeConnection(null);
  }
  let token = '';
  const t = raw?.token;
  const kind = storedTokenKind(t);
  try {
    if (kind === 'plain') token = t.plain;
    else if (kind === 'encrypted' && decrypt) token = String(decrypt(Buffer.from(t.encrypted, 'base64')));
  } catch (e) {
    console.error(`engine connection: could not read the saved token: ${e.message}`);
  }
  return normalizeConnection({ ...raw, token });
}

/** Writes the setting; encrypt(string) → Buffer, or null when the computer has no encryption. */
function writeConnection(file, connection, { encrypt = null } = {}) {
  const c = normalizeConnection(connection);
  const token = !c.token ? null : encrypt ? { encrypted: Buffer.from(encrypt(c.token)).toString('base64') } : { plain: c.token };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ mode: c.mode, address: c.address, ...(c.insecure ? { insecure: true } : {}), ...(token ? { token } : {}) }, null, 2)}\n`);
  return c;
}

/** How the saved token is kept (#479): 'encrypted', 'plain' (no encryption on this computer), or null when none is saved. */
function tokenStorage(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  return storedTokenKind(raw?.token);
}

// What the connection page may see of the setting: never the token itself (the insecure opt-in, so the
// page warns every time, #480); `tokenEncrypted` when the caller says how it is stored (tokenStorage).
const connectionView = (c, { tokenStorage: storage } = {}) => {
  const n = normalizeConnection(c);
  return {
    mode: n.mode,
    address: n.address,
    hasToken: !!n.token,
    ...(n.insecure ? { insecure: true } : {}),
    ...(storage ? { tokenEncrypted: storage === 'encrypted' } : {}),
  };
};

/**
 * Where this process's engine runs, from the setting and the environment:
 *   { mode: 'local' }                                         this computer (the default)
 *   { mode: 'remote', url, host, token, address }             a window onto that engine
 *   { mode: 'remote', error, address }                        remote, but the setting is unusable
 * MULTIAGENT_ENGINE=local forces this computer. Under MULTIAGENT_SIMULATION_ONLY=1 only an engine on
 * this computer (127.0.0.1) is used: a check must never drive an engine that can start real runs.
 * An unencrypted address without the insecure opt-in is unusable (#480): no token is handed out.
 */
function decideMode({ connection, env = {} }) {
  if (env.MULTIAGENT_ENGINE === 'local') return { mode: 'local', reason: 'MULTIAGENT_ENGINE=local' };
  const c = normalizeConnection(connection);
  if (c.mode !== 'remote') return { mode: 'local' };
  const parsed = parseAddress(c.address);
  if (parsed.error) return { mode: 'remote', address: c.address, error: `The saved engine address is not valid: ${parsed.error}` };
  const insecure = insecureAddress(parsed);
  if (insecure && !c.insecure) return { mode: 'remote', address: c.address, url: parsed.url, error: insecure };
  if (!c.token) return { mode: 'remote', address: c.address, url: parsed.url, error: 'No token is saved for the remote engine: type it again.' };
  if (env.MULTIAGENT_SIMULATION_ONLY === '1' && !isLoopback(parsed.hostname)) {
    return { mode: 'local', reason: 'Simulation only: a remote engine is used only on this computer (127.0.0.1).' };
  }
  return { mode: 'remote', address: c.address, url: parsed.url, host: parsed.host, token: c.token };
}

// ---- the connection test ------------------------------------------------------------------

function unreachableMessage(e, parsed, timeoutMs) {
  const code = e?.cause?.code || e?.code || '';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return `No answer from ${parsed.host} in ${Math.round(timeoutMs / 1000)} s: is the engine running there (npm run serve) and is this computer on the same network (Tailscale)?`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `${parsed.hostname} was not found: check the name (on Tailscale, the machine's MagicDNS name or its 100.x address).`;
  }
  if (code === 'ECONNREFUSED') {
    return `${parsed.host} refused the connection: nothing listens on port ${parsed.port} there. Start the engine with npm run serve and a --host other than 127.0.0.1.`;
  }
  return `Could not reach ${parsed.host}: ${e?.cause?.message || e?.message || String(e)}`;
}

/**
 * Asks the engine at `address` for GET /api/version with the token →
 *   { ok: true, url, host, app, contract, sameContract, message }
 *   { ok: false, reason: 'address' | 'token' | 'unreachable' | 'not-engine' | 'http', message, url?, status? }
 * `localContract`: this app's own contract; another one is a warning, not a failure (the remote
 * window shows the engine's own interface).
 */
async function testConnection({ address, token, fetch: fetchImpl = globalThis.fetch, timeoutMs = TEST_TIMEOUT_MS, localContract = null }) {
  const parsed = parseAddress(address);
  if (parsed.error) return { ok: false, reason: 'address', message: parsed.error };
  const tok = String(token || parsed.token || '').trim();
  const where = { url: parsed.url, host: parsed.host };
  if (!tok) return { ok: false, reason: 'token', ...where, message: 'Type the engine\'s token: MULTIAGENT_SERVER_TOKEN on the engine\'s computer, or the token= part of the URL it printed.' };
  let res;
  try {
    res = await fetchImpl(`${parsed.url}/api/version`, {
      headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, reason: 'unreachable', ...where, message: unreachableMessage(e, parsed, timeoutMs) };
  }
  if (res.status === 401) return { ok: false, reason: 'token', ...where, status: 401, message: `${parsed.host} refused the token: copy MULTIAGENT_SERVER_TOKEN from the engine's computer again.` };
  let body = null;
  try { body = await res.json(); } catch { /* not JSON: not an engine */ }
  if (res.status === 404 || (res.ok && (typeof body?.app !== 'string' || typeof body?.contract !== 'string'))) {
    return { ok: false, reason: 'not-engine', ...where, status: res.status, message: `Something answers at ${parsed.host}, but not a Multiagent Orchestrator engine: check the port (npm run serve uses 7300).` };
  }
  if (!res.ok) return { ok: false, reason: 'http', ...where, status: res.status, message: `${parsed.host} answered HTTP ${res.status}${body?.error ? `: ${body.error}` : '.'}` };
  const sameContract = !localContract || body.contract === localContract;
  return {
    ok: true,
    ...where,
    app: body.app,
    contract: body.contract,
    sameContract,
    message: sameContract
      ? `Connected: engine ${body.app} (interface ${body.contract}).`
      : `Connected: engine ${body.app} (interface ${body.contract}). It speaks another interface than this app (${localContract}): the window shows the engine's own interface, so it works; update one of them when you can.`,
  };
}

// ---- the server's side (packages/engine/server/listen-host.js, re-exported for the host's callers and tests) ----

const {
  isTailscaleIp,
  lanAddresses,
  resolveListenHost,
} = require('@multiagent/engine/server/listen-host');

// ---- the remote window's rules ------------------------------------------------------------

// A browser's first address with the token (scripts/serve.js prints it): the server keeps the token in
// a cookie and drops it from the address (packages/engine/server/index.js). The desktop app's remote window never
// uses it: it loads `<url>/` and sends the token as `Authorization: Bearer` (#480).
const startUrl = (url, token) => `${url}/?token=${encodeURIComponent(token)}`;

/**
 * Where a link or navigation of the remote window goes:
 *   'stay'        a page of the engine's own origin: loads in the window
 *   'connection'  the engine's page asks for the connection page (CONNECTION_PATH)
 *   'external'    another http(s) address: the system browser
 *   'deny'        anything else
 */
function routeUrl(url, origin) {
  let u;
  try { u = new URL(url); } catch { return 'deny'; }
  if (u.origin === origin) return u.pathname === CONNECTION_PATH ? 'connection' : 'stay';
  return u.protocol === 'http:' || u.protocol === 'https:' ? 'external' : 'deny';
}

// The web permissions of the remote window: the clipboard (the terminals, Copy buttons) for the
// engine's own origin; nothing else (the microphone needs a secure origin, and the rest is never used).
// Reading the clipboard only over https or loopback (#480, #746): a page replaced on the way must not
// read a password the user just copied; an engine on this computer has no way in between. A plain-http
// Tailscale address stays refused: Ctrl+V pastes through the browser's paste event, with no permission.
// Writing it (Copy buttons) stays on http too.
function allowRemotePermission(permission, requestingUrl, origin) {
  if (permission !== 'clipboard-sanitized-write' && permission !== 'clipboard-read') return false;
  let u;
  try { u = new URL(requestingUrl); } catch { return false; }
  if (u.origin !== origin) return false;
  return permission === 'clipboard-sanitized-write' || u.protocol === 'https:'
    || (u.protocol === 'http:' && isLoopback(u.hostname));
}

module.exports = {
  allowRemotePermission,
  CLIENT_MARK,
  CONNECTION_PATH,
  connectionView,
  decideMode,
  DEFAULT_PORT,
  FILE,
  insecureAddress,
  isLoopback,
  isTailscaleIp,
  lanAddresses,
  normalizeConnection,
  parseAddress,
  PARTITION,
  readConnection,
  resolveListenHost,
  routeUrl,
  startUrl,
  testConnection,
  tokenStorage,
  writeConnection,
};
