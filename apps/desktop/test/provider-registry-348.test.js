// Provider registry (#348): one adapter per CLI under packages/shared/providers/ (claude, codex, grok,
// mock) and a registry (packages/shared/providers/index.js) that is the only place mapping the CLI names
// ('claude') to the provider types ('claude-code'). The contract these tests hold:
// - registry.list() → the adapters; registry.resolve(key) → the adapter for an id, a type, a CLI
//   name or a model name, or null for an unknown key;
// - an adapter: { id, type, label, cli, imageInput, ... }; a CLI adapter also has
//   parse(event, emit, acc) (the stream parser, the engine's contract, with an optional
//   parse.flush(emit, acc)), resumeArgs(sessionId) and usageLimitMessage.
// The registry and adapters are loaded inside each test: they do not exist before the change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const { sourceFiles } = require('../../../scripts/source-tree');
const registry = () => require('@multiagent/shared/providers');
const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'test', 'fixtures', name), 'utf8');
const events = (text) => text.trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const parseAll = (adapter, evs) => {
  const items = [];
  const acc = {};
  const emit = (i) => items.push(i);
  for (const ev of evs) adapter.parse(ev, emit, acc);
  if (typeof adapter.parse.flush === 'function') adapter.parse.flush(emit, acc);
  return { kinds: items.map((i) => i.kind).filter((k) => k !== 'context'), items, acc };
};

const EXPECTED = [
  { id: 'claude', type: 'claude-code', cli: 'claude', label: 'Claude Code' },
  { id: 'codex', type: 'codex-cli', cli: 'codex', label: 'Codex CLI' },
  { id: 'grok', type: 'grok-cli', cli: 'grok', label: 'Grok Build' },
  { id: 'mock', type: 'mock', label: 'Simulated' },
];

test('the registry lists one adapter per provider: claude, codex, grok and the simulated one', () => {
  const ids = registry().list().map((a) => a.id).sort();
  assert.deepEqual(ids, ['claude', 'codex', 'grok', 'mock']);
});

test('each adapter carries its id, type, label and CLI name', () => {
  const byId = Object.fromEntries(registry().list().map((a) => [a.id, a]));
  for (const e of EXPECTED) {
    const a = byId[e.id];
    assert.ok(a, `no adapter ${e.id}`);
    assert.equal(a.type, e.type, `${e.id}.type`);
    assert.equal(a.label, e.label, `${e.id}.label`);
    if (e.cli) assert.equal(a.cli, e.cli, `${e.id}.cli`);
  }
});

test('resolve finds an adapter by id, by provider type and by CLI name', () => {
  const { resolve } = registry();
  for (const e of EXPECTED) {
    assert.equal(resolve(e.id)?.id, e.id, `by id ${e.id}`);
    assert.equal(resolve(e.type)?.id, e.id, `by type ${e.type}`);
    if (e.cli) assert.equal(resolve(e.cli)?.id, e.id, `by CLI name ${e.cli}`);
  }
});

test('resolve finds an adapter by model name (the known model prefixes)', () => {
  const { resolve } = registry();
  const cases = [
    ['claude-opus-5-5', 'claude'], ['claude-sonnet-5-5', 'claude'], ['claude-haiku-4-5-20251001', 'claude'],
    ['gpt-6-luna', 'codex'], ['gpt-5-codex', 'codex'], ['o3', 'codex'],
    ['grok-4.7', 'grok'], ['grok-code-fast-1', 'grok'],
  ];
  for (const [model, id] of cases) assert.equal(resolve(model)?.id, id, model);
});

test('resolve returns null for an unknown id, type or model, and for an empty key', () => {
  const { resolve } = registry();
  for (const key of ['nope', 'gemini', 'gemini-cli', 'gemini-2.5-pro', 'llama-3', '', null, undefined]) {
    assert.equal(resolve(key) ?? null, null, String(key));
  }
});

test('the simulated provider is not a CLI: no CLI name to look for', () => {
  const mock = registry().resolve('mock');
  assert.equal(mock.id, 'mock');
  assert.equal(!mock.cli, true);
});

test('claude adapter parses the fake Claude Code stream: session, text, usage and cost', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'test', 'fixtures', 'fake-claude.js')], { input: '', encoding: 'utf8' });
  const { kinds, acc } = parseAll(registry().resolve('claude'), events(out));
  assert.deepEqual(kinds, ['session', 'text', 'usage']);
  assert.equal(acc.providerSessionId, '00000000-0000-4000-8000-000000000001');
  assert.match(acc.text, /^args: \[\]\nprompt chars: 0\n/);
  assert.equal(acc.costUsd, 0);
  assert.deepEqual(acc.usage, { input: 91500, output: 30, cache_read: 71000, cache_write: 0, reasoning: 0 });
});

test('codex adapter parses a recorded `codex exec --json` stream: thread id, shell call, answer and token split', () => {
  const { kinds, items, acc } = parseAll(registry().resolve('codex'), events(fixture('codex-stream.ndjson')));
  assert.deepEqual(kinds, ['session', 'thinking', 'tool_call', 'tool_result', 'text', 'usage']);
  assert.equal(acc.providerSessionId, '0199a213-81c0-7800-8aa1-bbab2a035a53');
  assert.equal(items.find((i) => i.kind === 'tool_call').name, 'shell');
  assert.equal(acc.text, '2');
  // cached tokens are part of OpenAI's input_tokens: split, not counted twice
  assert.deepEqual(acc.usage, { input: 3000, output: 120, cache_read: 9000, cache_write: 0, reasoning: 40 });
});

test('grok adapter parses the recorded grok streaming-json capture: items, final text, usage and cost', () => {
  const { kinds, items, acc } = parseAll(registry().resolve('grok'), events(fixture('grok-stream.ndjson')));
  assert.deepEqual(kinds, ['thinking', 'text', 'tool_call', 'tool_result', 'thinking', 'text', 'session', 'usage']);
  assert.equal(items.find((i) => i.kind === 'tool_call').name, 'list_dir');
  assert.equal(acc.text, '6');
  assert.equal(acc.costUsd, 0.040184);
  assert.match(acc.providerSessionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(acc.usage, { input: 15126, output: 98, cache_read: 18688, cache_write: 0, reasoning: 54 });
});

test('each CLI adapter gives the arguments that resume a session', () => {
  const { resolve } = registry();
  assert.deepEqual(resolve('claude').resumeArgs('s-1'), ['--resume', 's-1']);
  assert.deepEqual(resolve('codex').resumeArgs('s-1'), ['resume', 's-1']);
  assert.deepEqual(resolve('grok').resumeArgs('s-1'), ['--resume', 's-1']);
});

test('each adapter says how it opens attached images', () => {
  const { resolve } = registry();
  assert.equal(resolve('claude').imageInput, 'read');
  assert.equal(resolve('mock').imageInput, 'record');
  assert.equal(resolve('codex').imageInput ?? null, null);
  assert.equal(resolve('grok').imageInput ?? null, null);
});

test('each CLI adapter\'s usage-limit message is recognised as a credit error for its type, and not a plain failure', () => {
  const { isQuotaError } = require('@multiagent/engine/engine/providers');
  for (const id of ['claude', 'codex', 'grok']) {
    const a = registry().resolve(id);
    assert.equal(typeof a.usageLimitMessage, 'string', `${id}.usageLimitMessage`);
    assert.equal(isQuotaError(a.type, a.usageLimitMessage), true, id);
    assert.equal(isQuotaError(a.type, 'Error: tests failed (3 failing)'), false, id);
  }
  // the per-CLI patterns stay per CLI
  assert.equal(isQuotaError('grok-cli', 'Your team has used all available credits'), true);
  assert.equal(isQuotaError('claude-code', 'Your team has used all available credits'), false);
  assert.equal(isQuotaError('claude-code', '5-hour limit reached ∙ resets 3pm'), true);
  assert.equal(isQuotaError('codex-cli', 'usage_limit_reached'), true);
});

test('the run chat maps CLI names and models to the backend\'s provider types, with no gemini', () => {
  const { providerType } = require('@multiagent/front-build/views/runchat/run-chat-model.js');
  assert.equal(providerType('claude'), 'claude-code');
  assert.equal(providerType('codex'), 'codex-cli');
  assert.equal(providerType('grok'), 'grok-cli');
  assert.equal(providerType('grok-cli'), 'grok-cli');
  assert.equal(providerType('', 'gpt-6-luna'), 'codex-cli');
  assert.equal(providerType('', 'claude-opus-5-5'), 'claude-code');
  assert.notEqual(providerType('gemini'), 'gemini-cli');
  assert.notEqual(providerType('', 'gemini-2.5-pro'), 'gemini-cli');
});

// No provider literal outside packages/shared/providers/: a provider type in quotes, or a CLI name
// compared with a provider/cli value, in any source file of the workspaces (scripts/source-tree.js
// sourceFiles, #579). The YAML files, user-facing docs, tests and features are exempt. Listed
// exceptions may only shrink (none today).
const EXCEPTIONS = [];
const TYPE_LITERAL = /['"`](?:claude-code|codex-cli|grok-cli|gemini-cli)['"`]/;
const CLI_COMPARE = /\b(?:provider|providerId|cli)\s*[!=]==?\s*['"`](?:claude|codex|grok)['"`]|['"`](?:claude|codex|grok)['"`]\s*[!=]==?\s*[\w.]*\b(?:provider|providerId|cli)\b/;

test('no provider literal outside packages/shared/providers/', () => {
  const files = sourceFiles(ROOT, { match: /\.(?:js|jsx|mjs|cjs|html)$/ })
    .filter((f) => !/(^|\/)(test|features)\//.test(f))
    .filter((f) => !f.startsWith('packages/shared/providers/') && !EXCEPTIONS.includes(f));
  const offenders = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
    lines.forEach((line, n) => {
      if (TYPE_LITERAL.test(line) || CLI_COMPARE.test(line)) offenders.push(`${rel}:${n + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('the registry is where the provider literals live (the literal check guards a real place)', () => {
  const dir = path.join(ROOT, 'packages', 'shared', 'providers');
  for (const f of ['index.js', 'claude.js', 'codex.js', 'grok.js', 'mock.js']) assert.ok(fs.existsSync(path.join(dir, f)), `packages/shared/providers/${f} is missing`);
});

test('docs: engine/providers.md describes the registry and its adapters', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'agents', 'engine', 'providers.md'), 'utf8');
  assert.match(doc, /packages\/shared\/providers\//);
  assert.match(doc, /providers\/index\.js/);
});

test('code map: "A provider" says how to add one (one adapter file plus the registry line)', () => {
  const { codeMap } = require('../../../scripts/docs');
  const map = String(codeMap(ROOT));
  const start = map.indexOf('**A provider**');
  assert.ok(start >= 0, 'the code map has no "A provider" entry');
  const next = map.indexOf('\n- ', start);
  const entry = map.slice(start, next === -1 ? undefined : next);
  assert.match(entry, /packages\/shared\/providers\//);
  assert.match(entry, /index\.js/);
});
