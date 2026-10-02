// The loopback endpoint the supervisor's MCP server (src/supervisor-mcp.js, a child of `claude`)
// calls to reach the service's tools (src/supervisor-tools.js) in the app's process (#28).
// It listens on 127.0.0.1 only, on a free port, from the first real supervisor turn on; every request
// carries a random bearer token that only the MCP config of that turn knows.
//   POST /tools/list                          → { tools: [{ name, description, inputSchema }] }
//   POST /tools/call { name, arguments }      → { text, isError, images? } (images: the Oracle's view_attachment)
// The Oracle (src/oracle.js) has its own bridge over its own tools; mcpCommand serves both.

const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { callTool, describeTools } = require('./supervisor-tools');

const MAX_BODY = 1024 * 1024;

// How `claude` starts the MCP server. Dev: Electron itself as node. Packaged: the RunAsNode fuse is
// off, so the system node runs the unpacked copy (node can't read app.asar), like session-tail.js.
function mcpCommand(isPackaged, resolveCommand) {
  const script = path.join(__dirname, 'supervisor-mcp.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const node = isPackaged ? resolveCommand('node') : { file: process.execPath };
  if (!node) throw new Error('The supervisor\'s tools need Node.js on the PATH.');
  return { command: node.file, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/** `tools()` returns the tool list at call time. start() resolves { url, token }; close() stops it. */
function createBridge({ tools }) {
  const token = crypto.randomBytes(24).toString('hex');
  let server = null;
  let ready = null;

  async function handle(req, res) {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) return send(403, { error: 'forbidden' });
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return send(413, { error: 'too large' });
    }
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: 'invalid JSON' }); }
    if (req.url === '/tools/list') return send(200, { tools: describeTools(tools()) });
    if (req.url === '/tools/call') return send(200, await callTool(tools(), String(body.name || ''), body.arguments));
    return send(404, { error: 'not found' });
  }

  return {
    start() {
      ready ||= new Promise((resolve, reject) => {
        server = http.createServer((req, res) => handle(req, res).catch((e) => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }));
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.unref();
          resolve({ url: `http://127.0.0.1:${server.address().port}`, token });
        });
      });
      return ready;
    },
    close() {
      server?.close();
      server = null;
      ready = null;
    },
  };
}

module.exports = {
  createBridge,
  mcpCommand,
};
