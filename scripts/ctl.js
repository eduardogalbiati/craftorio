#!/usr/bin/env node
// The control channel's client (#336, packages/engine/control/index.js): calls one channel of the running app and
// prints its result as JSON. Plain Node, no dependencies.
//   node scripts/ctl.js <channel> [json-argument]
//   node scripts/ctl.js roadmap:start '{"projectId":"my-app"}'
// The workspace is CRAFTORIO_WORKSPACE, or --workspace <dir>; the endpoint and its token come from
// <workspace>/control/endpoint.json (written while Settings › Execution › "Allow outside sessions to
// control this app" is on). A refused or failed call exits with 1 and prints the error on stderr.

const fs = require('fs');
const http = require('http');
const path = require('path');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const rest = [];
  let ws = process.env.CRAFTORIO_WORKSPACE || '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace') ws = argv[++i] || '';
    else rest.push(argv[i]);
  }
  return { ws, channel: rest[0], json: rest[1] };
}

function main() {
  const { ws, channel, json } = parseArgs(process.argv.slice(2));
  if (!channel) fail('Usage: node scripts/ctl.js <channel> [json-argument] [--workspace <dir>]');
  if (!ws) fail('No workspace: set CRAFTORIO_WORKSPACE or pass --workspace <dir>.');
  const file = path.join(ws, 'control', 'endpoint.json');
  let endpoint;
  try { endpoint = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
    fail(`No control endpoint at ${file}: turn on Settings › Execution › "Allow outside sessions to control this app".`);
  }
  let arg;
  if (json !== undefined) {
    try { arg = JSON.parse(json); } catch { fail(`The argument is not valid JSON: ${json}`); }
  }
  const body = JSON.stringify(arg === undefined ? {} : { arg });
  const req = http.request(`${endpoint.url}/api/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { data += c; });
    res.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(data); } catch { /* not JSON */ }
      if (res.statusCode !== 200) fail(`${channel}: ${res.statusCode} ${(parsed && parsed.error) || data}`);
      process.stdout.write(`${JSON.stringify(parsed ? parsed.result : null, null, 2)}\n`);
    });
  });
  req.on('error', (e) => fail(`${channel}: the app is not answering at ${endpoint.url} (${e.message}).`));
  req.end(body);
}

main();
