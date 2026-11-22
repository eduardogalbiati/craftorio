// #327 / #328 acceptance tests (written before the code): Settings › General › Language through the
// service. settings:set { language: { agents, issues } } is kept in the workspace's settings.json
// (workspace DEFAULT_SETTINGS, so writeSettings keeps the key), and a run started by the service gets
// it as its `language` option: the agents' prompts carry the [Language] line of the saved setting.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');

const load = () => require('@craftorio/shared/language');

const FIXTURE = `apiVersion: multiagent/v1
kind: Workflow
metadata: { name: fixture-language-service-327 }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
`;

test('#327 settings:set { language } is saved to settings.json and read back by settings:get', (t) => {
  const { service, api } = makeService(t);
  api['settings:set']({ language: { agents: 'pt-BR', issues: 'es' } });
  assert.deepEqual(JSON.parse(fs.readFileSync(service.workspace().settings, 'utf8')).language, { agents: 'pt-BR', issues: 'es' });
  const got = api['settings:get']().language;
  assert.deepEqual({ agents: got.agents, issues: got.issues }, { agents: 'pt-BR', issues: 'es' });
});

test('#327 a new workspace resolves to English for both the agents and the issues', (t) => {
  const { agentsLanguage, issuesLanguage } = load();
  const { api } = makeService(t);
  const settings = api['settings:get']();
  assert.equal(agentsLanguage(settings), 'en');
  assert.equal(issuesLanguage(settings), 'en');
});

test('#327 a run started by the service carries the saved agents language in its step prompt', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-language-service-327.yaml'), FIXTURE);
  api['settings:set']({ language: { agents: 'pt-BR', issues: 'en' } });
  const finished = new Promise((resolve) => service.events.on('run:event', (ev) => { if (ev.type === 'workflow.finished') resolve(ev); }));
  const { runDir } = await api['run:start']({ file: 'fixture-language-service-327.yaml', inputs: {}, mock: true });
  const end = await finished;
  assert.equal(end.status, 'success', end.error);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const prompt = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'work')?.prompt || '';
  assert.ok(prompt.includes(load().languageLine({ language: { agents: 'pt-BR', issues: 'en' } })), prompt.slice(0, 500));
});
