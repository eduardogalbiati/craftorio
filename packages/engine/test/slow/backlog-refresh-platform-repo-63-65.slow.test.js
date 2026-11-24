// #63 #65: backlog-refresh.yaml knows the platform repository before its review step. The project's
// clone has the person's local folder as `origin`; that folder's own origin is GitHub: the review
// prompt names `owner/name`. With no GitHub/GitLab remote behind it, the run stops with a clear
// message and no agent turn.
//
// Seam: WorkflowRun on the bundled workflow, with the real machine actions (the resolution reads real
// git repositories) except two boundaries: every agent gets the mock provider (no model, allowed
// under CRAFTORIO_SIMULATION_ONLY), and a transition's apply.js runs with a fake gh. The mock provider
// cannot give a whole answer, so a test that needs one writes refresh.json right before apply.js reads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { exec, execFileSync } = require('child_process');
const { real } = require('../../engine/machine-actions');
const { WorkflowRun } = require('../../engine/workflow');
const { runUntilStall } = require('../helpers/run-watch');
const { repoFromTemplate } = require('../helpers/git-fixture');

process.env.CRAFTORIO_MOCK_DELAY_SCALE = '0.02';
const root = path.join(__dirname, '..', '..', '..', '..');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// the clone is named after the folder's path (projects-finance-app), never after the repository
function localProject(t, { remote, as = 'path' }) {
  const folder = repoFromTemplate(t);
  if (remote) git(folder, 'remote', 'add', 'origin', remote);
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-refresh-run-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
  const clone = path.join(tmp, 'repos', 'projects-finance-app');
  fs.mkdirSync(path.dirname(clone));
  git(tmp, 'clone', '-q', folder, clone);
  git(clone, 'remote', 'set-url', 'origin', as === 'file-url' ? pathToFileURL(folder).href : folder);
  return { tmp, clone };
}

// A fake gh: every call is recorded in gh-calls.jsonl, `view` answers an open issue
function fakeGh(dir) {
  const file = path.join(dir, 'fake-gh.js');
  fs.writeFileSync(file, [
    "const fs = require('fs');",
    'const args = process.argv.slice(3);',
    `fs.appendFileSync(${JSON.stringify(path.join(dir, 'gh-calls.jsonl'))}, JSON.stringify(args) + '\\n');`,
    "console.log(args[1] === 'view' ? JSON.stringify({ body: 'before old after', updatedAt: '', state: 'OPEN', labels: [] }) : '');",
  ].join('\n'));
  return file;
}

// Runs the workflow. `answer(prompt)`: the refresh.json apply.js reads.
async function refresh(t, { tmp, clone }, { answer = null, platform = 'gh' } = {}) {
  const machine = real();
  const fake = fakeGh(tmp);
  let run = null;
  const prompts = [];
  machine.provider = () => ({ type: 'mock' });
  machine.runAction = (cmd, opts) => {
    if (!/apply\.js" .*--mode (?:safe|scope)/.test(cmd)) return real().runAction(cmd, opts);
    if (answer) fs.writeFileSync(path.join(run.runDir, 'refresh.json'), JSON.stringify(answer(prompts.at(-1))));
    return new Promise((resolve) => {
      exec(cmd, { cwd: tmp, windowsHide: true, env: { ...process.env, BACKLOG_REFRESH_FAKE_CLI: fake } }, (err, stdout, stderr) => {
        resolve({ skipped: false, exit_code: err ? err.code ?? 1 : 0, output: `${stdout}${stderr}`, stdout, stderr });
      });
    });
  };
  run = new WorkflowRun({ file: path.join(root, 'workflows', 'backlog-refresh.yaml'), inputs: { project_path: clone, git_platform: platform }, mock: false, runsDir: path.join(tmp, 'runs'), machine, memoryGuard: null });
  const gates = [];
  run.on('event', (ev) => {
    if (ev.type === 'session.message_sent') prompts.push(ev.prompt);
    if (ev.type !== 'approval.requested') return;
    gates.push(ev);
    const choice = ev.choices.some((c) => c.id === 'skip') ? 'skip' : ev.choices[0].id;
    setImmediate(() => run.resolveApproval(ev.approval_id, choice, 'user'));
  });
  const { events, finished } = await runUntilStall(run, { stallMs: 20000 });
  const turns = events.filter((e) => e.type === 'session.message_sent');
  const calls = path.join(tmp, 'gh-calls.jsonl');
  return {
    events, finished, gates, turns,
    prompt: turns.filter((e) => e.step_id === 'review').map((e) => e.prompt).join('\n'),
    ghCalls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [],
    applied: ['safe', 'scope'].filter((m) => fs.existsSync(path.join(run.runDir, `applied-${m}.json`))),
  };
}

// The message the owner reads when the run stops: its error, a gate's message or a warning of its log
const said = (r) => [
  r.finished.error,
  ...r.gates.map((g) => g.message),
  ...r.events.filter((e) => e.type === 'log' && ['warn', 'error'].includes(e.level)).map((e) => e.message),
].filter(Boolean).join('\n');

const EMPTY = { base: 'main', since: '24 hours ago', reviewed: 0, issues: [], scope: [], report: 'Nothing to do.' };

for (const as of ['path', 'file-url']) {
  test(`#63 #65 backlog-refresh: the review prompt of a project cloned from a local folder (${as}) names the GitHub repository behind it and asks to copy it into repo`, { timeout: 60000 }, async (t) => {
    const p = localProject(t, { remote: 'git@github.com:owner/finance-app.git', as });
    const r = await refresh(t, p, { answer: () => ({ ...EMPTY, repo: 'owner/finance-app' }) });
    assert.match(r.prompt, /(?<![\w.-])owner\/finance-app(?![\w-])/);
    // near the name, the prompt says it goes into the answer's `repo`
    assert.match(r.prompt, /owner\/finance-app[^]{0,200}`repo`|`repo`[^]{0,200}owner\/finance-app/);
  });
}

test('#65 backlog-refresh: the review prompt names the repository of a clone whose origin is GitHub, not its folder name', { timeout: 60000 }, async (t) => {
  const p = localProject(t, { remote: null });
  git(p.clone, 'remote', 'set-url', 'origin', 'https://github.com/owner/finance-app.git');
  const r = await refresh(t, p, { answer: () => ({ ...EMPTY, repo: 'owner/finance-app' }) });
  assert.match(r.prompt, /(?<![\w.-])owner\/finance-app(?![\w-])/);
});

test('#65 backlog-refresh: the review prompt names the GitLab project, with its group', { timeout: 60000 }, async (t) => {
  const p = localProject(t, { remote: 'git@gitlab.example.com:group/sub/finance-app.git' });
  const r = await refresh(t, p, { platform: 'gl', answer: () => ({ ...EMPTY, repo: 'group/sub/finance-app' }) });
  assert.match(r.prompt, /group\/sub\/finance-app(?![\w-])/);
});

test('#63 #65 backlog-refresh: an answer echoing the repository the prompt names is applied on it', { timeout: 60000 }, async (t) => {
  const p = localProject(t, { remote: 'https://github.com/owner/finance-app.git' });
  const r = await refresh(t, p, {
    answer: (prompt) => ({
      ...EMPTY, reviewed: 1,
      repo: /(?<![\w.-])owner\/[\w-]*finance-app/.exec(prompt)?.[0] || 'no repository in the prompt',
      issues: [{ number: 5, updated_at: '', edits: [{ find: 'old', replace: 'new' }], complexity: 0, note: '' }],
    }),
  });
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.deepEqual(r.ghCalls.map((c) => [c[1], c[2], c[c.indexOf('--repo') + 1]]), [['view', '5', 'owner/finance-app'], ['edit', '5', 'owner/finance-app']]);
});

test('#65 backlog-refresh: an answer with 0 reviewed issues and an unexpected repo ends the run without the apply_failed gate', { timeout: 60000 }, async (t) => {
  const p = localProject(t, { remote: 'https://github.com/owner/finance-app.git' });
  const r = await refresh(t, p, { answer: () => ({ ...EMPTY, repo: 'owner/projects-finance-app' }) });
  assert.equal(r.finished.status, 'success', r.finished.error);
  assert.equal(r.gates.some((g) => g.step_id === 'apply_failed'), false);
  assert.deepEqual(r.ghCalls, []);
});

test('#65 backlog-refresh: an answer that would edit issues of another repository still stops at apply_failed, nothing applied', { timeout: 60000 }, async (t) => {
  const p = localProject(t, { remote: 'https://github.com/owner/finance-app.git' });
  const r = await refresh(t, p, {
    answer: () => ({
      ...EMPTY, reviewed: 1, repo: 'owner/projects-finance-app',
      issues: [{ number: 5, updated_at: '', edits: [{ find: 'old', replace: 'new' }], complexity: 0, note: '' }],
    }),
  });
  const gate = r.gates.find((g) => g.step_id === 'apply_failed');
  assert.match(gate?.message || '', /The answer is about owner\/projects-finance-app, the project's remote is owner\/finance-app/);
  assert.deepEqual(r.ghCalls, []);
  assert.deepEqual(r.applied, []);
});

for (const as of ['path', 'file-url']) {
  test(`#63 backlog-refresh: a project with no GitHub/GitLab remote behind its local origin (${as}) stops with a clear message and runs no agent turn`, { timeout: 60000 }, async (t) => {
    const p = localProject(t, { remote: null, as });
    const r = await refresh(t, p);
    assert.equal(r.turns.length, 0, 'no agent turn (nor a supervisor one)');
    assert.notEqual(r.finished.status, 'success');
    assert.match(said(r), /\b(?:not|no)\b.{0,80}(?:GitHub\/GitLab|GitHub or GitLab)/i);
    assert.doesNotMatch(said(r), /not a GitHub remote/);
    assert.deepEqual(r.ghCalls, []);
  });
}

test('#63 backlog-refresh: a project with no origin at all runs no agent turn either', { timeout: 60000 }, async (t) => {
  const p = localProject(t, { remote: null });
  git(p.clone, 'remote', 'remove', 'origin');
  const r = await refresh(t, p);
  assert.equal(r.turns.length, 0);
  assert.notEqual(r.finished.status, 'success');
  assert.match(said(r), /\b(?:not|no)\b.{0,80}(?:GitHub\/GitLab|GitHub or GitLab)/i);
});
