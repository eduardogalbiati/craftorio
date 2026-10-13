// The supervisor's stdio MCP server (#28, src/supervisor-mcp.js): a thin JSON-RPC 2.0 proxy, over
// newline-delimited stdin/stdout, to the app's loopback bridge (src/supervisor-bridge.js), pointed
// at a real bridge serving fake tools. Every case runs against two servers that must answer alike
// (#341): the JS script (spawned with process.execPath) and the Rust binary multiagent-mcp
// (native/, built here with `cargo build --release`). Without cargo the binary's cases are skipped
// with one line; CI (CI set) never skips them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createBridge } = require('../src/supervisor-bridge');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'src', 'supervisor-mcp.js');
const NATIVE = path.join(ROOT, 'native');
const BINARY_NAME = process.platform === 'win32' ? 'multiagent-mcp.exe' : 'multiagent-mcp';
const BINARY = path.join(process.env.CARGO_TARGET_DIR || path.join(NATIVE, 'target'), 'release', BINARY_NAME);

const hasCargo = () => spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0;

// Builds the binary once per file (cargo is incremental: a no-op when it is up to date).
let built = null;
function buildBinary() {
  if (built) return built;
  const r = spawnSync('cargo', ['build', '--release', '--manifest-path', path.join(NATIVE, 'Cargo.toml'), '-p', 'multiagent-mcp'], {
    encoding: 'utf8', timeout: 9 * 60 * 1000,
  });
  if (r.status !== 0) built = { error: `cargo build of multiagent-mcp failed: ${(r.stderr || r.error?.message || '').slice(-1500)}` };
  else if (!fs.existsSync(BINARY)) built = { error: `cargo built multiagent-mcp but ${BINARY} does not exist` };
  else built = { file: BINARY };
  return built;
}

const SERVERS = [
  { label: 'supervisor-mcp.js (Node)', command: () => ({ file: process.execPath, args: [SCRIPT] }) },
  {
    label: 'multiagent-mcp (Rust binary)',
    skip: !process.env.CI && !hasCargo() ? 'cargo is not installed: the Rust MCP server\'s cases are skipped (CI runs them)' : false,
    command: () => {
      const b = buildBinary();
      if (b.error) throw new Error(b.error);
      return { file: b.file, args: [] };
    },
  },
];

function startMcp(server, env) {
  const { file, args } = server.command();
  const child = spawn(file, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const received = [];
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) if (line.trim()) { try { received.push(JSON.parse(line)); } catch { received.push({ raw: line }); } }
  });
  child.on('error', () => {});
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  const waitFor = async (predicate, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = received.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for a message (got ${JSON.stringify(received)})`);
  };
  return { child, send, received, waitFor, exited };
}

async function withBridgeAndMcp(t, server, tools, { token: tokenOverride } = {}) {
  const bridge = createBridge({ tools: () => tools });
  const { url, token } = await bridge.start();
  const mcp = startMcp(server, { SUPERVISOR_BRIDGE_URL: url, SUPERVISOR_BRIDGE_TOKEN: tokenOverride ?? token });
  t.after(() => { mcp.child.kill(); bridge.close(); });
  return mcp;
}

for (const server of SERVERS) {
  test.describe(server.label, { skip: server.skip }, () => {
    test('initialize echoes the protocolVersion and advertises tools capabilities', async (t) => {
      const mcp = await withBridgeAndMcp(t, server, []);
      mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-01-01' } });
      const res = await mcp.waitFor((m) => m.id === 1);
      assert.equal(res.jsonrpc, '2.0');
      assert.equal(res.result.protocolVersion, '2024-01-01');
      assert.deepEqual(res.result.capabilities, { tools: {} });
    });

    test('initialize without a protocolVersion answers 2025-06-18 and names the orchestrator server', async (t) => {
      const mcp = await withBridgeAndMcp(t, server, []);
      mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      const res = await mcp.waitFor((m) => m.id === 1);
      assert.equal(res.result.protocolVersion, '2025-06-18');
      assert.equal(res.result.serverInfo.name, 'orchestrator');
      assert.equal(typeof res.result.instructions, 'string');
    });

    test('a notification (no id) gets no reply', async (t) => {
      const mcp = await withBridgeAndMcp(t, server, []);
      mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      mcp.send({ jsonrpc: '2.0', id: 99, method: 'ping' });
      const res = await mcp.waitFor((m) => m.id === 99);
      assert.deepEqual(res.result, {});
      assert.equal(mcp.received.length, 1, `only the ping is answered (got ${JSON.stringify(mcp.received)})`);
    });

    test('a string id is answered with the same id', async (t) => {
      const mcp = await withBridgeAndMcp(t, server, []);
      mcp.send({ jsonrpc: '2.0', id: 'abc', method: 'ping' });
      const res = await mcp.waitFor((m) => m.id === 'abc');
      assert.deepEqual(res.result, {});
    });

    test('tools/list proxies the bridge\'s tools', async (t) => {
      const tool = { name: 'echo', description: 'echoes', inputSchema: { type: 'object' }, run: ({ x }) => `got ${x}` };
      const mcp = await withBridgeAndMcp(t, server, [tool]);
      mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const res = await mcp.waitFor((m) => m.id === 2);
      assert.deepEqual(res.result.tools, [{ name: 'echo', description: 'echoes', inputSchema: { type: 'object' } }]);
    });

    test('tools/call returns content[0].text and isError', async (t) => {
      const ok = { name: 'echo', description: 'echoes', inputSchema: { type: 'object' }, run: ({ x }) => `got ${x}` };
      const mcp = await withBridgeAndMcp(t, server, [ok]);
      mcp.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { x: 42 } } });
      const res = await mcp.waitFor((m) => m.id === 3);
      assert.deepEqual(res.result, { content: [{ type: 'text', text: 'got 42' }], isError: false });

      mcp.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'missing', arguments: {} } });
      const err = await mcp.waitFor((m) => m.id === 4);
      assert.equal(err.result.isError, true);
      assert.match(err.result.content[0].text, /Unknown tool: missing/);
    });

    test('tools/call without arguments sends an empty object to the tool', async (t) => {
      const keys = { name: 'keys', description: 'lists its argument keys', inputSchema: { type: 'object' }, run: (a) => `keys=${Object.keys(a).length} type=${typeof a}` };
      const mcp = await withBridgeAndMcp(t, server, [keys]);
      mcp.send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'keys' } });
      const res = await mcp.waitFor((m) => m.id === 6);
      assert.deepEqual(res.result, { content: [{ type: 'text', text: 'keys=0 type=object' }], isError: false });
    });

    test('tools/call keeps non-ASCII text intact', async (t) => {
      const text = 'Atenção: ✓ 日本語 🚀';
      const uni = { name: 'uni', description: 'unicode', inputSchema: { type: 'object' }, run: ({ s }) => `${s}|${text}` };
      const mcp = await withBridgeAndMcp(t, server, [uni]);
      mcp.send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'uni', arguments: { s: 'ação' } } });
      const res = await mcp.waitFor((m) => m.id === 7);
      assert.equal(res.result.content[0].text, `ação|${text}`);
    });

    test('tools/call passes a tool\'s images through after the text (view_attachment)', async (t) => {
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const view = {
        name: 'view_attachment', description: 'an image', inputSchema: { type: 'object' },
        run: () => ({ text: 'two images', images: [{ data: png, mimeType: 'image/png' }, { data: 'R0lGODlhAQABAAAAACw=', mimeType: 'image/gif' }] }),
      };
      const mcp = await withBridgeAndMcp(t, server, [view]);
      mcp.send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'view_attachment', arguments: {} } });
      const res = await mcp.waitFor((m) => m.id === 8);
      assert.deepEqual(res.result, {
        content: [
          { type: 'text', text: 'two images' },
          { type: 'image', data: png, mimeType: 'image/png' },
          { type: 'image', data: 'R0lGODlhAQABAAAAACw=', mimeType: 'image/gif' },
        ],
        isError: false,
      });
    });

    test('a wrong token gives the bridge\'s error (-32603 forbidden)', async (t) => {
      const mcp = await withBridgeAndMcp(t, server, [], { token: 'not-the-token' });
      mcp.send({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
      const res = await mcp.waitFor((m) => m.id === 9);
      assert.equal(res.result, undefined);
      assert.equal(res.error.code, -32603);
      assert.equal(res.error.message, 'forbidden');
    });

    test('a bridge that is down gives error -32603 and the server keeps answering', async (t) => {
      const bridge = createBridge({ tools: () => [] });
      const { url, token } = await bridge.start();
      bridge.close();
      const mcp = startMcp(server, { SUPERVISOR_BRIDGE_URL: url, SUPERVISOR_BRIDGE_TOKEN: token });
      t.after(() => mcp.child.kill());
      mcp.send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'echo', arguments: {} } });
      const res = await mcp.waitFor((m) => m.id === 10, 15000);
      assert.equal(res.error.code, -32603);
      assert.equal(typeof res.error.message, 'string');
      assert.ok(res.error.message.length > 0, 'the error says why');
      mcp.send({ jsonrpc: '2.0', id: 11, method: 'ping' });
      const pong = await mcp.waitFor((m) => m.id === 11);
      assert.deepEqual(pong.result, {});
    });

    test('an unknown method gives error -32601', async (t) => {
      const mcp = await withBridgeAndMcp(t, server, []);
      mcp.send({ jsonrpc: '2.0', id: 5, method: 'nope/nothing' });
      const res = await mcp.waitFor((m) => m.id === 5);
      assert.equal(res.error.code, -32601);
      assert.match(res.error.message, /Method not found: nope\/nothing/);
    });

    test('an unparsable line gives a parse error (-32700) and blank lines are ignored', async (t) => {
      const mcp = await withBridgeAndMcp(t, server, []);
      mcp.child.stdin.write('\n   \n{not json\n');
      const res = await mcp.waitFor((m) => m.error?.code === -32700);
      assert.equal(res.id, null);
      mcp.send({ jsonrpc: '2.0', id: 12, method: 'ping' });
      await mcp.waitFor((m) => m.id === 12);
      assert.equal(mcp.received.length, 2, `one parse error and the ping (got ${JSON.stringify(mcp.received)})`);
    });

    test('a request line split across writes is read as one message', async (t) => {
      const mcp = await withBridgeAndMcp(t, server, []);
      const line = JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'ping' });
      mcp.child.stdin.write(line.slice(0, 10));
      await new Promise((r) => setTimeout(r, 50));
      mcp.child.stdin.write(`${line.slice(10)}\n`);
      const res = await mcp.waitFor((m) => m.id === 13);
      assert.deepEqual(res.result, {});
    });

    test('exits cleanly (code 0) when stdin closes', async (t) => {
      const mcp = await withBridgeAndMcp(t, server, []);
      mcp.send({ jsonrpc: '2.0', id: 14, method: 'ping' });
      await mcp.waitFor((m) => m.id === 14);
      mcp.child.stdin.end();
      const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000));
      const exit = await Promise.race([mcp.exited, timeout]);
      assert.notEqual(exit, 'timeout', 'the server exits within 5 s of stdin closing');
      assert.equal(exit.code, 0);
    });
  });
}
