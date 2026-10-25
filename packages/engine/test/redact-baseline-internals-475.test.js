// Internals of packages/engine/engine/redact-baseline.js (#475): a PEM block cut before its END line, GitLab
// tokens, and the environment dumps isEnvDump recognises in any segment of a command.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isEnvDump, redactBaseline, redactEnvDump, redactMcpConfig } = require('../engine/redact-baseline');

test('redactMcpConfig keeps a --mcp-config file path and the other arguments', () => {
  const args = ['-p', '--mcp-config', 'C:/ws/mcp.json', '--model', 'm'];
  assert.deepEqual(redactMcpConfig(args), ['-p', '--mcp-config', 'C:/ws/mcp.json', '--model', 'm']);
});

test('redactMcpConfig redacts a --mcp-config argument that starts like JSON but does not parse', () => {
  assert.deepEqual(redactMcpConfig(['--mcp-config', '{"mcpServers": {"x": {"env": {"API_TOKEN": "s3cr3t"']), ['--mcp-config', '[REDACTED]']);
});

test('redactMcpConfig redacts each env value, keeps the names and the rest of the server', () => {
  const cfg = JSON.stringify({ mcpServers: { db: { command: 'node', args: ['srv.js'], env: { API_TOKEN: 's3cr3t', MODE: 'dev' } } } });
  const [, out] = redactMcpConfig(['--mcp-config', cfg]);
  assert.deepEqual(JSON.parse(out), { mcpServers: { db: { command: 'node', args: ['srv.js'], env: { API_TOKEN: '[REDACTED]', MODE: '[REDACTED]' } } } });
});

test('a PEM block cut before its END line is redacted to the end', () => {
  const out = redactBaseline('before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAsecretbody');
  assert.equal(out.includes('secretbody'), false);
  assert.ok(out.startsWith('before\n'));
});

test('a GitLab token is redacted', () => {
  assert.equal(redactBaseline('glpat-AbCdEf123456_x').includes('AbCdEf'), false);
});

test('isEnvDump: environment dumps in any segment, other commands not', () => {
  for (const c of ['printenv', 'printenv HOME', 'env', 'cd x && env', 'set', 'export -p', 'Get-ChildItem Env:', 'gci env:', 'ls | printenv > out.txt']) {
    assert.equal(isEnvDump(c), true, c);
  }
  for (const c of ['git status', 'npm run env-check', 'set -e; npm test', 'environment']) {
    assert.equal(isEnvDump(c), false, c);
  }
});

test('redactEnvDump keeps the names only, and redacts bare values', () => {
  const out = redactEnvDump('HOME=/home/u\ndeclare -x API="v1"\nbarevalue');
  assert.equal(out, 'HOME=[REDACTED]\ndeclare -x API=[REDACTED]\n[REDACTED]');
});
