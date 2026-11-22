// #312 (acceptance tests, written before the code): several accounts per provider. Each agent turn
// runs on one account of its provider (a config folder: CLAUDE_CONFIG_DIR, CODEX_HOME); a turn that
// hits the account's usage limit is repeated at once on the next enabled account of the SAME
// provider, in a fresh session. Only after the provider's last account does a #262 fallback chain
// apply; with no chain the step waits for credits instead of failing or switching provider.
//
// Interface assumed (the issue leaves the names open):
// - WorkflowRun options `accounts: { <provider>: [{ name, dir, enabled }] }` (Settings'
//   providers.<provider>.accounts, passed by the service like `fallbacks`: see
//   test/service/provider-accounts-312.test.js) and `accountCooldownMs` (Settings'
//   accountCooldownMinutes: how long an account stays out when its limit message names no reset time).
// - packages/engine/domains/cli/provider-accounts.js `accountLoginCommand(provider, dir)`: the command that logs the folder
//   in (names the CLI, its config-folder variable and the folder; null for a CLI without one), and
//   `accountStatus({ provider, dir })` (may be async): `{ signedIn }` from that folder only, never
//   the credentials themselves.
// - The adapters' configDirEnv / accountEnv and the reset times: test/provider-quota-reset-312.test.js.
// - The session snapshot (`session` of session.* events, summary.json `sessions`) has `account`:
//   the account's name, null (or absent) when the provider has no accounts configured.
// - Mock: `mockSequences.usage_limits` also takes "<provider>@<account name>": every turn on that
//   account fails with the CLI's usageLimitMessage ("<provider>" still means every account).
// - Event `agent.account_switch` { agent, step_id, provider, from, to, reason, until } (from/to:
//   account names; until: ISO time or null), declared in packages/shared/types.js RUN_EVENT_TYPES.
// - Event `run.waiting_credits` { agent, step_id, provider, until } when no account of the provider
//   is left and the agent has no chain: the run waits (it does not finish); stop() cancels it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const PROVIDERS = `providers:
  claude:
    type: claude-code
    command: claude
    args: ["-p", "--output-format", "stream-json", "--verbose", "--model", "{{ model }}"]
    resume_args: ["--resume", "{{ session_id }}"]
  codex:
    type: codex-cli
    command: codex
    args: ["exec", "--json", "--skip-git-repo-check", "-m", "{{ model }}"]
    resume_args: ["resume", "{{ session_id }}"]
    stdin_arg: "-"
`;

const ONE_STEP = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-accounts-312 }
${PROVIDERS}
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: ephemeral }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
`;

const GATED = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-accounts-gate-312 }
${PROVIDERS}
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: persistent }
steps:
  - id: draft
    agent: writer
    prompt: "Write a draft."
  - id: approve
    type: human_approval
    message: "Accept the draft?"
  - id: revise
    agent: writer
    prompt: "Revise the draft."
`;

const CHAIN = `apiVersion: craftorio/v1
kind: Workflow
metadata: { name: fixture-accounts-chain-312 }
${PROVIDERS}
agents:
  writer: { provider: claude, model: claude-opus-5-5, session: ephemeral, fallbacks: ["codex:gpt-6-luna"] }
steps:
  - id: write
    agent: writer
    prompt: "Write the document."
`;

const ON_CODEX = ONE_STEP.replace('provider: claude, model: claude-opus-5-5', 'provider: codex, model: gpt-6-luna').replace('fixture-accounts-312', 'fixture-accounts-codex-312');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// two Claude accounts in their own config folders
function claudeAccounts(t, extra = {}) {
  const root = tmpDir(t, 'accounts-312-');
  const a = path.join(root, 'claude-a');
  const b = path.join(root, 'claude-b');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  return { root, a, b, accounts: { claude: [{ name: 'Claude A', dir: a, enabled: true }, { name: 'Claude B', dir: b, enabled: true }] }, ...extra };
}

function newRun(t, yamlText, options = {}) {
  const { WorkflowRun } = require('../../engine/workflow');
  const dir = tmpDir(t, 'accounts-312-run-');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, yamlText);
  const runsDir = path.join(dir, 'runs');
  const run = new WorkflowRun({ file, inputs: {}, mock: true, runsDir, skillsDirs: [], ...options });
  // the run folder as the service records it (events.jsonl, sessions/, summary.json)
  const { Recorder } = require('../../engine/recorder');
  const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
  const events = [];
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, true));
  });
  return { run, events, runsDir };
}

async function runFixture(t, yamlText, options = {}) {
  const r = newRun(t, yamlText, options);
  await r.run.start();
  return { ...r, finished: r.events.find((e) => e.type === 'workflow.finished') || {} };
}

// A run expected to wait for credits: stopped as soon as it waits, or after 15 s whatever happens
async function runUntilWaiting(t, yamlText, options = {}) {
  const r = newRun(t, yamlText, options);
  r.run.on('event', (ev) => { if (ev.type === 'run.waiting_credits') setImmediate(() => r.run.stop()); });
  const guard = setTimeout(() => r.run.stop(), 15000);
  try { await r.run.start(); } finally { clearTimeout(guard); }
  return { ...r, finished: r.events.find((e) => e.type === 'workflow.finished') || {} };
}

const switchesOf = (events) => events.filter((e) => e.type === 'agent.account_switch');
const fallbacksOf = (events) => events.filter((e) => e.type === 'agent.fallback');
const answered = (events, step) => events.filter((e) => e.type === 'session.message_received' && e.step_id === step);
const answeredAccounts = (events, step) => answered(events, step).map((e) => e.session?.account ?? null);

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesUnder(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

test('#312 the account switch and the wait for credits are declared run events', () => {
  const { RUN_EVENT_TYPES } = require('@craftorio/shared/types');
  assert.equal(RUN_EVENT_TYPES.includes('agent.account_switch'), true);
  assert.equal(RUN_EVENT_TYPES.includes('run.waiting_credits'), true);
});

test('#312 adding an account: the login command names the CLI, its variable and the folder', () => {
  const { accountLoginCommand } = require('../../domains/cli/provider-accounts');
  const dir = 'C:\\accounts\\claude-b';
  const claude = String(accountLoginCommand('claude', dir));
  for (const part of ['CLAUDE_CONFIG_DIR', dir, 'claude']) assert.equal(claude.includes(part), true, `${part} in ${claude}`);
  const codex = String(accountLoginCommand('codex', 'C:\\accounts\\codex-2'));
  for (const part of ['CODEX_HOME', 'C:\\accounts\\codex-2', 'codex login']) assert.equal(codex.includes(part), true, `${part} in ${codex}`);
  assert.equal(accountLoginCommand('grok', 'C:\\accounts\\grok-2'), null);
});

test('#312 adding an account: the folder\'s sign-in is checked from that folder only, without the credentials', async (t) => {
  const { accountStatus } = require('../../domains/cli/provider-accounts');
  const saved = process.env.ANTHROPIC_API_KEY;
  t.after(() => { if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved; });
  process.env.ANTHROPIC_API_KEY = 'sk-ant-env-312'; // the app's own environment must not count for the account
  const empty = tmpDir(t, 'account-empty-312-');
  const out = await accountStatus({ provider: 'claude', dir: empty });
  assert.equal(out.signedIn, false);
  const logged = tmpDir(t, 'account-logged-312-');
  fs.writeFileSync(path.join(logged, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-fake-312-secret', refreshToken: 'r', expiresAt: 1 } }));
  const ok = await accountStatus({ provider: 'claude', dir: logged });
  assert.equal(ok.signedIn, true);
  assert.equal(JSON.stringify(ok).includes('sk-ant-fake-312-secret'), false, 'no credential in the answer');
});

test('#312 a turn runs on the first enabled account and the session records it', async (t) => {
  const acc = claudeAccounts(t);
  acc.accounts.claude.unshift({ name: 'Claude Off', dir: path.join(acc.root, 'off'), enabled: false });
  const { events, finished } = await runFixture(t, ONE_STEP, { accounts: acc.accounts });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(answeredAccounts(events, 'write'), ['Claude A']);
  assert.equal(switchesOf(events).length, 0);
});

test('#312 a provider without accounts behaves as today: no account on its sessions', async (t) => {
  const { events, finished } = await runFixture(t, ONE_STEP, { accounts: {} });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(answeredAccounts(events, 'write'), [null]);
});

test('#312 a usage limit on account A repeats the turn on account B in a new session and records the switch', async (t) => {
  const { isQuotaError } = require('../../engine/providers');
  const acc = claudeAccounts(t);
  const { run, events, finished } = await runFixture(t, ONE_STEP, { accounts: acc.accounts, mockSequences: { usage_limits: ['claude@Claude A'] } });
  assert.equal(finished.status, 'success', finished.error);
  const [sw, ...more] = switchesOf(events);
  assert.equal(more.length, 0, 'one switch');
  assert.equal(sw?.agent, 'writer');
  assert.equal(sw?.step_id, 'write');
  assert.equal(sw?.provider, 'claude');
  assert.equal(sw?.from, 'Claude A');
  assert.equal(sw?.to, 'Claude B');
  assert.equal(isQuotaError('claude-code', String(sw?.reason || '')), true, `the reason is Claude's message: ${sw?.reason}`);
  assert.equal(sw.until === null || !Number.isNaN(Date.parse(sw.until)), true, `until is an ISO time or null: ${sw.until}`);
  assert.equal(fallbacksOf(events).length, 0, 'no provider switch');
  assert.deepEqual(answeredAccounts(events, 'write'), ['Claude B']);
  // a simulated session records provider 'mock' and the workflow's provider in simulates (#353)
  assert.deepEqual(answered(events, 'write').map((e) => e.session?.simulates), ['claude']);
  const sent = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'write').map((e) => e.session_id);
  assert.equal(new Set(sent).size, 2, 'the turn on B runs in a new session');
  // the run's cost breakdown (summary.json sessions) names the account of each session
  const summary = JSON.parse(fs.readFileSync(path.join(run.runDir, 'summary.json'), 'utf8'));
  assert.deepEqual(summary.sessions.filter((s) => s.agent === 'writer').map((s) => s.account).sort(), ['Claude A', 'Claude B']);
});

test('#312 the agent stays on account B for its later turns, and the human gate is still asked', async (t) => {
  const acc = claudeAccounts(t);
  const { events, finished } = await runFixture(t, GATED, { accounts: acc.accounts, mockSequences: { usage_limits: ['claude@Claude A'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(switchesOf(events).length, 1);
  assert.equal(events.filter((e) => e.type === 'approval.requested' && e.step_id === 'approve').length, 1, 'the gate waited for its answer');
  assert.deepEqual(events.filter((e) => e.type === 'step.started').map((e) => e.step_id), ['draft', 'approve', 'revise']);
  assert.deepEqual(answeredAccounts(events, 'revise'), ['Claude B']);
  assert.equal(events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'revise').length, 1, 'no attempt on the exhausted account first');
});

test('#312 with a fallback chain, the chain is taken only after the provider\'s last account', async (t) => {
  const acc = claudeAccounts(t);
  const { events, finished } = await runFixture(t, CHAIN, { accounts: acc.accounts, mockSequences: { usage_limits: ['claude@Claude A', 'claude@Claude B'] } });
  assert.equal(finished.status, 'success', finished.error);
  const order = events.filter((e) => e.type === 'agent.account_switch' || e.type === 'agent.fallback')
    .map((e) => (e.type === 'agent.fallback' ? `fallback ${e.from}>${e.to}` : `account ${e.from}>${e.to}`));
  assert.deepEqual(order, ['account Claude A>Claude B', 'fallback claude:claude-opus-5-5>codex:gpt-6-luna']);
  assert.deepEqual(answered(events, 'write').map((e) => e.session?.model), ['gpt-6-luna']);
});

test('#312 one exhausted account and no chain: the step waits for credits instead of failing or switching provider', async (t) => {
  const root = tmpDir(t, 'accounts-312-one-');
  const { events, finished } = await runUntilWaiting(t, ONE_STEP, {
    accounts: { claude: [{ name: 'Claude A', dir: root, enabled: true }] },
    mockSequences: { usage_limits: ['claude'] },
  });
  const waits = events.filter((e) => e.type === 'run.waiting_credits');
  assert.equal(waits.length >= 1, true, `the run waits for credits (finished: ${finished.status} ${finished.error || ''})`);
  assert.equal(waits[0].agent, 'writer');
  assert.equal(waits[0].step_id, 'write');
  assert.equal(waits[0].provider, 'claude');
  assert.equal(fallbacksOf(events).length, 0, 'no provider switch');
  assert.equal(events.findIndex((e) => e.type === 'workflow.finished') > events.indexOf(waits[0]), true, 'the run did not end before waiting');
  assert.equal(finished.status, 'cancelled', 'stopped by the owner, not failed');
});

test('#312 both accounts exhausted and no chain: switched once, then waits for credits', async (t) => {
  const acc = claudeAccounts(t);
  const { events, finished } = await runUntilWaiting(t, ONE_STEP, { accounts: acc.accounts, mockSequences: { usage_limits: ['claude@Claude A', 'claude@Claude B'] } });
  assert.deepEqual(switchesOf(events).map((e) => `${e.from}>${e.to}`), ['Claude A>Claude B']);
  assert.equal(events.some((e) => e.type === 'run.waiting_credits' && e.provider === 'claude'), true, `waits (finished: ${finished.status} ${finished.error || ''})`);
  assert.equal(fallbacksOf(events).length, 0);
  assert.equal(finished.status, 'cancelled');
});

test('#312 a limit message without a reset time keeps the account out for Settings\' cooldown', async (t) => {
  const root = tmpDir(t, 'accounts-312-codex-');
  const before = Date.now();
  const { events } = await runUntilWaiting(t, ON_CODEX, {
    accounts: { codex: [{ name: 'Codex 1', dir: root, enabled: true }] },
    accountCooldownMs: 3600000,
    mockSequences: { usage_limits: ['codex'] },
  });
  const wait = events.find((e) => e.type === 'run.waiting_credits');
  assert.equal(typeof wait?.until, 'string', 'the waiting state gives the time the account is back');
  const until = Date.parse(wait.until);
  assert.equal(Math.abs(until - (before + 3600000)) < 5 * 60000, true, `until ≈ now + 1 h: ${wait.until}`);
});

test('#312 the account folder goes to the CLI process only: never into the agent\'s prompt', async (t) => {
  const acc = claudeAccounts(t);
  const { events, finished } = await runFixture(t, ONE_STEP, { accounts: acc.accounts });
  assert.equal(finished.status, 'success', finished.error);
  assert.deepEqual(answeredAccounts(events, 'write'), ['Claude A'], 'the turn ran on the account');
  const prompts = events.filter((e) => e.type === 'session.message_sent').map((e) => String(e.prompt || ''));
  assert.equal(prompts.length > 0, true);
  assert.equal(prompts.some((p) => p.includes(acc.a) || p.includes(acc.a.replace(/\\/g, '/'))), false);
});

test('#312 no credential of an account reaches the run folder', async (t) => {
  const acc = claudeAccounts(t);
  fs.writeFileSync(path.join(acc.a, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-fake-312-secret' } }));
  const { run, events, finished } = await runFixture(t, ONE_STEP, { accounts: acc.accounts, mockSequences: { usage_limits: ['claude@Claude A'] } });
  assert.equal(finished.status, 'success', finished.error);
  assert.equal(switchesOf(events).length, 1, 'the run switched account');
  const leaks = filesUnder(run.runDir).filter((f) => fs.readFileSync(f, 'utf8').includes('sk-ant-fake-312-secret'));
  assert.deepEqual(leaks, []);
  assert.equal(JSON.stringify(events).includes('sk-ant-fake-312-secret'), false);
});

// ---- resumed runs: a conversation continues only on the account that opened it ----------------
test('#312 resumeSpec records the account of each agent\'s last conversation (null without accounts)', (t) => {
  const supervisor = require('../../domains/supervisor/supervisor');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-312-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ev = (o) => JSON.stringify({ ts: '2026-10-22T10:00:00Z', ...o });
  const got = (agent, cli, account) => ev({ type: 'session.message_received', step_id: 'check', session: { agent, provider: 'claude', provider_session_id: cli, ...(account ? { account } : {}) } });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    ev({ type: 'workflow.started', workflow: 'wf', file: 'wf.yaml', inputs: { task: 'x' } }),
    ev({ type: 'step.started', step_id: 'check', visit: 1 }),
    got('a', 'ps-a1', 'Claude A'),
    got('a', 'ps-a2', 'Claude B'),
    got('b', 'ps-b', null),
    ev({ type: 'step.finished', step_id: 'check', visit: 1, output: { verdict: 'pass' } }),
    ev({ type: 'workflow.finished', status: 'failed', error: 'boom' }),
  ].join('\n') + '\n');
  const spec = supervisor.resumeSpec(dir, 'check');
  assert.deepEqual(spec.sessions, { a: 'ps-a2', b: 'ps-b' });
  assert.deepEqual(spec.sessionAccounts, { a: 'Claude B', b: null });
});

test('#312 a resumed run continues a conversation only when the agent is on the account that opened it', () => {
  const { methods } = require('../../engine/run/resume');
  const resumeOn = (account, sessionAccount) => {
    const run = { machine: { simulated: false }, resume: { sessions: { writer: 'ps-1' }, sessionAccounts: { writer: sessionAccount }, cliTotals: {} } };
    const session = { account, providerSessionId: null, turns: 0 };
    methods.resumeSession.call(run, 'writer', session, true);
    return session.providerSessionId;
  };
  assert.equal(resumeOn('Claude A', 'Claude A'), 'ps-1');
  assert.equal(resumeOn('Claude B', 'Claude A'), null, 'never on another account');
  assert.equal(resumeOn(null, 'Claude A'), null, 'never once the provider has no account');
  assert.equal(resumeOn(undefined, null), 'ps-1', 'without accounts, as before #312');
});
