// #116: a developer commits in the run's worktree; a develop step that leaves no commit fails at once.
// Acceptance tests written before the code.
//
// Contract (the interface these tests assume):
// - After a develop step (a step `develop` whose agent writes), the run's worktree must be on a branch with
//   everything committed. A worktree still detached, or with uncommitted changes, fails THAT step (the run
//   ends `failed`, nothing after it runs) with a cause that says "did not commit" and why (detached / no
//   branch, or the files left uncommitted), for every provider. The cause has an interface-language
//   text in the catalogs (packages/shared/i18n, en + pt-BR).
// - The develop step's recorded output carries the worktree's real branch (git), never the agent's free text.
// - A Codex writing turn in a linked worktree keeps `-s workspace-write` (never danger-full-access) and
//   gets the worktree's git dir and the repository's common git dir as writable roots
//   (`-c sandbox_workspace_write.writable_roots=[...]` or `--add-dir <dir>`); a read-only Codex agent gets none.
// Seam: mock runs (no real CLI) of a small workflow in throwaway repositories with a real linked worktree
// (worktree-helpers.js). The agent's work is played on the worktree when its turn is sent; the CLI's
// arguments are read at the process boundary (providers.runTurn).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fixture, git, commit } = require('./worktree-helpers');
const { tempWorkflow } = require('./engine-helpers');
const { WorkflowRun } = require('../engine/workflow');
const providers = require('../engine/providers');

const LIMIT = { timeout: 90000 };
const TYPES = { claude: 'claude-code', codex: 'codex-cli' };

const yaml = (provider) => [
  'apiVersion: craftorio/v1',
  'kind: Workflow',
  'metadata:',
  '  name: fixture-develop-116',
  'inputs:',
  '  repo_path: { type: string, required: true }',
  '  base_branch: { type: string, default: main }',
  'orchestrator:',
  '  worktree:',
  '    repo: "{{ inputs.repo_path }}"',
  '    base: "{{ inputs.base_branch }}"',
  'providers:',
  `  ai: { type: ${TYPES[provider]}, command: ${provider} }`,
  'defaults:',
  '  working_dir: "{{ worktree_dir }}"',
  'agents:',
  '  developer: { provider: ai, model: m, session: ephemeral, capabilities: { tools: [read, edit, write, bash:git] } }',
  '  reviewer: { provider: ai, model: m, session: ephemeral, capabilities: { tools: [read, bash:git] } }',
  'steps:',
  '  - id: develop',
  '    agent: developer',
  '    prompt: "Implement the change in {{ worktree_dir }}."',
  '    output_schema: { type: object, required: [branch, committed, summary], properties: { branch: { type: string }, committed: { type: boolean }, summary: { type: string } } }',
  '  - id: review',
  '    agent: reviewer',
  '    prompt: "Review the change."',
  '',
].join('\n');

// onDevelop(worktreeDir): what the developer does in its turn
async function runDevelop(t, { provider = 'claude', onDevelop = () => {} } = {}) {
  const f = fixture(t, 'canonical');
  const { file } = tempWorkflow(t, yaml(provider));
  const run = new WorkflowRun({ file, inputs: { repo_path: f.repo }, mock: true, runsDir: path.join(f.tmp, 'runs'), worktreesDir: f.worktrees, skillsDirs: [] });
  const events = [];
  let dir = null;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'worktree.ready') dir = ev.work_dir || ev.dir;
    if (ev.type === 'session.message_sent' && String(ev.step_id).split(':')[0] === 'develop') onDevelop(dir);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, false));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const ran = (id) => events.some((e) => e.type === 'session.message_sent' && String(e.step_id).split(':')[0] === id);
  // every text of the run but the prompts (a prompt may tell the agent to commit)
  const said = JSON.stringify(events.filter((e) => e.type !== 'session.message_sent'));
  return { f, events, finished, ran, said, dir: () => dir };
}

// ---- caught at the step ----------------------------------------------------------------------------

for (const provider of Object.keys(TYPES)) {
  test(`#116 ${provider}: a develop step that leaves the worktree detached with its change uncommitted fails at that step`, LIMIT, async (t) => {
    const r = await runDevelop(t, { provider, onDevelop: (d) => fs.writeFileSync(path.join(d, 'dirty-116.txt'), 'the change\n') });
    assert.equal(r.finished?.status, 'failed', 'the run fails');
    assert.match(r.said, /did not commit/i, 'the cause says the developer did not commit');
    assert.equal(r.ran('review'), false, 'nothing after develop runs');
  });
}

test('#116: a develop step that changes nothing and leaves the worktree detached fails with "did not commit" and the missing branch', LIMIT, async (t) => {
  const r = await runDevelop(t);
  assert.equal(r.finished?.status, 'failed');
  assert.match(r.said, /did not commit/i);
  assert.match(r.said, /detached|no branch|not on a branch/i, 'the cause names the missing branch');
  assert.equal(r.ran('review'), false);
});

test('#116: a develop step that makes the branch but leaves files uncommitted fails and names what is uncommitted', LIMIT, async (t) => {
  const r = await runDevelop(t, {
    onDevelop: (d) => {
      git(d, 'switch', '-q', '-c', 'feat/half-116');
      commit(d, 'done-116.txt', 'committed\n');
      fs.writeFileSync(path.join(d, 'dirty-116.txt'), 'left out\n');
    },
  });
  assert.equal(r.finished?.status, 'failed');
  assert.match(r.said, /did not commit/i);
  assert.match(r.said, /dirty-116\.txt|uncommitted/i, 'the cause says what was left uncommitted');
  assert.equal(r.ran('review'), false);
});

test('#116: the "did not commit" cause has an interface-language text in English and Portuguese', () => {
  const flat = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, String(v)]]));
  const read = (lang) => Object.fromEntries(flat(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'i18n', `${lang}.json`), 'utf8'))));
  const en = read('en');
  const pt = read('pt-BR');
  const keys = Object.keys(en).filter((k) => /did not commit/i.test(en[k]));
  assert.notEqual(keys.length, 0, 'an English catalog text says "did not commit"');
  for (const k of keys) {
    assert.equal(typeof pt[k], 'string', `pt-BR has ${k}`);
    assert.notEqual(pt[k].trim(), '', `pt-BR ${k} is not empty`);
    assert.notEqual(pt[k], en[k], `pt-BR ${k} is translated`);
  }
});

// ---- the real branch, and a committed change goes on --------------------------------------------------

test('#116: a develop step that commits on a branch goes on, and the run records the worktree\'s real branch, not the agent\'s text', LIMIT, async (t) => {
  const r = await runDevelop(t, {
    onDevelop: (d) => {
      git(d, 'switch', '-q', '-c', 'feat/real-116');
      commit(d, 'done-116.txt', 'committed\n');
    },
  });
  assert.equal(r.finished?.status, 'success', r.finished?.error);
  assert.equal(r.ran('review'), true, 'the review runs after a committed develop step');
  const developed = r.events.filter((e) => e.type === 'step.finished' && String(e.step_id).split(':')[0] === 'develop').at(-1);
  assert.equal(developed?.output?.branch, 'feat/real-116', 'the develop output carries the branch git reports');
  assert.equal(r.finished.summary?.worktree?.branch, 'feat/real-116');
});

// ---- Codex can commit: its sandbox's writable roots ----------------------------------------------------

// the CLI arguments of each turn, at the process boundary (the mock answers as usual)
function captureTurns(t) {
  const turns = [];
  const real = providers.runTurn;
  providers.runTurn = (opts) => {
    turns.push({ cwd: opts.cwd, args: [...(opts.extraArgs || [])] });
    return real(opts);
  };
  t.after(() => { providers.runTurn = real; });
  return turns;
}
const norm = (s) => String(s).replace(/\\\\/g, '/').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
// the folders a Codex turn may write besides its working folder
function writableRoots(args) {
  const roots = [];
  args.forEach((a, i) => {
    if (a === '--add-dir' && args[i + 1]) roots.push(norm(args[i + 1]));
    const m = /^sandbox_workspace_write\.writable_roots\s*=\s*\[(.*)\]$/s.exec(a);
    if (m) for (const q of m[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) roots.push(norm(q[1] ?? q[2]));
  });
  return roots;
}

test('#116 codex: a writing turn in the run\'s linked worktree may write the worktree\'s git dir and the common git dir, in workspace-write', LIMIT, async (t) => {
  const turns = captureTurns(t);
  let gitDir = null;
  let commonDir = null;
  const r = await runDevelop(t, {
    provider: 'codex',
    onDevelop: (d) => {
      gitDir = fs.realpathSync(git(d, 'rev-parse', '--absolute-git-dir'));
      commonDir = fs.realpathSync(path.resolve(d, git(d, 'rev-parse', '--git-common-dir')));
      git(d, 'switch', '-q', '-c', 'feat/codex-116');
      commit(d, 'done-116.txt', 'committed\n');
    },
  });
  assert.ok(gitDir && commonDir, 'the develop turn ran in a worktree');
  assert.notEqual(norm(gitDir), norm(commonDir), 'a linked worktree: its git dir is not the common one');
  const dev = turns.find((x) => norm(x.cwd) === norm(r.dir()));
  assert.ok(dev, 'a turn ran in the worktree');
  assert.equal(dev.args[dev.args.indexOf('-s') + 1], 'workspace-write');
  assert.equal(dev.args.join(' ').includes('danger-full-access'), false, 'never danger-full-access');
  const roots = writableRoots(dev.args);
  assert.ok(roots.includes(norm(gitDir)), `the worktree's git dir is writable (roots: ${roots.join(', ') || 'none'})`);
  assert.ok(roots.includes(norm(commonDir)), `the common git dir is writable (roots: ${roots.join(', ') || 'none'})`);
});

test('#116 codex: a read-only turn gets no writable roots', LIMIT, async (t) => {
  const turns = captureTurns(t);
  await runDevelop(t, {
    provider: 'codex',
    onDevelop: (d) => {
      git(d, 'switch', '-q', '-c', 'feat/codex-ro-116');
      commit(d, 'done-116.txt', 'committed\n');
    },
  });
  const ro = turns.filter((x) => x.args[x.args.indexOf('-s') + 1] === 'read-only');
  assert.notEqual(ro.length, 0, 'the reviewer ran read-only');
  for (const x of ro) assert.deepEqual(writableRoots(x.args), [], 'a read-only Codex turn writes nowhere');
});
