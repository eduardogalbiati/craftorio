// #45, internals of packages/engine/engine/project-instructions.js (what counts as an import, what is
// refused, where an agent has a repository) and the Claude adapter's flag; and one run whose worktree
// starts from the pushed base, with the workflow's own appended system prompt and a simulation.
// The behaviour of a run is in claude-project-instructions.test.js. No model call.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const capabilities = require('../engine/capabilities');
const { composeInstructions, instructionsRoot } = require('../engine/project-instructions');
const { WorkflowRun } = require('../engine/workflow');
const { commit, fixture, scratch } = require('./worktree-helpers');

const FAKE = path.join(__dirname, 'fixtures', 'fake-claude-instructions.js').replace(/\\/g, '/');

function repository(t, files) {
  const root = path.join(scratch(t, 'canonical'), 'repo');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('#45 an import in code or in an HTML comment is text; one in a sentence is followed', (t) => {
  const root = repository(t, {
    'CLAUDE.md': 'Read @docs/a.md, then\n```\n@docs/fenced.md\n```\nuse `@docs/inline.md` <!-- @docs/comment.md -->\n~~~sh\n@docs/fenced.md\n~~~\nsee (me@docs/mail.md) and @docs/b.md.\n',
    ...Object.fromEntries(['a', 'b', 'comment', 'fenced', 'inline', 'mail'].map((n) => [`docs/${n}.md`, `TEXT-${n}\n`])),
  });
  assert.deepEqual(composeInstructions(root).files, ['CLAUDE.md', 'docs/a.md', 'docs/b.md']);
});

test('#45 a hostile file (long runs of backticks, unclosed fences and comments) is scanned in linear time', { timeout: 20000 }, (t) => {
  const root = repository(t, { 'CLAUDE.md': `${'`'.repeat(300000)}\n${'<!--'.repeat(50000)}-->\n@a.md\n@${'.'.repeat(300000)}x\n${'~~~'.repeat(100000)}`, 'a.md': 'A\n' });
  assert.deepEqual(composeInstructions(root).files, ['CLAUDE.md']); // the opening run of backticks is an unclosed fence
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `x ${'`'.repeat(300000)}\n@a.md\n@${'.'.repeat(300000)}x\n`);
  assert.deepEqual(composeInstructions(root).files, ['CLAUDE.md', 'a.md']);
});

test('#45 an absolute import inside the repository is followed; .git, a folder, a binary and a missing file are not', (t) => {
  const root = repository(t, { 'docs/in.md': 'IN\n', '.git/config': 'SECRET\n', 'data.bin': 'a\0b' });
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `@${path.join(root, 'docs', 'in.md')}\n@.git/config\n@docs\n@data.bin\n@someone\n`);
  const r = composeInstructions(root);
  assert.deepEqual(r.files, ['CLAUDE.md', 'docs/in.md']);
  assert.deepEqual(r.refused, ['CLAUDE.md: @.git/config']);
  assert.equal(r.text.includes('SECRET'), false);
});

test('#45 the refused imports say which file asked for them', (t) => {
  const root = repository(t, { 'CLAUDE.md': '@docs/in.md\n@~/home.md\n', 'docs/in.md': '@../../above.md\n' });
  assert.deepEqual(composeInstructions(root).refused, ['docs/in.md: @../../above.md', 'CLAUDE.md: @~/home.md']);
});

test('#45 imports stop after five hops', (t) => {
  const root = repository(t, { 'CLAUDE.md': '@h1.md\n', ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`h${n}.md`, `@h${n + 1}.md\n`])) });
  assert.deepEqual(composeInstructions(root).files, ['CLAUDE.md', 'h1.md', 'h2.md', 'h3.md', 'h4.md', 'h5.md']);
});

test('#45 no instruction file: nothing composed', (t) => {
  assert.deepEqual(composeInstructions(repository(t, { 'a.txt': 'a' })), { files: [], text: '', refused: [] });
});

test('#45 the root is the repository folder that holds the agent\'s, and none in the run folder', (t) => {
  const root = repository(t, { 'pkg/a.txt': 'a', 'runs/r1/x': 'x' });
  const runDir = path.join(root, 'runs', 'r1');
  const where = { runDir, roots: [undefined, '', root] };
  assert.equal(instructionsRoot(path.join(root, 'pkg'), where), root);
  assert.equal(instructionsRoot(runDir, where), null);
  assert.equal(instructionsRoot(path.dirname(root), where), null);
});

test('#45 providerArgs: the flag only for an isolated Claude agent with a file, beside the empty setting sources', () => {
  const args = (type, o) => capabilities.providerArgs(type, o).args;
  const claude = args('claude-code', { instructionsFile: '/r/i.md' });
  assert.equal(claude[claude.indexOf('--append-system-prompt-file') + 1], '/r/i.md');
  assert.equal(claude[claude.indexOf('--setting-sources') + 1], '');
  for (const [type, o] of [['claude-code', {}], ['claude-code', { isolated: false, instructionsFile: '/r/i.md' }], ['codex-cli', { instructionsFile: '/r/i.md' }], ['grok-cli', { instructionsFile: '/r/i.md' }]]) {
    assert.equal(args(type, o).includes('--append-system-prompt-file'), false, `${type} ${JSON.stringify(o)}`);
  }
});

// One run in a worktree of the local base (or, worktree: false, in the project's folder), whose CLAUDE.md
// imports docs/rules.md; `onEvent(ev, f)` sees the run's events as they happen.
async function run(t, { agent = '', mock = false, session = 'ephemeral', steps = 1, worktree = true, inputs = () => ({}), workingDir = '{{ worktree_dir }}', resume = undefined, onEvent = () => {} } = {}) {
  const f = fixture(t, 'canonical');
  fs.mkdirSync(path.join(f.repo, 'docs'));
  commit(f.repo, 'docs/rules.md', 'MARK-RULES\n');
  commit(f.repo, 'CLAUDE.md', 'MARK-CLAUDE\n@docs/rules.md\n');
  fs.mkdirSync(path.join(f.repo, 'pkg'));
  commit(f.repo, 'pkg/CLAUDE.md', 'MARK-PKG\n');
  for (const k of ['CRAFTORIO_SIMULATION_ONLY', 'CRAFTORIO_WORKSPACE', 'CRAFTORIO_USER_DATA']) {
    const v = process.env[k];
    delete process.env[k];
    t.after(() => { if (v !== undefined) process.env[k] = v; });
  }
  const record = path.join(f.tmp, 'calls.jsonl').replace(/\\/g, '/');
  const file = path.join(f.tmp, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${FAKE}", "--record", "${record}", "-p"], resume_args: ["--resume", "{{ session_id }}"] }`,
    'inputs:',
    '  repo_path: { type: string, default: "" }',
    '  project_path: { type: string, default: "" }',
    ...(worktree ? ['orchestrator:', '  worktree: { repo: "{{ inputs.repo_path }}", base: main, remote: false }'] : []),
    'agents:',
    `  dev: { provider: claude, model: fake, session: ${session}, working_dir: "${workingDir}", capabilities: { tools: [read] }${agent} }`,
    'steps:',
    ...Array.from({ length: steps }, (_, i) => `  - { id: work${i + 1}, agent: dev, prompt: "Do it." }`),
  ].join('\n'));
  const r = new WorkflowRun({ file, inputs: { repo_path: f.repo, ...inputs(f) }, mock, resume, runsDir: path.join(f.tmp, 'runs'), worktreesDir: mock ? undefined : f.worktrees, skillsDirs: [] });
  const events = [];
  r.on('event', (ev) => { events.push(ev); onEvent(ev, f); });
  await r.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const calls = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { calls, events, said: events.filter((e) => e.type === 'log' && e.kind === 'instructions'), closed: events.find((e) => e.type === 'session.closed' && e.session.agent === 'dev') };
}

test('#45 the composed file is in the run folder, and the log and the session record list its files', { timeout: 60000 }, async (t) => {
  const r = await run(t);
  assert.match(r.calls[0].system, /MARK-CLAUDE[\s\S]*MARK-RULES/);
  assert.deepEqual(r.said.map((e) => [e.level, e.files, e.refused]), [['info', ['CLAUDE.md', 'docs/rules.md'], []]]);
  assert.deepEqual(r.closed.session.instructions, ['CLAUDE.md', 'docs/rules.md']);
});

test('#45 the workflow\'s own appended system prompt stays the CLI\'s only one, and the log warns', { timeout: 60000 }, async (t) => {
  const r = await run(t, { agent: ', cli_args: ["--append-system-prompt", "OWN"]' });
  assert.equal(r.calls[0].system, 'OWN');
  assert.deepEqual(r.said.map((e) => [e.level, e.files]), [['warn', []]]);
  assert.deepEqual(r.closed.session.instructions, []);
});

test('#45 a simulated run composes nothing', { timeout: 60000 }, async (t) => {
  const r = await run(t, { mock: true });
  assert.deepEqual(r.said, []);
  assert.equal('instructions' in r.closed.session, false);
});

test('#45 a session keeps the instructions it started with, on every turn, when the files change in between', { timeout: 60000 }, async (t) => {
  let changed = 0;
  const r = await run(t, {
    session: 'persistent', steps: 2,
    onEvent: (ev, f) => {
      if (ev.type !== 'step.finished' || ev.step_id !== 'work1') return;
      fs.writeFileSync(path.join(f.worktrees, fs.readdirSync(f.worktrees)[0], 'CLAUDE.md'), 'MARK-CHANGED\n');
      changed++;
    },
  });
  assert.equal(changed, 1);
  assert.equal(r.calls.length, 2);
  assert.equal(!!r.calls[1].resumed, true, 'the second step resumes the session');
  assert.equal(r.calls[1].system, r.calls[0].system);
  assert.match(r.calls[1].system, /MARK-CLAUDE[\s\S]*MARK-RULES/);
  assert.equal(r.said.length, 1, 'said once per session');
});

test('#45 a resumed run that continues the agent\'s conversation passes the instructions again, and says so', { timeout: 60000 }, async (t) => {
  const r = await run(t, { session: 'persistent', resume: { runId: 'previous', fromStep: 'work1', steps: {}, sessions: { dev: '00000000-0000-4000-8000-000000000001' } } });
  assert.equal(r.calls[0].resumed, '00000000-0000-4000-8000-000000000001');
  assert.equal(r.calls[0].system.split('MARK-CLAUDE').length - 1, 1);
  assert.equal(r.calls[0].stdin.includes('MARK-CLAUDE'), false);
  assert.deepEqual(r.said.map((e) => e.files), [['CLAUDE.md', 'docs/rules.md']]);
});

test('#45 a run with no worktree: the instructions of the project folder the agent works in', { timeout: 60000 }, async (t) => {
  const r = await run(t, { worktree: false, workingDir: '{{ inputs.project_path }}', inputs: (f) => ({ repo_path: '', project_path: f.repo }) });
  assert.deepEqual(r.said.map((e) => e.files), [['CLAUDE.md', 'docs/rules.md']]);
  assert.match(r.calls[0].system, /MARK-CLAUDE[\s\S]*MARK-RULES/);
});

test('#45 a project in a subfolder of its repository: the worktree\'s root instructions, not the folder\'s', { timeout: 60000 }, async (t) => {
  const r = await run(t, { inputs: (f) => ({ repo_path: path.join(f.repo, 'pkg') }) });
  assert.equal(path.basename(r.calls[0].cwd), 'pkg', 'the agent works in the subfolder');
  assert.deepEqual(r.said.map((e) => e.files), [['CLAUDE.md', 'docs/rules.md']]);
  assert.equal(r.calls[0].system.includes('MARK-PKG'), false);
});

test('#45 a folder that no project root of the run holds: nothing, and the log says so', { timeout: 60000 }, async (t) => {
  const r = await run(t, { worktree: false, workingDir: '{{ inputs.project_path }}/..', inputs: (f) => ({ repo_path: '', project_path: f.repo }) });
  assert.equal(r.calls[0].system, '');
  assert.deepEqual(r.said.map((e) => [e.files, e.message.includes('none')]), [[[], true]]);
});

test('#45 a CLAUDE.md that links out of the repository counts as missing: AGENTS.md is used and the link reported', { skip: process.platform === 'win32' && 'symlinks need a privilege on Windows' }, (t) => {
  const root = repository(t, { 'AGENTS.md': 'AGENTS\n' });
  fs.writeFileSync(path.join(path.dirname(root), 'secret.md'), 'SECRET\n');
  fs.symlinkSync('../secret.md', path.join(root, 'CLAUDE.md'));
  const r = composeInstructions(root);
  assert.deepEqual([r.files, r.refused, r.text.includes('SECRET')], [['AGENTS.md'], ['CLAUDE.md'], false]);
});
