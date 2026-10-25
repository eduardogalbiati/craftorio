// The HTTP contract suite's harness (#339): what a client sees of an engine, over HTTP, against any
// engine URL. The JS engine's behaviour, captured as fixtures (test/contract/fixtures.js), is the
// reference another engine (the Rust phases) must answer like. Registers no test: the suite is
// test/contract/contract.test.js, this file's own tests test/contract-harness-339.test.js.
//
//   resolveEngine(env)   ENGINE_URL (+ ENGINE_TOKEN) names an engine; without it the suite starts one
//   startEngine()        `npm run serve` (the multiagent-engine bin) on a scratch workspace, in simulation
//   checkChannel(...)    one channel's call against its manifest entry: status, schema.result, a 400
//   runFixture(...)      a fixture's setup, its checked call, then its teardown
//   coverage(...)        the request/reply channels with a schema, with and without a fixture

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { validateSchema } = require('../../domains/workspace/json-schema');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const BIN = path.join(__dirname, '..', '..', 'bin', 'multiagent-engine.js');

// { url, token, external: true } when ENGINE_URL names an engine; { external: false } otherwise
function resolveEngine(env = process.env) {
  if (!env.ENGINE_URL) return { external: false };
  return { url: String(env.ENGINE_URL).replace(/\/+$/, ''), token: env.ENGINE_TOKEN || '', external: true };
}

// Starts the engine server on a free port, on a fresh scratch workspace, simulation only and with no
// account → { url, token, stop() }. stop() ends the server and removes the scratch folder.
async function startEngine() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-339-'));
  const home = path.join(scratch, 'home');
  for (const d of [home, path.join(home, 'AppData'), path.join(scratch, 'workspace')]) fs.mkdirSync(d, { recursive: true });
  const token = crypto.randomBytes(24).toString('base64url');
  const env = {
    ...process.env,
    MULTIAGENT_SIMULATION_ONLY: '1',
    MULTIAGENT_AUTH: 'off',
    MULTIAGENT_MOCK_DELAY_SCALE: '0.02',
    MULTIAGENT_SERVER_TOKEN: token,
    MULTIAGENT_USER_DATA: path.join(scratch, 'user-data'),
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
    GH_CONFIG_DIR: path.join(home, 'gh'), GLAB_CONFIG_DIR: path.join(home, 'glab'),
  };
  delete env.MULTIAGENT_WORKSPACE;
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [BIN, '--port', '0', '--workspace', path.join(scratch, 'workspace')], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await exited;
    try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* EBUSY: the OS temp folder cleans it */ }
  };
  try {
    const url = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`The engine server did not start in 60 s:\n${out}`)), 60000);
      child.stdout.on('data', (c) => {
        out += c;
        const m = out.match(/Open: (http:\/\/\S+)/);
        if (m) { clearTimeout(timer); resolve(new URL(m[1]).origin); }
      });
      child.stderr.on('data', (c) => { out += c; });
      exited.then((code) => { clearTimeout(timer); reject(new Error(`The engine server exited (${code}):\n${out}`)); });
    });
    return { url, token, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}

// GET or POST on the engine → { status, body } (body: the parsed JSON, or null)
async function request(url, token, pathname, body) {
  const res = await fetch(`${url}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}

// a channel's call: POST /api/<channel> { arg } → { status, body }
const callChannel = (url, token, channel, arg) => request(url, token, `/api/${encodeURIComponent(channel)}`, { arg: arg === undefined ? null : arg });

// the engine's manifest entries, read once per engine
const manifests = new Map();
async function manifestOf(url, token) {
  const key = `${url}\n${token}`;
  if (!manifests.has(key)) {
    const res = await request(url, token, '/api/manifest');
    if (res.status !== 200 || !Array.isArray(res.body?.result)) {
      throw new Error(`GET ${url}/api/manifest answered ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
    }
    manifests.set(key, res.body.result);
  }
  return manifests.get(key);
}

const brief = (value) => JSON.stringify(value === undefined ? null : value).slice(0, 300);

// One channel against its contract: the fixture's call answers fixture.status (200 by default) with
// a result matching the entry's schema.result, and fixture.invalid's argument is refused with a 400.
// Rejects with an Error naming the channel and what does not hold.
async function checkChannel({ url, token, channel, fixture }) {
  const entry = (await manifestOf(url, token)).find((e) => e.channel === channel);
  if (!entry) throw new Error(`${channel}: not a channel of the engine's manifest (GET /api/manifest).`);
  const expected = fixture.status || 200;
  const res = await callChannel(url, token, channel, fixture.arg);
  if (res.status !== expected) {
    throw new Error(`${channel}: expected HTTP ${expected}, got ${res.status}: ${brief(res.body?.error ?? res.body)}`);
  }
  const result = res.body?.result;
  if (expected === 200 && entry.schema && 'result' in entry.schema) {
    const errs = validateSchema(result === undefined ? null : result, entry.schema.result, 'result');
    if (errs.length) throw new Error(`${channel}: the result does not match its schema.result: ${errs.join('; ')}. Result: ${brief(result)}`);
  }
  if (fixture.invalid) {
    const bad = await callChannel(url, token, channel, fixture.invalid.arg);
    if (bad.status !== 400) {
      throw new Error(`${channel}: an invalid argument (${brief(fixture.invalid.arg)}) must be refused with HTTP 400, got ${bad.status}: ${brief(bad.body)}`);
    }
  }
  return result;
}

// A client for a fixture's setup and teardown: call(channel, arg) → the result, or throws
function clientOf(url, token) {
  return {
    call: async (channel, arg) => {
      const res = await callChannel(url, token, channel, arg);
      if (res.status !== 200) throw new Error(`${channel} answered HTTP ${res.status}: ${brief(res.body?.error ?? res.body)}`);
      return res.body.result;
    },
  };
}

// A fixture of test/contract/fixtures.js end to end: its setup, the checked call (its arg may be a
// function of the setup's state), then its teardown, even when the check fails
async function runFixture({ url, token, channel, fixture }) {
  const client = clientOf(url, token);
  let state;
  try {
    state = fixture.setup ? await fixture.setup(client) : undefined;
  } catch (e) {
    throw new Error(`${channel}: the fixture's setup failed: ${e.message}`);
  }
  const arg = typeof fixture.arg === 'function' ? fixture.arg(state) : fixture.arg;
  let result;
  try {
    result = await checkChannel({ url, token, channel, fixture: { ...fixture, arg } });
  } finally {
    if (fixture.teardown) await Promise.resolve().then(() => fixture.teardown(client, state, result)).catch(() => {});
  }
  return result;
}

// The request/reply channels with a schema (not desktop-only: the browser's rule, apps/web/renderer/api-http.js)
// → { withSchema, covered, missing }, sorted channel names
function coverage(manifest, fixtures) {
  const withSchema = manifest.filter((e) => e.channel && e.schema && !e.desktop).map((e) => e.channel).sort();
  const has = (ch) => Object.hasOwn(fixtures, ch);
  return { withSchema, covered: withSchema.filter(has), missing: withSchema.filter((ch) => !has(ch)) };
}

module.exports = {
  callChannel,
  checkChannel,
  coverage,
  manifestOf,
  resolveEngine,
  runFixture,
  startEngine,
};
