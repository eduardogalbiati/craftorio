// The develop step's rendered prompt of ai-development-local-hero: no self-review paragraph and no
// code-review skill, the screenshots instructions unchanged (#303, after #300's checklist); and a
// shared skill's section addressed to one role (e.g. context-economy's "Test writer: ...") reaches
// only that role's prompt (#300). Mock runs.
// Moved from test/develop-prompt-300.test.js by #306: its tests are whole mock runs of a bundled workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../engine/workflow');
process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', '..', '..', 'workflows', 'feature.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// one mock run of the normal path; the prompt of each turn with the agent that received it
async function mockRun(t, { runsPrefix = 'dev-prompt-runs-' } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-prompt-repo-'));
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), runsPrefix));
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
    fs.rmSync(runsDir, { recursive: true, force: true, maxRetries: 5 });
  });
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'app.js'), 'module.exports = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'switch', '-q', '-c', 'feat');
  const run = new WorkflowRun({
    file: WORKFLOW,
    inputs: { task: 'Add the feature', repo_path: repo, unit_tests: 'run_existing', e2e_tests: 'off' },
    mock: true,
    runsDir,
    mockSequences: { verdict: ['approved'], suite: { red_check: ['fail'], suite: ['pass'] } },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices[0].id, 'user'));
  });
  await run.start();
  const agentOf = {};
  for (const e of events) if (e.type === 'session.opened') agentOf[e.session.id] = e.session.agent;
  const turns = events.filter((e) => e.type === 'session.message_sent').map((e) => ({ step: e.step_id, agent: agentOf[e.session_id], prompt: e.prompt }));
  return { finished: events.find((e) => e.type === 'workflow.finished'), turns };
}

// "## Test writer: ...", "## Developer: ..." (a numbered "## 2. Developer: ..." too) → the role the section is addressed to
const roleHeadings = (prompt) => [...prompt.matchAll(/^## (?:\d+\.\s*)?(Developer|Test writer):/gm)].map((m) => m[1].toLowerCase().replace(/ /g, '_'));

// #303 replaced #300's self-review checklist: the develop turn ends at green acceptance tests and a
// commit, with no self-review pass over the diff; the screenshots instructions stay as they were
test('develop prompt (#303): no self-review paragraph and no code-review skill; the screenshots instructions are unchanged', { timeout: 120000 }, async (t) => {
  const { finished, turns } = await mockRun(t);
  assert.equal(finished.status, 'success', finished.error);
  const develop = turns.find((x) => x.step === 'develop');
  assert.ok(develop, 'the developer had a turn');
  const prompt = develop.prompt;
  const flat = prompt.replace(/\s+/g, ' ');

  assert.equal(prompt.includes('<skill name="code-review"'), false, 'the reviewer\'s code-review skill is not loaded into the develop turn');
  assert.doesNotMatch(prompt, /^## \d+\. (Review on three axes|Severity and verdict|Writing each finding)/m, 'no reviewer sections (axes, severity, verdict, findings format)');
  assert.ok(prompt.length < 40000, `the develop prompt stays under 40K characters (got ${prompt.length})`);

  assert.doesNotMatch(flat, /Self-review \(#179\)/i, 'the self-review paragraph is gone');
  assert.doesNotMatch(flat, /git diff [^\s`{]+\.\.\.HEAD/, 'no reading of the branch diff against its base');
  assert.doesNotMatch(flat, /Fix what you find with a new commit/i, 'no self-review fix commit');

  // the screenshots instructions (screenshots on, the default) are unchanged
  for (const line of [
    'In `screenshots`, list the same UI states as exact options of the project\'s screenshot command',
    '`<issue>-<screen>-<state>`, `caption` one sentence, `args` the options as a list',
    'never --out, --name, --side, --ref or --caption (the capture sets them)',
    'The engine captures each one, original and modified, before the owner tries the change.',
    // #670: a change under the UI folders always lists its screens
    'An empty list when the change has no UI; a change to files under the UI folders always lists its screens.',
    'make the screenshot demo data cover the fields the change introduces (ui-conventions skill)',
  ]) assert.ok(flat.includes(line), `the screenshots instructions keep: ${line}`);

  // the rest of the develop prompt stays
  assert.match(prompt, /Add the feature/, 'the task');
  assert.match(prompt, /```run-tests/, 'the focused run-tests block');
  for (const field of ['evidence_plan', 'screenshots', 'left_out', 'test_notes']) assert.ok(prompt.includes(`\`${field}\``) || prompt.includes(`"${field}"`), `the ${field} output stays`);
  assert.match(prompt, /Handoff note:/, 'the handoff rules stay');
});

// #418: the run folder's path is written into the develop prompt several times (logs, evidence,
// red check log, test map), so the 40K budget must leave room for a long path, not only for this
// machine's temp folder (the base went red at 40052 characters on another one)
test('develop prompt (#418): stays under 40K characters with a long run folder path', { timeout: 120000 }, async (t) => {
  const { finished, turns } = await mockRun(t, { runsPrefix: `dev-prompt-runs-${'long-folder-name-'.repeat(4)}` });
  assert.equal(finished.status, 'success', finished.error);
  const develop = turns.find((x) => x.step === 'develop');
  assert.ok(develop, 'the developer had a turn');
  assert.ok(develop.prompt.length < 40000, `the develop prompt stays under 40K characters with a long run folder (got ${develop.prompt.length})`);
});

// #756: what the engine really sends (loadSkills expanding `uses`/`reads`, not a test helper): the
// developer gets its self-review and is pointed to the shared reuse pass; the reviewer gets the reuse
// pass inline with its code-review skill, before the verdict
test('self-review (#756): the develop turn carries the self-review and points to the reuse pass; the code_review turn carries the reuse pass inline', { timeout: 120000 }, async (t) => {
  const { finished, turns } = await mockRun(t);
  assert.equal(finished.status, 'success', finished.error);
  const develop = turns.find((x) => x.step === 'develop');
  assert.ok(develop, 'the developer had a turn');
  assert.ok(develop.prompt.includes('<skill name="developer-self-review"'), 'the develop prompt carries the developer-self-review skill');
  const reuseDir = path.join('skills', 'reuse-pass');
  assert.ok(develop.prompt.includes('<skill name="reuse-pass"') || develop.prompt.includes(reuseDir), 'the develop prompt carries or points to the shared reuse-pass skill');

  const review = turns.find((x) => x.step === 'code_review');
  assert.ok(review, 'the reviewer had a turn');
  const at = review.prompt.indexOf('<skill name="reuse-pass"');
  assert.ok(at >= 0, 'the code_review prompt carries the reuse-pass skill inline');
  const flatReview = review.prompt.slice(at).replace(/\s+/g, ' ');
  assert.match(flatReview, /literal values/i, 'the reviewer reads the search by literal values');
  assert.match(flatReview, /mapping table/i, 'the reviewer reads the mapping table rule');
  const verdict = review.prompt.search(/^#{2,4} .*verdict/im);
  assert.ok(verdict > at, 'the reuse pass comes before the verdict section in the reviewer\'s prompt');
});

test('shared skills (#300): a section addressed to the developer or the test writer reaches only that role\'s prompt', { timeout: 120000 }, async (t) => {
  const { finished, turns } = await mockRun(t);
  assert.equal(finished.status, 'success', finished.error);
  const develop = turns.find((x) => x.step === 'develop');
  assert.ok(develop.prompt.includes('<skill name="context-economy"'), 'the developer still gets context-economy');
  assert.doesNotMatch(develop.prompt, /^## Test writer:/m, 'context-economy\'s test writer section is not in the develop prompt');
  const writer = turns.find((x) => x.step === 'acceptance_tests');
  assert.match(writer.prompt, /^## Test writer: map the behaviours before writing tests/m, 'the test writer still gets its own section');

  const misplaced = [];
  for (const { step, agent, prompt } of turns) {
    for (const role of roleHeadings(prompt)) if (role !== agent) misplaced.push(`${role} section in ${step} (${agent})`);
  }
  assert.deepEqual(misplaced, [], 'no section addressed to another role');
});
