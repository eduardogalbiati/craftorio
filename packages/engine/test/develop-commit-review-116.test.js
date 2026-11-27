// #116 (review round): the develop commit check beyond the acceptance tests (develop-commit-116.test.js):
// - which steps are checked: the step's effective capabilities (defaults, agent, step on top), not an
//   ask_human question;
// - the cause: more than 10 uncommitted files ("and N more"), the screen's text in the interface language,
//   a git error while listing the changes (the step fails, it never passes);
// - the normal failure path: the on-call supervisor retries with an instruction and the developer commits;
//   a supervisor's fixed output on a still uncommitted worktree is checked again (on_error, or the run fails);
// - prepareWorktree's gitDir / commonDir (#116: the Codex writable roots) are canonical paths.
// Seam: mock runs in throwaway repositories with a real linked worktree (worktree-helpers.js); the agents'
// answers are scripted through run.sendToAgent (as agent-asks-human-567 and the supervisor tests do) and play
// the agent's git work on the worktree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fixture, git, commit } = require('./worktree-helpers');
const { tempWorkflow } = require('./engine-helpers');
const { WorkflowRun } = require('../engine/workflow');
const { prepareWorktree } = require('../engine/worktree');
const I18n = require('@craftorio/shared/i18n');

const LIMIT = { timeout: 90000 };
const WRITER = '{ tools: [read, edit, write, bash:git] }';
const READER = '{ tools: [read, bash:git] }';

// defaultsCaps / agentCaps / stepCaps: capabilities lines; supervisor: on-call supervisor on; onError: a
// `handle` step takes the failure; askHuman: develop may ask the owner
function yaml({ defaultsCaps = '', agentCaps = WRITER, stepCaps = '', supervisor = false, onError = false, askHuman = false } = {}) {
  return [
    'apiVersion: craftorio/v1',
    'kind: Workflow',
    'metadata:',
    '  name: fixture-develop-review-116',
    'inputs:',
    '  repo_path: { type: string, required: true }',
    'orchestrator:',
    '  worktree: { repo: "{{ inputs.repo_path }}", base: main }',
    ...(supervisor ? ['  provider: ai', '  model: m', '  supervisor: { enabled: true, max_interventions: 2 }'] : []),
    'providers:',
    '  ai: { type: claude-code, command: claude }',
    'defaults:',
    '  working_dir: "{{ worktree_dir }}"',
    ...(defaultsCaps ? [`  capabilities: ${defaultsCaps}`] : []),
    'agents:',
    `  developer: { provider: ai, model: m, session: ephemeral${agentCaps ? `, capabilities: ${agentCaps}` : ''} }`,
    `  reviewer: { provider: ai, model: m, session: ephemeral, capabilities: ${READER} }`,
    'steps:',
    '  - id: develop',
    '    agent: developer',
    ...(stepCaps ? [`    capabilities: ${stepCaps}`] : []),
    ...(onError ? ['    on_error: handle'] : []),
    ...(askHuman ? ['    ask_human: true'] : []),
    '    prompt: "Implement the change."',
    '    output_schema: { type: object, required: [branch, committed, summary], properties: { branch: { type: string }, committed: { type: boolean }, summary: { type: string } } }',
    '  - id: review',
    '    agent: reviewer',
    '    prompt: "Review the change."',
    '    transitions:',
    '      - { when: "true", goto: end }',
    '  - id: handle',
    '    agent: reviewer',
    '    prompt: "Handle the failure."',
    '',
  ].join('\n');
}

const ANSWER = { branch: 'HEAD destacado em main', committed: true, summary: 'done' };
const json = (o) => ({ text: '```json\n' + JSON.stringify(o) + '\n```' });

// develop(dir, visit, prompt) → the developer's answer (it may change the worktree first);
// decisions: the supervisor's answers, in order
async function runScripted(t, wf, { develop = () => ANSWER, decisions = [] } = {}) {
  const f = fixture(t, 'canonical');
  const { file } = tempWorkflow(t, wf);
  const run = new WorkflowRun({ file, inputs: { repo_path: f.repo }, mock: true, runsDir: path.join(f.tmp, 'runs'), worktreesDir: f.worktrees, skillsDirs: [] });
  const events = [];
  const prompts = { developer: [], supervisor: [], reviewer: [] };
  let dir = null;
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'worktree.ready') dir = ev.work_dir || ev.dir;
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, 'sqlite', 'user', 'use the default'));
  });
  run.sendToAgent = async (agent, prompt) => {
    (prompts[agent] ??= []).push(prompt);
    if (agent === 'supervisor') return json(decisions.shift() || { explanation: 'give up', action: 'fail' });
    if (agent === 'developer') return json(develop(dir, prompts.developer.length, prompt));
    return { text: 'ok' };
  };
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  const ran = (id) => events.some((e) => e.type === 'step.started' && e.step_id === id);
  const notCommitted = events.filter((e) => e.type === 'log' && e.kind === 'develop_not_committed');
  const developed = events.filter((e) => e.type === 'step.finished' && e.step_id === 'develop').at(-1);
  return { f, events, finished, ran, prompts, notCommitted, developed };
}

const commitOnBranch = (branch) => (d) => {
  git(d, 'switch', '-q', '-c', branch);
  commit(d, 'done-116.txt', 'committed\n');
  return ANSWER;
};

// ---- which steps are checked ----------------------------------------------------------------------------

test('#116: read-only capabilities declared only in defaults leave a detached develop step unchecked', LIMIT, async (t) => {
  const r = await runScripted(t, yaml({ defaultsCaps: READER, agentCaps: '' }));
  assert.equal(r.finished?.status, 'success', r.finished?.error);
  assert.equal(r.notCommitted.length, 0);
  assert.equal(r.ran('review'), true);
});

test('#116: writing capabilities on the step over a read-only developer are checked', LIMIT, async (t) => {
  const r = await runScripted(t, yaml({ agentCaps: READER, stepCaps: WRITER }));
  assert.equal(r.finished?.status, 'failed');
  assert.match(String(r.finished?.error), /did not commit/i);
  assert.equal(r.ran('review'), false);
});

test('#116: a step-only override that keeps the developer writing (web: true) is still checked', LIMIT, async (t) => {
  const r = await runScripted(t, yaml({ stepCaps: '{ web: true }' }));
  assert.equal(r.finished?.status, 'failed');
  assert.match(String(r.finished?.error), /did not commit/i);
});

test('#116: a develop answer that asks the owner (ask_human) is not checked; the next visit commits and the run goes on', LIMIT, async (t) => {
  const question = { question: 'Which database should the cache use?', options: [{ id: 'pg', label: 'Postgres' }, { id: 'sqlite', label: 'SQLite' }], default: 'sqlite' };
  const r = await runScripted(t, yaml({ askHuman: true }), {
    develop: (d, visit) => (visit === 1 ? { ...ANSWER, needs_human: question } : commitOnBranch('feat/asked-116')(d)),
  });
  assert.equal(r.finished?.status, 'success', r.finished?.error);
  assert.equal(r.notCommitted.length, 0, 'the question was not taken for a missing commit');
  assert.equal(r.prompts.developer.length, 2);
  assert.equal(r.developed?.output?.branch, 'feat/asked-116');
});

// ---- the cause ---------------------------------------------------------------------------------------------

test('#116: more than 10 uncommitted files: the cause lists 10 and says "and N more", on screen too', LIMIT, async (t) => {
  const r = await runScripted(t, yaml(), {
    develop: (d) => {
      commitOnBranch('feat/many-116')(d);
      for (let i = 1; i <= 12; i++) fs.writeFileSync(path.join(d, `dirty-${String(i).padStart(2, '0')}.txt`), 'left out\n');
      return ANSWER;
    },
  });
  assert.equal(r.finished?.status, 'failed');
  const error = String(r.finished?.error);
  assert.match(error, /did not commit/i);
  assert.match(error, /and 2 more/);
  assert.match(error, /dirty-01\.txt/);
  assert.doesNotMatch(error, /dirty-12\.txt/, 'only the first 10 files are named');
  assert.equal(r.notCommitted.length > 0, true, 'a log event for the screen');
  assert.match(String(r.notCommitted[0].message), /and 2 more/);
});

test('#116: the screen\'s cause follows the interface language (pt-BR)', LIMIT, async (t) => {
  I18n.setLanguage('pt-BR');
  t.after(() => I18n.setLanguage('en'));
  const r = await runScripted(t, yaml());
  assert.equal(r.finished?.status, 'failed');
  assert.match(String(r.finished?.error), /did not commit/i, 'the run error stays English');
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'i18n', 'pt-BR.json'), 'utf8'));
  const prefix = String(catalog['engine.develop_not_committed'] || '').split('{cause}')[0];
  assert.notEqual(prefix.trim(), '', 'pt-BR has engine.develop_not_committed');
  const message = String(r.notCommitted[0]?.message);
  assert.equal(message.startsWith(prefix), true, `the log is in Portuguese: ${message}`);
  assert.doesNotMatch(message, /did not commit/i);
});

test('#116: a git error while listing the changes fails the develop step, it never passes', LIMIT, async (t) => {
  const r = await runScripted(t, yaml(), {
    develop: (d) => {
      commitOnBranch('feat/broken-116')(d);
      // a corrupt index: `git status` fails, the branch is still readable
      fs.writeFileSync(path.join(git(d, 'rev-parse', '--absolute-git-dir'), 'index'), 'not an index');
      return ANSWER;
    },
  });
  assert.equal(r.finished?.status, 'failed');
  assert.equal(r.ran('review'), false);
});

// ---- the normal failure path: the supervisor, on_error ----------------------------------------------------------

test('#116: the on-call supervisor gets "did not commit", retries with an instruction, and a developer that commits goes on', LIMIT, async (t) => {
  const r = await runScripted(t, yaml({ supervisor: true }), {
    develop: (d, visit) => (visit === 1 ? ANSWER : commitOnBranch('feat/retried-116')(d)),
    decisions: [{ explanation: 'nothing committed', action: 'retry', instruction: 'Create the branch and commit your change.' }],
  });
  assert.equal(r.finished?.status, 'success', r.finished?.error);
  assert.equal(r.prompts.supervisor.length >= 1, true);
  assert.match(r.prompts.supervisor[0], /did not commit/i, 'the supervisor sees the cause');
  assert.match(r.prompts.developer.at(-1), /Create the branch and commit your change\./, 'the instruction reaches the developer');
  assert.equal(r.developed?.output?.branch, 'feat/retried-116', 'the real branch, not the agent\'s text');
  assert.equal(r.ran('review'), true);
});

test('#116: a supervisor\'s fixed output on a still uncommitted worktree is checked again: on_error takes it', LIMIT, async (t) => {
  const r = await runScripted(t, yaml({ supervisor: true, onError: true }), {
    decisions: [{ explanation: 'looks done', action: 'fix_output', output: ANSWER }, { explanation: 'give up', action: 'fail' }],
  });
  assert.equal(r.finished?.status, 'success', r.finished?.error);
  assert.equal(r.ran('review'), false, 'the unchecked fixed output did not reach the review');
  assert.equal(r.ran('handle'), true, 'on_error took the failure');
  assert.match(String(r.developed?.output?.error), /did not commit/i);
});

test('#116: a supervisor\'s fixed output on a still uncommitted worktree, no on_error: the run fails', LIMIT, async (t) => {
  const r = await runScripted(t, yaml({ supervisor: true }), {
    decisions: [{ explanation: 'looks done', action: 'fix_output', output: ANSWER }, { explanation: 'give up', action: 'fail' }],
  });
  assert.equal(r.finished?.status, 'failed');
  assert.match(String(r.finished?.error), /did not commit/i);
  assert.equal(r.ran('review'), false);
});

// ---- prepareWorktree: the git dirs for the provider --------------------------------------------------------------

test('#116: prepareWorktree gives the linked worktree\'s git dir and the common git dir, canonical', LIMIT, async (t) => {
  const f = fixture(t, 'link'); // reached through a symlink: the paths must still be the real ones
  const dir = path.join(f.worktrees, 'run-116');
  const wt = await prepareWorktree({ repo: f.repo, base: 'main', dir });
  assert.ok(wt, 'the worktree was made');
  const real = (p) => fs.realpathSync.native(p);
  assert.equal(wt.gitDir, real(git(dir, 'rev-parse', '--absolute-git-dir')));
  assert.equal(wt.commonDir, real(path.resolve(dir, git(dir, 'rev-parse', '--git-common-dir'))));
  assert.notEqual(wt.gitDir, wt.commonDir);
  assert.equal(wt.commonDir, real(path.join(f.repo, '.git')));
});
