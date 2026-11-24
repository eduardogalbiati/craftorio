// #45: an isolated Claude agent of a run starts with the instructions of its worktree's root (CLAUDE.md
// with its imports inside the repository, or AGENTS.md when there is no CLAUDE.md), while the checkout's
// .claude/settings*.json stay out (#468, SEC-3). Acceptance tests written before the code.
// Seams: WorkflowRun on throwaway repositories, whose "CLI" is test/fixtures/fake-claude-instructions.js
// (it records what reached the model: the prompt on stdin and the appended system prompt; no model call);
// the Oracle, the supervisor chat and the Product Owner through their public ask.
// The way the instructions travel is left to the developer: the prompt, --append-system-prompt or
// --append-system-prompt-file. Not through a setting source (capabilities.test.js, #468).
// Assumption: the session "says" its files in its recorded events (a session.* event or a log with its
// session_id) by their path in the repository, outside the prompt, the answer and the CLI's arguments.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { WorkflowRun } = require('../engine/workflow');
const { fixture, git } = require('./worktree-helpers');

const FAKE = path.join(__dirname, 'fixtures', 'fake-claude-instructions.js').replace(/\\/g, '/');

// { 'path/in/repo': text | { link: target } } committed on the repository's main and pushed: a run's
// worktree starts from origin/main
function commitFiles(repo, files) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(repo, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (typeof content === 'string') fs.writeFileSync(full, content);
    else fs.symlinkSync(content.link, full);
    git(repo, 'add', '-f', file);
  }
  if (!Object.keys(files).length) return;
  git(repo, 'commit', '-q', '-m', 'instructions');
  git(repo, 'push', '-q', 'origin', 'main');
}

// The "CLI" is node + a fake that calls no model: the simulation-only guard is lifted for the test
function liftSimulation(t) {
  for (const k of ['CRAFTORIO_SIMULATION_ONLY', 'CRAFTORIO_WORKSPACE', 'CRAFTORIO_USER_DATA']) {
    const v = process.env[k];
    delete process.env[k];
    t.after(() => { if (v !== undefined) process.env[k] = v; });
  }
}

// One run with a worktree of a repository holding `files`; `before(f)` adds what is outside it.
async function runIn(t, files, { agent = '', session = 'ephemeral', steps = 1, workingDir = '{{ worktree_dir }}', before = () => {}, type = 'claude-code', supervised = false } = {}) {
  const f = fixture(t, 'canonical');
  commitFiles(f.repo, files);
  before(f);
  liftSimulation(t);
  const record = path.join(f.tmp, 'calls.jsonl');
  const file = path.join(f.tmp, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: ${type}, command: node, args: ["${FAKE}", "--record", "${record.replace(/\\/g, '/')}", "-p"], resume_args: ["--resume", "{{ session_id }}"] }`,
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'orchestrator:',
    '  worktree: { repo: "{{ inputs.repo_path }}", base: main }',
    ...(supervised ? ['  supervisor: { enabled: true, max_interventions: 1, max_total: 1 }'] : []),
    'agents:',
    `  dev: { provider: claude, model: fake, session: ${session}, ${workingDir ? `working_dir: "${workingDir}", ` : ''}capabilities: { tools: [read] }${agent} }`,
    'steps:',
    ...Array.from({ length: steps }, (_, i) => `  - { id: work${i + 1}, agent: dev, supervise: ${supervised}, prompt: "Do it."${supervised ? ', output_schema: { type: object, required: [verdict], properties: { verdict: { type: string } } }' : ''} }`),
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: { repo_path: f.repo }, runsDir: path.join(f.tmp, 'runs'), worktreesDir: f.worktrees, skillsDirs: [path.join(__dirname, '..', '..', '..', 'skills')] });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const calls = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { f, events, finished, calls };
}

const reached = (call) => `${call.stdin}\n${call.system}`;
const count = (text, part) => text.split(part).length - 1;
const seen = (r, markers) => {
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.equal(r.calls.length >= 1, true, 'the CLI ran');
  return Object.fromEntries(markers.map((m) => [m, count(reached(r.calls[0]), m)]));
};

// ---- the instructions are back ----------------------------------------------------------------------

test('#45 CLAUDE.md that imports AGENTS.md: the agent starts with both, each once, from the worktree\'s commit', { timeout: 60000 }, async (t) => {
  const r = await runIn(t, { 'CLAUDE.md': 'MARK-CLAUDE\n@AGENTS.md\n', 'AGENTS.md': 'MARK-AGENTS ask @someone\n' }, {
    before: (f) => fs.writeFileSync(path.join(f.repo, 'AGENTS.md'), 'MARK-OWNER-DIRTY\n'),
  });
  assert.deepEqual(seen(r, ['MARK-CLAUDE', 'MARK-AGENTS', 'MARK-OWNER-DIRTY']), { 'MARK-CLAUDE': 1, 'MARK-AGENTS': 1, 'MARK-OWNER-DIRTY': 0 });
});

test('#45 no CLAUDE.md: the agent starts with AGENTS.md', { timeout: 60000 }, async (t) => {
  const r = await runIn(t, { 'AGENTS.md': 'MARK-AGENTS\n' });
  assert.deepEqual(seen(r, ['MARK-AGENTS']), { 'MARK-AGENTS': 1 });
});

test('#45 a CLAUDE.md that does not import AGENTS.md: only CLAUDE.md', { timeout: 60000 }, async (t) => {
  const r = await runIn(t, { 'CLAUDE.md': 'MARK-CLAUDE\n', 'AGENTS.md': 'MARK-AGENTS\n' });
  assert.deepEqual(seen(r, ['MARK-CLAUDE', 'MARK-AGENTS']), { 'MARK-CLAUDE': 1, 'MARK-AGENTS': 0 });
});

test('#45 nested imports resolve from the importing file, and an import cycle ends with each file once', { timeout: 60000 }, async (t) => {
  const r = await runIn(t, {
    'CLAUDE.md': 'MARK-CLAUDE\n@docs/rules.md\n',
    'docs/rules.md': 'MARK-RULES\n@more.md\n',
    'docs/more.md': 'MARK-MORE\n@../CLAUDE.md\n',
  });
  assert.deepEqual(seen(r, ['MARK-CLAUDE', 'MARK-RULES', 'MARK-MORE']), { 'MARK-CLAUDE': 1, 'MARK-RULES': 1, 'MARK-MORE': 1 });
});

test('#45 a resumed turn does not load the instructions twice', { timeout: 60000 }, async (t) => {
  const r = await runIn(t, { 'AGENTS.md': 'MARK-AGENTS\n' }, { session: 'persistent', steps: 2 });
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.equal(r.calls.length, 2);
  assert.equal(r.calls[0].resumed, null);
  assert.ok(r.calls[1].resumed, 'the second step resumes the session');
  // the conversation the resumed turn sends: both prompts and this turn's own system prompt
  assert.equal(count(`${r.calls[0].stdin}\n${r.calls[1].stdin}\n${r.calls[1].system}`, 'MARK-AGENTS'), 1);
});

test('#45 every fresh session of a run starts with the instructions', { timeout: 60000 }, async (t) => {
  const r = await runIn(t, { 'AGENTS.md': 'MARK-AGENTS\n' }, { session: 'ephemeral', steps: 2 });
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.deepEqual(r.calls.map((c) => [c.resumed, count(reached(c), 'MARK-AGENTS')]), [[null, 1], [null, 1]]);
});

// ---- SEC-3 ------------------------------------------------------------------------------------------

test('#45 the checkout\'s settings stay out (no hook runs, no permissions.allow) while its instructions load', { timeout: 60000 }, async (t) => {
  const settings = (marker) => JSON.stringify({
    permissions: { allow: [`Bash(${marker}:*)`] },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node .claude/hook.js ${marker}` }] }] },
  });
  const hooked = [];
  const r = await runIn(t, {
    'AGENTS.md': 'MARK-AGENTS\n',
    '.claude/hook.js': 'require("fs").writeFileSync(require("path").join(__dirname, "..", "..", `hook-ran-${process.argv[2]}`), "x");\n',
    '.claude/settings.json': settings('MARK-PROJECT'),
    '.claude/settings.local.json': settings('MARK-LOCAL'),
  });
  assert.deepEqual(seen(r, ['MARK-AGENTS', 'MARK-PROJECT', 'MARK-LOCAL']), { 'MARK-AGENTS': 1, 'MARK-PROJECT': 0, 'MARK-LOCAL': 0 });
  const call = r.calls[0];
  for (const dir of [r.f.tmp, r.f.worktrees, path.dirname(call.cwd)]) hooked.push(...fs.readdirSync(dir).filter((n) => n.startsWith('hook-ran-')));
  assert.deepEqual(hooked, []);
  assert.deepEqual(call.allow, []);
  assert.deepEqual(call.sources, []);
  for (const flag of ['--strict-mcp-config', '--disable-slash-commands']) assert.ok(call.argv.includes(flag), flag);
  assert.equal(call.argv.join(' ').includes('MARK-LOCAL') || call.argv.join(' ').includes('MARK-PROJECT'), false, 'nothing of the settings reaches the arguments');
});

test('#45 an agent that is not isolated gets no second copy from the engine (its CLI loads its own)', { timeout: 60000 }, async (t) => {
  const r = await runIn(t, { 'CLAUDE.md': 'MARK-CLAUDE\n' }, { agent: ', isolation: false' });
  assert.deepEqual(seen(r, ['MARK-CLAUDE']), { 'MARK-CLAUDE': 0 });
});

// ---- only the repository's --------------------------------------------------------------------------

test('#45 instruction files above the worktree and in the home folder are not loaded, only the repository\'s', { timeout: 60000 }, async (t) => {
  const r = await runIn(t, { 'AGENTS.md': 'MARK-REPO\n' }, {
    before: (f) => {
      fs.mkdirSync(f.worktrees, { recursive: true });
      for (const [dir, m] of [[f.tmp, 'MARK-WORKSPACE'], [f.worktrees, 'MARK-WORKTREES']]) {
        for (const name of ['AGENTS.md', 'CLAUDE.md']) fs.writeFileSync(path.join(dir, name), `${m}\n`);
      }
      const home = path.join(f.tmp, 'home');
      fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
      for (const file of ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md']) fs.writeFileSync(path.join(home, file), 'MARK-HOME\n');
      for (const k of ['HOME', 'USERPROFILE']) {
        const v = process.env[k];
        process.env[k] = home;
        t.after(() => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
      }
    },
  });
  assert.deepEqual(seen(r, ['MARK-REPO', 'MARK-WORKSPACE', 'MARK-WORKTREES', 'MARK-HOME']), { 'MARK-REPO': 1, 'MARK-WORKSPACE': 0, 'MARK-WORKTREES': 0, 'MARK-HOME': 0 });
});

test('#45 a repository with no instructions, and an agent in the run folder, load nothing from the folders above', { timeout: 60000 }, async (t) => {
  for (const workingDir of ['{{ worktree_dir }}', '']) {
    const r = await runIn(t, {}, {
      workingDir,
      before: (f) => {
        fs.mkdirSync(f.worktrees, { recursive: true });
        for (const dir of [f.tmp, f.worktrees]) for (const name of ['AGENTS.md', 'CLAUDE.md']) fs.writeFileSync(path.join(dir, name), 'MARK-ABOVE\n');
      },
    });
    assert.deepEqual(seen(r, ['MARK-ABOVE']), { 'MARK-ABOVE': 0 }, workingDir || 'run folder');
  }
});

test('#45 an import that leaves the repository (.., the home folder, an absolute path) is not followed', { timeout: 60000 }, async (t) => {
  const f0 = fixture(t, 'canonical');
  const outside = path.join(f0.tmp, 'outside.md');
  fs.writeFileSync(outside, 'MARK-ABSOLUTE\n');
  const r = await runIn(t, { 'CLAUDE.md': `MARK-CLAUDE\n@../above.md\n@~/home.md\n@${outside}\n@docs/in.md\n`, 'docs/in.md': 'MARK-IN\n@../../above.md\n' }, {
    before: (f) => {
      fs.mkdirSync(f.worktrees, { recursive: true });
      fs.writeFileSync(path.join(f.worktrees, 'above.md'), 'MARK-ABOVE\n');
      const home = path.join(f.tmp, 'home');
      fs.mkdirSync(home);
      fs.writeFileSync(path.join(home, 'home.md'), 'MARK-HOME\n');
      for (const k of ['HOME', 'USERPROFILE']) {
        const v = process.env[k];
        process.env[k] = home;
        t.after(() => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
      }
    },
  });
  assert.deepEqual(seen(r, ['MARK-CLAUDE', 'MARK-IN', 'MARK-ABOVE', 'MARK-HOME', 'MARK-ABSOLUTE']), { 'MARK-CLAUDE': 1, 'MARK-IN': 1, 'MARK-ABOVE': 0, 'MARK-HOME': 0, 'MARK-ABSOLUTE': 0 });
});

test('#45 a link that leaves the repository is not followed, as an import or as the root file; a link inside it is', { timeout: 60000, skip: process.platform === 'win32' && 'symlinks need a privilege on Windows' }, async (t) => {
  const f0 = fixture(t, 'canonical');
  fs.writeFileSync(path.join(f0.tmp, 'secret.md'), 'MARK-SECRET\n');
  const imports = await runIn(t, { 'AGENTS.md': 'MARK-AGENTS\n', 'CLAUDE.md': 'MARK-CLAUDE\n@link.md\n@dir/secret.md\n', 'link.md': { link: path.join(f0.tmp, 'secret.md') }, dir: { link: f0.tmp } });
  assert.deepEqual(seen(imports, ['MARK-CLAUDE', 'MARK-SECRET']), { 'MARK-CLAUDE': 1, 'MARK-SECRET': 0 });
  const root = await runIn(t, { 'CLAUDE.md': { link: path.join(f0.tmp, 'secret.md') } });
  assert.deepEqual(seen(root, ['MARK-SECRET']), { 'MARK-SECRET': 0 });
  const inside = await runIn(t, { 'AGENTS.md': 'MARK-AGENTS\n', 'CLAUDE.md': { link: 'AGENTS.md' } });
  assert.deepEqual(seen(inside, ['MARK-AGENTS']), { 'MARK-AGENTS': 1 });
});

// ---- the other agents keep what they load today ------------------------------------------------------

test('#45 a Codex agent gets nothing from the engine: its CLI loads AGENTS.md by itself', { timeout: 60000 }, async (t) => {
  const r = await runIn(t, { 'AGENTS.md': 'MARK-AGENTS\n' }, { type: 'codex-cli' });
  const spawn = r.events.find((e) => e.type === 'session.stream' && e.item.kind === 'spawn');
  assert.ok(spawn, 'the CLI started');
  const sent = r.events.filter((e) => e.type === 'session.message_sent').map((e) => e.prompt).join('\n');
  assert.equal(count(sent, 'MARK-AGENTS') + count(JSON.stringify(spawn.item.args), 'MARK-AGENTS'), 0);
});

test('#45 the supervisor of a run, in the run folder, gets none of the repository\'s instructions', { timeout: 60000 }, async (t) => {
  // the fake's answer has no JSON: the step fails and its supervisor is called
  const r = await runIn(t, { 'AGENTS.md': 'MARK-AGENTS\n' }, { supervised: true });
  const isSupervisor = (c) => c.stdin.includes('You are the run supervisor');
  const calls = r.calls.filter(isSupervisor);
  assert.equal(calls.length >= 1, true, 'the supervisor\'s CLI ran');
  for (const c of calls) {
    assert.equal(count(reached(c), 'MARK-AGENTS'), 0);
    assert.deepEqual(c.sources, []);
  }
});

test('#45 the Oracle loads no instruction file of the folder it runs in', { timeout: 60000 }, async (t) => {
  const { tmp } = fixture(t, 'canonical');
  const dir = path.join(tmp, 'oracle');
  fs.mkdirSync(dir);
  for (const d of [tmp, dir]) for (const name of ['AGENTS.md', 'CLAUDE.md']) fs.writeFileSync(path.join(d, name), 'MARK-FOLDER\n');
  liftSimulation(t);
  const { PROVIDERS } = require('../domains/workflow/workflow-builder');
  const saved = { command: PROVIDERS.claude.command, args: PROVIDERS.claude.args };
  const record = path.join(tmp, 'calls.jsonl');
  Object.assign(PROVIDERS.claude, { command: process.execPath, args: [FAKE, '--record', record] });
  const o = require('../domains/oracle/oracle').createOracle({
    dir: () => dir,
    tools: () => [],
    bridge: { start: async () => ({ url: 'http://127.0.0.1:9', token: 'test-token-45' }) },
    mcpCommand: () => ({ command: process.execPath, args: ['-e', ''], env: {} }),
    skillsDirs: () => [],
    resolveCommand: () => true,
    refuseReal: () => {},
    agent: () => ({ model: 'claude-opus-5-5', effort: 'high' }),
    settings: () => ({ oracle: { dailyBudgetUsd: 5 } }),
  });
  t.after(() => { o.release(); Object.assign(PROVIDERS.claude, saved); });
  await o.ask({ question: 'What happened?', mock: false });
  const call = JSON.parse(fs.readFileSync(record, 'utf8').split('\n')[0]);
  assert.equal(count(reached(call) + JSON.stringify(call.argv), 'MARK-FOLDER'), 0);
  assert.deepEqual(call.sources, []);
});

// the turn of an internal agent, stubbed at providers.runTurn: what its CLI would be given
function stubTurn(t, text) {
  const providers = require('../engine/providers');
  const original = providers.runTurn;
  t.after(() => { providers.runTurn = original; });
  const turns = [];
  providers.runTurn = async (opts) => { turns.push(opts); return { text, costUsd: 0, usage: {} }; };
  return turns;
}

test('#45 the supervisor chat loads no instruction file of the folder it runs in', async (t) => {
  const { tmp } = fixture(t, 'canonical');
  for (const name of ['AGENTS.md', 'CLAUDE.md']) fs.writeFileSync(path.join(tmp, name), 'MARK-FOLDER\n');
  const turns = stubTurn(t, 'ok');
  const { createSupervisorChat } = require('../domains/supervisor/supervisor-chat');
  const chat = createSupervisorChat({
    dir: () => tmp,
    tools: () => [],
    bridge: { start: async () => ({ url: 'http://127.0.0.1:9', token: 'test-token-45' }) },
    mcpCommand: () => ({ command: process.execPath, args: ['-e', ''], env: {} }),
    skillsDirs: () => [],
    resolveCommand: () => true,
    refuseReal: () => {},
  });
  await chat.ask({ question: 'Where am I?', mock: false });
  assert.equal(turns.length, 1, 'the turn ran');
  assert.equal(count(turns[0].prompt + JSON.stringify(turns[0].extraArgs), 'MARK-FOLDER'), 0);
  assert.equal(turns[0].extraArgs.includes('--append-system-prompt-file'), false);
  assert.equal(turns[0].extraArgs[turns[0].extraArgs.indexOf('--setting-sources') + 1], '');
});

test('#45 the Product Owner loads no instruction file of the project folder', async (t) => {
  const { tmp } = fixture(t, 'canonical');
  const at = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d); return d; };
  const folder = at('project');
  for (const name of ['AGENTS.md', 'CLAUDE.md']) fs.writeFileSync(path.join(folder, name), 'MARK-FOLDER\n');
  const turns = stubTurn(t, '```json\n{"summary":"The plan.","groups":[],"conflicts":[],"enrich":[]}\n```');
  const ROOT = path.join(__dirname, '..', '..', '..');
  await require('../domains/po/product-owner').ask({
    backlogDir: at('backlog'), runsDir: at('runs'), folder, projectId: 'demo',
    data: { projectId: 'demo', issues: [{ number: 1, state: 'open', title: 'Login page', labels: [], body: 'x' }] },
    activeRuns: [], runs: [], workflows: [], skillsDirs: [path.join(ROOT, 'skills')], resolveCommand: () => 'claude',
    agent: { model: 'claude-opus-5-5', effort: 'high' }, mock: false, mode: 'plan', question: 'Plan',
  });
  assert.equal(turns.length >= 1, true, 'the turn ran');
  for (const turn of turns) {
    assert.equal(count(turn.prompt + JSON.stringify(turn.extraArgs), 'MARK-FOLDER'), 0);
    assert.equal(turn.extraArgs.includes('--append-system-prompt-file'), false);
    assert.equal(turn.extraArgs[turn.extraArgs.indexOf('--setting-sources') + 1], '');
  }
});

// ---- visible ----------------------------------------------------------------------------------------

test('#45 the session records which instruction files it started with, by their path in the repository', { timeout: 60000 }, async (t) => {
  const r = await runIn(t, { 'CLAUDE.md': 'MARK-CLAUDE\n@AGENTS.md\n@docs/rules.md\n', 'AGENTS.md': 'MARK-AGENTS\n', 'docs/rules.md': 'MARK-RULES\n', 'docs/other.md': 'MARK-OTHER\n' });
  assert.equal(r.finished.status, 'success', r.finished.error);
  const id = r.events.find((e) => e.type === 'session.stream' && e.item.kind === 'spawn').session_id;
  // what the prompt, the answer and the arguments say does not count: a record of its own does
  const said = r.events.filter((e) => e.session_id === id)
    .map((e) => JSON.stringify(e, (k, v) => (['prompt', 'text', 'args', 'system', 'content'].includes(k) ? undefined : v)).replace(/\\\\/g, '/'))
    .filter((s) => s.includes('CLAUDE.md'));
  assert.equal(said.length >= 1, true, 'no event of the session names its instruction files');
  for (const file of ['AGENTS.md', 'docs/rules.md']) assert.ok(said.some((s) => s.includes(file)), file);
  assert.equal(said.some((s) => s.includes('docs/other.md')), false, 'a file that was not loaded is not listed');
});
