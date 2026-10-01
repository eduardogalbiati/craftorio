// The supervisor's stdio MCP server (#28, src/supervisor-mcp.js): a thin JSON-RPC 2.0 proxy, over
// newline-delimited stdin/stdout, to the app's loopback bridge (src/supervisor-bridge.js). Spawned
// with process.execPath, pointed at a real bridge serving a fake tool.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { createBridge } = require('../src/supervisor-bridge');

const SCRIPT = path.join(__dirname, '..', 'src', 'supervisor-mcp.js');

function startMcp(env) {
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const received = [];
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) if (line.trim()) { try { received.push(JSON.parse(line)); } catch { received.push({ raw: line }); } }
  });
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
  return { child, send, received, waitFor };
}

async function withBridgeAndMcp(t, tools) {
  const bridge = createBridge({ tools: () => tools });
  const { url, token } = await bridge.start();
  const mcp = startMcp({ SUPERVISOR_BRIDGE_URL: url, SUPERVISOR_BRIDGE_TOKEN: token });
  t.after(() => { mcp.child.kill(); bridge.close(); });
  return mcp;
}

test('initialize echoes the protocolVersion and advertises tools capabilities', async (t) => {
  const mcp = await withBridgeAndMcp(t, []);
  mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-01-01' } });
  const res = await mcp.waitFor((m) => m.id === 1);
  assert.equal(res.result.protocolVersion, '2024-01-01');
  assert.deepEqual(res.result.capabilities, { tools: {} });
});

test('a notification (no id) gets no reply', async (t) => {
  const mcp = await withBridgeAndMcp(t, []);
  mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  mcp.send({ jsonrpc: '2.0', id: 99, method: 'ping' });
  const res = await mcp.waitFor((m) => m.id === 99);
  assert.deepEqual(res.result, {});
  assert.ok(!mcp.received.some((m) => m.method === 'notifications/initialized'));
});

test('tools/list proxies the bridge\'s tools', async (t) => {
  const tool = { name: 'echo', description: 'echoes', inputSchema: { type: 'object' }, run: ({ x }) => `got ${x}` };
  const mcp = await withBridgeAndMcp(t, [tool]);
  mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const res = await mcp.waitFor((m) => m.id === 2);
  assert.deepEqual(res.result.tools, [{ name: 'echo', description: 'echoes', inputSchema: { type: 'object' } }]);
});

test('tools/call returns content[0].text and isError', async (t) => {
  const ok = { name: 'echo', description: 'echoes', inputSchema: { type: 'object' }, run: ({ x }) => `got ${x}` };
  const mcp = await withBridgeAndMcp(t, [ok]);
  mcp.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { x: 42 } } });
  const res = await mcp.waitFor((m) => m.id === 3);
  assert.deepEqual(res.result, { content: [{ type: 'text', text: 'got 42' }], isError: false });

  mcp.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'missing', arguments: {} } });
  const err = await mcp.waitFor((m) => m.id === 4);
  assert.equal(err.result.isError, true);
  assert.match(err.result.content[0].text, /Unknown tool: missing/);
});

test('an unknown method gives error -32601', async (t) => {
  const mcp = await withBridgeAndMcp(t, []);
  mcp.send({ jsonrpc: '2.0', id: 5, method: 'nope/nothing' });
  const res = await mcp.waitFor((m) => m.id === 5);
  assert.equal(res.error.code, -32601);
  assert.match(res.error.message, /Method not found: nope\/nothing/);
});

test('an unparsable line gives a parse error (-32700)', async (t) => {
  const mcp = await withBridgeAndMcp(t, []);
  mcp.child.stdin.write('{not json\n');
  const res = await mcp.waitFor((m) => m.error?.code === -32700);
  assert.equal(res.id, null);
});
