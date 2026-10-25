// Sessions screen: reading the CLIs' own session files, and the command lines to reopen or start one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listCliSessions, findCliSession, cliArgs, providerModels } = require('../../src/domains/cli/cli-sessions');

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

function fakeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const put = (rel, text) => {
    const file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  return { home, put };
}

test('Claude sessions: title from the latest custom title, else the first typed prompt; headless from the entrypoint', (t) => {
  const { home, put } = fakeHome(t);
  put('.claude/projects/C--app/aaa.jsonl', jsonl([
    { type: 'user', sessionId: 'aaa', cwd: 'C:\\app', entrypoint: 'cli', timestamp: '2026-09-01T10:00:00Z', isMeta: true, message: { role: 'user', content: '<command-name>/init</command-name>' } },
    { type: 'user', sessionId: 'aaa', cwd: 'C:\\app', timestamp: '2026-09-01T10:00:01Z', message: { role: 'user', content: 'Add a sessions menu' } },
    { type: 'assistant', sessionId: 'aaa', message: { model: 'claude-opus-5-5', content: [] } },
    { type: 'ai-title', aiTitle: 'Generated title', sessionId: 'aaa' },
    { type: 'custom-title', customTitle: 'Sessions menu', sessionId: 'aaa' },
  ]));
  put('.claude/projects/C--app/bbb.jsonl', jsonl([
    { type: 'user', sessionId: 'bbb', cwd: 'C:\\run', entrypoint: 'sdk-cli', timestamp: '2026-09-02T10:00:00Z', message: { role: 'user', content: '<system>\nYou are the writer.\n</system>\n\nUser request: a PRD' } },
  ]));
  // subagent transcripts in <id>/ folders are not sessions
  put('.claude/projects/C--app/aaa/subagents/x.jsonl', jsonl([{ type: 'user', sessionId: 'x', message: { content: 'sub' } }]));
  const list = listCliSessions({ home });
  assert.equal(list.length, 2);
  const a = list.find((s) => s.id === 'aaa');
  assert.equal(a.title, 'Sessions menu');
  assert.equal(a.cwd, 'C:\\app');
  assert.equal(a.model, 'claude-opus-5-5');
  assert.equal(a.headless, false);
  const b = list.find((s) => s.id === 'bbb');
  assert.equal(b.title, 'User request: a PRD');
  assert.equal(b.headless, true);
});

test('Codex and Grok sessions, newest first', (t) => {
  const { home, put } = fakeHome(t);
  const codexFile = put('.codex/sessions/2026/09/27/rollout-2026-09-27T10-00-00-ccc.jsonl', jsonl([
    { timestamp: '2026-09-27T10:00:00Z', type: 'session_meta', payload: { id: 'ccc', cwd: 'C:\\app', source: 'cli', originator: 'codex_cli_rs', timestamp: '2026-09-27T10:00:00Z' } },
    { type: 'turn_context', payload: { model: 'gpt-6-luna' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n<cwd>C:\\app</cwd>\n</environment_context>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Review the diff' }] } },
  ]));
  // a Codex session is as recent as its file
  fs.utimesSync(codexFile, new Date('2026-09-27T12:00:00Z'), new Date('2026-09-27T12:00:00Z'));
  const grokDir = '.grok/sessions/C%3A%5Capp';
  put(`${grokDir}/ggg/summary.json`, JSON.stringify({
    info: { id: 'ggg', cwd: 'C:\\app' }, session_summary: '', created_at: '2026-09-28T10:00:00Z',
    last_active_at: '2026-09-28T11:00:00Z', current_model_id: 'grok-4.7', session_kind: 'headless',
  }));
  put(`${grokDir}/prompt_history.jsonl`, jsonl([{ session_id: 'ggg', prompt: 'Reply with pong' }]));
  // opened and closed without a message: not listed
  put(`${grokDir}/empty/summary.json`, JSON.stringify({ info: { id: 'empty', cwd: 'C:\\app' }, num_messages: 0, created_at: '2026-09-29T10:00:00Z' }));
  const list = listCliSessions({ home });
  assert.deepEqual(list.map((s) => `${s.provider}:${s.id}`), ['grok:ggg', 'codex:ccc']);
  const [g, c] = list;
  assert.equal(c.title, 'Review the diff');
  assert.equal(c.model, 'gpt-6-luna');
  assert.equal(c.headless, false);
  assert.equal(g.title, 'Reply with pong');
  assert.equal(g.cwd, 'C:\\app');
  assert.equal(g.headless, true);
  assert.equal(findCliSession('codex', 'ccc', { home }).id, 'ccc');
  assert.equal(findCliSession('claude', 'ccc', { home }), null);
});

test('missing folders and broken files never break the listing', (t) => {
  const { home, put } = fakeHome(t);
  assert.deepEqual(listCliSessions({ home }), []);
  put('.claude/projects/p/broken.jsonl', 'not json\n{"type":');
  put('.grok/sessions/g/s1/summary.json', '{ broken');
  assert.deepEqual(listCliSessions({ home }), []);
});

test('command lines to resume or start a session, with unsafe values refused', () => {
  assert.deepEqual(cliArgs('claude', { resume: 'aaa-1' }), ['--resume', 'aaa-1']);
  assert.deepEqual(cliArgs('codex', { resume: 'ccc' }), ['resume', '--no-daemon', 'ccc']);
  assert.deepEqual(cliArgs('grok', { resume: 'ggg' }), ['--resume', 'ggg']);
  assert.deepEqual(cliArgs('claude', { model: 'claude-opus-5-5', effort: 'high' }), ['--model', 'claude-opus-5-5', '--effort', 'high']);
  assert.deepEqual(cliArgs('codex', { model: 'gpt-6-luna', effort: 'low' }), ['--no-daemon', '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort=low']);
  assert.deepEqual(cliArgs('grok', {}), []);
  assert.throws(() => cliArgs('claude', { model: 'x" & calc' }), /Invalid model/);
  assert.throws(() => cliArgs('claude', { resume: 'a b' }), /Invalid session id/);
  assert.throws(() => cliArgs('other', {}), /Unknown provider/);
});

test('models come from the CLIs own caches (shown ones, in their order), else the built-in list', (t) => {
  const { home, put } = fakeHome(t);
  assert.deepEqual(providerModels('codex', { home }).map((m) => m.id), ['gpt-6-luna']); // no cache yet
  put('.codex/models_cache.json', JSON.stringify({ models: [
    { slug: 'gpt-5.5', visibility: 'list', priority: 13, supported_reasoning_levels: [{ effort: 'high' }, { effort: 'low' }] },
    { slug: 'gpt-reserve', visibility: 'hide', priority: 1 },
    { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list', priority: 8, default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'ultra' }, { effort: 'medium' }] },
  ] }));
  assert.deepEqual(providerModels('codex', { home }), [
    { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', efforts: ['medium', 'ultra'], defaultEffort: 'medium' },
    { id: 'gpt-5.5', name: 'gpt-5.5', efforts: ['low', 'high'], defaultEffort: null },
  ]);
  put('.grok/models_cache.json', JSON.stringify({ models: {
    'grok-4.7': { info: { id: 'grok-4.7', name: 'Grok 4.7', hidden: false, reasoning_effort: 'high', reasoning_efforts: [{ value: 'xhigh' }, { value: 'low' }] } },
    secret: { info: { id: 'secret', hidden: true } },
  } }));
  assert.deepEqual(providerModels('grok', { home }), [{ id: 'grok-4.7', name: 'Grok 4.7', efforts: ['low', 'xhigh'], defaultEffort: 'high' }]);
  assert.equal(providerModels('claude', { home })[0].id, 'claude-opus-5-5');
});
