// #327 acceptance tests (written before the code): the agent chats carry the same [Language] line as
// a run's turns (src/shared/language.js languageLine), from the workspace settings, built like the
// [Time] line (#273): the Oracle (src/domains/oracle/oracle.js, its turn context from settings()), the Product Owner
// (src/product-owner.js ask, option `language`), the Supervisor chat (src/supervisor-chat.js
// questionText, 5th argument `language`) and the engine-side supervisor prompts (src/supervisor.js,
// field `language`), which no longer pin English when the agents write Português.
// A run's chat shows the run's own agent turns: those are covered by test/language-engine-327.test.js.
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./service/helpers');
const productOwner = require('../src/product-owner');
const supervisor = require('../src/supervisor');
const { questionText } = require('../src/supervisor-chat');

const load = () => require('../src/shared/language');
const PT = { agents: 'pt-BR', issues: 'en' };
const count = (text, part) => text.split(part).length - 1;

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-chats-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- the Oracle ----------------------------------------------------------------------------------

test('#327 Oracle turn context: the [Language] line of the workspace settings, once', async (t) => {
  const { service, api } = makeService(t);
  api['settings:set']({ language: PT });
  await api['oracle:ask']({ question: 'What is going on?', mock: true });
  // the first turn of a session: the whole prompt sent is kept in session.md
  const prompt = fs.readFileSync(path.join(service.workspace().oracle, 'session.md'), 'utf8');
  assert.equal(count(prompt, load().languageLine({ language: PT })), 1);
});

test('#327 Oracle turn context with the setting unset: the [Language] line names English', async (t) => {
  const { service, api } = makeService(t);
  await api['oracle:ask']({ question: 'What is going on?', mock: true });
  const prompt = fs.readFileSync(path.join(service.workspace().oracle, 'session.md'), 'utf8');
  assert.equal(count(prompt, load().languageLine({})), 1);
});

// ---- the Product Owner (runTurn stubbed: no real CLI is started) ---------------------------------

function stubTurns(t) {
  const providers = require('../src/engine/providers');
  const original = providers.runTurn;
  t.after(() => { providers.runTurn = original; });
  const prompts = [];
  providers.runTurn = async ({ prompt }) => { prompts.push(prompt); return { text: '```json\n{"summary":"ok","groups":[],"conflicts":[],"enrich":[]}\n```', costUsd: 0, usage: {} }; };
  return prompts;
}

const PO_COMMON = {
  projectId: 'demo', question: 'Analyze the backlog', data: { projectId: 'demo', issues: [{ number: 1, state: 'open', title: 'A', labels: [], body: 'x' }] },
  workflows: [{ file: 'software-development.yaml', name: 'x' }], folder: path.join(__dirname, '..'), skillsDirs: [path.join(__dirname, '..', 'skills')],
  resolveCommand: () => 'claude', agent: { model: 'claude-opus-5-5', effort: 'high' }, mock: false,
};

test('#327 the Product Owner\'s turn carries the [Language] line of the given language, once', async (t) => {
  const prompts = stubTurns(t);
  await productOwner.ask({ ...PO_COMMON, backlogDir: tmp(t), language: PT });
  assert.equal(count(prompts[0], load().languageLine({ language: PT })), 1);
  assert.equal(count(prompts[0], '[Language]'), 1);
});

test('#327 the Product Owner\'s turn without a language names English', async (t) => {
  const prompts = stubTurns(t);
  await productOwner.ask({ ...PO_COMMON, backlogDir: tmp(t) });
  assert.equal(count(prompts[0], load().languageLine({})), 1);
});

// ---- #424 "Same as the interface" with the interface unset: the computer's language ------------
// The computer's language comes in as host.locale, applied by src/service/areas/interface-language.js;
// each test puts an English host back afterwards.
const onComputer = (locale) => require('../src/service/areas/interface-language')({ events: { on() {} }, host: { locale } }).applyInterfaceLanguage({});
function computerIn(t, locale) {
  onComputer(locale);
  t.after(() => { onComputer('en-US'); require('../src/shared/i18n').setLanguage('en'); });
}
const PT_LINE = () => load().languageLine({ language: { agents: 'pt-BR', issues: 'en' } });

test('#424 the Product Owner\'s turn, interface unset and the computer in pt-BR: the Portuguese [Language] line', async (t) => {
  computerIn(t, 'pt-BR');
  const prompts = stubTurns(t);
  await productOwner.ask({ ...PO_COMMON, backlogDir: tmp(t), language: { agents: 'interface', issues: 'en' } });
  assert.equal(count(prompts[0], PT_LINE()), 1);
  assert.equal(count(prompts[0], '[Language]'), 1);
});

test('#424 the Product Owner\'s turn without a language, the computer in pt-BR: the Portuguese [Language] line', async (t) => {
  computerIn(t, 'pt-BR');
  const prompts = stubTurns(t);
  await productOwner.ask({ ...PO_COMMON, backlogDir: tmp(t) });
  assert.equal(count(prompts[0], PT_LINE()), 1);
});

test('#424 the Oracle on a service whose host\'s locale is pt-BR, nothing set: the Portuguese [Language] line', async (t) => {
  t.after(() => { onComputer('en-US'); require('../src/shared/i18n').setLanguage('en'); });
  const { service, api } = makeService(t, { locale: 'pt-BR' });
  await api['oracle:ask']({ question: 'What is going on?', mock: true });
  const prompt = fs.readFileSync(path.join(service.workspace().oracle, 'session.md'), 'utf8');
  assert.equal(count(prompt, PT_LINE()), 1);
});

// ---- the Supervisor chat --------------------------------------------------------------------------

test('#327 Supervisor chat: a question carries the [Language] line when the language is given', () => {
  const text = questionText('Why?', 'Runs', null, null, PT);
  assert.equal(count(text, load().languageLine({ language: PT })), 1);
  assert.ok(text.endsWith('[Screen] Runs\n\nWhy?'), text);
});

// ---- the engine-side supervisor prompts ---------------------------------------------------------

function supervisorPrompts(extra = {}) {
  const wf = { metadata: { name: 'wf' } };
  return {
    decision: supervisor.decisionPrompt({ wf, step: { id: 's1' }, error: 'boom', answer: null, allowed: ['s1'], events: [], ...extra }),
    actionError: supervisor.actionErrorPrompt({ wf, step: { id: 's1' }, error: 'boom', check: null, recover: ['s1'], gate: 'g1', events: [], ...extra }),
    idle: supervisor.idlePrompt({ wf, step: { id: 's1' }, agent: 'a', idle: { idle_ms: 6e5, tool: 'bash', command: 'npm test' }, events: [], ...extra }),
    onCall: supervisor.onCallPrompt({ wf, step: { id: 's1' }, signals: [{ kind: 'same_output', detail: 'x' }], retryStep: 's1', steps: ['s1'], events: [], ...extra }),
  };
}

test('#327 the supervisor\'s prompts with agents in pt-BR carry the [Language] line and no longer pin English', () => {
  const line = load().languageLine({ language: PT });
  for (const [name, prompt] of Object.entries(supervisorPrompts({ language: PT }))) {
    assert.equal(count(prompt, line), 1, `${name}: the line once`);
    assert.doesNotMatch(prompt, /in English \(the app's language\)/, name);
  }
});

test('#327 the supervisor\'s prompts without a language still write in English', () => {
  for (const [name, prompt] of Object.entries(supervisorPrompts())) assert.match(prompt, /in English/, name);
});
