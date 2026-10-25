const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./helpers');

test('analytics: computes a snapshot of the (empty) workspace and refuses a real supervisor call without mock', async (t) => {
  const { api } = makeService(t);
  const snapshot = await api['analytics:get']({ scope: 'orchestrator' });
  assert.equal(snapshot.scope, 'orchestrator');
  assert.equal(snapshot.totals.sessions, 0);
  await assert.rejects(api['analytics:analyze']({ scope: 'orchestrator', mock: false }), /Simulation only .*supervisor's CLI/);
});

// #408: the CLI home the service reads the transcripts from is the host's `cliHome` (tests pass a
// folder of their own), not the machine's ~/.claude, ~/.codex and ~/.grok.
// One Claude Code session, written now, with one message of 5 + 50 + 100 + 10 = 165 tokens.
function oneClaudeSessionHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-home-408-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, '.claude', 'projects', 'C--proj-408');
  fs.mkdirSync(dir, { recursive: true });
  const msg = {
    type: 'assistant', sessionId: 'session-408', requestId: 'req-408', timestamp: new Date().toISOString(),
    message: { id: 'msg-408', model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } },
  };
  fs.writeFileSync(path.join(dir, 'session-408.jsonl'), JSON.stringify(msg) + '\n');
  return home;
}

test('#408 usage:get machine scope counts only the transcripts of the host\'s CLI home', async (t) => {
  const { api } = makeService(t, { cliHome: oneClaudeSessionHome(t) });
  const snap = await api['usage:get']({ scope: 'machine' });
  assert.equal(snap.scope, 'machine');
  const claude = snap.providers.find((p) => p.id === 'claude');
  assert.equal(claude.month.tokens.total, 165);
  const codex = snap.providers.find((p) => p.id === 'codex');
  assert.equal(codex ? codex.month.tokens.total : 0, 0, 'no Codex transcript in that home');
});

test('#408 analytics:get machine scope counts only the sessions of the host\'s CLI home', async (t) => {
  const { api } = makeService(t, { cliHome: oneClaudeSessionHome(t) });
  const snap = await api['analytics:get']({ scope: 'machine' });
  assert.equal(snap.scope, 'machine');
  assert.equal(snap.totals.sessions, 1);
});
