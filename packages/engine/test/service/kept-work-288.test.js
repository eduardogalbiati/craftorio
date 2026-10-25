// #288: the kept-work question redone (packages/engine/service/areas/resume.js keptWorkQuestion, reached through
// run:start's answer `kept` when an ended run of the same issues kept commits of its own). Title
// "<issues>: a run stopped at <step>"; a one-line stop reason (a human gate, which one; the app
// closed; a failure, its first line; a limit; cancelled by the owner); the done steps, the steps
// left and what was spent (US$ and time); a base that moved on is "main moved N commits … the run
// merges it at the end" (no "resuming will likely conflict"); the commit counts and file names go to
// `details`; the choices are Start over (what it spends again; its tooltip: the old commits stay in
// their branch) and Resume, Resume primary when the old run has commits of its own; the step it
// stopped at is `stoppedAt` (Resume resumes there at once).
//
// Acceptance tests written before the code. The old run folders are fabricated the way
// test/service/resume.test.js does (events.jsonl + summary.json, a kept worktree with commits); the
// workflow has steps plan → develop → evidence → review (human gate) → merge.
//
// Interface the developer provides on `kept`: title, message (one line of stop reason, done / left
// steps, US$ and time spent, the base's moves), details (string or string[]: commit counts, file
// names), stoppedAt (step id), choices [{ id: 'scratch', label: 'Start over', line, title, primary },
// { id: 'resume', label: 'Resume', line, primary }].
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('./helpers');

const WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-kept
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  issues: { type: array, default: [] }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: plan
    agent: a
    prompt: "plan"
  - id: develop
    agent: a
    prompt: "develop"
  - id: evidence
    agent: a
    prompt: "evidence"
  - id: review
    type: human_approval
    message: "Accept the work?"
  - id: merge
    agent: a
    prompt: "merge"
`;

// a repo on branch `feature`, `own` commits ahead of `main`; `baseAfter` commits land on main after
// (touching the same file when `touch`), as in test/service/resume.test.js's keptWorkRepo
function keptRepo(t, { own = 1, baseAfter = 0, touch = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-kept288-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'widget.js'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('checkout', '-q', '-b', 'feature');
  for (let i = 0; i < own; i++) {
    fs.writeFileSync(path.join(dir, 'widget.js'), `one\nown${i}\n`);
    git('add', '.');
    git('commit', '-q', '-m', `own ${i}`);
  }
  if (baseAfter) {
    git('checkout', '-q', 'main');
    for (let i = 0; i < baseAfter; i++) {
      fs.writeFileSync(path.join(dir, touch ? 'widget.js' : `base${i}.txt`), `base${i}\n`);
      git('add', '.');
      git('commit', '-q', '-m', `base ${i}`);
    }
    git('checkout', '-q', 'feature');
  }
  return dir;
}

const T0 = Date.parse('2026-09-30T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const issueRef = (n) => ({ number: n, url: `https://github.com/o/r/issues/${n}`, title: `Issue ${n}` });

// An ended run: plan and develop done ($1.25 in all), then `stop` decides how it ended:
//   app-closed (interrupted at evidence), gate (interrupted, waiting at review), failed (evidence
//   failed with a multi-line error), limit (a limit stopped it at evidence), cancelled (at evidence)
function fabricate(ws, runId, { issues, worktreeDir, stop = 'app-closed' }) {
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  const ev = [
    { ts: at(0), type: 'workflow.started', run_id: runId, workflow: 'fixture-kept', file: 'fixture-kept.yaml', inputs: { task: 't' }, mock: false, issues },
    { ts: at(1), type: 'worktree.ready', dir: worktreeDir, base: 'main', branch: 'feature' },
    { ts: at(2), type: 'step.started', step_id: 'plan', agent: 'a' },
    { ts: at(120), type: 'session.message_received', session_id: 's1', turn: 1, step_id: 'plan', text: 'ok', cost_usd: 0.25 },
    { ts: at(120), type: 'step.finished', step_id: 'plan' },
    { ts: at(121), type: 'step.started', step_id: 'develop', agent: 'a' },
    { ts: at(600), type: 'session.message_received', session_id: 's2', turn: 1, step_id: 'develop', text: 'ok', cost_usd: 1.0 },
    { ts: at(600), type: 'step.finished', step_id: 'develop' },
    { ts: at(601), type: 'step.started', step_id: 'evidence', agent: 'a' },
  ];
  let status = 'interrupted';
  if (stop === 'gate') {
    ev.push({ ts: at(700), type: 'step.finished', step_id: 'evidence' });
    ev.push({ ts: at(701), type: 'step.started', step_id: 'review', agent: 'human' });
    ev.push({ ts: at(750), type: 'approval.requested', approval_id: 'a1', step_id: 'review', message: 'Accept the work?' });
  } else if (stop === 'failed') {
    status = 'failed';
    ev.push({ ts: at(740), type: 'step.finished', step_id: 'evidence', error: true, output: { error: 'Tests failed: 3 of 10\n    at check (spec/widget.spec.js:12)' } });
    ev.push({ ts: at(750), type: 'workflow.finished', status: 'failed', error: 'Tests failed: 3 of 10\n    at check (spec/widget.spec.js:12)', summary: { cost_usd: 1.25, duration_ms: 750000 } });
  } else if (stop === 'limit') {
    status = 'failed';
    ev.push({ ts: at(740), type: 'limit.exceeded', step_id: 'evidence', limit: 'max_cost_usd' });
    ev.push({ ts: at(750), type: 'workflow.finished', status: 'failed', error: 'Limit exceeded: max_cost_usd', summary: { cost_usd: 1.25, duration_ms: 750000 } });
  } else if (stop === 'cancelled') {
    status = 'cancelled';
    ev.push({ ts: at(750), type: 'workflow.finished', status: 'cancelled', error: 'Cancelled by the user', summary: { cost_usd: 1.25, duration_ms: 750000 } });
  } else {
    ev.push({ ts: at(750), type: 'log', level: 'info', message: 'evidence: taking screenshots' });
  }
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${ev.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'fixture-kept', status, started_at: at(0), finished_at: at(750), duration_ms: 750000,
    issues, inputs: { task: 't' }, sessions: [{ id: 's1', agent: 'a', cost_usd: 0.25 }, { id: 's2', agent: 'a', cost_usd: 1.0 }],
  }));
}

function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-kept.yaml'), WORKFLOW);
  return { api, ws };
}
// the kept-work question run:start answers for these issues (nothing is started)
async function ask(api, issues) {
  const out = await api['run:start']({ file: 'fixture-kept.yaml', inputs: { task: 't', repo_path: '.' }, mock: true, issues });
  assert.ok(out.kept, `a kept-work question: ${JSON.stringify(out).slice(0, 300)}`);
  return out.kept;
}
const detailsText = (kept) => (Array.isArray(kept.details) ? kept.details.join('\n') : String(kept.details || ''));
const choice = (kept, id) => kept.choices.find((c) => c.id === id);

test('#288 kept-work question: the title is "<issues>: a run stopped at <step>"', async (t) => {
  const { api, ws } = setup(t);
  const issues = [282, 284, 285].map(issueRef);
  fabricate(ws, '20260930-100000-kept288a01', { issues, worktreeDir: keptRepo(t) });
  const kept = await ask(api, issues);
  assert.equal(kept.title, '#282 + #284 + #285: a run stopped at Evidence');
  assert.equal(kept.stoppedAt, 'evidence');
});

test('#288 kept-work question: one-line stop reasons: the app closed, a human gate (which one), a failure\'s first line, a limit, cancelled by the owner', async (t) => {
  const { api, ws } = setup(t);
  const repo = keptRepo(t);
  const cases = [
    ['app-closed', 401, /app closed/i, 'evidence'],
    ['gate', 402, /gate[^.]*Review|Review[^.]*gate/i, 'review'],
    ['failed', 403, /Tests failed: 3 of 10/, 'evidence'],
    ['limit', 404, /limit/i, 'evidence'],
    ['cancelled', 405, /cancel/i, 'evidence'],
  ];
  for (const [stop, n, reason, step] of cases) {
    fabricate(ws, `20260930-100000-kept288r${n}`, { issues: [issueRef(n)], worktreeDir: repo, stop });
    const kept = await ask(api, [issueRef(n)]);
    assert.match(kept.message, reason, `${stop}: ${kept.message}`);
    assert.equal(kept.stoppedAt, step, `${stop}: stopped at ${step}`);
    if (stop === 'failed') assert.equal(kept.message.includes('widget.spec.js'), false, 'only the failure\'s first line');
    if (stop === 'gate') assert.equal(kept.title, '#402: a run stopped at Review');
  }
});

test('#288 kept-work question: the message lists the done steps, the steps left and what was spent (US$ and time)', async (t) => {
  const { api, ws } = setup(t);
  fabricate(ws, '20260930-100000-kept288s01', { issues: [issueRef(410)], worktreeDir: keptRepo(t) });
  const { message } = await ask(api, [issueRef(410)]);
  for (const word of ['Plan', 'Develop', 'Merge']) assert.ok(message.includes(word), `${word}: ${message}`);
  assert.match(message, /\bdone\b/i, message);
  assert.match(message, /\bleft\b/i, message);
  assert.match(message, /US\$ ?1\.25/, message);
  assert.match(message, /12 ?m/, `12 min 30 s spent: ${message}`);
});

test('#288 kept-work question: a base that moved on says "main moved N commits" and that the run merges it at the end, never "resuming will likely conflict"; Resume stays primary', async (t) => {
  const { api, ws } = setup(t);
  fabricate(ws, '20260930-100000-kept288m01', { issues: [issueRef(420)], worktreeDir: keptRepo(t, { own: 3, baseAfter: 2, touch: true }) });
  const kept = await ask(api, [issueRef(420)]);
  assert.match(kept.message, /main moved 2 commits/, kept.message);
  assert.match(kept.message, /the run merges it at the end/, kept.message);
  assert.doesNotMatch(kept.text || '', /resuming will likely conflict/);
  assert.doesNotMatch(kept.message, /resuming will likely conflict/);
  assert.deepEqual(kept.choices.filter((c) => c.primary).map((c) => c.id), ['resume']);
});

test('#288 kept-work question: commit counts and file names go to the details, not the message', async (t) => {
  const { api, ws } = setup(t);
  fabricate(ws, '20260930-100000-kept288d01', { issues: [issueRef(430)], worktreeDir: keptRepo(t, { own: 3, baseAfter: 1, touch: true }) });
  const kept = await ask(api, [issueRef(430)]);
  const details = detailsText(kept);
  assert.ok(details.includes('widget.js'), `the file name in the details: ${details}`);
  assert.match(details, /\b3 commits\b/, details);
  assert.equal(kept.message.includes('widget.js'), false, kept.message);
});

test('#288 kept-work question: the choices are Start over (spends about the old cost again; the old commits stay in their branch) and Resume, Resume primary', async (t) => {
  const { api, ws } = setup(t);
  fabricate(ws, '20260930-100000-kept288c01', { issues: [issueRef(440)], worktreeDir: keptRepo(t) });
  const kept = await ask(api, [issueRef(440)]);
  assert.deepEqual(kept.choices.map((c) => c.id).sort(), ['resume', 'scratch']);
  const scratch = choice(kept, 'scratch');
  const resume = choice(kept, 'resume');
  assert.equal(scratch.label, 'Start over');
  assert.equal(resume.label, 'Resume');
  assert.match(`${scratch.line || ''} ${scratch.label}`, /spends about (US)?\$1\.25 again/);
  assert.match(scratch.title || '', /old commits stay in their branch/i);
  assert.equal(resume.primary, true);
  assert.equal(scratch.primary, false);
});
