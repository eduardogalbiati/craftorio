// #319 edges of the first-run Setup beyond the acceptance tests: Claude Code's sign-in from the
// environment and its account, workflow requirements for disabled agents, the supervisor and the
// git_platform input, the Setup model's labels, and the order of settings writes on a new workspace
// (a write before the Setup opens must not mark it done once the Setup has saved setupDone: false).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { claudeAccount, claudeSignedIn } = require('../domains/cli/claude-auth');
const { workflowRequirements } = require('../domains/workflow/workflow-requirements');
const { missingLabel, workflowId } = require('@multiagent/shared/setup-model');
const { layout, readSettings, writeSettings } = require('../domains/workspace/workspace');

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-319-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const noKeychain = () => { throw new Error('the Keychain is only read on macOS'); };

// ---------------------------------------------------------------------------
// Claude Code: sign-in from the environment, account from its config file
// ---------------------------------------------------------------------------
test('claudeSignedIn: an ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN counts as signed in without a credentials file', (t) => {
  const home = tmp(t);
  assert.equal(claudeSignedIn({ env: { ANTHROPIC_API_KEY: 'sk-x' }, home, platform: 'linux', readKeychain: noKeychain }), true);
  assert.equal(claudeSignedIn({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'tok' }, home, platform: 'win32', readKeychain: noKeychain }), true);
  assert.equal(claudeSignedIn({ env: { ANTHROPIC_API_KEY: '' }, home, platform: 'linux', readKeychain: noKeychain }), false);
});

test('claudeSignedIn: on macOS without the file and with no Keychain reader it is not signed in', (t) => {
  assert.equal(claudeSignedIn({ env: {}, home: tmp(t), platform: 'darwin', readKeychain: null }), false);
});

test('claudeAccount: the e-mail of oauthAccount in ~/.claude.json, or in CLAUDE_CONFIG_DIR/.claude.json', (t) => {
  const home = tmp(t);
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'ana@example.com' } }));
  assert.equal(claudeAccount({ env: {}, home }), 'ana@example.com');
  const cfg = path.join(home, 'cfg');
  fs.mkdirSync(cfg);
  fs.writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'bo@example.com' } }));
  assert.equal(claudeAccount({ env: { CLAUDE_CONFIG_DIR: cfg }, home }), 'bo@example.com');
});

test('claudeAccount: no file, invalid JSON or no oauthAccount gives null', (t) => {
  const home = tmp(t);
  assert.equal(claudeAccount({ env: {}, home }), null);
  fs.writeFileSync(path.join(home, '.claude.json'), '{not json');
  assert.equal(claudeAccount({ env: {}, home }), null);
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ numStartups: 3 }));
  assert.equal(claudeAccount({ env: {}, home }), null);
});

// ---------------------------------------------------------------------------
// Workflow requirements: inline workflows
// ---------------------------------------------------------------------------
const providers = { claude: { type: 'claude-code', command: 'claude' }, codex: { type: 'codex', command: 'codex' }, grok: { type: 'grok', command: 'grok' } };

test('workflowRequirements: an agent disabled by an input default does not count, and counts once the input enables it', () => {
  const wf = {
    providers,
    inputs: { use_grok: { type: 'boolean', default: false } },
    agents: { dev: { provider: 'claude' }, judge: { provider: 'grok', enabled: '{{ inputs.use_grok }}' } },
  };
  assert.deepEqual(workflowRequirements(wf).clis, ['claude', 'git']);
  assert.deepEqual(workflowRequirements(wf, { use_grok: true }).clis, ['claude', 'git', 'grok']);
});

test('workflowRequirements: the supervisor\'s provider counts', () => {
  const wf = { providers, agents: { dev: { provider: 'claude' } }, orchestrator: { supervisor: { provider: 'codex' } } };
  assert.deepEqual(workflowRequirements(wf).clis, ['claude', 'codex', 'git']);
});

test('workflowRequirements: a git_platform input means it needs gh or glab; none means no forge', () => {
  const agents = { dev: { provider: 'claude' } };
  assert.equal(workflowRequirements({ providers, agents, inputs: { git_platform: { default: 'github' } } }).forge, true);
  assert.equal(workflowRequirements({ providers, agents, inputs: { task: { required: true } } }).forge, false);
});

test('workflowRequirements: an empty workflow still needs git', () => {
  assert.deepEqual(workflowRequirements({}), { clis: ['git'], forge: false });
});

// ---------------------------------------------------------------------------
// Setup model labels
// ---------------------------------------------------------------------------
test('missingLabel: nothing missing is empty; CLIs are named, forge reads as GitHub or GitLab CLI', () => {
  assert.equal(missingLabel([]), '');
  assert.equal(missingLabel(undefined), '');
  assert.equal(missingLabel(['codex']), 'Missing Codex CLI');
  assert.equal(missingLabel(['forge']), 'Missing GitHub or GitLab CLI');
  assert.equal(missingLabel(['codex', 'grok']), 'Missing Codex CLI, Grok Build');
});

test('workflowId: the id hiddenWorkflows keeps is the file name without .yaml', () => {
  assert.equal(workflowId('ai-arena.yaml'), 'ai-arena');
  assert.equal(workflowId('Writer.YML'), 'Writer');
  assert.equal(workflowId(undefined), '');
});

// ---------------------------------------------------------------------------
// Settings: the order of writes on a new workspace
// ---------------------------------------------------------------------------
const freshWs = (t) => {
  const ws = layout(tmp(t));
  fs.mkdirSync(path.dirname(ws.settings), { recursive: true });
  return ws;
};

test('settings: once the Setup saved setupDone false, a later developerMode write keeps it false', (t) => {
  const ws = freshWs(t);
  writeSettings(ws, { setupDone: false });
  const after = writeSettings(ws, { developerMode: true });
  assert.equal(after.setupDone, false);
  assert.equal(readSettings(ws).setupDone, false);
  assert.equal(readSettings(ws).developerMode, true);
});

test('settings: a first write without setupDone (a scripted workspace) reads as set up', (t) => {
  const ws = freshWs(t);
  assert.equal(readSettings(ws).setupDone, false);
  assert.equal(writeSettings(ws, { developerMode: true }).setupDone, true);
  assert.equal(readSettings(ws).setupDone, true);
});

test('settings: an unreadable settings.json counts as an existing workspace (set up)', (t) => {
  const ws = freshWs(t);
  fs.writeFileSync(ws.settings, '{broken');
  assert.equal(readSettings(ws).setupDone, true);
  assert.deepEqual(readSettings(ws).hiddenWorkflows, []);
});

test('settings: the default hiddenWorkflows is a fresh list each read (changing one does not leak)', (t) => {
  const a = freshWs(t);
  const list = readSettings(a).hiddenWorkflows;
  list.push('ai-arena');
  assert.deepEqual(readSettings(a).hiddenWorkflows, []);
  assert.deepEqual(readSettings(freshWs(t)).hiddenWorkflows, []);
});

test('settings: Show in Start removes a workflow from hiddenWorkflows and keeps the others', (t) => {
  const ws = freshWs(t);
  writeSettings(ws, { setupDone: true, hiddenWorkflows: ['ai-arena', 'multi-model-review'] });
  writeSettings(ws, { hiddenWorkflows: readSettings(ws).hiddenWorkflows.filter((id) => id !== 'ai-arena') });
  assert.deepEqual(readSettings(ws).hiddenWorkflows, ['multi-model-review']);
  assert.equal(readSettings(ws).setupDone, true);
});
