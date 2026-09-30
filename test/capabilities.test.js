const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const caps = require('../src/engine/capabilities');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];
const TOOLCHAINS = ['bash:git', 'bash:npm'];

test('claude: capabilities become --tools (offered), --allowedTools (approved) and acceptEdits for writers', () => {
  const { args } = caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'edit', 'write', TOOLCHAINS], subagents: true }) });
  assert.equal(argAfter(args, '--tools'), 'Read,Glob,Grep,Edit,NotebookEdit,Write,Bash,Task');
  assert.equal(argAfter(args, '--allowedTools'), 'Read Glob Grep Edit NotebookEdit Write Bash(git:*) Bash(npm:*) Task');
  assert.equal(argAfter(args, '--permission-mode'), 'acceptEdits');
  assert.ok(!args.join(' ').includes('WebSearch'), 'no web tools unless web: true');

  const ro = caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'bash:git diff'], web: true }) }).args;
  assert.equal(argAfter(ro, '--tools'), 'Read,Glob,Grep,Bash,WebSearch,WebFetch');
  assert.equal(argAfter(ro, '--allowedTools'), 'Read Glob Grep Bash(git diff:*) WebSearch WebFetch');
  assert.ok(!ro.includes('--permission-mode'), 'read-only agents never get acceptEdits');
});

test('claude: isolated by default (no user MCP servers, settings, Chrome, skill listing or auto-memory)', () => {
  const { args } = caps.providerArgs('claude-code', { caps: null });
  assert.deepEqual(args, ['--strict-mcp-config', '--no-chrome', '--setting-sources', 'project,local', '--disable-slash-commands', '--settings', '{"autoMemoryEnabled":false}']);
  assert.deepEqual(caps.providerArgs('claude-code', { caps: null, isolated: false }).args, []);
});

test('MCP servers: only the ones the agent declares, from the workflow definitions', () => {
  const servers = { docs: { command: 'npx', args: ['-y', 'docs-mcp'] }, other: { url: 'https://x' } };
  const c = caps.normalize({ tools: ['read'], mcp: ['docs'] });
  const claude = caps.providerArgs('claude-code', { caps: c, mcpServers: servers }).args;
  assert.deepEqual(JSON.parse(argAfter(claude, '--mcp-config')), { mcpServers: { docs: servers.docs } });
  assert.match(argAfter(claude, '--allowedTools'), / mcp__docs$/);
  const codex = caps.providerArgs('codex-cli', { caps: c, mcpServers: servers }).args;
  assert.equal(codex.filter((a) => a.startsWith('mcp_servers=')).length, 1);
  assert.ok(codex.includes('mcp_servers={docs={command="npx",args=["-y","docs-mcp"]}}'));
});

test('codex: sandbox from the tools, web search off, user MCP servers and desktop features off', () => {
  const ro = caps.providerArgs('codex-cli', { caps: caps.normalize({ tools: ['read', 'bash:git'] }) });
  assert.equal(argAfter(ro.args, '-s'), 'read-only');
  assert.ok(ro.args.includes('mcp_servers={}'));
  for (const f of caps.CODEX_FEATURES_OFF) assert.ok(ro.args.join(' ').includes(`--disable ${f}`), f);
  assert.ok(ro.args.includes('web_search="disabled"'));
  assert.match(ro.notes.join(), /not enforceable/);
  const rw = caps.providerArgs('codex-cli', { caps: caps.normalize({ tools: ['read', 'write'], web: true }) });
  assert.equal(argAfter(rw.args, '-s'), 'workspace-write');
  assert.ok(!rw.args.includes('web_search="disabled"'));
});

test('grok: read-only tool list, no web, no sub-agents, always-approve; what it cannot isolate is noted', () => {
  const { args, notes } = caps.providerArgs('grok-cli', { caps: caps.normalize({ tools: ['read'] }) });
  assert.deepEqual(args, ['--tools', 'read_file,list_dir,grep', '--disable-web-search', '--no-subagents', '--always-approve']);
  assert.match(notes.join(), /no flags to skip/);
  const web = caps.providerArgs('grok-cli', { caps: caps.normalize({ tools: ['read'], web: true }) }).args;
  assert.equal(argAfter(web, '--tools'), 'read_file,list_dir,grep,web_search,web_fetch');
  assert.match(caps.providerArgs('grok-cli', { caps: caps.normalize({ tools: ['read', 'bash'] }) }).notes.join(), /only read-only tool sets/);
});

test('a bare flag is never passed twice (clap CLIs refuse it)', () => {
  assert.deepEqual(caps.dedupeFlags(['--no-subagents', '--tools', 'x', '--no-subagents', '--always-approve'], ['-m', 'm', '--always-approve']), ['--no-subagents', '--tools', 'x']);
});

test('step capabilities override the agent\'s key by key; describe() summarizes them', () => {
  const m = caps.merge({ tools: ['read', 'bash:gh'], web: false }, { web: true });
  assert.deepEqual(m, { tools: ['read', 'bash:gh'], web: true, mcp: [], subagents: false });
  assert.equal(caps.merge(null, null), null);
  assert.equal(caps.describe({ tools: ['read', 'edit', ['bash:git', 'bash:gh']] }), 'tools: read, edit, bash: git gh · web: off · mcp: none');
  assert.equal(caps.describe(null), 'cli_args only');
});

test('loadWorkflow rejects unknown capabilities, tools, MCP servers and session modes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const load = (agent, extra = '') => {
    const f = path.join(dir, `wf-${Math.random().toString(36).slice(2)}.yaml`);
    fs.writeFileSync(f, `${extra}agents:\n  a: ${agent}\nsteps:\n  - { id: s, agent: a, prompt: x }\n`);
    return () => loadWorkflow(f);
  };
  assert.throws(load('{ provider: claude, model: m, capabilities: { shell: true } }'), /unknown capability "shell"/);
  assert.throws(load('{ provider: claude, model: m, capabilities: { tools: [read, delete] } }'), /unknown tool "delete"/);
  assert.throws(load('{ provider: claude, model: m, capabilities: { web: "yes" } }'), /web must be true or false/);
  assert.throws(load('{ provider: claude, model: m, capabilities: { mcp: [docs] } }'), /MCP server "docs" is not defined/);
  assert.doesNotThrow(load('{ provider: claude, model: m, capabilities: { mcp: [docs] } }', 'mcp_servers:\n  docs: { command: x }\n'));
  assert.throws(load('{ provider: claude, model: m, session: forever }'), /session must be one of persistent, ephemeral, handoff/);
  assert.throws(load('{ provider: claude, model: m, max_context: lots }'), /max_context must be a token count/);
});

test('a real turn gets the capability and isolation flags, and its context is measured per request', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // the "CLI" is node + a fake that calls no model: lift the simulation-only guard for this test
  const guard = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { if (guard !== undefined) process.env.MULTIAGENT_SIMULATION_ONLY = guard; });
  const fake = path.join(__dirname, 'fixtures', 'fake-claude.js').replace(/\\/g, '/');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${fake}", "-p"] }`,
    'agents:',
    '  dev: { provider: claude, model: fake, session: handoff, capabilities: { tools: [read, bash:gh] }, cli_args: ["--verbose"] }',
    'steps:',
    '  - { id: work, agent: dev, prompt: "Do it." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, runsDir: path.join(dir, 'runs') });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const spawn = events.find((e) => e.type === 'session.stream' && e.item.kind === 'spawn').item;
  assert.ok(spawn.args.includes('--strict-mcp-config'));
  assert.equal(argAfter(spawn.args, '--tools'), 'Read,Glob,Grep,Bash');
  assert.equal(argAfter(spawn.args, '--allowedTools'), 'Read Glob Grep Bash(gh:*)');
  assert.ok(spawn.args.includes('--verbose'), 'cli_args still apply on top');
  const log = events.find((e) => e.type === 'log' && e.kind === 'capabilities');
  assert.match(log.message, /dev \(claude-code, isolated\): tools: read, bash: gh/);

  // the answer comes back without its handoff block; the note is saved; the context is the main
  // conversation's per request (a sub-agent's request does not count)
  const received = events.find((e) => e.type === 'session.message_received');
  assert.ok(!received.text.includes('```handoff'));
  assert.deepEqual(received.context, { start: 31000, peak: 41500 });
  assert.equal(received.handoff, '- Goal: fake');
  assert.ok(fs.existsSync(path.join(run.runDir, 'handoffs', 'work-v1-dev.md')));
  assert.deepEqual(finished.summary.context.agents.dev.per_turn[0], { step: 'work', visit: 1, start: 31000, peak: 41500, tokens: 72520 });
});
