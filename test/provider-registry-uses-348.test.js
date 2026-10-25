// Provider registry (#348), beyond the acceptance tests (provider-registry-348.test.js): the exact
// lookups (byId, byType, clis), the registry loaded as the renderer loads it (plain scripts in
// index.html order, window.Providers), the adapters' read-only chat arguments, and the callers that
// now read the registry: the robots' fallback, the builder's and the requirements' provider lookups,
// folder trust and the 3D view's agent list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const registry = () => require('@multiagent/shared/providers');

// the packages/shared/providers/ scripts index.html loads, in its order
function providerScripts() {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="\.\.\/\.\.\/packages\/shared\/providers\/([\w-]+\.js)"><\/script>/g)].map((m) => m[1]);
}

/** A browser-like sandbox with the provider scripts loaded (and robots.js when asked). */
function browser({ providers = true, robots = false } = {}) {
  const sandbox = { window: {}, document: { dispatchEvent() {} }, CustomEvent: class {}, console };
  vm.createContext(sandbox);
  if (providers) {
    for (const f of providerScripts()) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'providers', f), 'utf8'), sandbox, { filename: f });
    }
  }
  if (robots) vm.runInContext(fs.readFileSync(path.join(RENDERER, 'robots.js'), 'utf8'), sandbox, { filename: 'robots.js' });
  return sandbox.window;
}

test('byId and byType match exactly one vocabulary; clis() lists only the CLIs', () => {
  const { byId, byType, clis } = registry();
  assert.equal(byId('codex')?.type, 'codex-cli');
  assert.equal(byId('codex-cli'), null);
  assert.equal(byType('grok-cli')?.id, 'grok');
  assert.equal(byType('grok'), null);
  assert.equal(byType('mock')?.id, 'mock');
  assert.equal(byId('nope'), null);
  assert.equal(byType(undefined), null);
  assert.deepEqual(clis().map((a) => a.id).sort(), ['claude', 'codex', 'grok']);
});

test('index.html loads every adapter before the registry, and the registry before the scripts that read it', () => {
  const scripts = providerScripts();
  assert.equal(scripts[scripts.length - 1], 'index.js');
  for (const f of ['claude.js', 'codex.js', 'grok.js', 'mock.js']) assert.ok(scripts.includes(f), f);
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const at = (src) => html.indexOf(`<script src="${src}"></script>`);
  const registryAt = at('../../packages/shared/providers/index.js');
  for (const reader of ['chat-models.js', 'robots.js', 'views/runchat/run-chat-model.js']) {
    assert.ok(at(reader) > registryAt, `${reader} loads before the provider registry`);
  }
});

test('in the browser the registry is window.Providers and resolves both vocabularies', () => {
  const win = browser();
  assert.equal(typeof win.Providers?.resolve, 'function');
  assert.equal(win.Providers.resolve('claude-code').label, 'Claude Code');
  assert.equal(win.Providers.resolve('codex').type, 'codex-cli');
  assert.equal(win.Providers.resolve('grok-4.7').id, 'grok');
  assert.equal(win.Providers.resolve('gemini-cli') ?? null, null);
  assert.deepEqual(Array.from(win.Providers.list(), (a) => a.id).sort(), ['claude', 'codex', 'grok', 'mock']);
});

test('the supervisor\'s read-only chat: each CLI\'s plan mode, sandbox or read-only tool list', () => {
  const { byId } = registry();
  const opts = { model: 'm-1', skillDir: 'S', prompt: 'Explain the run.' };
  assert.deepEqual(byId('claude').readOnlyChatArgs(opts), ['--model', 'm-1', '--permission-mode', 'plan', '--add-dir', 'S', 'Explain the run.']);
  assert.deepEqual(byId('codex').readOnlyChatArgs(opts), ['-m', 'm-1', '-s', 'read-only', 'Explain the run.']);
  assert.deepEqual(byId('grok').readOnlyChatArgs(opts), ['-m', 'm-1', '--tools', 'read_file,list_dir,grep', 'Explain the run.']);
  assert.equal(typeof byId('mock').readOnlyChatArgs, 'undefined');
});

test('robots: a provider type draws its adapter\'s robot; gemini models keep their own', () => {
  const { Robots } = browser({ robots: true });
  assert.equal(Robots.variantFor('claude-code', ''), 'claude');
  assert.equal(Robots.variantFor('codex-cli', ''), 'gpt');
  assert.equal(Robots.variantFor('grok-cli', ''), 'grok');
  assert.equal(Robots.variantFor('codex', 'gpt-6-luna'), 'gpt');
  assert.equal(Robots.variantFor('claude-code', 'gemini-2.5-pro'), 'gemini');
});

test('robots: without an adapter (simulated, unknown, no registry) the model\'s maker draws, else the vanilla robot', () => {
  const withRegistry = browser({ robots: true }).Robots;
  assert.equal(withRegistry.variantFor('mock', 'claude-opus-5-5'), 'claude');
  assert.equal(withRegistry.variantFor('mock', 'gpt-6-luna'), 'gpt');
  assert.equal(withRegistry.variantFor('mock', 'o3'), 'gpt');
  assert.equal(withRegistry.variantFor('nope', 'grok-4.7'), 'grok');
  assert.equal(withRegistry.variantFor('mock', 'fake'), 'vanilla');
  assert.equal(withRegistry.variantFor('', ''), 'vanilla');
  const alone = browser({ providers: false, robots: true }).Robots;
  assert.equal(alone.variantFor('claude-code', 'claude-opus-5-5'), 'claude');
  assert.equal(alone.variantFor('codex-cli', 'gpt-6-luna'), 'gpt');
  assert.equal(alone.variantFor('codex-cli', ''), 'vanilla');
});

test('builder: a workflow provider of the simulated or an unknown type is reported, not drawn as a CLI', () => {
  const builder = require('../src/domains/workflow/workflow-builder');
  const agent = { provider: 'claude', model: 'claude-opus-5-5', system_prompt: 'You plan.' };
  const wf = (type) => ({
    name: 'P', steps: [{ id: 'plan', agent: 'planner', prompt: 'Plan.' }],
    agents: { planner: { ...agent } },
    providers: { claude: { type, command: 'claude' } },
  });
  for (const type of ['mock', 'gemini-cli']) {
    const { problems } = builder.fromWorkflow(wf(type));
    assert.ok(problems.includes('provider "claude" of agent "planner"'), `${type}: ${problems.join('; ')}`);
    assert.equal(builder.describeWorkflow(wf(type)).agents.planner.provider, null, type);
  }
  // a provider named freely is drawn as the CLI of its type
  const named = wf('codex-cli');
  named.providers = { fast: { type: 'codex-cli', command: 'codex' } };
  named.agents.planner.provider = 'fast';
  assert.equal(builder.describeWorkflow(named).agents.planner.provider, 'codex');
  assert.equal(builder.fromWorkflow(named).problems.some((p) => p.startsWith('provider ')), false);
});

test('requirements: a provider of the simulated or an unknown type needs no CLI; a known type needs its CLI', () => {
  const { workflowRequirements } = require('../src/domains/workflow/workflow-requirements');
  const wf = (providers, provider) => ({ agents: { a: { provider } }, providers });
  assert.deepEqual(workflowRequirements(wf({ sim: { type: 'mock' } }, 'sim')).clis, ['git']);
  assert.deepEqual(workflowRequirements(wf({ other: { type: 'gemini-cli' } }, 'other')).clis, ['git']);
  assert.deepEqual(workflowRequirements(wf({ fast: { type: 'grok-cli' } }, 'fast')).clis.slice().sort(), ['git', 'grok']);
  assert.deepEqual(workflowRequirements(wf({}, 'codex')).clis.slice().sort(), ['codex', 'git']);
});

test('trustFolder: an unknown provider or the simulated one is not trusted and writes nothing', (t) => {
  const { trustFolder } = require('../src/domains/cli/cli-trust');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-348-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'project');
  fs.mkdirSync(dir);
  const before = fs.readdirSync(home).sort();
  for (const provider of ['nope', 'mock', 'gemini', '', undefined]) assert.equal(trustFolder(provider, dir, { home }), false, String(provider));
  assert.deepEqual(fs.readdirSync(home).sort(), before);
});

test('3D view: every "·" separator in the HUD has a space on both sides (agent list: "Claude Code · Opus 5.5")', () => {
  const hud = fs.readFileSync(path.join(RENDERER, 'run3d', 'hud.jsx'), 'utf8');
  const bad = hud.split(/\r?\n/).map((line, i) => [i + 1, line]).filter(([, line]) => /\S·|·[^\s]/.test(line.replace(/\{\s*'·'\s*\}/g, '')))
    .map(([n, line]) => `hud.jsx:${n}: ${line.trim().slice(0, 160)}`);
  assert.deepEqual(bad, []);
});
