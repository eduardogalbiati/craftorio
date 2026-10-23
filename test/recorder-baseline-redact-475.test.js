// #475 (SEC-10) acceptance tests, written before the code: the Recorder (src/engine/recorder.js)
// redacts well-known secrets with no workflow rule declared.
//
// Interface the developer implements (assumptions, documented here):
//   - new Recorder(runDir, redactRules) keeps its signature. A baseline list inside Recorder runs on
//     every recorded string before the workflow's rules (observability.capture.redact): bearer
//     tokens (`Authorization: Bearer …`), `…KEY=` / `…TOKEN=` / `…SECRET=` env pairs (the value),
//     PEM blocks (`-----BEGIN … PRIVATE KEY-----` … `-----END …-----`), and `ghp_` / `github_pat_` /
//     `sk-` / `xox…` tokens.
//   - A `session.stream` event whose item is `{ kind: 'spawn', args }` (src/engine/providers.js runCli)
//     is recorded with the `env` values of the JSON after `--mcp-config` removed (the env names kept,
//     as #470 records env names, never values).
//   - The `tool_result` of a `printenv` / `env` tool call (the matching `tool_call` id of the same
//     session, input.command) is never recorded in full: the variables' values are absent.
// What is asserted is behavioural only: secret strings absent from events.jsonl and the session
// file, the non-secret text around them still there. The replacement text is free.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Recorder } = require('../src/engine/recorder');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-475-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

let seq = 0;
const stream = (item, sessionId = 's1') => ({ seq: ++seq, ts: '2026-10-22T00:00:00.000Z', run_id: 'r1', type: 'session.stream', session_id: sessionId, turn: 1, item });
const toolResult = (output, id = 't1') => stream({ kind: 'tool_result', id, output });

// Records `events` with `rules` (the workflow's redact list) → { events: events.jsonl text, session: sessions/s1.jsonl text }
function record(t, events, rules) {
  const dir = tmpDir(t);
  const rec = new Recorder(dir, rules);
  for (const ev of events) rec.write(ev);
  rec.write({ seq: ++seq, ts: '2026-10-22T00:00:01.000Z', run_id: 'r1', type: 'workflow.finished', summary: {} });
  const session = path.join(dir, 'sessions', 's1.jsonl');
  return {
    events: fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'),
    session: fs.existsSync(session) ? fs.readFileSync(session, 'utf8') : '',
  };
}

test('#475 a bearer token in a tool_result is redacted with no workflow rule; the header name stays', (t) => {
  const out = record(t, [toolResult('curl -v https://api.example.com\nAuthorization: Bearer abc123def456ghi789jkl\nHTTP/1.1 200 OK')]);
  assert.equal(out.events.includes('abc123def456ghi789jkl'), false);
  assert.equal(out.events.includes('Authorization'), true);
  assert.equal(out.events.includes('HTTP/1.1 200 OK'), true);
});

test('#475 a PEM private key block in a tool_result is redacted with no workflow rule', (t) => {
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7pemSecretBody\n-----END PRIVATE KEY-----';
  const out = record(t, [toolResult(`cat key.pem\n${pem}\ndone reading`)]);
  assert.equal(out.events.includes('MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7pemSecretBody'), false);
  assert.equal(out.events.includes('done reading'), true);
});

test('#475 the session file is redacted too', (t) => {
  const out = record(t, [toolResult('Authorization: Bearer abc123def456ghi789jkl')]);
  assert.equal(out.session.includes('abc123def456ghi789jkl'), false);
  assert.equal(out.session.includes('Authorization'), true);
});

test('#475 an AWS_SECRET_ACCESS_KEY= value is redacted; the variable name stays', (t) => {
  const out = record(t, [toolResult('export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY\nexported')]);
  assert.equal(out.events.includes('wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY'), false);
  assert.equal(out.events.includes('AWS_SECRET_ACCESS_KEY'), true);
  assert.equal(out.events.includes('exported'), true);
});

test('#475 a TOKEN= env pair value is redacted', (t) => {
  const out = record(t, [toolResult('NPM_TOKEN=npmtokvalue0123456789abcdef npm publish')]);
  assert.equal(out.events.includes('npmtokvalue0123456789abcdef'), false);
  assert.equal(out.events.includes('npm publish'), true);
});

test('#475 a ghp_ GitHub token is redacted', (t) => {
  const out = record(t, [toolResult('remote: https://ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8@github.com/o/r.git cloned')]);
  assert.equal(out.events.includes('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'), false);
  assert.equal(out.events.includes('github.com/o/r.git cloned'), true);
});

test('#475 a github_pat_ token is redacted', (t) => {
  const out = record(t, [toolResult('token github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123 set')]);
  assert.equal(out.events.includes('11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123'), false);
  assert.equal(out.events.includes(' set'), true);
});

test('#475 an sk- API key is redacted', (t) => {
  const out = record(t, [toolResult('using key sk-proj-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0Fe for the call')]);
  assert.equal(out.events.includes('Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0Fe'), false);
  assert.equal(out.events.includes('for the call'), true);
});

test('#475 an xox Slack token is redacted', (t) => {
  const out = record(t, [toolResult('slack xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx posted')]);
  assert.equal(out.events.includes('AbCdEfGhIjKlMnOpQrStUvWx'), false);
  assert.equal(out.events.includes('posted'), true);
});

test('#475 a spawn event\'s --mcp-config env value is not recorded; the flag and the env name are', (t) => {
  const mcp = JSON.stringify({ mcpServers: { x: { command: 'node', args: ['srv.js'], env: { API_TOKEN: 'mcpvalue-9f8e7d6c5b4a' } } } });
  const spawn = stream({ kind: 'spawn', command: 'claude', args: ['-p', '--mcp-config', mcp, '--output-format', 'stream-json'], cwd: os.tmpdir(), env: ['PATH'] });
  const out = record(t, [spawn]);
  assert.equal(out.events.includes('mcpvalue-9f8e7d6c5b4a'), false);
  assert.equal(out.events.includes('--mcp-config'), true);
  assert.equal(out.events.includes('API_TOKEN'), true);
  assert.equal(out.events.includes('stream-json'), true);
});

test('#475 the output of a printenv call is not recorded in full: a variable value no pattern knows is absent', (t) => {
  const call = stream({ kind: 'tool_call', id: 't9', name: 'Bash', input: { command: 'printenv' } });
  const result = toolResult('HOME=/home/u\nDATABASE_URL=postgres://app:hunter2plain@db.local/app\nSHELL=/bin/bash', 't9');
  const out = record(t, [call, result]);
  assert.equal(out.events.includes('hunter2plain'), false);
  assert.equal(out.events.includes('printenv'), true, 'the call itself is still recorded');
});

test('#475 the output of an env call is not recorded in full', (t) => {
  const call = stream({ kind: 'tool_call', id: 't8', name: 'Bash', input: { command: 'env' } });
  const result = toolResult('LANG=C.UTF-8\nSESSION_COOKIE=cookieplainvalue77\nUSER=u', 't8');
  const out = record(t, [call, result]);
  assert.equal(out.events.includes('cookieplainvalue77'), false);
});

test('#475 the output of another command is kept as it is (only secrets go)', (t) => {
  const call = stream({ kind: 'tool_call', id: 't7', name: 'Bash', input: { command: 'git status' } });
  const result = toolResult('On branch feat/x\nnothing to commit, working tree clean', 't7');
  const out = record(t, [call, result]);
  assert.equal(out.events.includes('nothing to commit, working tree clean'), true);
});

test('#475 the workflow\'s own rules still apply after the baseline', (t) => {
  const out = record(t, [toolResult('customer id CUST-778899 with Authorization: Bearer abc123def456ghi789jkl')], [{ pattern: 'CUST-\\d+' }]);
  assert.equal(out.events.includes('CUST-778899'), false);
  assert.equal(out.events.includes('abc123def456ghi789jkl'), false);
  assert.equal(out.events.includes('customer id'), true);
});
