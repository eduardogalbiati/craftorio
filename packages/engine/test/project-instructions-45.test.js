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

// One run in a worktree of the pushed base, whose CLAUDE.md imports docs/rules.md
async function run(t, { agent = '', mock = false } = {}) {
  const f = fixture(t, 'canonical');
  fs.mkdirSync(path.join(f.repo, 'docs'));
  commit(f.repo, 'docs/rules.md', 'MARK-RULES\n');
  commit(f.repo, 'CLAUDE.md', 'MARK-CLAUDE\n@docs/rules.md\n');
  for (const k of ['CRAFTORIO_SIMULATION_ONLY', 'CRAFTORIO_WORKSPACE', 'CRAFTORIO_USER_DATA']) {
    const v = process.env[k];
    delete process.env[k];
    t.after(() => { if (v !== undefined) process.env[k] = v; });
  }
  const record = path.join(f.tmp, 'calls.jsonl').replace(/\\/g, '/');
  const file = path.join(f.tmp, 'wf.yaml');
  fs.writeFileSync(file, [
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${FAKE}", "--record", "${record}", "-p"] }`,
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'orchestrator:',
    '  worktree: { repo: "{{ inputs.repo_path }}", base: main, remote: false }',
    'agents:',
    `  dev: { provider: claude, model: fake, session: ephemeral, working_dir: "{{ worktree_dir }}", capabilities: { tools: [read] }${agent} }`,
    'steps:',
    '  - { id: work, agent: dev, prompt: "Do it." }',
  ].join('\n'));
  const r = new WorkflowRun({ file, inputs: { repo_path: f.repo }, mock, runsDir: path.join(f.tmp, 'runs'), worktreesDir: mock ? undefined : f.worktrees, skillsDirs: [] });
  const events = [];
  r.on('event', (ev) => events.push(ev));
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
