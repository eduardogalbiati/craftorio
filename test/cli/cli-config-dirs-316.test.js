// The CLIs' config folders (#316): Claude Code keeps its sessions and config under
// CLAUDE_CONFIG_DIR and Codex under CODEX_HOME when they are set (on every OS), instead of
// ~/.claude and ~/.codex. The session list (src/domains/cli/cli-sessions.js), the usage reader
// (src/domains/local/local-usage.js) and folder trust (src/domains/cli/cli-trust.js) follow them when the caller passes no
// home folder (the app never does).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listCliSessions, providerModels } = require('../../src/domains/cli/cli-sessions');
const { readLocalUsage } = require('../../src/domains/local/local-usage');
const { trustFolder } = require('../../src/domains/cli/cli-trust');

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-config-316-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function withEnv(t, vars) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
}

function put(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// An empty home folder plus a Claude config folder and a Codex home elsewhere.
function setup(t) {
  const dir = tmp(t);
  const home = path.join(dir, 'home');
  const claudeDir = path.join(dir, 'claude-config');
  const codexHome = path.join(dir, 'codex-home');
  for (const d of [home, claudeDir, codexHome]) fs.mkdirSync(d, { recursive: true });
  withEnv(t, { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexHome });
  return { dir, home, claudeDir, codexHome };
}

function writeSessions({ claudeDir, codexHome }) {
  put(claudeDir, 'projects/C--app/cfg316claude.jsonl', jsonl([
    { type: 'user', sessionId: 'cfg316claude', cwd: 'C:\\app', timestamp: '2026-10-01T10:00:00Z', message: { role: 'user', content: 'Hello from the config dir' } },
    { type: 'assistant', sessionId: 'cfg316claude', requestId: 'req-1', timestamp: '2026-10-01T10:00:05Z', message: { id: 'msg-1', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 10, output_tokens: 20 } } },
  ]));
  put(codexHome, 'sessions/2026/10/01/rollout-2026-10-01T10-00-00-cfg316codex.jsonl', jsonl([
    { timestamp: '2026-10-01T10:00:00Z', type: 'session_meta', payload: { id: 'cfg316codex', cwd: 'C:\\app', source: 'cli', originator: 'codex_cli_rs', timestamp: '2026-10-01T10:00:00Z' } },
    { type: 'turn_context', payload: { model: 'gpt-6-luna' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello from CODEX_HOME' }] } },
  ]));
}

test('Sessions: with CLAUDE_CONFIG_DIR and CODEX_HOME set, the Claude and Codex sessions are read from those folders', (t) => {
  const s = setup(t);
  writeSessions(s);
  const ids = listCliSessions().map((x) => `${x.provider}:${x.id}`);
  assert.ok(ids.includes('claude:cfg316claude'), `Claude session under CLAUDE_CONFIG_DIR not listed: ${ids.join(', ')}`);
  assert.ok(ids.includes('codex:cfg316codex'), `Codex session under CODEX_HOME not listed: ${ids.join(', ')}`);
});

test('Sessions: without CLAUDE_CONFIG_DIR and CODEX_HOME, the sessions still come from ~/.claude and ~/.codex', (t) => {
  const s = setup(t);
  withEnv(t, { CLAUDE_CONFIG_DIR: undefined, CODEX_HOME: undefined });
  writeSessions({ claudeDir: path.join(s.home, '.claude'), codexHome: path.join(s.home, '.codex') });
  const ids = listCliSessions().map((x) => `${x.provider}:${x.id}`);
  assert.ok(ids.includes('claude:cfg316claude'), ids.join(', '));
  assert.ok(ids.includes('codex:cfg316codex'), ids.join(', '));
});

test('Sessions: the Codex models list is read from CODEX_HOME when it is set', (t) => {
  const { codexHome } = setup(t);
  put(codexHome, 'models_cache.json', JSON.stringify({ models: [{ slug: 'gpt-cfg-316', display_name: 'GPT cfg 316', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'high' }] }] }));
  assert.deepEqual(providerModels('codex').map((m) => m.id), ['gpt-cfg-316']);
});

test('Usage: with CLAUDE_CONFIG_DIR and CODEX_HOME set, the local usage is read from those folders', (t) => {
  const s = setup(t);
  writeSessions(s);
  const usage = readLocalUsage();
  assert.equal(usage.sources.claude, path.join(s.claudeDir, 'projects'));
  assert.equal(usage.sources.codex, path.join(s.codexHome, 'sessions'));
  assert.equal(usage.found.claude, true);
  assert.equal(usage.found.codex, true);
  assert.ok(usage.records.some((r) => r.provider === 'claude' && r.sessionId === 'cfg316claude'), 'no Claude record from CLAUDE_CONFIG_DIR');
});

test('Folder trust: Codex records the trusted folder in CODEX_HOME/config.toml when CODEX_HOME is set', (t) => {
  const { dir, codexHome, home } = setup(t);
  const folder = path.join(dir, 'project');
  fs.mkdirSync(folder);
  assert.equal(trustFolder('codex', folder), true);
  const toml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
  assert.ok(toml.includes(`[projects.'${path.resolve(folder)}']`), toml);
  assert.equal(fs.existsSync(path.join(home, '.codex', 'config.toml')), false);
});

test('Folder trust: Claude Code records the trusted folder in CLAUDE_CONFIG_DIR/.claude.json when CLAUDE_CONFIG_DIR is set', (t) => {
  const { dir, claudeDir, home } = setup(t);
  const folder = path.join(dir, 'project');
  fs.mkdirSync(folder);
  put(claudeDir, '.claude.json', JSON.stringify({ projects: {} }));
  assert.equal(trustFolder('claude', folder), true);
  const config = JSON.parse(fs.readFileSync(path.join(claudeDir, '.claude.json'), 'utf8'));
  assert.equal(config.projects[path.resolve(folder).replace(/\\/g, '/')].hasTrustDialogAccepted, true);
  assert.equal(fs.existsSync(path.join(home, '.claude.json')), false);
});
