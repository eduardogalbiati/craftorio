#!/usr/bin/env node
// The supervisor's MCP server (#28): a stdio MCP server (newline-delimited JSON-RPC 2.0) that the
// supervisor's `claude` session starts from its --mcp-config. It holds no data: tools/list and
// tools/call are forwarded to the app's loopback bridge (packages/engine/domains/supervisor/supervisor-bridge.js), whose URL and
// token come in SUPERVISOR_BRIDGE_URL / SUPERVISOR_BRIDGE_TOKEN. Only Node built-ins: the packaged
// app runs this file unpacked under the system node (like session-tail.js).

const http = require('http');
const readline = require('readline');

const URL_ = process.env.SUPERVISOR_BRIDGE_URL || '';
const TOKEN = process.env.SUPERVISOR_BRIDGE_TOKEN || '';
const PROTOCOL = '2025-06-18';

function bridge(route, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${URL_}${route}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const out = JSON.parse(raw);
          if (res.statusCode !== 200) reject(new Error(out.error || `HTTP ${res.statusCode}`)); else resolve(out);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: msg.params?.protocolVersion || PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'orchestrator', version: '1.0.0' },
        instructions: 'Read-only tools over the Multiagent Orchestrator app: workflows, projects, runs, skills, agents, usage and analytics.',
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: (await bridge('/tools/list')).tools };
    case 'tools/call': {
      const out = await bridge('/tools/call', { name: msg.params?.name, arguments: msg.params?.arguments || {} });
      const images = (out.images || []).map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType }));
      return { content: [{ type: 'text', text: out.text }, ...images], isError: !!out.isError };
    }
    default: {
      const e = new Error(`Method not found: ${msg.method}`);
      e.code = -32601;
      throw e;
    }
  }
}

const write = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return write({ id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (msg.id === undefined || msg.id === null) return; // a notification (e.g. notifications/initialized)
  try {
    write({ id: msg.id, result: await handle(msg) });
  } catch (e) {
    // a JSON-RPC code is a number: Node's own codes (ECONNREFUSED when the bridge is down) are -32603
    write({ id: msg.id, error: { code: Number.isInteger(e.code) ? e.code : -32603, message: e.message || String(e) } });
  }
});
