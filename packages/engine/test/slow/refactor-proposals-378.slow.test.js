// #378: whole simulated runs of the Refactor proposals workflow (workflows/analyze-project.yaml with `since` since #631):
// facts → analyze → propose → prioritize → gate (validated mode only) → file, on a git repository in a
// temp folder and a temp workspace. The cheaper checks (and the contract) are in
// test/refactor-proposals-workflow-378.test.js. The workflow is loaded inside each run (tests first).
//
// Contract assumed by these runs (besides that test's header):
// - The run is started for a project: WorkflowRun's `projectId` (also given as the input
//   `project_id`) and the input `repo_path` (the project's folder; `project_path` before #631). The workspace is the runs
//   folder's parent, so the proposals are those the Refactor tab reads: <workspace>/refactor
//   (fronts/analyser/engine/channels/refactor.js root()), through packages/engine/domains/refactor/refactor-proposals.js listProposals.
// - The mock analyst answers from the analyze step's output schema (one finding); a second run on the
//   same project finds the same finding, so propose drops it as known.
// - facts lists the files changed since `since` (an array holding 'src/changed.js', as a string or
//   as an object's `path`) and not the files only committed before it.
// - The file step previews in a simulation (nothing runs gh) and says so; its output names the
//   `refactor` label and the Refactor workflow refactor.yaml.
// - The workflow's final outputs are workflow.finished's `outputs`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');
const { Recorder } = require('../../engine/recorder');
const projects = require('../../domains/project/projects');
const proposals = require('../../domains/refactor/refactor-proposals');
const { validateReport } = require('../../domains/oracle/oracle-architecture');
const { producedIssues } = require('@craftorio/shared/chain-model');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'analyze-project.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

function write(dir, rel, text) {
  const file = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// before the tag: src/old.js (and the manifest); after it: src/changed.js
function makeRepo(t) {
  const dir = tmp(t, 'refactor-proposals-repo-');
  git(dir, 'init', '-q');
  write(dir, 'package.json', '{ "name": "fixture", "version": "1.0.0" }\n');
  write(dir, 'src/old.js', 'module.exports = function old(a) { return a + 1; };\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'tag', 'v1.0.0');
  write(dir, 'src/changed.js', 'module.exports = function changed(a, b) { if (a) { return b; } return a; };\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'after the release');
  return dir;
}

// A project in a temp workspace (runs in <ws>/runs, the Refactor tab's store in <ws>/refactor)
async function makeProject(t) {
  const repo = makeRepo(t);
  const ws = tmp(t, 'refactor-proposals-ws-');
  const runsDir = path.join(ws, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const project = await projects.createProject(path.join(ws, 'projects'), { name: 'proposals-378', folder: repo });
  const storeRoot = path.join(ws, 'refactor');
  return { repo, ws, runsDir, project, storeRoot, stored: () => proposals.listProposals(storeRoot, project.id) };
}

// A mock run recorded as the app records it; gates are answered with their first choice.
async function runProposals(ctx, inputs = {}) {
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { repo_path: ctx.repo, project_id: ctx.project.id, ...inputs },
    mock: true,
    runsDir: ctx.runsDir,
    projectId: ctx.project.id,
  });
  const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
  const events = [];
  run.on('event', (ev) => {
    rec.write(ev);
    events.push(ev);
    if (ev.type === 'approval.requested') {
      const choices = ev.choices || [];
      const answer = choices.length ? choices[0].id : true;
      setImmediate(() => run.resolveApproval(ev.approval_id, answer, 'user'));
    }
  });
  await run.start();
  const outputOf = (id) => events.filter((e) => e.type === 'step.finished' && e.step_id === id).map((e) => e.output).pop();
  const visits = (id) => events.filter((e) => e.type === 'step.started' && e.step_id === id).length;
  const gates = events.filter((e) => e.type === 'approval.requested');
  const finished = events.find((e) => e.type === 'workflow.finished') || {};
  return { events, outputOf, visits, gates, finished, outputs: finished.outputs || finished.summary?.outputs || {} };
}

// The arrays anywhere in `value` that hold `file` (as a string or as an item's `path`)
function listsHolding(value, file, found = []) {
  if (Array.isArray(value)) {
    if (value.some((x) => x === file || x?.path === file || x?.file === file)) found.push(value);
    for (const x of value) listsHolding(x, file, found);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) listsHolding(v, file, found);
  }
  return found;
}
const holds = (list, file) => list.some((x) => x === file || x?.path === file || x?.file === file);
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? null));

test('#378 refactor proposals, auto mode: facts since the tag, a valid report, proposals stored, top issues filed with no gate', { timeout: 180000 }, async (t) => {
  const ctx = await makeProject(t);
  const r = await runProposals(ctx, { mode: 'auto', since: 'v1.0.0' });
  assert.equal(r.finished.status, 'success', r.finished.error);

  // facts: the files changed since v1.0.0, not those only committed before it
  const facts = r.outputOf('refactor_facts');
  assert.ok(facts, 'the facts step finished with an output');
  assert.ok(asText(facts).includes('src/changed.js'), 'facts name the file changed since the tag');
  const changedLists = listsHolding(facts, 'src/changed.js');
  assert.ok(changedLists.length > 0, 'a list of the changed files');
  for (const list of changedLists) assert.equal(holds(list, 'src/old.js'), false, 'src/old.js was only committed before the tag');

  // analyze: the Oracle's report format
  const analyzed = validateReport(r.outputOf('refactor_analysis'));
  assert.equal(analyzed.error, undefined, analyzed.error);

  // propose: the findings are in the Refactor tab's store
  assert.ok(ctx.stored().length > 0, 'proposals in <workspace>/refactor/<project>/proposals.json');

  // auto: nobody answers a gate
  assert.equal(r.gates.filter((g) => g.step_id === 'proposals_gate').length, 0, 'no approval for the gate step in auto mode');

  // outputs: the filed issues as the pipeline targets read them, and the report
  const issues = r.outputs.issues;
  assert.ok(Array.isArray(issues), `issues output: ${asText(issues)}`);
  assert.ok(issues.length > 0, 'at least one issue filed');
  assert.ok(issues.length <= 5, 'no more than the default limit');
  assert.equal(producedIssues(r.outputs).length, issues.length, `producedIssues reads every filed issue: ${asText(issues)}`);
  const report = validateReport(r.outputs.report);
  assert.equal(report.error, undefined, report.error);

  // file: the `refactor` label and the Refactor workflow, previewed (a simulation runs no gh)
  const filed = asText(r.outputOf('file'));
  assert.match(filed, /\brefactor\b/, 'the refactor label');
  assert.match(filed, /refactor\.yaml/, 'the issue body names the Refactor workflow');
  assert.match(filed, /simulat|preview/i, 'previewed, not filed with gh');
});

test('#378 refactor proposals, auto mode: limit 1 files at most one issue', { timeout: 180000 }, async (t) => {
  const ctx = await makeProject(t);
  const r = await runProposals(ctx, { mode: 'auto', since: 'v1.0.0', limit: 1 });
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.ok(Array.isArray(r.outputs.issues), `issues output: ${asText(r.outputs.issues)}`);
  assert.ok(r.outputs.issues.length <= 1, `at most 1 issue: ${r.outputs.issues.length}`);
});

test('#378 refactor proposals: drops findings that match an open or dismissed proposal and says which', { timeout: 300000 }, async (t) => {
  const ctx = await makeProject(t);
  const first = await runProposals(ctx, { mode: 'auto', since: 'v1.0.0' });
  assert.equal(first.finished.status, 'success', first.finished.error);
  const before = ctx.stored();
  assert.ok(before.length > 0, 'the first run stored proposals');

  const dismissed = before[0];
  proposals.dismissProposal(ctx.storeRoot, ctx.project.id, dismissed.id, 'Not worth it now');

  const second = await runProposals(ctx, { mode: 'auto', since: 'v1.0.0' });
  assert.equal(second.finished.status, 'success', second.finished.error);
  const after = ctx.stored();
  assert.equal(after.length, before.length, 'no new proposal for a known finding');
  const again = after.find((p) => p.id === dismissed.id);
  assert.ok(again, 'the dismissed proposal is still listed');
  assert.equal(again.status, 'dismissed', 'the dismissed proposal is not reopened');

  const said = asText(second.outputOf('propose'));
  for (const p of before) assert.ok(said.includes(p.id) || (p.title && said.includes(p.title)), `the propose step names the dropped proposal ${p.id} (${p.title})`);
  const issues = second.outputs.issues || [];
  assert.equal(Array.isArray(issues) ? issues.length : -1, 0, `nothing new filed: ${asText(issues)}`);
});

test('#378 refactor proposals, validated mode: the owner is asked at the gate before anything is filed', { timeout: 180000 }, async (t) => {
  const ctx = await makeProject(t);
  const r = await runProposals(ctx, { mode: 'validated', since: 'v1.0.0' });
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.equal(r.gates.filter((g) => g.step_id === 'proposals_gate').length, 1, 'one approval for the gate step');
  assert.equal(r.visits('proposals_gate'), 1);
});
