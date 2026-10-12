// #300: the develop step's prompt of ai-development-local-hero carries a short self-review checklist
// instead of the reviewer's whole code-review skill, and a shared skill's section addressed to one
// role (e.g. context-economy's "Test writer: ...") reaches only that role's prompt. Mock runs.
// Moved from test/develop-prompt-300.test.js by #306: its tests are whole mock runs of a bundled workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { WorkflowRun } = require('../../src/engine/workflow');
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.02';

const WORKFLOW = path.join(__dirname, '..', '..', 'workflows', 'ai-development-local-hero.yaml');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// one mock run of the normal path; the prompt of each turn with the agent that received it
async function mockRun(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-prompt-repo-'));
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-prompt-runs-'));
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

test('develop prompt (#300): a short self-review checklist instead of the code-review skill; the rest of the prompt stays', { timeout: 120000 }, async (t) => {
  const { finished, turns } = await mockRun(t);
  assert.equal(finished.status, 'success', finished.error);
  const develop = turns.find((x) => x.step === 'develop');
  assert.ok(develop, 'the developer had a turn');
  const prompt = develop.prompt;

  assert.equal(prompt.includes('<skill name="code-review"'), false, 'the reviewer\'s code-review skill is not loaded into the develop turn');
  assert.doesNotMatch(prompt, /^## \d+\. (Review on three axes|Severity and verdict|Writing each finding)/m, 'no reviewer sections (axes, severity, verdict, findings format)');
  // the mock develop prompt was ~41.6K characters with the code-review skill (~7.5K of it); the
  // checklist replaces that skill, so the prompt stays under 40K
  assert.ok(prompt.length < 40000, `the develop prompt shrinks without the code-review skill (got ${prompt.length} characters)`);
  const selfReviewSkill = prompt.match(/<skill name="self-review"[\s\S]*?<\/skill>/);
  assert.ok(selfReviewSkill, 'the self-review checklist is loaded into the develop turn');
  assert.ok(selfReviewSkill[0].length < 5000, `the self-review skill is under 5,000 characters (got ${selfReviewSkill[0].length})`);

  assert.match(prompt, /self-review/i, 'the developer still self-reviews its diff (#179)');
  assert.match(prompt, /rules\//, 'the checklist points to the language\'s rules/<language>.md');
  assert.match(prompt, /Fix what you find with a new commit/i, 'the fix-with-a-new-commit rule stays (#179)');
  // nothing else of the develop prompt changes
  assert.match(prompt, /Add the feature/, 'the task');
  for (const field of ['self_review', 'evidence_plan', 'screenshots', 'left_out']) assert.ok(prompt.includes(`\`${field}\``) || prompt.includes(`"${field}"`), `the ${field} output stays`);
  assert.match(prompt, /Handoff note:/, 'the handoff rules stay');
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
