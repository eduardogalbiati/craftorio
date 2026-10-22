// #312 (acceptance tests, written before the code): the service side of several accounts per
// provider. Settings keep `providers: { <provider>: { accounts: [{ name, dir, enabled }] } }` next to
// `fallbacks`, and `accountCooldownMinutes` (workspace DEFAULT_SETTINGS, so writeSettings keeps it);
// every run gets them (WorkflowRun options `accounts` / `accountCooldownMs`, src/service/areas/runs.js).
// Seam: run:start through the service (settingsFallbacks is not exported), observed in the run's
// events.jsonl: the session snapshot's `account` and the `agent.account_switch` event.
// Engine behaviour and the mock's "<provider>@<account>" limits: test/provider-accounts-312.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const workspace = require('../../src/workspace');
const { makeService } = require('./helpers');

const FIXTURE = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-accounts-service-312 }
providers:
  claude:
    type: claude-code
    command: claude
    args: ["-p", "--output-format", "stream-json", "--verbose", "--model", "{{ model }}"]
agents:
  a: { provider: claude, model: claude-opus-5-5, session: ephemeral, timeout: 10m }
steps:
  - id: work
    agent: a
    prompt: "do the work"
`;

function startAndFinish(service, api, payload) {
  const events = [];
  let runId = null;
  const finished = new Promise((resolve) => {
    service.events.on('run:event', (ev) => {
      events.push(ev);
      if (ev.type === 'workflow.finished' && (!runId || ev.run_id === runId)) resolve(ev);
    });
  });
  return api['run:start'](payload).then(async (r) => {
    runId = r.runId;
    const end = await finished;
    return { ...r, end };
  });
}

const eventsFile = (runDir) => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function accountDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('#312 Settings keep providers.<name>.accounts and accountCooldownMinutes', (t) => {
  const { service } = makeService(t);
  const ws = service.workspace();
  const accounts = [{ name: 'Claude A', dir: 'C:/accounts/a', enabled: true }, { name: 'Claude B', dir: 'C:/accounts/b', enabled: false }];
  workspace.writeSettings(ws, { providers: { claude: { accounts } }, accountCooldownMinutes: 45 });
  const saved = workspace.readSettings(ws);
  assert.deepEqual(saved.providers, { claude: { accounts } });
  assert.equal(saved.accountCooldownMinutes, 45);
});

test('#312 Settings\' accounts reach a run: Claude A at its limit, the turn moves to Claude B', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-accounts-service-312.yaml'), FIXTURE);
  workspace.writeSettings(ws, {
    providers: { claude: { accounts: [{ name: 'Claude A', dir: accountDir(t, 'svc-acc-a-312-') }, { name: 'Claude B', dir: accountDir(t, 'svc-acc-b-312-') }] } },
    accountCooldownMinutes: 30,
  });
  const { runDir, end } = await startAndFinish(service, api, {
    file: 'fixture-accounts-service-312.yaml', inputs: {}, mock: true, mockSequences: { usage_limits: ['claude@Claude A'] },
  });
  assert.equal(end.status, 'success', end.error);
  const recorded = eventsFile(runDir);
  assert.deepEqual(recorded.filter((e) => e.type === 'agent.account_switch').map((e) => `${e.from}>${e.to}`), ['Claude A>Claude B']);
  const answered = recorded.filter((e) => e.type === 'session.message_received' && e.step_id === 'work').map((e) => e.session?.account ?? null);
  assert.deepEqual(answered, ['Claude B']);
});
