// #651 (write doc phase 4, docs/work/write-doc/spec.md R16, decision of 2026-11-01): the living
// document in Build, Test and Deploy. Acceptance tests, written before the code.
//
// The interface assumed here (workflows loaded with packages/engine/engine/run/load.js loadWorkflow, as
// sdlc-flows-633.test.js does; the chain's inputs computed with @multiagent/shared/chain-model nextInputs):
// - a Code & Build run (feature, fix) hands its result to the post-flow as declared outputs only:
//   `merged_commit`, `pr_url`, `issues` and `evidence` (an object: the suite, the E2E scenarios, the
//   screenshots and the axe check);
// - sdlc-record, chained (`then`) after a successful feature/fix run, takes those outputs as inputs of
//   the same names plus `run` (`type: run`, the Code & Build run, mapped with '@run'), and writes the
//   Progress row of docs/work/<item>/plan.md (run, commit, PR) and the evidence row of test.md; it no
//   longer writes a separate progress.md;
// - sdlc-test records the Test stage in test.md at the code owner's gate;
// - sdlc-release writes deploy.md (the review findings, the release with the Ship) and the changelog,
//   no longer a separate release.md;
// - write-doc, once the plan is accepted, files the plan's steps as issues (an `issues` output).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const root = path.join(__dirname, '..', '..', '..', '..');
const WORKFLOWS = path.join(root, 'workflows');

const engine = () => require('../../engine/run/load');
const chain = () => require('@multiagent/shared/chain-model');
const loadBundled = (name) => engine().loadWorkflow(path.join(WORKFLOWS, `${name}.yaml`));

const step = (wf, id) => (wf.steps || []).find((s) => s?.id === id);
// the text an agent step works from: its prompt and its agent's system prompt
const stepText = (wf, id) => {
  const s = step(wf, id);
  return s ? `${String(s.prompt || '')}\n${String(wf.agents?.[s.agent]?.system_prompt || '')}` : '';
};
const missing = (wanted, have) => wanted.filter((k) => !have.includes(k));

const RECORDED_OUTPUTS = ['merged_commit', 'pr_url', 'issues', 'evidence'];

// ---- Code & Build: the evidence is a declared output ------------------------------------------------

for (const name of ['feature', 'fix']) {
  test(`#651 ${name}.yaml declares the outputs the post-flow records (merged_commit, pr_url, issues, evidence)`, () => {
    const outputs = Object.keys(loadBundled(name).outputs || {});
    assert.deepEqual(missing(RECORDED_OUTPUTS, outputs), [], `its outputs: ${JSON.stringify(outputs)}`);
  });

  test(`#651 ${name}.yaml's evidence output is an object with the suite, E2E, screenshots and axe`, () => {
    const out = loadBundled(name).outputs?.evidence;
    assert.ok(out, `${name}.yaml declares an evidence output`);
    assert.equal(String(out.type), 'object');
    const value = String(out.value || '').toLowerCase();
    assert.deepEqual(missing(['suite', 'e2e', 'screenshots', 'axe'], ['suite', 'e2e', 'screenshots', 'axe'].filter((w) => value.includes(w))), [],
      `its value names: ${value}`);
  });
}

// ---- sdlc-record: the Progress row of plan.md and the evidence row of test.md ---------------------------

test('#651 sdlc-record takes the Code & Build run and its outputs as inputs (run, merged_commit, pr_url, evidence)', () => {
  const inputs = loadBundled('sdlc-record').inputs || {};
  assert.deepEqual(missing(['run', 'merged_commit', 'pr_url', 'evidence'], Object.keys(inputs)), [], `its inputs: ${JSON.stringify(Object.keys(inputs))}`);
  assert.equal(String(inputs.run?.type), 'run');
});

test('#651 sdlc-record writes the Progress row of plan.md with the run, the commit and the PR', () => {
  const text = stepText(loadBundled('sdlc-record'), 'record');
  assert.equal(text.includes('plan.md'), true, 'the record step names plan.md');
  assert.equal(/progress/i.test(text), true, 'the record step names the Progress table');
  for (const input of ['inputs.run', 'inputs.merged_commit', 'inputs.pr_url']) {
    assert.equal(text.includes(input), true, `the record step uses ${input}`);
  }
});

test('#651 sdlc-record no longer writes a separate progress.md', () => {
  const text = stepText(loadBundled('sdlc-record'), 'record');
  assert.equal(text.includes('progress.md'), false);
});

test('#651 sdlc-record writes the run\'s evidence row in test.md (suite, E2E, screenshots, axe)', () => {
  const text = stepText(loadBundled('sdlc-record'), 'record');
  assert.equal(text.includes('test.md'), true, 'the record step names test.md');
  assert.equal(text.includes('inputs.evidence'), true, 'the record step uses inputs.evidence');
  const lower = text.toLowerCase();
  assert.deepEqual(['suite', 'e2e', 'screenshots', 'axe'].filter((w) => !lower.includes(w)), []);
});

test('#651 a then from a feature run to sdlc-record fills its inputs from the run\'s outputs', () => {
  const { normalizeThen, nextInputs } = chain();
  const then = normalizeThen({
    action: 'workflow',
    workflow: 'sdlc-record.yaml',
    map: { run: '@run', merged_commit: 'merged_commit', pr_url: 'pr_url', evidence: 'evidence' },
    inputs: { item: 'write-doc' },
  });
  const evidence = { suite: 'passed', e2e: '3 passed', screenshots: ['evidence/a.png'], axe: 'no violations' };
  const prev = {
    runId: '20261103-101010-abcd1234',
    inputs: { repo_path: '/projects/app', base_branch: 'main' },
    outputs: { merged_commit: '1a2b3c4', pr_url: 'https://example.test/pr/7', evidence },
  };
  const got = nextInputs(then, prev, loadBundled('sdlc-record').inputs || {});
  assert.equal(got.run, '20261103-101010-abcd1234');
  assert.equal(got.merged_commit, '1a2b3c4');
  assert.equal(got.pr_url, 'https://example.test/pr/7');
  assert.deepEqual(got.evidence, evidence);
  assert.equal(got.item, 'write-doc');
  assert.equal(got.project_path, '/projects/app');
});

// ---- sdlc-test: the Test stage at the code owner's gate ---------------------------------------------------

test('#651 sdlc-test records the Test stage in test.md at the code owner\'s gate', () => {
  const wf = loadBundled('sdlc-test');
  assert.equal(stepText(wf, 'record').includes('test.md'), true, 'the record step names test.md');
  const gates = (wf.steps || []).filter((s) => s?.type === 'human_approval');
  assert.equal(gates.some((g) => /code owner/i.test(`${g.message || ''} ${g.approver || ''} ${g.help || ''}`)), true,
    'a human_approval gate names the code owner');
});

// ---- sdlc-release: deploy.md and the changelog --------------------------------------------------------------

test('#651 sdlc-release writes deploy.md with the review findings and the release with the Ship', () => {
  const text = stepText(loadBundled('sdlc-release'), 'record');
  assert.equal(text.includes('deploy.md'), true, 'the record step names deploy.md');
  assert.equal(/review/i.test(text), true, 'the record step records the review findings');
  assert.equal(/\bship\b/i.test(text), true, 'the record step records the release with the Ship');
});

test('#651 sdlc-release updates the changelog', () => {
  const text = stepText(loadBundled('sdlc-release'), 'record');
  assert.equal(/changelog/i.test(text), true);
});

test('#651 sdlc-release no longer writes a separate release.md', () => {
  const text = stepText(loadBundled('sdlc-release'), 'record');
  assert.equal(text.includes('release.md'), false);
});

// ---- the pre-flow: an accepted plan's steps are filed as issues ----------------------------------------------

test('#651 write-doc declares the issues it filed from the plan (an issues output, an array)', () => {
  const out = loadBundled('write-doc').outputs?.issues;
  assert.ok(out, 'write-doc.yaml declares an issues output');
  assert.equal(String(out.type), 'array');
});

test('#651 accepting a plan goes on to file its steps as issues instead of ending the run', () => {
  const wf = loadBundled('write-doc');
  const ids = (wf.steps || []).map((s) => s?.id);
  const transitions = step(wf, 'approval')?.transitions || [];
  const toFile = transitions.filter((t) => /plan/.test(String(t?.when || '')) && t.goto && t.goto !== 'end' && t.goto !== 'merge_blocked');
  assert.equal(toFile.length > 0, true, `approval's transitions: ${JSON.stringify(transitions.map((t) => [t.when, t.goto]))}`);
  assert.equal(toFile.every((t) => ids.includes(t.goto)), true, 'the target step exists');
});
