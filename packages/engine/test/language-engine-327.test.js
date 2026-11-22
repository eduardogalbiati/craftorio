// #327 acceptance tests (written before the code): every agent turn of a run carries ONE [Language]
// line (packages/shared/language.js languageLine), added where a step's prompt is assembled
// (packages/engine/engine/run/sessions.js), the same for every CLI. The run reads the setting through its
// `language` option, a function returning the settings' language object ({ agents, issues }) called
// at each turn (like `nightLimits`): a change applies from the next turn. The output instruction
// (OUTPUT_LANGUAGE) and the schema retry (outputs.js retryPrompt) keep keys and enum values as the
// schema names them and ask for prose in the agents language. Unset: English, as today.
// Tiny inline workflows with the mock provider (about a second each); the simulated run gives every
// agent the mock provider, so the prompt sent is the one each CLI (claude, codex, grok) would get.
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');

const load = () => require('@craftorio/shared/language');
const PT = { agents: 'pt-BR', issues: 'en' };

// cld answers twice in one persistent session (a then d); cdx and grk once; b has an output schema
const WORKFLOW = [
  'apiVersion: multiagent/v1',
  'kind: Workflow',
  'metadata: { name: fixture-language-327 }',
  'providers:',
  '  claude: { type: claude-code, command: claude, args: ["-p"] }',
  '  codex: { type: codex-cli, command: codex, args: [exec] }',
  '  grok: { type: grok-cli, command: grok }',
  'agents:',
  '  cld: { provider: claude, model: m, session: persistent }',
  '  cdx: { provider: codex, model: m, session: ephemeral }',
  '  grk: { provider: grok, model: m, session: ephemeral }',
  'steps:',
  '  - { id: a, agent: cld, prompt: "first claude turn" }',
  '  - id: b',
  '    agent: cdx',
  '    prompt: "codex turn"',
  '    output_schema:',
  '      type: object',
  '      required: [verdict, summary]',
  '      properties:',
  '        verdict: { type: string, enum: [approved, changes_requested] }',
  '        summary: { type: string }',
  '  - { id: c, agent: grk, prompt: "grok turn" }',
  '  - { id: d, agent: cld, prompt: "second claude turn" }',
].join('\n');

async function run(t, opts = {}, onEvent = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-327-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, WORKFLOW);
  const r = new WorkflowRun({ file, inputs: {}, mock: true, runsDir: path.join(dir, 'runs'), ...opts });
  const events = [];
  r.on('event', (ev) => { events.push(ev); onEvent(ev); });
  await r.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const promptOf = (step) => events.filter((e) => e.type === 'session.message_sent' && e.step_id === step).map((e) => e.prompt);
  return { events, promptOf };
}

const count = (text, part) => text.split(part).length - 1;
const languageLines = (prompt) => prompt.split('\n').filter((l) => l.startsWith('[Language]'));

test('#327 every step\'s prompt, on claude, codex and grok, carries the agents language line exactly once', { timeout: 60000 }, async (t) => {
  const line = load().languageLine({ language: PT });
  const { promptOf } = await run(t, { language: () => PT });
  for (const step of ['a', 'b', 'c', 'd']) {
    const [prompt] = promptOf(step);
    assert.ok(prompt, `step ${step} sent a prompt`);
    assert.equal(count(prompt, line), 1, `step ${step}: the line once`);
    assert.equal(count(prompt, '[Language]'), 1, `step ${step}: no second [Language] line`);
  }
});

test('#327 the [Language] line is identical across two turns of the same session while the setting is unchanged', { timeout: 60000 }, async (t) => {
  const { promptOf } = await run(t, { language: () => PT });
  const first = languageLines(promptOf('a')[0]);
  const second = languageLines(promptOf('d')[0]);
  assert.equal(first.length, 1);
  assert.deepEqual(second, first);
  assert.ok(first[0].includes('Português (Brasil)'), first[0]);
});

test('#327 the run reads the setting at each turn: a change applies from the next turn', { timeout: 60000 }, async (t) => {
  const { languageLine } = load();
  let current = { agents: 'en', issues: 'en' };
  let calls = 0;
  const language = () => { calls += 1; return current; };
  const { promptOf } = await run(t, { language }, (ev) => {
    if (ev.type === 'session.message_sent' && ev.step_id === 'a') current = PT;
  });
  assert.ok(calls >= 2, `read at each turn (${calls} calls)`);
  assert.ok(promptOf('a')[0].includes(languageLine({ language: { agents: 'en', issues: 'en' } })), 'the first turn: English');
  assert.ok(promptOf('c')[0].includes(languageLine({ language: PT })), 'a later turn: Português (Brasil)');
});

test('#327 without the language option every prompt has the [Language] line naming English', { timeout: 60000 }, async (t) => {
  const line = load().languageLine({});
  const { promptOf } = await run(t);
  for (const step of ['a', 'b', 'c', 'd']) {
    const [prompt] = promptOf(step);
    assert.equal(count(prompt, line), 1, `step ${step}`);
    assert.ok(languageLines(prompt)[0].includes('English'));
  }
});

test('#327 without the language option the output instruction stays the English one of today', { timeout: 60000 }, async (t) => {
  const { promptOf } = await run(t);
  assert.match(promptOf('b')[0], /written in English[\s\S]*whatever language the project instructions or the conversation use/);
});

test('#327 agents in pt-BR: the output instruction keeps keys and enum values as the schema names them and asks prose in Português', { timeout: 60000 }, async (t) => {
  const line = load().languageLine({ language: PT });
  const { promptOf } = await run(t, { language: () => PT });
  // what follows the schema, without the [Language] line (wherever the engine puts it)
  const prompt = promptOf('b')[0].replace(line, '');
  const after = prompt.slice(prompt.indexOf('validates against this JSON Schema'));
  const instruction = after.slice(after.indexOf('\n```\n') + 5);
  assert.doesNotMatch(instruction, /written in English \(string values included\)/);
  assert.match(instruction, /keys/i);
  assert.match(instruction, /enum values/i);
  assert.ok(instruction.includes('Português (Brasil)'), instruction);
});

test('#327 the schema retry with agents in pt-BR keeps keys in English and asks the prose in Português', () => {
  const r = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'on-error.yaml'), inputs: {}, mock: true, runsDir: os.tmpdir(), language: () => PT });
  const schema = { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['approved'] } } };
  const p = r.retryPrompt('a', 'ORIGINAL TASK', 'PREVIOUS ANSWER', schema, ['output.verdict: required']);
  assert.match(p, /"verdict"/, 'the schema goes along');
  assert.doesNotMatch(p, /keeping the content of your answer, in English/);
  assert.match(p, /keys/i);
  assert.match(p, /enum values/i);
  assert.ok(p.includes('Português (Brasil)'), p);
});

test('#327 the schema retry without the setting still asks for English', () => {
  const r = new WorkflowRun({ file: path.join(__dirname, 'fixtures', 'on-error.yaml'), inputs: {}, mock: true, runsDir: os.tmpdir() });
  const p = r.retryPrompt('a', 'ORIGINAL TASK', 'PREVIOUS ANSWER', { type: 'object', required: ['verdict'] }, ['x']);
  assert.match(p, /in English/);
});
