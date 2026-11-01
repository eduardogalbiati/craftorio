// #631 through WorkflowRun and the bundled YAML (no whole run):
// - feature.yaml's "Retrospective after" (input `retrospective`): the run's `then` becomes the
//   retrospective of this run, unless a then was given; off, the run has no then;
// - analyze-project.yaml's routing: without `since` the map (and the Oracle's analysis), with `since`
//   the refactor proposals only (the old refactor-proposals), never both;
// - its refactor steps find the project's folder in repo_path, and still in project_path (the input of
//   an old refactor-proposals run).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, evalExpr } = require('../../engine/workflow');

const root = path.join(__dirname, '..', '..', '..', '..');
const FEATURE = path.join(root, 'workflows', 'feature.yaml');
const ANALYZE = path.join(root, 'workflows', 'analyze-project.yaml');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const featureRun = (t, inputs, opts = {}) => new WorkflowRun({ file: FEATURE, inputs: { task: 'Add the feature', repo_path: root, ...inputs }, mock: true, runsDir: tmpDir(t, 'runs-631-'), ...opts });
const plainThen = (then) => JSON.parse(JSON.stringify(then ?? null));

// ---- Retrospective after --------------------------------------------------------------------------

test('#631 feature with retrospective on and no then: the run is followed by the retrospective of this run', (t) => {
  const run = featureRun(t, { retrospective: true });
  assert.deepEqual(plainThen(run.then), { action: 'workflow', workflow: 'retrospective.yaml', map: { run_id: '@run' }, inputs: {} });
});

test('#631 feature with retrospective on and a then given: the given then is kept', (t) => {
  const run = featureRun(t, { retrospective: true }, { then: { action: 'workflow', workflow: 'release.yaml' } });
  assert.equal(run.then?.workflow, 'release.yaml');
});

test('#631 feature with retrospective off or not given: no then', (t) => {
  assert.equal(featureRun(t, { retrospective: false }).then, null);
  assert.equal(featureRun(t, {}).then, null);
});

// ---- analyze-project's routing --------------------------------------------------------------------

// The steps an automatic run walks from the first one: at each step the first transition whose
// condition holds (every machine step succeeds), until `end`.
function walk(inputs) {
  const wf = loadWorkflow(ANALYZE);
  const byId = new Map(wf.steps.map((s) => [s.id, s]));
  const scope = { inputs: { mode: 'auto', analyze: true, since: '', ...inputs }, output: { ok: true }, steps: {}, vars: {}, approved: true, rejected: false };
  const seen = [];
  let step = wf.steps[0];
  while (step && seen.length < 50) {
    seen.push(step.id);
    const tr = (step.transitions || []).find((x) => x.when === undefined || evalExpr(x.when, scope));
    step = tr && tr.goto !== 'end' ? byId.get(tr.goto) : null;
  }
  return seen;
}

const MAP_STEPS = ['plan', 'validate', 'gate', 'save', 'analyze'];
const PROPOSAL_STEPS = ['refactor_facts', 'refactor_analysis', 'propose', 'prioritize', 'proposals_gate', 'file'];

test('#631 analyze-project without since writes the map, then the Oracle\'s analysis, and makes no proposals', () => {
  const seen = walk({ since: '' });
  assert.deepEqual(seen, ['facts', 'plan', 'validate', 'save', 'analyze']);
  assert.deepEqual(seen.filter((id) => PROPOSAL_STEPS.includes(id)), []);
});

test('#631 analyze-project without since and the analysis off stops after the map is saved', () => {
  assert.deepEqual(walk({ since: '', analyze: false }), ['facts', 'plan', 'validate', 'save']);
});

test('#631 analyze-project with since files the refactor proposals and never writes the map', () => {
  const seen = walk({ since: 'v1.2.0' });
  assert.deepEqual(seen, ['facts', 'refactor_facts', 'refactor_analysis', 'propose', 'prioritize', 'file']);
  assert.deepEqual(seen.filter((id) => MAP_STEPS.includes(id)), []);
});

test('#631 analyze-project with since in validated mode shows the proposals at a gate before filing them', () => {
  const seen = walk({ since: 'v1.2.0', mode: 'validated' });
  assert.deepEqual(seen.slice(-2), ['proposals_gate', 'file']);
});

// ---- the refactor steps' place --------------------------------------------------------------------

const analyzeRun = (t, inputs) => new WorkflowRun({ file: ANALYZE, inputs, mock: true, runsDir: path.join(tmpDir(t, 'ws-631-'), 'runs') });

test('#631 analyze-project\'s refactor steps work in the repo_path folder of the project', (t) => {
  const repo = tmpDir(t, 'repo-631-');
  const run = analyzeRun(t, { repo_path: repo, project_id: 'p1', since: 'v1' });
  const place = run.refactorProposalsPlace({ id: 'refactor_facts' });
  assert.equal(place.folder, repo);
  assert.equal(place.projectId, 'p1');
});

// the inputs an old refactor-proposals run (or a saved pipeline naming it) carries: project_path, no repo_path
test('#631 an old refactor-proposals run\'s inputs (project_path, no repo_path) start and give the folder', (t) => {
  const repo = tmpDir(t, 'repo-631-');
  const run = analyzeRun(t, { project_path: repo, project_id: 'p1', since: 'v1', limit: 5, mode: 'auto' });
  assert.equal(run.refactorProposalsPlace({ id: 'refactor_facts' }).folder, repo);
});

test('#631 an input\'s old name (was:) is read only when the new name is empty: repo_path wins over project_path', (t) => {
  const repo = tmpDir(t, 'repo-631-');
  const old = tmpDir(t, 'old-631-');
  assert.equal(analyzeRun(t, { repo_path: repo, project_path: old, since: 'v1' }).inputs.repo_path, repo);
  assert.equal(analyzeRun(t, { repo_path: '', project_path: old, since: 'v1' }).inputs.repo_path, old);
});

test('#631 neither repo_path nor its old name project_path: the run refuses to start', (t) => {
  assert.throws(() => analyzeRun(t, { since: 'v1' }), /Required input not provided: repo_path/);
});
