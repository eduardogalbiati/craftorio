// The engine server's side of the addresses (#479, taken from the host's engine-connection.js in phase 2
// of docs/reorganisation-study-2026-10.md, so the `multiagent-engine` bin needs nothing of the desktop
// app): which address `--host` means, and the addresses another computer can type. Pure: the
// interfaces are given (os.networkInterfaces()). The desktop app's engine-connection re-exports these.
//
//   isLoopback(hostname)                    localhost, 127.0.0.1, [::1], ::1
//   isTailscaleIp(ip)                       100.64.0.0/10: the addresses Tailscale gives the machines of a tailnet
//   lanAddresses(interfaces)                this computer's IPv4 addresses beyond loopback, Tailscale's first
//   resolveListenHost(host, interfaces, { insecureHttp })   `--host` as typed → { host } to listen on, or { error }

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isLoopback = (hostname) => LOOPBACK.has(String(hostname || '').toLowerCase());

// 100.64.0.0/10: the addresses Tailscale gives the machines of a tailnet
function isTailscaleIp(ip) {
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(String(ip || ''));
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/** This computer's IPv4 addresses beyond loopback (os.networkInterfaces()) → [{ address, name, tailscale }], Tailscale's first. */
function lanAddresses(interfaces) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push({ address: a.address, name, tailscale: isTailscaleIp(a.address) });
    }
  }
  return out.sort((x, y) => Number(y.tailscale) - Number(x.tailscale));
}

/**
 * `--host` as typed → { host } to listen on, or { error }: 'tailscale' is this computer's Tailscale
 * address only. Beyond loopback and Tailscale the token travels as plain HTTP to the network, and the
 * token is full control of this machine (#479): refused unless `insecureHttp` (`--insecure-http`).
 */
function resolveListenHost(host, interfaces, { insecureHttp = false } = {}) {
  if (host === 'tailscale') {
    const ts = lanAddresses(interfaces).find((a) => a.tailscale);
    return ts ? { host: ts.address } : { error: '--host tailscale: this computer has no Tailscale address (100.64.0.0/10). Is Tailscale running and signed in?' };
  }
  if (isLoopback(host) || isTailscaleIp(host) || insecureHttp) return { host };
  return {
    error: `--host ${host}: the engine would serve plain HTTP to the network, and its token is full control of this machine (a shell, gate approval, paid runs). `
      + 'Use --host tailscale (or a VPN), or put it behind a reverse proxy with TLS and pass --insecure-http to accept plain HTTP on this address.',
  };
}

module.exports = {
  isLoopback,
  isTailscaleIp,
  lanAddresses,
  resolveListenHost,
};
