// #49 (review): the secret scan's internals: the refs whose commits are not the run's, the prompts' filters,
// where a round goes after the scan (vars.after_scan), and result.md for a scan that failed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { RULE, commit, defaults, git, load, plainGit, project } = require('./helpers/fake-gitleaks');
const { WorkflowRun } = require('../engine/workflow');
const { commitRange } = require('../engine/secret-scan');
const { evalExpr, render } = require('../engine/run/templates');
const { renderResultSummary } = require('../domains/evidence/result-summary');
const { workflowStations } = require('@craftorio/shared/run-progress-model');

plainGit();
const FOUND = { kind: 'secret_scan', status: 'fail', findings: [{ rule: RULE, file: 'src/a.txt', line: 3, commit: 'abcdef1234567890' }], message: 'm' };

const refsOf = (worktree, inputs = {}) => Object.assign(Object.create(WorkflowRun.prototype), {
  worktree, wf: { orchestrator: { worktree: { base: '{{ inputs.base_branch }}' } } }, ctx: { inputs: { base_branch: 'main', ...inputs } },
}).secretScanRefs();

test('#49 refs: Local reads the base refs, Remote leaves the local base out and adds a stacked run\'s parent', () => {
  assert.deepEqual(refsOf({ base: 'main', remote: false }), ['refs/heads/main', 'refs/remotes/origin/main']);
  assert.deepEqual(refsOf(null), ['refs/heads/main', 'refs/remotes/origin/main']);
  assert.deepEqual(refsOf({ base: 'main', remote: true }), ['refs/remotes/origin/main']);
  assert.deepEqual(refsOf({ base: 'main', remote: true, fork: true }, { parent_branch: 'parent' }), ['refs/remotes/origin/main', 'refs/remotes/upstream/main', 'refs/remotes/origin/parent']);
});

test('#49 range: every base ref that exists is left out, also an origin ahead of the local base', async (t) => {
  const { repo, dir } = project(t);
  const ahead = commit(dir, 'a colleague\'s', { 'other.txt': 'x\n' });
  git(dir, 'push', '-q', 'origin', 'HEAD:main');
  git(repo, 'fetch', '-q', 'origin');
  commit(dir, 'the change', { 'src/new.txt': 'y\n' });
  const range = await commitRange(dir, { refs: ['refs/heads/main', 'refs/remotes/origin/main', 'refs/remotes/upstream/main'] });
  assert.deepEqual(range.not, [git(repo, 'rev-parse', 'main'), ahead]);
  assert.equal(range.from, ahead);
  await assert.rejects(commitRange(dir, { refs: ['refs/heads/none'] }), /not in the repository/);
});

test('#49 filters: nothing to say is empty; a long list is cut; a failure without findings gives its message', () => {
  const say = (output) => render('{{ o | secret_findings("main") }}', { o: output });
  for (const output of [undefined, { status: 'pass', findings: [] }, { status: 'skipped', findings: [] }]) assert.equal(say(output), '');
  assert.match(say(FOUND), /fake-token src\/a\.txt:3 \(commit abcdef123456\)/);
  assert.match(say({ ...FOUND, findings: Array(60).fill(FOUND.findings[0]) }), /and 10 more/);
  assert.match(say({ ...FOUND, findings: [], message: '.gitleaksignore changed without a commit' }), /without a commit/);
  const review = (output) => render('{{ o | secret_review }}', { o: output });
  for (const output of [undefined, { status: 'pass', ignored: [], config: [] }]) assert.equal(review(output), '');
  assert.match(review({ status: 'skipped', message: 'Secrets not scanned: x.' }), /Secrets not scanned: x\. Look for secrets/);
  assert.match(review({ status: 'pass', ignored: [{ entry: 'a:r:1', reason: '' }] }), /`a:r:1`: no reason given/);
});

const firstGoto = (step, scope) => (step.transitions || []).find((tr) => !tr.when || evalExpr(String(tr.when), scope));
for (const name of ['feature', 'local hero', 'remote hero']) {
  test(`#49 ${name}: after the scan a round goes where it was going, whatever step ran before`, () => {
    const wf = load(name);
    const at = (id) => wf.steps.find((s) => s.id === id);
    const scope = (vars, previous) => ({ inputs: { ...defaults(wf), mode: 'validated', validation: 'validated', task: 't', screenshots: 'changed' }, vars, output: { status: 'pass' }, choice: 'continue', previous_step: previous, worktree_dir: '', steps: { develop: { output: { committed: false, screenshots: [{}], issues: [] } } } });
    for (const previous of ['develop', 'secret_found', 'secret_scan_error']) {
      assert.equal(firstGoto(at('secret_scan'), scope({ after_scan: 'gate' }, previous)).goto, 'developer_check', previous);
      for (const next of ['review', 'ui_review']) assert.equal(firstGoto(at('secret_scan'), scope({ after_scan: next }, previous)).goto, 'code_review', previous);
    }
    // the ui_reviewer runs after the captures, as it did before the scan, never after another check
    const ui = (vars, previous) => Boolean(evalExpr(at('code_review').agent_when.ui_reviewer, scope(vars, previous)));
    assert.deepEqual([ui({ after_scan: 'ui_review' }, 'secret_scan'), ui({ after_scan: 'gate' }, 'developer_check'), ui({ after_scan: 'review' }, 'secret_scan')], [true, true, false]);
    // every route to the scan says where it goes
    for (const step of wf.steps.filter((s) => !s.id.startsWith('secret_'))) {
      for (const tr of (step.transitions || []).filter((x) => x.goto === 'secret_scan')) assert.equal(['gate', 'review', 'ui_review'].includes(tr.set?.after_scan), true, `${step.id}: ${tr.when}`);
    }
    const gap = at('requirements_left_out').transitions.find((x) => x.goto === 'secret_scan');
    assert.deepEqual(Object.keys(gap.set).sort(), ['accepted_gaps', 'after_scan']);
  });
}

// the skills the engine resolves for a turn of the step: the agent's, then the step's (a template may resolve to none)
const skillsFor = (wf, step, scope) => {
  const run = Object.assign(Object.create(WorkflowRun.prototype), { worktree: null, ctx: scope });
  return run.skillNames([...(wf.agents[step.agent].skills || []), ...(step.skills || [])], scope).filter(Boolean);
};
for (const name of ['feature', 'local hero', 'remote hero']) {
  test(`#49 ${name}: the developer loads secret-triage only on a turn a finding sends back (#418)`, () => {
    const wf = load(name);
    const develop = wf.steps.find((s) => s.id === 'develop');
    const on = (previous, language) => skillsFor(wf, develop, { inputs: { ...defaults(wf), task: 't', language }, vars: {}, steps: {}, previous_step: previous }).filter((k) => k === 'secret-triage').length;
    for (const language of ['js', 'js, python']) {
      for (const previous of ['secret_scan', 'secret_found']) assert.equal(on(previous, language), 1, `${previous} (${language})`);
      for (const previous of ['', 'warm_up', 'developer_check', 'code_review', 'suite']) assert.equal(on(previous, language), 0, `${previous || 'first step'} (${language})`);
    }
  });
}

// the roadmap card's pipeline (#282): the scan's steps and gates move no station and keep the owner's gate
for (const name of ['feature', 'fix', 'local hero', 'remote hero']) {
  test(`#49 ${name}: the pipeline's stations keep their order, the Validated gate right after Develop`, () => {
    const wf = load(name);
    const names = (mode) => workflowStations({ steps: wf.steps, groups: wf.groups, mode }).map((st) => (st.gate ? `gate ${st.name}` : st.name));
    const groups = wf.groups.map((g) => g.name);
    assert.deepEqual(names(null).filter((n) => groups.includes(n)), groups);
    if (name === 'fix') return; // no Validated mode
    const list = names('validated');
    assert.equal(list[list.indexOf('Develop') + 1], 'gate developer_check', list.join(' > '));
  });
}

test('#49 report: result.md names a scan that failed and an open finding', () => {
  const text = (output) => renderResultSummary('/no/such/run', { workflow: 'Fix', run_id: 'r', status: 'failed', steps: { secret_scan: { output } } });
  assert.match(text({ kind: 'secret_scan', status: 'error', findings: [], message: 'Secrets not scanned: gitleaks failed (exit code 1).' }), /## Secrets\n\n- `secret_scan`: Secrets not scanned: gitleaks failed/);
  assert.match(text(FOUND), /\*\*1 open finding\(s\)\*\*\n {2}- fake-token `src\/a\.txt:3`/);
  assert.match(text({ ...FOUND, findings: Array(12).fill(FOUND.findings[0]) }), /and 2 more/);
  assert.match(text({ ...FOUND, findings: [], message: '.gitleaksignore changed without a commit' }), /without a commit/);
});
