const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const caps = require('../src/engine/capabilities');
const { WorkflowRun, loadWorkflow } = require('../src/engine/workflow');

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];
const TOOLCHAINS = ['bash:git', 'bash:npm'];

// The read-only shell utilities every agent with a bash:<command> capability also gets (#96): no
// refusal for a pipe or a `;` chain made of allowed commands, whatever the agent's own toolchain.
const READ_BASH = ['[', 'basename', 'cat', 'cut', 'dirname', 'echo', 'grep', 'head', 'ls', 'printenv', 'pwd', 'tail', 'test', 'tr', 'wc'].map((u) => `Bash(${u}:*)`);
const WRITE_BASH = ['mkdir', 'mktemp', 'sort', 'uniq'].map((u) => `Bash(${u}:*)`);

test('claude: capabilities become --tools (offered), --allowedTools (approved) and acceptEdits for writers', () => {
  const { args } = caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'edit', 'write', TOOLCHAINS], subagents: true }) });
  assert.equal(argAfter(args, '--tools'), 'Read,Glob,Grep,Edit,NotebookEdit,Write,Bash,Agent,Task');
  assert.equal(argAfter(args, '--allowedTools'), [
    'Read Glob Grep Edit NotebookEdit Write Bash(git:*) Bash(npm:*)',
    'Bash(MULTIAGENT_SIMULATION_ONLY=1 git:*) Bash(MULTIAGENT_SIMULATION_ONLY=1 npm:*)',
    ...READ_BASH, ...WRITE_BASH, 'Agent Task',
  ].join(' '));
  assert.equal(argAfter(args, '--permission-mode'), 'acceptEdits');
  assert.ok(!args.join(' ').includes('WebSearch'), 'no web tools unless web: true');

  const ro = caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'bash:git diff'], web: true }) }).args;
  assert.equal(argAfter(ro, '--tools'), 'Read,Glob,Grep,Bash,WebSearch,WebFetch');
  assert.equal(argAfter(ro, '--allowedTools'), [
    'Read Glob Grep Bash(git diff:*) Bash(MULTIAGENT_SIMULATION_ONLY=1 git diff:*)', ...READ_BASH, 'WebSearch WebFetch',
  ].join(' '));
  assert.ok(!ro.includes('--permission-mode'), 'read-only agents never get acceptEdits');
});

test('claude: every agent with bash:<command> also gets the read-only utilities (pipes, `;` chains); only writers get the write ones too', () => {
  const readOnly = caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'bash:git'] }) }).args;
  const allowedRo = argAfter(readOnly, '--allowedTools');
  for (const rule of READ_BASH) assert.ok(allowedRo.includes(rule), rule);
  assert.match(allowedRo, /Bash\(\[:\*\)/, 'the bracket form of test ([ -f file ] && ...)');
  assert.match(allowedRo, /Bash\(test:\*\)/);
  for (const rule of WRITE_BASH) assert.ok(!allowedRo.includes(rule), `${rule} would let a read-only agent write`);

  const writer = caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'write', 'bash:npm'] }) }).args;
  const allowedRw = argAfter(writer, '--allowedTools');
  for (const rule of [...READ_BASH, ...WRITE_BASH]) assert.ok(allowedRw.includes(rule), rule);
  assert.ok(allowedRw.includes('Bash(MULTIAGENT_SIMULATION_ONLY=1 npm:*)'), 'a still-prefixed command is allowed too, so the engine setting the var does not by itself refuse it');

  // a utility the agent already declared as its own command is listed once, not duplicated
  const withGrep = argAfter(caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'bash:grep'] }) }).args, '--allowedTools');
  assert.equal(withGrep.split('Bash(grep:*)').length - 1, 1);
});

test('a bare `bash` capability keeps allowing everything: no need for the fixed utility list', () => {
  const { args } = caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'bash'] }) });
  assert.equal(argAfter(args, '--allowedTools'), 'Read Glob Grep Bash');
});

test('runDirs/commandGuide: an agent with commands gets a logs, a scratch and an evidence folder under the run, and no other agent does', () => {
  const withBash = caps.normalize({ tools: ['read', 'bash:git'] });
  const noBash = caps.normalize({ tools: ['read'] });
  assert.deepEqual(caps.runDirs(withBash, 'C:/run'), [path.join('C:/run', 'evidence'), path.join('C:/run', 'logs'), path.join('C:/run', 'scratch')]);
  assert.deepEqual(caps.runDirs(noBash, 'C:/run'), []);
  assert.deepEqual(caps.runDirs(withBash, null), [], 'no run folder yet: nothing to offer');
  assert.equal(caps.commandGuide(noBash, 'C:/run'), '', 'nothing to tell an agent with no commands');

  const guide = caps.commandGuide(withBash, 'C:/run');
  assert.match(guide, /never `cd <folder> && \.\.\.`/, 'the current folder already is the working folder');
  assert.match(guide, /MULTIAGENT_SIMULATION_ONLY=1 is already set in your environment: never prefix/, 'the engine sets it, not the agent');
  assert.ok(guide.includes(`Write command logs to \`${path.join('C:/run', 'logs')}`), 'the log folder, never /tmp, $TEMP or AppData');
  assert.match(guide, /never to \/tmp, \$TEMP or AppData/);
  assert.match(guide, /rephrase it once into an allowed form instead of retrying variants/);
  assert.doesNotMatch(guide, /scratch workspace/, 'no MULTIAGENT_WORKSPACE (a run with no worktree): nothing to say about it');
});

test('agentEnv: the agent\'s environment is AGENT_ENV alone, unless the run has a scratch workspace (#120)', () => {
  assert.deepEqual(caps.agentEnv(), { MULTIAGENT_SIMULATION_ONLY: '1' });
  assert.deepEqual(caps.agentEnv(null), { MULTIAGENT_SIMULATION_ONLY: '1' });
  assert.deepEqual(caps.agentEnv({ workspace: 'C:/run/scratch/workspace', userData: 'C:/run/scratch/user-data' }), {
    MULTIAGENT_SIMULATION_ONLY: '1',
    MULTIAGENT_USER_DATA: 'C:/run/scratch/user-data',
    MULTIAGENT_WORKSPACE: 'C:/run/scratch/workspace',
  });
});

test('commandGuide: an agent given a scratch workspace is told every one of its own variables (plural wording) and where its own checks must write', () => {
  const withBash = caps.normalize({ tools: ['read', 'bash:npm'] });
  const env = caps.agentEnv({ workspace: 'C:/run/scratch/workspace', userData: 'C:/run/scratch/user-data' });
  const guide = caps.commandGuide(withBash, 'C:/run', env);
  assert.match(guide, /MULTIAGENT_SIMULATION_ONLY=1, MULTIAGENT_USER_DATA=C:\/run\/scratch\/user-data, MULTIAGENT_WORKSPACE=C:\/run\/scratch\/workspace are already set/, 'plural: more than one variable');
  assert.match(guide, /this run's scratch workspace `C:\/run\/scratch\/workspace`: never pass a path under the owner's workspace/);
});

test('claudeBashRules: a command is allowed prefixed by any one of the agent\'s own environment variables, not only MULTIAGENT_SIMULATION_ONLY', () => {
  const c = caps.normalize({ tools: ['read', 'bash:npm'] });
  const env = caps.agentEnv({ workspace: 'C:/run/scratch/workspace', userData: 'C:/run/scratch/user-data' });
  const allowed = argAfter(caps.providerArgs('claude-code', { caps: c, env }).args, '--allowedTools');
  assert.match(allowed, /Bash\(MULTIAGENT_SIMULATION_ONLY=1 npm:\*\)/);
  assert.match(allowed, /Bash\(MULTIAGENT_WORKSPACE=C:\/run\/scratch\/workspace npm:\*\)/);
  assert.match(allowed, /Bash\(MULTIAGENT_USER_DATA=C:\/run\/scratch\/user-data npm:\*\)/);
});

test('edits_tests: false → Claude refuses edits to the test paths; the other CLIs note that they cannot', () => {
  const writer = caps.normalize({ tools: ['read', 'edit', 'write', TOOLCHAINS] });
  const denyEdits = ['**/test/**', '*.test.*'];
  const claude = caps.providerArgs('claude-code', { caps: writer, denyEdits });
  assert.equal(argAfter(claude.args, '--disallowedTools'), 'Edit(**/test/**) Edit(**/*.test.*)');
  assert.deepEqual(claude.notes, []);
  assert.ok(!caps.providerArgs('claude-code', { caps: writer }).args.includes('--disallowedTools'), 'no rules without edits_tests: false');
  const readOnly = caps.normalize({ tools: ['read'] });
  assert.ok(!caps.providerArgs('claude-code', { caps: readOnly, denyEdits }).args.includes('--disallowedTools'), 'nothing to refuse to a read-only agent');
  assert.match(caps.providerArgs('codex-cli', { caps: writer, denyEdits }).notes.join(), /test paths .* not refused by the tools/);
  assert.match(caps.providerArgs('grok-cli', { caps: writer, denyEdits }).notes.join(), /test paths .* not refused by the tools/);
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

test('describe(caps, type): the run log names the tool that offers sub-agents, per provider', () => {
  const withSubagents = { tools: ['read'], subagents: true };
  assert.match(caps.describe(withSubagents, 'claude-code'), /subagents: Agent\/Task tool offered$/);
  assert.match(caps.describe(withSubagents, 'codex-cli'), /subagents: not offered by Codex$/);
  assert.match(caps.describe(withSubagents), /· subagents$/, 'no provider type: the generic word');
  assert.doesNotMatch(caps.describe({ tools: ['read'] }, 'claude-code'), /subagents/, 'subagents: false leaves it out entirely');
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
  // this run has no worktree (no orchestrator.worktree), so the engine's own agentEnv carries no
  // MULTIAGENT_WORKSPACE/MULTIAGENT_USER_DATA; isolate the ones the *outer* run (this very CI/agent
  // turn) already has, so the spawned fake does not inherit them through process.env
  const outerEnv = { MULTIAGENT_WORKSPACE: process.env.MULTIAGENT_WORKSPACE, MULTIAGENT_USER_DATA: process.env.MULTIAGENT_USER_DATA };
  delete process.env.MULTIAGENT_WORKSPACE;
  delete process.env.MULTIAGENT_USER_DATA;
  t.after(() => {
    for (const [k, v] of Object.entries(outerEnv)) { if (v !== undefined) process.env[k] = v; }
  });
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
  assert.equal(argAfter(spawn.args, '--allowedTools'), ['Read Glob Grep Bash(gh:*) Bash(MULTIAGENT_SIMULATION_ONLY=1 gh:*)', ...READ_BASH].join(' '));
  assert.ok(spawn.args.includes('--verbose'), 'cli_args still apply on top');
  // the run's logs, scratch and evidence folders exist and are offered to the CLI with --add-dir (#96, #120, #146)
  const runDirArgs = spawn.args.filter((a, i) => spawn.args[i - 1] === '--add-dir');
  assert.ok(runDirArgs.some((d) => d.endsWith(`${path.sep}logs`) && fs.existsSync(d)), runDirArgs.join(', '));
  assert.ok(runDirArgs.some((d) => d.endsWith(`${path.sep}scratch`) && fs.existsSync(d)), runDirArgs.join(', '));
  assert.ok(runDirArgs.some((d) => d.endsWith(`${path.sep}evidence`) && fs.existsSync(d)), runDirArgs.join(', '));
  const log = events.find((e) => e.type === 'log' && e.kind === 'capabilities');
  assert.match(log.message, /dev \(claude-code, isolated\): tools: read, bash: gh/);

  // the answer comes back without its handoff block; the note is saved; the context is the main
  // conversation's per request (a sub-agent's request does not count)
  const received = events.find((e) => e.type === 'session.message_received');
  assert.ok(!received.text.includes('```handoff'));
  // the engine sets MULTIAGENT_SIMULATION_ONLY in the child's own environment: the agent needs no
  // `VAR=value` prefix, even though this test deleted it from the *parent* process to lift the guard
  assert.match(received.text, /MULTIAGENT_SIMULATION_ONLY: 1/);
  // no worktree in this run (no orchestrator.worktree, no worktreesDir): no scratch workspace either
  assert.match(received.text, /MULTIAGENT_WORKSPACE: undefined/);
  assert.deepEqual(received.context, { start: 31000, peak: 41500 });
  assert.equal(received.handoff, '- Goal: fake');
  assert.ok(fs.existsSync(path.join(run.runDir, 'handoffs', 'work-v1-dev.md')));
  assert.deepEqual(finished.summary.context.agents.dev.per_turn[0], { step: 'work', visit: 1, start: 31000, peak: 41500, tokens: 72520 });
});

test('Agent/Task tool calls are counted as sub-agent calls, per agent and per step; other tools and a step with none do not count (#160)', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-subagent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const guard = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => { if (guard !== undefined) process.env.MULTIAGENT_SIMULATION_ONLY = guard; });
  const withSubagent = path.join(__dirname, 'fixtures', 'fake-claude-subagent.js').replace(/\\/g, '/');
  const plain = path.join(__dirname, 'fixtures', 'fake-claude.js').replace(/\\/g, '/');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  devcli: { type: claude-code, command: node, args: ["${withSubagent}", "-p"] }`,
    `  qacli: { type: claude-code, command: node, args: ["${plain}", "-p"] }`,
    'agents:',
    '  dev: { provider: devcli, model: fake, session: ephemeral, capabilities: { tools: [read, edit], subagents: true } }',
    '  qa: { provider: qacli, model: fake, session: ephemeral, capabilities: { tools: [read] } }',
    'steps:',
    '  - { id: map, agent: dev, prompt: "Do it." }',
    '  - { id: check, agent: qa, prompt: "Check it." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, runsDir: path.join(dir, 'runs') });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  // two of the turn's three tool calls are Task/Agent; the plain Bash call does not count
  const received = events.find((e) => e.type === 'session.message_received' && e.step_id === 'map');
  assert.equal(received.subagent_calls, 2);
  const noSubagents = events.find((e) => e.type === 'session.message_received' && e.step_id === 'check');
  assert.equal('subagent_calls' in noSubagents, false, 'a turn with no Agent/Task call omits the field');

  const { agents } = finished.summary.context;
  assert.equal(agents.dev.subagent_calls, 2);
  assert.deepEqual(agents.dev.subagent_calls_by_step, { map: 2 });
  assert.equal(agents.qa.subagent_calls, 0);
  assert.deepEqual(agents.qa.subagent_calls_by_step, {});
  assert.equal(agents.dev.per_turn[0].subagent_calls, 2);
  assert.equal('subagent_calls' in agents.qa.per_turn[0], false);
});
